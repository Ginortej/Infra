// Package vpn — VPN-профили. Каждый профиль = отдельный процесс sing-box с локальным
// прокси (SOCKS5 + HTTP на одном порту). Вкладки и SSH выбирают, через какой профиль идти.
package vpn

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"infra/internal/proc"
	"infra/internal/vault"
)

type Status struct {
	ID      string   `json:"id"`
	Type    string   `json:"type"`
	Running bool     `json:"running"`
	Addr    string   `json:"addr"`
	Error   string   `json:"error"`
	Since   int64    `json:"since"`
	Log     []string `json:"log"`
}

type proc_ struct {
	cmd    *exec.Cmd
	cancel context.CancelFunc
	since  time.Time
	log    []string
	err    string
}

type Manager struct {
	Vault    func() *vault.Vault
	Profiles func() []vault.VPNProfile
	SingBox  func() string // путь к sing-box.exe ("" — не найден)
	OnChange func()

	mu    sync.Mutex
	procs map[string]*proc_
	errs  map[string]string
}

func (m *Manager) init() {
	if m.procs == nil {
		m.procs = map[string]*proc_{}
		m.errs = map[string]string{}
	}
}

func (m *Manager) profile(id string) (vault.VPNProfile, bool) {
	for _, p := range m.Profiles() {
		if p.ID == id {
			return p, true
		}
	}
	return vault.VPNProfile{}, false
}

func (m *Manager) changed() {
	if m.OnChange != nil {
		go m.OnChange()
	}
}

// Addr — адрес локального прокси профиля, если он работает.
func (m *Manager) Addr(id string) (string, error) {
	p, ok := m.profile(id)
	if !ok {
		return "", fmt.Errorf("VPN-профиль %q не найден", id)
	}
	if p.Type == "socks" {
		if p.Proxy == "" {
			return "", fmt.Errorf("в профиле %s не указан proxy", id)
		}
		return p.Proxy, nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.init()
	if _, ok := m.procs[id]; !ok {
		return "", fmt.Errorf("VPN %s не подключён — включи его на панели VPN", id)
	}
	return fmt.Sprintf("127.0.0.1:%d", p.Socks), nil
}

// ProxyEnv — переменные окружения для локальных оболочек.
func (m *Manager) ProxyEnv(id string) ([]string, error) {
	addr, err := m.Addr(id)
	if err != nil {
		return nil, err
	}
	p, _ := m.profile(id)
	env := []string{"ALL_PROXY=socks5://" + addr, "all_proxy=socks5://" + addr}
	if p.Type != "socks" {
		env = append(env, "HTTP_PROXY=http://"+addr, "HTTPS_PROXY=http://"+addr, "http_proxy=http://"+addr, "https_proxy=http://"+addr)
	}
	return env, nil
}

func (m *Manager) Status() []Status {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.init()
	var out []Status
	for _, p := range m.Profiles() {
		st := Status{ID: p.ID, Type: p.Type}
		if p.Type == "socks" {
			st.Addr = p.Proxy
			if c, err := net.DialTimeout("tcp", p.Proxy, 500*time.Millisecond); err == nil {
				c.Close()
				st.Running = true
			} else {
				st.Error = "прокси не отвечает"
			}
		} else if pr, ok := m.procs[p.ID]; ok {
			st.Running = true
			st.Addr = fmt.Sprintf("127.0.0.1:%d", p.Socks)
			st.Since = pr.since.Unix()
			st.Log = append([]string(nil), pr.log...)
		} else {
			st.Addr = fmt.Sprintf("127.0.0.1:%d", p.Socks)
			st.Error = m.errs[p.ID]
		}
		out = append(out, st)
	}
	return out
}

func (m *Manager) Start(id string) error {
	p, ok := m.profile(id)
	if !ok {
		return fmt.Errorf("профиль %q не найден", id)
	}
	if p.Type == "socks" {
		m.changed()
		return nil // внешний прокси — нечего запускать
	}
	sb := m.SingBox()
	if sb == "" {
		return errors.New("не найден sing-box.exe. Скачай его с github.com/SagerNet/sing-box/releases и укажи путь в Настройках (или положи в папку bin хранилища)")
	}
	if p.Socks == 0 {
		return fmt.Errorf("в профиле %s не указан порт socks", id)
	}
	v := m.Vault()
	cfg, err := BuildConfig(p, v)
	if err != nil {
		return err
	}
	cfgPath := filepath.Join(v.AppDir("vpn"), vault.Slug(id)+".json")
	if err := os.WriteFile(cfgPath, cfg, 0o600); err != nil {
		return err
	}
	m.mu.Lock()
	m.init()
	if _, ok := m.procs[id]; ok {
		m.mu.Unlock()
		return nil
	}
	m.mu.Unlock()

	ctx, cancel := context.WithCancel(context.Background())
	cmd := proc.Command(ctx, sb, "run", "-c", cfgPath)
	cmd.Dir = filepath.Dir(cfgPath)
	stderr, _ := cmd.StderrPipe()
	cmd.Stdout = cmd.Stderr
	if err := cmd.Start(); err != nil {
		cancel()
		return fmt.Errorf("sing-box: %v", err)
	}
	pr := &proc_{cmd: cmd, cancel: cancel, since: time.Now()}
	m.mu.Lock()
	m.procs[id] = pr
	delete(m.errs, id)
	m.mu.Unlock()

	go func() {
		sc := bufio.NewScanner(stderr)
		for sc.Scan() {
			line := stripANSI(sc.Text())
			m.mu.Lock()
			pr.log = append(pr.log, line)
			if len(pr.log) > 50 {
				pr.log = pr.log[len(pr.log)-50:]
			}
			if strings.Contains(line, "FATAL") || strings.Contains(line, "ERROR") {
				pr.err = line
			}
			m.mu.Unlock()
		}
	}()
	go func() {
		err := cmd.Wait()
		m.mu.Lock()
		if m.procs[id] == pr {
			delete(m.procs, id)
			msg := pr.err
			if msg == "" && err != nil && ctx.Err() == nil {
				msg = "sing-box завершился: " + err.Error()
				if n := len(pr.log); n > 0 {
					msg += " — " + pr.log[n-1]
				}
			}
			if msg != "" && ctx.Err() == nil {
				m.errs[id] = msg
			}
		}
		m.mu.Unlock()
		m.changed()
	}()

	// ждём, пока поднимется порт
	addr := fmt.Sprintf("127.0.0.1:%d", p.Socks)
	for i := 0; i < 40; i++ {
		time.Sleep(150 * time.Millisecond)
		m.mu.Lock()
		_, alive := m.procs[id]
		e := m.errs[id]
		m.mu.Unlock()
		if !alive {
			if e == "" {
				e = "sing-box сразу завершился"
			}
			return errors.New(e)
		}
		if c, err := net.DialTimeout("tcp", addr, 200*time.Millisecond); err == nil {
			c.Close()
			break
		}
	}
	m.changed()
	return nil
}

func (m *Manager) Stop(id string) {
	m.mu.Lock()
	m.init()
	pr := m.procs[id]
	delete(m.procs, id)
	delete(m.errs, id)
	m.mu.Unlock()
	if pr != nil {
		pr.cancel()
	}
	m.changed()
}

func (m *Manager) StopAll() {
	m.mu.Lock()
	m.init()
	all := m.procs
	m.procs = map[string]*proc_{}
	m.mu.Unlock()
	for _, pr := range all {
		pr.cancel()
	}
}

func stripANSI(s string) string {
	var b strings.Builder
	esc := false
	for _, r := range s {
		if r == 0x1b {
			esc = true
			continue
		}
		if esc {
			if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') {
				esc = false
			}
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}

// ---------- Генерация конфига sing-box ----------

func BuildConfig(p vault.VPNProfile, v *vault.Vault) ([]byte, error) {
	cfg := map[string]any{
		"log": map[string]any{"level": "warn", "timestamp": true},
		"inbounds": []any{map[string]any{
			"type": "mixed", "tag": "in", "listen": "127.0.0.1", "listen_port": p.Socks,
		}},
		"outbounds": []any{map[string]any{"type": "direct", "tag": "direct"}},
		"route":     map[string]any{"final": "proxy"},
	}
	switch p.Type {
	case "wireguard":
		if p.WireGuard == "" {
			return nil, fmt.Errorf("в профиле %s не указан файл wireguard: .conf", p.ID)
		}
		b, err := os.ReadFile(v.Resolve(p.WireGuard))
		if err != nil {
			return nil, fmt.Errorf("не удалось прочитать %s", p.WireGuard)
		}
		ep, err := WireGuardEndpoint(string(b))
		if err != nil {
			return nil, err
		}
		cfg["endpoints"] = []any{ep}
	case "singbox", "":
		if len(p.Outbound) == 0 {
			return nil, fmt.Errorf("в профиле %s нет блока outbound", p.ID)
		}
		ob := map[string]any{}
		for k, val := range p.Outbound {
			ob[k] = val
		}
		ob["tag"] = "proxy"
		cfg["outbounds"] = append([]any{ob}, cfg["outbounds"].([]any)...)
	default:
		return nil, fmt.Errorf("неизвестный type: %s (нужно wireguard, singbox или socks)", p.Type)
	}
	return json.MarshalIndent(cfg, "", "  ")
}

// WireGuardEndpoint переводит обычный wg .conf в endpoint sing-box (1.11+).
func WireGuardEndpoint(conf string) (map[string]any, error) {
	ep := map[string]any{"type": "wireguard", "tag": "proxy"}
	var peers []any
	var peer map[string]any
	section := ""
	for _, raw := range strings.Split(conf, "\n") {
		line := strings.TrimSpace(raw)
		if i := strings.IndexAny(line, "#;"); i >= 0 {
			line = strings.TrimSpace(line[:i])
		}
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "[") {
			section = strings.ToLower(strings.Trim(line, "[]"))
			if section == "peer" {
				peer = map[string]any{}
				peers = append(peers, peer)
			}
			continue
		}
		k, val, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		k = strings.ToLower(strings.TrimSpace(k))
		val = strings.TrimSpace(val)
		list := func() []string {
			var out []string
			for _, x := range strings.Split(val, ",") {
				if x = strings.TrimSpace(x); x != "" {
					out = append(out, x)
				}
			}
			return out
		}
		switch section {
		case "interface":
			switch k {
			case "privatekey":
				ep["private_key"] = val
			case "address":
				ep["address"] = list()
			case "mtu":
				if n, err := strconv.Atoi(val); err == nil {
					ep["mtu"] = n
				}
			}
		case "peer":
			switch k {
			case "publickey":
				peer["public_key"] = val
			case "presharedkey":
				peer["pre_shared_key"] = val
			case "allowedips":
				peer["allowed_ips"] = list()
			case "persistentkeepalive":
				if n, err := strconv.Atoi(val); err == nil {
					peer["persistent_keepalive_interval"] = n
				}
			case "endpoint":
				host, port, err := net.SplitHostPort(val)
				if err != nil {
					return nil, fmt.Errorf("Endpoint %q: %v", val, err)
				}
				pn, _ := strconv.Atoi(port)
				peer["address"] = host
				peer["port"] = pn
			}
		}
	}
	if ep["private_key"] == nil || len(peers) == 0 {
		return nil, errors.New("в .conf нет PrivateKey или [Peer]")
	}
	ep["peers"] = peers
	return ep, nil
}
