package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"infra/internal/tools"
)

// Agent — модель + инструкция + разрешённые инструменты.
type Agent struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Icon        string   `json:"icon"`  // ключ иконки в интерфейсе
	Color       string   `json:"color"` // акцент
	Desc        string   `json:"desc"`
	Provider    string   `json:"provider"` // ollama | openai
	Model       string   `json:"model"`
	System      string   `json:"system"`
	Tools       []string `json:"tools"`   // пусто — без инструментов (просто чат)
	Approve     string   `json:"approve"` // danger — спрашивать опасные (по умолчанию), all — всё, never — автопилот
	Servers     []string `json:"servers"` // пусто — все серверы
	Temperature float64  `json:"temperature"`
	Template    string   `json:"template,omitempty"`
	Builtin     bool     `json:"builtin,omitempty"`
}

// ---------- Хранилище агентов: %APPDATA%\Infra\agents.json ----------

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
	return &Store{path: filepath.Join(dir, "agents.json")}
}

func NewStoreAt(path string) *Store { return &Store{path: path} }

func (s *Store) load() []Agent {
	var list []Agent
	b, err := os.ReadFile(s.path)
	if err != nil {
		// первый запуск — один агент по умолчанию
		a := FromTemplate("devops", "")
		return []Agent{a}
	}
	_ = json.Unmarshal(b, &list)
	return list
}

func (s *Store) List() []Agent {
	s.mu.Lock()
	defer s.mu.Unlock()
	l := s.load()
	if l == nil {
		l = []Agent{}
	}
	return l
}

func (s *Store) Get(id string) (Agent, bool) {
	for _, a := range s.List() {
		if a.ID == id {
			return a, true
		}
	}
	return Agent{}, false
}

var idRe = regexp.MustCompile(`[^a-z0-9]+`)

func slug(s string) string {
	s = strings.Trim(idRe.ReplaceAllString(strings.ToLower(translit(s)), "-"), "-")
	if s == "" {
		s = "agent"
	}
	return s
}

func (s *Store) Save(a Agent) (Agent, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	a.Name = strings.TrimSpace(a.Name)
	if a.Name == "" {
		return a, errors.New("укажи имя агента")
	}
	if a.Provider == "" {
		a.Provider = "ollama"
	}
	if a.Approve == "" {
		a.Approve = "danger"
	}
	list := s.load()
	if a.ID == "" {
		base := slug(a.Name)
		a.ID = base
		for i := 2; ; i++ {
			taken := false
			for _, x := range list {
				if x.ID == a.ID {
					taken = true
				}
			}
			if !taken {
				break
			}
			a.ID = fmt.Sprintf("%s-%d", base, i)
		}
	}
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
	return a, s.write(list)
}

func (s *Store) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []Agent
	for _, a := range s.load() {
		if a.ID != id {
			out = append(out, a)
		}
	}
	if out == nil {
		out = []Agent{}
	}
	return s.write(out)
}

func (s *Store) write(list []Agent) error {
	b, _ := json.MarshalIndent(list, "", "  ")
	_ = os.MkdirAll(filepath.Dir(s.path), 0o755)
	return os.WriteFile(s.path, b, 0o644)
}

// ---------- Чат-сессии ----------

type Session struct {
	ID       string    `json:"id"`
	AgentID  string    `json:"agent"`
	Title    string    `json:"title"`
	Created  int64     `json:"created"`
	Updated  int64     `json:"updated"`
	Messages []Message `json:"messages"` // без системного
}

type SessionInfo struct {
	ID      string `json:"id"`
	AgentID string `json:"agent"`
	Title   string `json:"title"`
	Updated int64  `json:"updated"`
	Count   int    `json:"count"`
}

// Chats хранит историю в %APPDATA%\Infra\chats\*.json.
type Chats struct {
	dir string
	mu  sync.Mutex
}

func NewChats() *Chats {
	dir, err := os.UserConfigDir()
	if err != nil {
		dir = "."
	}
	return NewChatsAt(filepath.Join(dir, "Infra", "chats"))
}

func NewChatsAt(dir string) *Chats { _ = os.MkdirAll(dir, 0o755); return &Chats{dir: dir} }

var safeID = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

func (c *Chats) file(id string) (string, error) {
	if !safeID.MatchString(id) {
		return "", errors.New("неверный id чата")
	}
	return filepath.Join(c.dir, id+".json"), nil
}

func (c *Chats) Save(s *Session) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	p, err := c.file(s.ID)
	if err != nil {
		return err
	}
	b, _ := json.Marshal(s)
	return os.WriteFile(p, b, 0o600)
}

func (c *Chats) Load(id string) (*Session, error) {
	p, err := c.file(id)
	if err != nil {
		return nil, err
	}
	b, err := os.ReadFile(p)
	if err != nil {
		return nil, err
	}
	var s Session
	return &s, json.Unmarshal(b, &s)
}

func (c *Chats) Delete(id string) error {
	p, err := c.file(id)
	if err != nil {
		return err
	}
	return os.Remove(p)
}

func (c *Chats) List() []SessionInfo {
	out := []SessionInfo{}
	ents, _ := os.ReadDir(c.dir)
	for _, e := range ents {
		if !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		s, err := c.Load(strings.TrimSuffix(e.Name(), ".json"))
		if err != nil || len(s.Messages) == 0 {
			continue
		}
		out = append(out, SessionInfo{s.ID, s.AgentID, s.Title, s.Updated, len(s.Messages)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Updated > out[j].Updated })
	if len(out) > 100 {
		out = out[:100]
	}
	return out
}

// ---------- Цикл агента ----------

// Event — что показать в чате.
type Event struct {
	Session string `json:"session"`
	Type    string `json:"type"` // start, status, loaded, model, delta, thinking, tool, result, notice, done, error
	Text    string `json:"text,omitempty"`
	ID      string `json:"id,omitempty"` // id вызова инструмента
	Tool    string `json:"tool,omitempty"`
	Args    string `json:"args,omitempty"`
	OK      bool   `json:"ok,omitempty"`
}

// Loop — один ответ агента: модель ↔ инструменты, пока модель не ответит текстом.
type Loop struct {
	Provider Provider
	Agent    Agent
	Tools    []*tools.Tool
	System   string
	Emit     func(Event)
	// Exec выполняет инструмент (с проверками и подтверждением). Ошибка уходит модели как результат.
	Exec     func(ctx context.Context, call ToolCall) (string, error)
	MaxSteps int
}

func (l *Loop) Run(ctx context.Context, s *Session) error {
	max := l.MaxSteps
	if max <= 0 {
		max = 16
	}
	ts := l.Tools
	for step := 0; step < max; step++ {
		msgs := append([]Message{{Role: "system", Content: l.System}}, s.Messages...)
		req := Request{Model: l.Agent.Model, Messages: msgs, Tools: ts, Temperature: l.Agent.Temperature}
		m, err := l.Provider.Chat(ctx, req, func(d Delta) {
			if d.Thinking != "" {
				l.Emit(Event{Session: s.ID, Type: "thinking", Text: d.Thinking})
			}
			if d.Content != "" {
				l.Emit(Event{Session: s.ID, Type: "delta", Text: d.Content})
			}
		})
		if errors.Is(err, ErrNoTools) && len(ts) > 0 {
			ts = nil
			l.Emit(Event{Session: s.ID, Type: "notice", Text: "Модель " + l.Agent.Model + " не умеет вызывать инструменты — отвечаю без доступа к серверам. Для управления выбери модель с пометкой «инструменты» (например qwen3)."})
			step--
			continue
		}
		if err != nil {
			if ctx.Err() != nil {
				return context.Canceled
			}
			return err
		}
		m.Time = time.Now().Unix()
		for i := range m.ToolCalls {
			if !json.Valid(m.ToolCalls[i].Args) {
				b, _ := json.Marshal(string(m.ToolCalls[i].Args))
				m.ToolCalls[i].Args = b
			}
		}
		s.Messages = append(s.Messages, m)
		if len(m.ToolCalls) == 0 {
			return nil
		}
		for _, c := range m.ToolCalls {
			l.Emit(Event{Session: s.ID, Type: "tool", ID: c.ID, Tool: c.Name, Args: string(c.Args)})
			res, err := l.Exec(ctx, c)
			ok := err == nil
			if err != nil {
				res = "ОШИБКА: " + err.Error()
			}
			l.Emit(Event{Session: s.ID, Type: "result", ID: c.ID, Tool: c.Name, Text: res, OK: ok})
			s.Messages = append(s.Messages, Message{Role: "tool", ToolID: c.ID, ToolName: c.Name, Content: res, Time: time.Now().Unix()})
			if ctx.Err() != nil {
				return context.Canceled
			}
		}
	}
	return fmt.Errorf("агент сделал %d шагов подряд и остановлен — напиши, продолжать ли", max)
}

// Title — заголовок чата из первого сообщения.
func Title(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	r := []rune(s)
	if len(r) > 48 {
		return string(r[:46]) + "…"
	}
	return s
}

func translit(s string) string {
	m := map[rune]string{'а': "a", 'б': "b", 'в': "v", 'г': "g", 'д': "d", 'е': "e", 'ё': "e", 'ж': "zh", 'з': "z", 'и': "i", 'й': "y", 'к': "k", 'л': "l", 'м': "m", 'н': "n", 'о': "o", 'п': "p", 'р': "r", 'с': "s", 'т': "t", 'у': "u", 'ф': "f", 'х': "h", 'ц': "c", 'ч': "ch", 'ш': "sh", 'щ': "sch", 'ы': "y", 'э': "e", 'ю': "yu", 'я': "ya"}
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		if t, ok := m[r]; ok {
			b.WriteString(t)
		} else {
			b.WriteRune(r)
		}
	}
	return b.String()
}
