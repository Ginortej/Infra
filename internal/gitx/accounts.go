// Package gitx — git-аккаунты (GitHub / GitLab) и работа с репозиториями через git CLI.
// Аккаунты лежат в %APPDATA%\Infra\accounts.json, токены — в диспетчере учётных данных Windows.
package gitx

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/zalando/go-keyring"
	"golang.org/x/crypto/ssh"
)

const keyringService = "Infra"

type Account struct {
	ID       string `json:"id"`
	Provider string `json:"provider"` // github | gitlab
	Host     string `json:"host"`     // github.com, gitlab.com, git.company.ru
	Label    string `json:"label"`    // «Работа», «Личный»
	Username string `json:"username"`
	Name     string `json:"name"`    // для коммитов
	Email    string `json:"email"`   // для коммитов
	GitAuth  string `json:"gitAuth"` // token | ssh — чем авторизоваться в git
	SSHKey   string `json:"sshKey"`  // путь к приватному ключу
	HasToken bool   `json:"hasToken"`
}

type Store struct {
	mu   sync.Mutex
	path string
}

func NewStore() *Store {
	dir, err := os.UserConfigDir()
	if err != nil {
		dir = "."
	}
	dir = filepath.Join(dir, "Infra")
	_ = os.MkdirAll(dir, 0o755)
	return &Store{path: filepath.Join(dir, "accounts.json")}
}

func tokenKey(id string) string { return "git:" + id }

func (s *Store) load() []Account {
	var list []Account
	if b, err := os.ReadFile(s.path); err == nil {
		_ = json.Unmarshal(b, &list)
	}
	return list
}

func (s *Store) save(list []Account) error {
	for i := range list {
		list[i].HasToken = false // не храним флаг, вычисляем при чтении
	}
	b, _ := json.MarshalIndent(list, "", "  ")
	return os.WriteFile(s.path, b, 0o600)
}

func (s *Store) List() []Account {
	s.mu.Lock()
	defer s.mu.Unlock()
	list := s.load()
	for i := range list {
		list[i].HasToken = s.token(list[i].ID) != ""
	}
	return list
}

func (s *Store) Get(id string) (Account, error) {
	for _, a := range s.List() {
		if a.ID == id {
			return a, nil
		}
	}
	return Account{}, fmt.Errorf("git-аккаунт %q не найден", id)
}

func (s *Store) token(id string) string {
	t, err := keyring.Get(keyringService, tokenKey(id))
	if err != nil {
		return ""
	}
	return t
}

// Token — токен аккаунта (пустой, если не задан).
func (s *Store) Token(id string) string { return s.token(id) }

var slugRe = regexp.MustCompile(`[^a-z0-9]+`)

// Save добавляет или обновляет аккаунт. token: "" — не менять, "-" — удалить.
func (s *Store) Save(a Account, token string) (Account, error) {
	a.Provider = strings.ToLower(strings.TrimSpace(a.Provider))
	if a.Provider != "github" && a.Provider != "gitlab" {
		return a, errors.New("provider: github или gitlab")
	}
	a.Host = normalizeHost(a.Host)
	if a.Host == "" {
		a.Host = map[string]string{"github": "github.com", "gitlab": "gitlab.com"}[a.Provider]
	}
	if a.GitAuth != "ssh" {
		a.GitAuth = "token"
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	list := s.load()
	if a.ID == "" {
		base := strings.Trim(slugRe.ReplaceAllString(strings.ToLower(a.Provider+"-"+firstNonEmpty(a.Username, a.Label, "acc")), "-"), "-")
		a.ID = base
		for n := 2; exists(list, a.ID); n++ {
			a.ID = fmt.Sprintf("%s-%d", base, n)
		}
		list = append(list, a)
	} else {
		found := false
		for i := range list {
			if list[i].ID == a.ID {
				list[i] = a
				found = true
			}
		}
		if !found {
			list = append(list, a)
		}
	}
	switch token {
	case "":
	case "-":
		_ = keyring.Delete(keyringService, tokenKey(a.ID))
	default:
		if err := keyring.Set(keyringService, tokenKey(a.ID), strings.TrimSpace(token)); err != nil {
			return a, fmt.Errorf("не удалось сохранить токен: %v", err)
		}
	}
	if err := s.save(list); err != nil {
		return a, err
	}
	a.HasToken = s.token(a.ID) != ""
	return a, nil
}

func (s *Store) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	list := s.load()
	var out []Account
	for _, a := range list {
		if a.ID != id {
			out = append(out, a)
		}
	}
	_ = keyring.Delete(keyringService, tokenKey(id))
	return s.save(out)
}

func exists(list []Account, id string) bool {
	for _, a := range list {
		if a.ID == id {
			return true
		}
	}
	return false
}

func firstNonEmpty(v ...string) string {
	for _, s := range v {
		if strings.TrimSpace(s) != "" {
			return s
		}
	}
	return ""
}

func normalizeHost(h string) string {
	h = strings.TrimSpace(strings.ToLower(h))
	h = strings.TrimPrefix(strings.TrimPrefix(h, "https://"), "http://")
	return strings.TrimRight(h, "/")
}

// GenerateKey создаёт ed25519-ключ в ~/.ssh/infra_<id> и возвращает путь и публичную часть.
func GenerateKey(id, comment string) (string, string, error) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return "", "", err
	}
	block, err := ssh.MarshalPrivateKey(priv, comment)
	if err != nil {
		return "", "", err
	}
	home, _ := os.UserHomeDir()
	dir := filepath.Join(home, ".ssh")
	_ = os.MkdirAll(dir, 0o700)
	name := "infra_" + strings.Trim(slugRe.ReplaceAllString(strings.ToLower(id), "_"), "_")
	path := filepath.Join(dir, name)
	if _, err := os.Stat(path); err == nil {
		path += "_" + time.Now().Format("20060102150405")
	}
	if err := os.WriteFile(path, pem.EncodeToMemory(block), 0o600); err != nil {
		return "", "", err
	}
	sp, _ := ssh.NewPublicKey(pub)
	pubLine := strings.TrimSpace(string(ssh.MarshalAuthorizedKey(sp))) + " " + comment
	if err := os.WriteFile(path+".pub", []byte(pubLine+"\n"), 0o644); err != nil {
		return "", "", err
	}
	return path, pubLine, nil
}

// PublicKey читает .pub рядом с приватным ключом (или выводит его из приватного).
func PublicKey(keyPath string) (string, error) {
	if b, err := os.ReadFile(keyPath + ".pub"); err == nil {
		return strings.TrimSpace(string(b)), nil
	}
	b, err := os.ReadFile(keyPath)
	if err != nil {
		return "", err
	}
	signer, err := ssh.ParsePrivateKey(b)
	if err != nil {
		return "", fmt.Errorf("ключ %s: %v", keyPath, err)
	}
	return strings.TrimSpace(string(ssh.MarshalAuthorizedKey(signer.PublicKey()))), nil
}
