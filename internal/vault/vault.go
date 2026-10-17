// Package vault — папка-хранилище с YAML-конфигами (как vault в Obsidian).
package vault

import (
	"errors"
	"fmt"
	"io/fs"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

type Vault struct {
	Root string
}

// Open открывает существующую папку. Если create — создаёт структуру и примеры.
func Open(root string, create bool) (*Vault, error) {
	root = filepath.Clean(root)
	st, err := os.Stat(root)
	if err != nil || !st.IsDir() {
		return nil, fmt.Errorf("папка не найдена: %s", root)
	}
	v := &Vault{Root: root}
	for _, d := range []string{"servers", "vpn", "labs", "scripts", ".app"} {
		if err := os.MkdirAll(filepath.Join(root, d), 0o755); err != nil {
			return nil, err
		}
	}
	if create {
		v.writeExamples()
	}
	return v, nil
}

// Abs превращает относительный путь хранилища в абсолютный и не даёт выйти за его пределы.
func (v *Vault) Abs(rel string) (string, error) {
	if rel == "" {
		return "", errors.New("пустой путь")
	}
	if filepath.IsAbs(rel) {
		return "", errors.New("нужен путь внутри хранилища")
	}
	p := filepath.Join(v.Root, filepath.FromSlash(rel))
	r, err := filepath.Rel(v.Root, p)
	if err != nil || strings.HasPrefix(r, "..") {
		return "", errors.New("путь вне хранилища")
	}
	return p, nil
}

// Resolve: для путей из конфигов. Абсолютные и ~/ оставляем, относительные — от корня хранилища.
func (v *Vault) Resolve(p string) string {
	if p == "" {
		return ""
	}
	if strings.HasPrefix(p, "~/") || strings.HasPrefix(p, `~\`) {
		home, _ := os.UserHomeDir()
		return filepath.Join(home, p[2:])
	}
	if filepath.IsAbs(p) || (len(p) > 2 && p[1] == ':') {
		return filepath.FromSlash(p)
	}
	return filepath.Join(v.Root, filepath.FromSlash(p))
}

func (v *Vault) AppDir(sub ...string) string {
	p := filepath.Join(append([]string{v.Root, ".app"}, sub...)...)
	_ = os.MkdirAll(p, 0o755)
	return p
}

func (v *Vault) ReadFile(rel string) (string, error) {
	p, err := v.Abs(rel)
	if err != nil {
		return "", err
	}
	b, err := os.ReadFile(p)
	return string(b), err
}

// WriteFile сохраняет файл. Для YAML сначала проверяет синтаксис, но сохраняет в любом случае.
func (v *Vault) WriteFile(rel, text string) (string, error) {
	p, err := v.Abs(rel)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return "", err
	}
	if err := os.WriteFile(p, []byte(text), 0o644); err != nil {
		return "", err
	}
	if isYAML(rel) {
		var x any
		if err := yaml.Unmarshal([]byte(text), &x); err != nil {
			return err.Error(), nil
		}
	}
	return "", nil
}

func (v *Vault) Delete(rel string) error {
	p, err := v.Abs(rel)
	if err != nil {
		return err
	}
	return os.Remove(p)
}

func isYAML(p string) bool {
	e := strings.ToLower(filepath.Ext(p))
	return e == ".yaml" || e == ".yml"
}

var badName = regexp.MustCompile(`[^\w.\-]+`)

// Slug делает безопасное имя файла.
func Slug(s string) string {
	s = strings.Trim(badName.ReplaceAllString(strings.TrimSpace(s), "-"), "-")
	if s == "" {
		s = "item"
	}
	return s
}

// SaveServer записывает сервер в servers/<group>/<name>.yaml (или в его текущий файл).
func (v *Vault) SaveServer(s Server) (string, error) {
	if s.Name == "" || s.Host == "" {
		return "", errors.New("нужны имя и адрес")
	}
	rel := s.File
	if rel == "" {
		dir := "servers"
		if s.Group != "" && !strings.HasPrefix(s.Group, "lab:") {
			dir += "/" + Slug(s.Group)
		}
		rel = dir + "/" + Slug(s.Name) + ".yaml"
	}
	if s.Port == 22 {
		s.Port = 0
	}
	b, err := yaml.Marshal(s)
	if err != nil {
		return "", err
	}
	_, err = v.WriteFile(rel, string(b))
	return rel, err
}

// Load читает всё хранилище.
func (v *Vault) Load() Snapshot {
	snap := Snapshot{Path: v.Root, Name: filepath.Base(v.Root)}
	_ = filepath.WalkDir(v.Root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		rel, _ := filepath.Rel(v.Root, p)
		rel = filepath.ToSlash(rel)
		if d.IsDir() {
			if rel != "." && (strings.HasPrefix(d.Name(), ".") || d.Name() == "node_modules") {
				return fs.SkipDir
			}
			return nil
		}
		snap.Tree = append(snap.Tree, rel)
		top := strings.SplitN(rel, "/", 2)[0]
		switch {
		case top == "servers" && isYAML(rel):
			var s Server
			if err := readYAML(p, &s); err != nil {
				snap.Errors = append(snap.Errors, rel+": "+err.Error())
				return nil
			}
			s.File = rel
			if s.Name == "" {
				s.Name = strings.TrimSuffix(d.Name(), filepath.Ext(d.Name()))
			}
			s.ID = s.Name
			if s.Port == 0 {
				s.Port = 22
			}
			if s.Auth == "" {
				if s.Key != "" {
					s.Auth = "key"
				} else {
					s.Auth = "password"
				}
			}
			if s.Group == "" {
				if s.Lab != "" {
					s.Group = "lab: " + s.Lab
				} else if parts := strings.Split(rel, "/"); len(parts) > 2 {
					s.Group = parts[len(parts)-2]
				} else {
					s.Group = "без группы"
				}
			}
			snap.Servers = append(snap.Servers, s)
		case top == "vpn" && isYAML(rel):
			var p2 VPNProfile
			if err := readYAML(p, &p2); err != nil {
				snap.Errors = append(snap.Errors, rel+": "+err.Error())
				return nil
			}
			p2.File = rel
			if p2.Name == "" {
				p2.Name = strings.TrimSuffix(d.Name(), filepath.Ext(d.Name()))
			}
			p2.ID = p2.Name
			snap.VPNs = append(snap.VPNs, p2)
		case top == "labs" && isYAML(rel):
			var l Lab
			if err := readYAML(p, &l); err != nil {
				snap.Errors = append(snap.Errors, rel+": "+err.Error())
				return nil
			}
			l.File = rel
			if l.Name == "" {
				l.Name = strings.TrimSuffix(d.Name(), filepath.Ext(d.Name()))
			}
			l.ID = l.Name
			snap.Labs = append(snap.Labs, l)
		case top == "scripts":
			if k := ScriptKind(rel); k != "" {
				snap.Scripts = append(snap.Scripts, Script{Path: rel, Kind: k})
			}
		}
		return nil
	})
	sort.Slice(snap.Servers, func(i, j int) bool {
		if snap.Servers[i].Group != snap.Servers[j].Group {
			return snap.Servers[i].Group < snap.Servers[j].Group
		}
		return snap.Servers[i].Name < snap.Servers[j].Name
	})
	return snap
}

// ScriptKind определяет, как запускать скрипт, по расширению.
func ScriptKind(p string) string {
	switch strings.ToLower(filepath.Ext(p)) {
	case ".sh", ".bash":
		return "bash"
	case ".yml", ".yaml":
		return "ansible"
	case ".ps1":
		return "powershell"
	case ".bat", ".cmd":
		return "cmd"
	}
	return ""
}

func readYAML(p string, out any) error {
	b, err := os.ReadFile(p)
	if err != nil {
		return err
	}
	return yaml.Unmarshal(b, out)
}

// ---------- Лабы: разворачиваем count/ip_start в список машин ----------

type VMSpec struct {
	Name string `json:"name"` // имя VM в гипервизоре: <lab>-<machine>[-N]
	Host string `json:"host"` // hostname внутри VM
	CPU  int    `json:"cpu"`
	RAM  int    `json:"ram"`
	IP   string `json:"ip"`
}

func (l Lab) Expand() ([]VMSpec, error) {
	var out []VMSpec
	_, ipnet, err := net.ParseCIDR(l.Network.CIDR)
	if err != nil {
		return nil, fmt.Errorf("network.cidr: %v", err)
	}
	for _, m := range l.Machines {
		n := m.Count
		if n <= 0 {
			n = 1
		}
		if m.CPU == 0 {
			m.CPU = 1
		}
		if m.RAM == 0 {
			m.RAM = 1024
		}
		start := m.IP
		if m.IPStart != "" {
			start = m.IPStart
		}
		ip := net.ParseIP(start).To4()
		if ip == nil {
			return nil, fmt.Errorf("машина %s: нужен ip или ip_start", m.Name)
		}
		for i := 0; i < n; i++ {
			host := m.Name
			if m.Count > 1 {
				host = fmt.Sprintf("%s-%d", m.Name, i+1)
			}
			cur := make(net.IP, 4)
			copy(cur, ip)
			cur[3] += byte(i)
			if !ipnet.Contains(cur) {
				return nil, fmt.Errorf("%s: IP %s вне сети %s", host, cur, l.Network.CIDR)
			}
			out = append(out, VMSpec{Name: l.Name + "-" + host, Host: host, CPU: m.CPU, RAM: m.RAM, IP: cur.String()})
		}
	}
	return out, nil
}

func (l Lab) PrefixLen() int {
	_, n, err := net.ParseCIDR(l.Network.CIDR)
	if err != nil {
		return 24
	}
	o, _ := n.Mask.Size()
	return o
}
