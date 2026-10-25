// Package agent — ИИ-агенты: чат с моделью, которая может вызывать инструменты Infra.
package agent

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"infra/internal/tools"
)

type ToolCall struct {
	ID   string          `json:"id"`
	Name string          `json:"name"`
	Args json.RawMessage `json:"args"`
}

type Message struct {
	Role      string     `json:"role"` // system, user, assistant, tool
	Content   string     `json:"content"`
	Thinking  string     `json:"thinking,omitempty"`
	ToolCalls []ToolCall `json:"toolCalls,omitempty"`
	ToolID    string     `json:"toolId,omitempty"`   // для role=tool
	ToolName  string     `json:"toolName,omitempty"` // для role=tool
	Time      int64      `json:"time,omitempty"`
}

type Delta struct {
	Content  string
	Thinking string
}

type Request struct {
	Model       string
	Messages    []Message
	Tools       []*tools.Tool
	Temperature float64
}

// Provider — откуда берётся модель.
type Provider struct {
	Kind     string // ollama | openai
	Endpoint string // ollama: http://127.0.0.1:11434; openai: http://localhost:1234/v1
	Key      string // для openai-совместимых
}

// ErrNoTools — модель не поддерживает вызов инструментов.
var ErrNoTools = errors.New("модель не поддерживает инструменты")

var httpc = &http.Client{}

func (p Provider) Chat(ctx context.Context, r Request, on func(Delta)) (Message, error) {
	if p.Kind == "openai" {
		return p.chatOpenAI(ctx, r, on)
	}
	return p.chatOllama(ctx, r, on)
}

func toolSpecs(ts []*tools.Tool) []map[string]any {
	var out []map[string]any
	for _, t := range ts {
		out = append(out, map[string]any{"type": "function", "function": map[string]any{
			"name": t.Name, "description": t.Description, "parameters": t.Params,
		}})
	}
	return out
}

func post(ctx context.Context, url, key string, body any) (*http.Response, error) {
	b, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	resp, err := httpc.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, fmt.Errorf("модель недоступна: %v", err)
	}
	if resp.StatusCode != 200 {
		defer resp.Body.Close()
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		msg := strings.TrimSpace(string(raw))
		var e struct {
			Error any `json:"error"`
		}
		if json.Unmarshal(raw, &e) == nil && e.Error != nil {
			switch v := e.Error.(type) {
			case string:
				msg = v
			case map[string]any:
				msg = fmt.Sprint(v["message"])
			}
		}
		if strings.Contains(msg, "does not support tools") || strings.Contains(msg, "tools is not supported") {
			return nil, ErrNoTools
		}
		if strings.Contains(msg, "not found") && strings.Contains(msg, "model") {
			return nil, fmt.Errorf("модель не скачана: %s", msg)
		}
		return nil, fmt.Errorf("%s: %s", resp.Status, msg)
	}
	return resp, nil
}

// ---------- Ollama /api/chat ----------

func (p Provider) chatOllama(ctx context.Context, r Request, on func(Delta)) (Message, error) {
	type ocall struct {
		Function struct {
			Name      string          `json:"name"`
			Arguments json.RawMessage `json:"arguments"`
		} `json:"function"`
	}
	type omsg struct {
		Role      string  `json:"role"`
		Content   string  `json:"content"`
		Thinking  string  `json:"thinking,omitempty"`
		ToolCalls []ocall `json:"tool_calls,omitempty"`
		ToolName  string  `json:"tool_name,omitempty"`
	}
	var msgs []omsg
	for _, m := range r.Messages {
		om := omsg{Role: m.Role, Content: m.Content, ToolName: m.ToolName}
		for _, c := range m.ToolCalls {
			var oc ocall
			oc.Function.Name = c.Name
			oc.Function.Arguments = c.Args
			if len(oc.Function.Arguments) == 0 {
				oc.Function.Arguments = json.RawMessage("{}")
			}
			om.ToolCalls = append(om.ToolCalls, oc)
		}
		msgs = append(msgs, om)
	}
	body := map[string]any{"model": r.Model, "messages": msgs, "stream": true,
		"options": map[string]any{"temperature": r.Temperature}}
	if len(r.Tools) > 0 {
		body["tools"] = toolSpecs(r.Tools)
	}
	ep := strings.TrimRight(p.Endpoint, "/")
	resp, err := post(ctx, ep+"/api/chat", "", body)
	if err != nil {
		return Message{}, err
	}
	defer resp.Body.Close()
	out := Message{Role: "assistant"}
	sc := bufio.NewScanner(resp.Body)
	sc.Buffer(make([]byte, 256*1024), 8<<20)
	n := 0
	for sc.Scan() {
		var ch struct {
			Message omsg   `json:"message"`
			Done    bool   `json:"done"`
			Error   string `json:"error"`
		}
		if json.Unmarshal(sc.Bytes(), &ch) != nil {
			continue
		}
		if ch.Error != "" {
			return out, errors.New(ch.Error)
		}
		if ch.Message.Content != "" || ch.Message.Thinking != "" {
			out.Content += ch.Message.Content
			out.Thinking += ch.Message.Thinking
			if on != nil {
				on(Delta{Content: ch.Message.Content, Thinking: ch.Message.Thinking})
			}
		}
		for _, c := range ch.Message.ToolCalls {
			n++
			out.ToolCalls = append(out.ToolCalls, ToolCall{ID: fmt.Sprintf("call_%d", n), Name: c.Function.Name, Args: c.Function.Arguments})
		}
		if ch.Done {
			break
		}
	}
	if ctx.Err() != nil {
		return out, ctx.Err()
	}
	return out, sc.Err()
}

// ---------- OpenAI-совместимые (LM Studio, llama.cpp server, vLLM, OpenRouter…) ----------

func (p Provider) chatOpenAI(ctx context.Context, r Request, on func(Delta)) (Message, error) {
	var msgs []map[string]any
	for _, m := range r.Messages {
		om := map[string]any{"role": m.Role, "content": m.Content}
		if m.Role == "tool" {
			om["tool_call_id"] = m.ToolID
		}
		if len(m.ToolCalls) > 0 {
			var calls []map[string]any
			for _, c := range m.ToolCalls {
				args := string(c.Args)
				if args == "" {
					args = "{}"
				}
				calls = append(calls, map[string]any{"id": c.ID, "type": "function", "function": map[string]any{"name": c.Name, "arguments": args}})
			}
			om["tool_calls"] = calls
		}
		msgs = append(msgs, om)
	}
	body := map[string]any{"model": r.Model, "messages": msgs, "stream": true, "temperature": r.Temperature}
	if len(r.Tools) > 0 {
		body["tools"] = toolSpecs(r.Tools)
	}
	ep := strings.TrimRight(p.Endpoint, "/")
	if !strings.HasSuffix(ep, "/v1") && !strings.Contains(ep, "/v1/") && !strings.Contains(ep, "/api/") {
		ep += "/v1"
	}
	resp, err := post(ctx, ep+"/chat/completions", p.Key, body)
	if err != nil {
		return Message{}, err
	}
	defer resp.Body.Close()
	out := Message{Role: "assistant"}
	type part struct {
		id, name string
		args     strings.Builder
	}
	parts := map[int]*part{}
	order := []int{}
	sc := bufio.NewScanner(resp.Body)
	sc.Buffer(make([]byte, 256*1024), 8<<20)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "[DONE]" {
			break
		}
		var ch struct {
			Choices []struct {
				Delta struct {
					Content   string `json:"content"`
					Reasoning string `json:"reasoning_content"`
					ToolCalls []struct {
						Index    int    `json:"index"`
						ID       string `json:"id"`
						Function struct {
							Name      string `json:"name"`
							Arguments string `json:"arguments"`
						} `json:"function"`
					} `json:"tool_calls"`
				} `json:"delta"`
			} `json:"choices"`
			Error any `json:"error"`
		}
		if json.Unmarshal([]byte(data), &ch) != nil {
			continue
		}
		if ch.Error != nil {
			return out, fmt.Errorf("%v", ch.Error)
		}
		for _, c := range ch.Choices {
			d := c.Delta
			if d.Content != "" || d.Reasoning != "" {
				out.Content += d.Content
				out.Thinking += d.Reasoning
				if on != nil {
					on(Delta{Content: d.Content, Thinking: d.Reasoning})
				}
			}
			for _, tc := range d.ToolCalls {
				pt := parts[tc.Index]
				if pt == nil {
					pt = &part{}
					parts[tc.Index] = pt
					order = append(order, tc.Index)
				}
				if tc.ID != "" {
					pt.id = tc.ID
				}
				if tc.Function.Name != "" {
					pt.name = tc.Function.Name
				}
				pt.args.WriteString(tc.Function.Arguments)
			}
		}
	}
	for i, idx := range order {
		pt := parts[idx]
		id := pt.id
		if id == "" {
			id = fmt.Sprintf("call_%d", i+1)
		}
		args := pt.args.String()
		if strings.TrimSpace(args) == "" {
			args = "{}"
		}
		out.ToolCalls = append(out.ToolCalls, ToolCall{ID: id, Name: pt.name, Args: json.RawMessage(args)})
	}
	if ctx.Err() != nil {
		return out, ctx.Err()
	}
	return out, sc.Err()
}
