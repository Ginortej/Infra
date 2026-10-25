package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"infra/internal/tools"
)

func echoTool() *tools.Tool {
	return &tools.Tool{Name: "list_servers", Params: tools.Obj(), Run: func(ctx context.Context, a tools.Args) (string, error) { return "web-1", nil }}
}

func TestLoopOllama(t *testing.T) {
	step := 0
	var lastBody map[string]any
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		json.Unmarshal(b, &lastBody)
		step++
		if step == 1 {
			fmt.Fprintln(w, `{"message":{"role":"assistant","content":"","thinking":"хм"},"done":false}`)
			fmt.Fprintln(w, `{"message":{"role":"assistant","content":"","tool_calls":[{"function":{"name":"list_servers","arguments":{}}}]},"done":false}`)
			fmt.Fprintln(w, `{"done":true}`)
			return
		}
		fmt.Fprintln(w, `{"message":{"role":"assistant","content":"Есть "},"done":false}`)
		fmt.Fprintln(w, `{"message":{"role":"assistant","content":"web-1"},"done":true}`)
	}))
	defer ts.Close()
	var events []string
	s := &Session{ID: "s", Messages: []Message{{Role: "user", Content: "какие серверы?"}}}
	l := &Loop{Provider: Provider{Kind: "ollama", Endpoint: ts.URL}, Agent: Agent{Model: "m"}, Tools: []*tools.Tool{echoTool()}, System: "sys",
		Emit: func(e Event) { events = append(events, e.Type) },
		Exec: func(ctx context.Context, c ToolCall) (string, error) { return "web-1", nil }}
	if err := l.Run(context.Background(), s); err != nil {
		t.Fatal(err)
	}
	if len(s.Messages) != 4 || s.Messages[3].Content != "Есть web-1" || s.Messages[2].Role != "tool" || s.Messages[1].Thinking != "хм" {
		t.Fatalf("%+v", s.Messages)
	}
	msgs := lastBody["messages"].([]any)
	if msgs[0].(map[string]any)["role"] != "system" || msgs[3].(map[string]any)["tool_name"] != "list_servers" {
		t.Fatalf("%v", msgs)
	}
	if strings.Join(events, ",") != "thinking,tool,result,delta,delta" {
		t.Fatal(events)
	}
}

func TestNoToolsFallback(t *testing.T) {
	n := 0
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n++
		b, _ := io.ReadAll(r.Body)
		if strings.Contains(string(b), `"tools"`) {
			w.WriteHeader(400)
			fmt.Fprint(w, `{"error":"registry.ollama.ai/library/gemma3:4b does not support tools"}`)
			return
		}
		fmt.Fprintln(w, `{"message":{"role":"assistant","content":"привет"},"done":true}`)
	}))
	defer ts.Close()
	var notice bool
	s := &Session{ID: "s", Messages: []Message{{Role: "user", Content: "hi"}}}
	l := &Loop{Provider: Provider{Kind: "ollama", Endpoint: ts.URL}, Agent: Agent{Model: "gemma3:4b"}, Tools: []*tools.Tool{echoTool()},
		Emit: func(e Event) { notice = notice || e.Type == "notice" }, Exec: nil}
	if err := l.Run(context.Background(), s); err != nil || !notice || s.Messages[1].Content != "привет" || n != 2 {
		t.Fatal(err, notice, s.Messages, n)
	}
}

func TestOpenAIStream(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" || r.Header.Get("Authorization") != "Bearer k" {
			w.WriteHeader(404)
			return
		}
		for _, l := range []string{
			`{"choices":[{"delta":{"content":"ок"}}]}`,
			`{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"run_command","arguments":"{\"server\":"}}]}}]}`,
			`{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"web\"}"}}]}}]}`,
		} {
			fmt.Fprintf(w, "data: %s\n\n", l)
		}
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer ts.Close()
	m, err := Provider{Kind: "openai", Endpoint: ts.URL, Key: "k"}.Chat(context.Background(), Request{Model: "x", Messages: []Message{{Role: "user", Content: "q"}}}, nil)
	if err != nil || m.Content != "ок" || len(m.ToolCalls) != 1 || m.ToolCalls[0].ID != "c1" || string(m.ToolCalls[0].Args) != `{"server":"web"}` {
		t.Fatal(err, m)
	}
}

func TestStore(t *testing.T) {
	s := NewStoreAt(filepath.Join(t.TempDir(), "a.json"))
	if l := s.List(); len(l) != 1 || l[0].ID != "devops" {
		t.Fatal(l)
	}
	a, err := s.Save(Agent{Name: "Мой агент", Model: "qwen3:8b"})
	if err != nil || a.ID != "moy-agent" || a.Approve != "danger" {
		t.Fatal(a, err)
	}
	b, _ := s.Save(Agent{Name: "Мой агент"})
	if b.ID != "moy-agent-2" {
		t.Fatal(b.ID)
	}
	s.Delete("moy-agent")
	if len(s.List()) != 2 {
		t.Fatal(s.List())
	}
	c := NewChatsAt(t.TempDir())
	c.Save(&Session{ID: "c1", Title: "t", Messages: []Message{{Role: "user", Content: "x"}}})
	if l := c.List(); len(l) != 1 {
		t.Fatal(l)
	}
	if _, err := c.Load("../x"); err == nil {
		t.Fatal("path traversal")
	}
}
