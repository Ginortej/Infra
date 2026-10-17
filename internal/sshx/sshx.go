// Package sshx — SSH-подключения к серверам из хранилища.
package sshx

import (
	"bufio"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/zalando/go-keyring"
	"golang.org/x/crypto/ssh"
	"golang.org/x/net/proxy"

	"infra/internal/vault"
)

const keyringService = "Infra"

// ErrNeedPassword — интерфейс должен спросить пароль (или пароль ключа) и повторить.
var ErrNeedPassword = errors.New("NEED_PASSWORD")

// Dialer знает, как подключаться к серверам: хранилище, порты VPN, временные пароли.
type Dialer struct {
	Vault   *vault.Vault
	VPNAddr func(vpnID string) (string, error) // адрес локального прокси VPN-профиля
	Servers func() []vault.Server
	mu      sync.Mutex
	session map[string]string // пароли на время сеанса (если не сохранять)
	knownMu sync.Mutex
}

func (d *Dialer) secretKey(id string) string { return "server:" + id }

// SetPassword запоминает пароль: в Credential Manager (remember) или только до закрытия программы.
func (d *Dialer) SetPassword(id, pw string, remember bool) error {
	d.mu.Lock()
	if d.session == nil {
		d.session = map[string]string{}
	}
	d.session[id] = pw
	d.mu.Unlock()
	if remember {
		return keyring.Set(keyringService, d.secretKey(id), pw)
	}
	return nil
}

func (d *Dialer) ForgetPassword(id string) {
	d.mu.Lock()
	delete(d.session, id)
	d.mu.Unlock()
	_ = keyring.Delete(keyringService, d.secretKey(id))
}

// Password возвращает сохранённый пароль сервера, если он есть.
func (d *Dialer) Password(id string) string {
	d.mu.Lock()
	pw, ok := d.session[id]
	d.mu.Unlock()
	if ok {
		return pw
	}
	if pw, err := keyring.Get(keyringService, d.secretKey(id)); err == nil {
		return pw
	}
	return ""
}

func (d *Dialer) find(id string) (vault.Server, bool) {
	for _, s := range d.Servers() {
		if s.ID == id {
			return s, true
		}
	}
	return vault.Server{}, false
}

// Dial подключается к серверу. vpnOverride: nil — как в конфиге, "" — напрямую, "id" — через профиль.
func (d *Dialer) Dial(id string, vpnOverride *string) (*ssh.Client, error) {
	return d.DialNotify(id, vpnOverride, nil)
}

// DialNotify — как Dial, notify получает служебные сообщения (например, «новый ключ хоста сохранён»).
func (d *Dialer) DialNotify(id string, vpnOverride *string, notify func(string)) (*ssh.Client, error) {
	s, ok := d.find(id)
	if !ok {
		return nil, fmt.Errorf("сервер %q не найден", id)
	}
	vpn := s.VPN
	if vpnOverride != nil {
		vpn = *vpnOverride
	}
	cfg, err := d.clientConfig(s, notify)
	if err != nil {
		return nil, err
	}
	addr := net.JoinHostPort(s.Host, fmt.Sprint(s.Port))

	// через jump-хост
	if s.Jump != "" {
		jc, err := d.DialNotify(s.Jump, vpnOverride, notify)
		if err != nil {
			return nil, fmt.Errorf("jump %s: %w", s.Jump, err)
		}
		conn, err := jc.Dial("tcp", addr)
		if err != nil {
			jc.Close()
			return nil, err
		}
		c, chans, reqs, err := ssh.NewClientConn(conn, addr, cfg)
		if err != nil {
			jc.Close()
			return nil, err
		}
		return ssh.NewClient(c, chans, reqs), nil
	}

	conn, err := d.dialTCP(vpn, addr)
	if err != nil {
		return nil, err
	}
	_ = conn.SetDeadline(time.Now().Add(20 * time.Second))
	c, chans, reqs, err := ssh.NewClientConn(conn, addr, cfg)
	if err != nil {
		conn.Close()
		if strings.Contains(err.Error(), "unable to authenticate") {
			if s.Auth == "password" {
				d.mu.Lock()
				delete(d.session, s.ID)
				d.mu.Unlock()
				return nil, ErrNeedPassword
			}
			return nil, fmt.Errorf("сервер не принял ключ %s", s.Key)
		}
		return nil, err
	}
	_ = conn.SetDeadline(time.Time{})
	return ssh.NewClient(c, chans, reqs), nil
}

// DialTCP — TCP-соединение напрямую или через SOCKS-прокси VPN-профиля.
func (d *Dialer) dialTCP(vpn, addr string) (net.Conn, error) {
	if vpn == "" {
		return net.DialTimeout("tcp", addr, 10*time.Second)
	}
	paddr, err := d.VPNAddr(vpn)
	if err != nil {
		return nil, err
	}
	px, err := proxy.SOCKS5("tcp", paddr, nil, &net.Dialer{Timeout: 10 * time.Second})
	if err != nil {
		return nil, err
	}
	return px.Dial("tcp", addr)
}

// Ping проверяет, открыт ли SSH-порт (для индикаторов статуса).
func (d *Dialer) Ping(s vault.Server) string {
	vpn := s.VPN
	if vpn != "" {
		if _, err := d.VPNAddr(vpn); err != nil {
			return "off"
		}
	}
	c, err := d.dialTCP(vpn, net.JoinHostPort(s.Host, fmt.Sprint(s.Port)))
	if err != nil {
		return "err"
	}
	c.Close()
	return "ok"
}

func (d *Dialer) clientConfig(s vault.Server, notify func(string)) (*ssh.ClientConfig, error) {
	var auths []ssh.AuthMethod
	if s.Auth == "key" {
		keyPath := d.Vault.Resolve(s.Key)
		if keyPath == "" {
			home, _ := os.UserHomeDir()
			for _, n := range []string{"id_ed25519", "id_ecdsa", "id_rsa"} {
				if p := filepath.Join(home, ".ssh", n); fileExists(p) {
					keyPath = p
					break
				}
			}
		}
		b, err := os.ReadFile(keyPath)
		if err != nil {
			return nil, fmt.Errorf("не удалось прочитать ключ %s", keyPath)
		}
		signer, err := ssh.ParsePrivateKey(b)
		var pe *ssh.PassphraseMissingError
		if errors.As(err, &pe) {
			pass := d.Password(s.ID)
			if pass == "" {
				return nil, ErrNeedPassword
			}
			signer, err = ssh.ParsePrivateKeyWithPassphrase(b, []byte(pass))
			if err != nil {
				d.mu.Lock()
				delete(d.session, s.ID)
				d.mu.Unlock()
				return nil, ErrNeedPassword
			}
		} else if err != nil {
			return nil, fmt.Errorf("ключ %s: %v", keyPath, err)
		}
		auths = append(auths, ssh.PublicKeys(signer))
	} else {
		pw := d.Password(s.ID)
		if pw == "" {
			return nil, ErrNeedPassword
		}
		auths = append(auths, ssh.Password(pw), ssh.KeyboardInteractive(func(_, _ string, qs []string, _ []bool) ([]string, error) {
			ans := make([]string, len(qs))
			for i := range ans {
				ans[i] = pw
			}
			return ans, nil
		}))
	}
	return &ssh.ClientConfig{
		User:            s.User,
		Auth:            auths,
		HostKeyCallback: d.hostKeyCallback(notify),
		Timeout:         15 * time.Second,
	}, nil
}

func fileExists(p string) bool { _, err := os.Stat(p); return err == nil }

// hostKeyCallback: «доверие при первом подключении». Новый ключ сохраняется в .app/known_hosts,
// изменившийся ключ — ошибка (возможна подмена сервера).
func (d *Dialer) hostKeyCallback(notify func(string)) ssh.HostKeyCallback {
	return func(host string, remote net.Addr, key ssh.PublicKey) error {
		d.knownMu.Lock()
		defer d.knownMu.Unlock()
		path := filepath.Join(d.Vault.AppDir(), "known_hosts")
		fp := ssh.FingerprintSHA256(key)
		line := host + " " + key.Type() + " " + fp
		if f, err := os.Open(path); err == nil {
			sc := bufio.NewScanner(f)
			for sc.Scan() {
				parts := strings.Fields(sc.Text())
				if len(parts) == 3 && parts[0] == host && parts[1] == key.Type() {
					f.Close()
					if parts[2] == fp {
						return nil
					}
					return fmt.Errorf("ВНИМАНИЕ: ключ хоста %s изменился (было %s, стало %s). Если сервер переустанавливали — удали строку из .app/known_hosts", host, parts[2], fp)
				}
			}
			f.Close()
		}
		f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
		if err != nil {
			return err
		}
		defer f.Close()
		_, err = fmt.Fprintln(f, line)
		if notify != nil {
			notify(fmt.Sprintf("Новый ключ хоста %s %s сохранён", key.Type(), fp))
		}
		return err
	}
}
