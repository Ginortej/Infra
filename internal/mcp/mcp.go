// Package mcp — сервер Model Context Protocol: отдаёт инструменты Infra другим ИИ
// (Claude Desktop, Claude Code, Cursor…). Транспорт — Streamable HTTP на 127.0.0.1 с токеном;
// для клиентов, которые умеют только stdio, есть мост «Infra.exe mcp».
package mcp

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"infra/internal/tools"
)

var Versions = []string{"2025-06-18", "2025-03-26", "2024-11-05"}

type Server struct {
	Name, Version, Instructions string
	Tools                       func() []*tools.Tool
	// Call выполняет инструмент; client — имя клиента из initialize (для подтверждения).
	Call func(ctx context.Context, client, name string, args json.RawMessage) (string, error)
	// OnRequest — для журнала в интерфейсе.
	OnRequest func(client, method string)

	mu       sync.Mutex
	sessions map[string]string // Mcp-Session-Id -> имя клиента
}

type rpcReq struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type rpcErr struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type rpcResp struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  any             `json:"result,omitempty"`
	Error   *rpcErr         `json:"error,omitempty"`
}

// Handle обрабатывает одно сообщение или пакет. Возвращает nil, если отвечать не нужно.
func (s *Server) Handle(ctx context.Context, raw []byte, client *string) []byte {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 {
		return nil
	}
	if raw[0] == '[' {
		var batch []json.RawMessage
		if json.Unmarshal(raw, &batch) != nil {
			b, _ := json.Marshal(rpcResp{JSONRPC: "2.0", ID: json.RawMessage("null"), Error: &rpcErr{-32700, "parse error"}})
			return b
		}
		var out []json.RawMessage
		for _, m := range batch {
			if r := s.Handle(ctx, m, client); r != nil {
				out = append(out, r)
			}
		}
		if len(out) == 0 {
			return nil
		}
		b, _ := json.Marshal(out)
		return b
	}
	var req rpcReq
	if err := json.Unmarshal(raw, &req); err != nil {
		b, _ := json.Marshal(rpcResp{JSONRPC: "2.0", ID: json.RawMessage("null"), Error: &rpcErr{-32700, "parse error"}})
		return b
	}
	if s.OnRequest != nil && req.Method != "ping" && !strings.HasPrefix(req.Method, "notifications/") {
		s.OnRequest(*client, req.Method)
	}
	res, err := s.dispatch(ctx, req, client)
	if len(req.ID) == 0 { // уведомление
		return nil
	}
	resp := rpcResp{JSONRPC: "2.0", ID: req.ID, Result: res}
	if err != nil {
		resp.Result = nil
		resp.Error = err
	}
	b, _ := json.Marshal(resp)
	return b
}

func (s *Server) dispatch(ctx context.Context, req rpcReq, client *string) (any, *rpcErr) {
	switch req.Method {
	case "initialize":
		var p struct {
			ProtocolVersion string `json:"protocolVersion"`
			ClientInfo      struct {
				Name    string `json:"name"`
				Version string `json:"version"`
			} `json:"clientInfo"`
		}
		_ = json.Unmarshal(req.Params, &p)
		if p.ClientInfo.Name != "" {
			*client = p.ClientInfo.Name
		}
		ver := Versions[0]
		for _, v := range Versions {
			if v == p.ProtocolVersion {
				ver = v
			}
		}
		return map[string]any{
			"protocolVersion": ver,
			"capabilities":    map[string]any{"tools": map[string]any{"listChanged": false}},
			"serverInfo":      map[string]any{"name": s.Name, "title": "Infra", "version": s.Version},
			"instructions":    s.Instructions,
		}, nil
	case "ping":
		return map[string]any{}, nil
	case "tools/list":
		var list []map[string]any
		for _, t := range s.Tools() {
			list = append(list, map[string]any{
				"name": t.Name, "title": t.Title, "description": t.Description, "inputSchema": t.Params,
				"annotations": map[string]any{"title": t.Title, "readOnlyHint": !t.Danger, "destructiveHint": t.Danger, "openWorldHint": false},
			})
		}
		if list == nil {
			list = []map[string]any{}
		}
		return map[string]any{"tools": list}, nil
	case "tools/call":
		var p struct {
			Name      string          `json:"name"`
			Arguments json.RawMessage `json:"arguments"`
		}
		if err := json.Unmarshal(req.Params, &p); err != nil || p.Name == "" {
			return nil, &rpcErr{-32602, "нужны name и arguments"}
		}
		found := false
		for _, t := range s.Tools() {
			if t.Name == p.Name {
				found = true
			}
		}
		if !found {
			return nil, &rpcErr{-32602, "неизвестный инструмент: " + p.Name}
		}
		out, err := s.Call(ctx, *client, p.Name, p.Arguments)
		if err != nil {
			return map[string]any{"content": []map[string]any{{"type": "text", "text": err.Error()}}, "isError": true}, nil
		}
		return map[string]any{"content": []map[string]any{{"type": "text", "text": out}}, "isError": false}, nil
	case "resources/list":
		return map[string]any{"resources": []any{}}, nil
	case "resources/templates/list":
		return map[string]any{"resourceTemplates": []any{}}, nil
	case "prompts/list":
		return map[string]any{"prompts": []any{}}, nil
	case "logging/setLevel":
		return map[string]any{}, nil
	}
	if strings.HasPrefix(req.Method, "notifications/") {
		return nil, nil
	}
	return nil, &rpcErr{-32601, "метод не поддерживается: " + req.Method}
}

// ---------- HTTP ----------

// HTTP — обработчик /mcp. token обязателен (заголовок Authorization: Bearer или ?token=).
func (s *Server) HTTP(token func() string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// защита от DNS-rebinding: браузерные запросы только с локальных страниц
		if o := r.Header.Get("Origin"); o != "" {
			u, err := url.Parse(o)
			if err != nil || !(u.Hostname() == "127.0.0.1" || u.Hostname() == "localhost" || u.Hostname() == "::1") {
				http.Error(w, "forbidden origin", http.StatusForbidden)
				return
			}
		}
		got := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if got == "" {
			got = r.URL.Query().Get("token")
		}
		if t := token(); t == "" || !constEq(got, t) {
			w.Header().Set("WWW-Authenticate", `Bearer realm="infra"`)
			http.Error(w, "нужен токен Infra (Authorization: Bearer …)", http.StatusUnauthorized)
			return
		}
		switch r.Method {
		case http.MethodPost:
		case http.MethodDelete:
			s.mu.Lock()
			delete(s.sessions, r.Header.Get("Mcp-Session-Id"))
			s.mu.Unlock()
			w.WriteHeader(http.StatusOK)
			return
		default:
			w.Header().Set("Allow", "POST, DELETE")
			http.Error(w, "SSE-поток не поддерживается", http.StatusMethodNotAllowed)
			return
		}
		body, err := io.ReadAll(io.LimitReader(r.Body, 4<<20))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		sid := r.Header.Get("Mcp-Session-Id")
		s.mu.Lock()
		if s.sessions == nil {
			s.sessions = map[string]string{}
		}
		client := s.sessions[sid]
		s.mu.Unlock()
		if client == "" {
			client = "MCP-клиент"
		}
		before := client
		out := s.Handle(r.Context(), body, &client)
		if bytes.Contains(body, []byte(`"initialize"`)) && (sid == "" || client != before) {
			sid = newID()
			s.mu.Lock()
			s.sessions[sid] = client
			s.mu.Unlock()
			w.Header().Set("Mcp-Session-Id", sid)
		}
		if out == nil {
			w.WriteHeader(http.StatusAccepted)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(out)
	})
}

func constEq(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	var v byte
	for i := 0; i < len(a); i++ {
		v |= a[i] ^ b[i]
	}
	return v == 0
}

func newID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// NewToken — случайный токен доступа.
func NewToken() string { return newID() + newID()[:16] }

// Listener — HTTP-сервер на 127.0.0.1:port (0 — любой свободный).
type Listener struct {
	srv  *http.Server
	ln   net.Listener
	Port int
}

func Listen(port int, h http.Handler) (*Listener, error) {
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil && port != 0 {
		ln, err = net.Listen("tcp", "127.0.0.1:0") // порт занят — берём другой
	}
	if err != nil {
		return nil, err
	}
	mux := http.NewServeMux()
	mux.Handle("/mcp", h)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "Infra MCP: используйте /mcp", http.StatusNotFound)
	})
	l := &Listener{srv: &http.Server{Handler: mux, ReadHeaderTimeout: 10 * time.Second}, ln: ln, Port: ln.Addr().(*net.TCPAddr).Port}
	go func() { _ = l.srv.Serve(ln) }()
	return l, nil
}

func (l *Listener) Close() {
	if l != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = l.srv.Shutdown(ctx)
	}
}

// ---------- Файл подключения: %APPDATA%\Infra\mcp.json ----------

type Conn struct {
	Port  int    `json:"port"`
	Token string `json:"token"`
	PID   int    `json:"pid"`
}

func ConnPath() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		dir = "."
	}
	return filepath.Join(dir, "Infra", "mcp.json")
}

func WriteConn(c Conn) error {
	b, _ := json.Marshal(c)
	_ = os.MkdirAll(filepath.Dir(ConnPath()), 0o755)
	return os.WriteFile(ConnPath(), b, 0o600)
}

func ReadConn() (Conn, error) {
	var c Conn
	b, err := os.ReadFile(ConnPath())
	if err != nil {
		return c, err
	}
	return c, json.Unmarshal(b, &c)
}

func RemoveConn() { _ = os.Remove(ConnPath()) }

// ---------- stdio-мост ----------

// Bridge читает JSON-RPC построчно из in, пересылает в запущенную Infra по HTTP и пишет ответы в out.
// Если Infra не запущена — вызывает launch и ждёт до 30 секунд.
func Bridge(in io.Reader, out io.Writer, launch func() error) error {
	hc := &http.Client{Timeout: 15 * time.Minute} // подтверждение человеком может занять время
	var (
		sid      string
		launched bool
		wmu, smu sync.Mutex
		wg       sync.WaitGroup
	)
	write := func(b []byte) {
		wmu.Lock()
		defer wmu.Unlock()
		_, _ = out.Write(append(bytes.TrimSpace(b), '\n'))
	}
	send := func(line []byte) ([]byte, error) {
		for attempt := 0; ; attempt++ {
			c, err := ReadConn()
			smu.Lock()
			cur := sid
			smu.Unlock()
			if err == nil && c.Port > 0 {
				req, _ := http.NewRequest("POST", fmt.Sprintf("http://127.0.0.1:%d/mcp", c.Port), bytes.NewReader(line))
				req.Header.Set("Content-Type", "application/json")
				req.Header.Set("Accept", "application/json, text/event-stream")
				req.Header.Set("Authorization", "Bearer "+c.Token)
				if cur != "" {
					req.Header.Set("Mcp-Session-Id", cur)
				}
				resp, err := hc.Do(req)
				if err == nil {
					defer resp.Body.Close()
					if v := resp.Header.Get("Mcp-Session-Id"); v != "" {
						smu.Lock()
						sid = v
						smu.Unlock()
					}
					b, _ := io.ReadAll(resp.Body)
					if resp.StatusCode == http.StatusAccepted {
						return nil, nil
					}
					if resp.StatusCode != 200 {
						return nil, fmt.Errorf("Infra ответила %s: %s", resp.Status, strings.TrimSpace(string(b)))
					}
					return b, nil
				}
			}
			smu.Lock()
			first := !launched && launch != nil
			launched = true
			smu.Unlock()
			if first {
				if err := launch(); err != nil {
					return nil, fmt.Errorf("не удалось запустить Infra: %v", err)
				}
			}
			if attempt > 60 {
				return nil, errors.New("Infra не запущена или MCP выключен (Infra → ИИ → MCP)")
			}
			time.Sleep(500 * time.Millisecond)
		}
	}
	sc := bufio.NewScanner(in)
	sc.Buffer(make([]byte, 1<<20), 16<<20)
	for sc.Scan() {
		line := append([]byte(nil), bytes.TrimSpace(sc.Bytes())...)
		if len(line) == 0 {
			continue
		}
		do := func() {
			resp, err := send(line)
			if err != nil {
				var req rpcReq
				if json.Unmarshal(line, &req) == nil && len(req.ID) > 0 {
					b, _ := json.Marshal(rpcResp{JSONRPC: "2.0", ID: req.ID, Error: &rpcErr{-32000, err.Error()}})
					write(b)
				}
				return
			}
			if len(resp) > 0 {
				write(resp)
			}
		}
		// initialize — по порядку (выдаёт сессию), остальное параллельно: долгое подтверждение не блокирует ping
		if bytes.Contains(line, []byte(`"initialize"`)) || bytes.Contains(line, []byte(`"notifications/`)) {
			wg.Wait()
			do()
		} else {
			wg.Add(1)
			go func() { defer wg.Done(); do() }()
		}
	}
	wg.Wait()
	return sc.Err()
}
