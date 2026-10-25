package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"infra/internal/tools"
)

func testServer() *Server {
	return &Server{Name: "infra", Version: "t",
		Tools: func() []*tools.Tool {
			return []*tools.Tool{{Name: "echo", Title: "Эхо", Params: tools.Obj(tools.Req("x", "string", "")), Description: "echo"},
				{Name: "boom", Danger: true, Params: tools.Obj()}}
		},
		Call: func(ctx context.Context, client, name string, args json.RawMessage) (string, error) {
			if name == "boom" {
				return "", errors.New("denied for " + client)
			}
			var a map[string]string
			json.Unmarshal(args, &a)
			return "echo:" + a["x"], nil
		}}
}

func TestHandle(t *testing.T) {
	s := testServer()
	client := "?"
	out := s.Handle(context.Background(), []byte(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","clientInfo":{"name":"claude"}}}`), &client)
	if !bytes.Contains(out, []byte(`"protocolVersion":"2025-03-26"`)) || client != "claude" {
		t.Fatal(string(out), client)
	}
	if out := s.Handle(context.Background(), []byte(`{"jsonrpc":"2.0","method":"notifications/initialized"}`), &client); out != nil {
		t.Fatal(string(out))
	}
	out = s.Handle(context.Background(), []byte(`{"jsonrpc":"2.0","id":2,"method":"tools/list"}`), &client)
	if !bytes.Contains(out, []byte(`"destructiveHint":true`)) || !bytes.Contains(out, []byte(`"inputSchema"`)) {
		t.Fatal(string(out))
	}
	out = s.Handle(context.Background(), []byte(`{"jsonrpc":"2.0","id":"a","method":"tools/call","params":{"name":"echo","arguments":{"x":"hi"}}}`), &client)
	if !bytes.Contains(out, []byte(`echo:hi`)) || !bytes.Contains(out, []byte(`"isError":false`)) {
		t.Fatal(string(out))
	}
	out = s.Handle(context.Background(), []byte(`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"boom","arguments":{}}}`), &client)
	if !bytes.Contains(out, []byte(`denied for claude`)) || !bytes.Contains(out, []byte(`"isError":true`)) {
		t.Fatal(string(out))
	}
	out = s.Handle(context.Background(), []byte(`{"jsonrpc":"2.0","id":4,"method":"nope"}`), &client)
	if !bytes.Contains(out, []byte(`-32601`)) {
		t.Fatal(string(out))
	}
}

func TestHTTP(t *testing.T) {
	s := testServer()
	ts := httptest.NewServer(s.HTTP(func() string { return "tok" }))
	defer ts.Close()
	post := func(body, tok, sid, origin string) *http.Response {
		req, _ := http.NewRequest("POST", ts.URL, strings.NewReader(body))
		if tok != "" {
			req.Header.Set("Authorization", "Bearer "+tok)
		}
		if sid != "" {
			req.Header.Set("Mcp-Session-Id", sid)
		}
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		r, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return r
	}
	if r := post(`{}`, "bad", "", ""); r.StatusCode != 401 {
		t.Fatal(r.Status)
	}
	if r := post(`{}`, "tok", "", "http://evil.com"); r.StatusCode != 403 {
		t.Fatal(r.Status)
	}
	r := post(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"cursor"}}}`, "tok", "", "")
	sid := r.Header.Get("Mcp-Session-Id")
	if r.StatusCode != 200 || sid == "" {
		t.Fatal(r.Status, sid)
	}
	if r := post(`{"jsonrpc":"2.0","method":"notifications/initialized"}`, "tok", sid, ""); r.StatusCode != 202 {
		t.Fatal(r.Status)
	}
	r = post(`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"boom"}}`, "tok", sid, "")
	var v map[string]any
	json.NewDecoder(r.Body).Decode(&v)
	b, _ := json.Marshal(v)
	if !strings.Contains(string(b), "denied for cursor") {
		t.Fatal(string(b))
	}
}

func TestBridge(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("APPDATA", t.TempDir())
	s := testServer()
	l, err := Listen(0, s.HTTP(func() string { return "tok" }))
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	if err := WriteConn(Conn{Port: l.Port, Token: "tok"}); err != nil {
		t.Fatal(err)
	}
	in := strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"desk"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"boom","arguments":{}}}
`)
	var out bytes.Buffer
	if err := Bridge(in, &out, nil); err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(out.String()), "\n")
	if len(lines) != 2 || !strings.Contains(lines[1], "denied for desk") {
		t.Fatal(out.String())
	}
}
