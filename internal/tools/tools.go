// Package tools — действия Infra, которые можно отдать ИИ: агентам во встроенном чате и
// внешним клиентам через MCP. Опасные (меняют что-то) требуют подтверждения человеком.
package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

type Tool struct {
	Name        string                                               `json:"name"`
	Title       string                                               `json:"title"` // по-русски, для интерфейса
	Group       string                                               `json:"group"` // servers, files, scripts, vpn, labs, git, local
	Description string                                               `json:"description"`
	Params      map[string]any                                       `json:"params"` // JSON Schema объекта аргументов
	Danger      bool                                                 `json:"danger"`
	Run         func(ctx context.Context, args Args) (string, error) `json:"-"`
	// Target — что именно затрагивает вызов: для карточки подтверждения и проверки политикой.
	Target func(args Args) Target `json:"-"`
}

type Target struct {
	Summary string   // показать человеку (команда, путь)
	Text    string   // проверить политикой (команда, содержимое скрипта)
	Servers []string // затронутые серверы
}

type Registry struct {
	list []*Tool
	by   map[string]*Tool
}

func (r *Registry) Add(t *Tool) {
	if r.by == nil {
		r.by = map[string]*Tool{}
	}
	r.list = append(r.list, t)
	r.by[t.Name] = t
}

func (r *Registry) Get(name string) *Tool { return r.by[name] }

func (r *Registry) All() []*Tool { return r.list }

// Pick — инструменты из списка имён (пустой список — все).
func (r *Registry) Pick(names []string) []*Tool {
	if len(names) == 0 {
		return r.list
	}
	set := map[string]bool{}
	for _, n := range names {
		set[n] = true
	}
	var out []*Tool
	for _, t := range r.list {
		if set[t.Name] {
			out = append(out, t)
		}
	}
	return out
}

func (r *Registry) Names() []string {
	var n []string
	for _, t := range r.list {
		n = append(n, t.Name)
	}
	sort.Strings(n)
	return n
}

// ---------- Аргументы ----------

type Args map[string]any

func Parse(raw json.RawMessage) (Args, error) {
	a := Args{}
	s := strings.TrimSpace(string(raw))
	if s == "" || s == "null" {
		return a, nil
	}
	// некоторые модели присылают аргументы строкой с JSON внутри
	if strings.HasPrefix(s, `"`) {
		var inner string
		if err := json.Unmarshal(raw, &inner); err == nil {
			raw = json.RawMessage(inner)
		}
	}
	if err := json.Unmarshal(raw, &a); err != nil {
		return nil, fmt.Errorf("аргументы не JSON: %v", err)
	}
	return a, nil
}

func (a Args) Str(k string) string {
	switch v := a[k].(type) {
	case string:
		return strings.TrimSpace(v)
	case nil:
		return ""
	default:
		return fmt.Sprint(v)
	}
}

func (a Args) Need(k string) (string, error) {
	if s := a.Str(k); s != "" {
		return s, nil
	}
	return "", fmt.Errorf("не задан параметр %q", k)
}

func (a Args) Int(k string, def int) int {
	switch v := a[k].(type) {
	case float64:
		return int(v)
	case string:
		var n int
		if _, err := fmt.Sscan(v, &n); err == nil {
			return n
		}
	}
	return def
}

func (a Args) Bool(k string) bool {
	switch v := a[k].(type) {
	case bool:
		return v
	case string:
		return v == "true" || v == "1" || v == "yes"
	}
	return false
}

// List — массив строк (или одна строка, или "a, b").
func (a Args) List(k string) []string {
	switch v := a[k].(type) {
	case []any:
		var out []string
		for _, x := range v {
			if s := strings.TrimSpace(fmt.Sprint(x)); s != "" {
				out = append(out, s)
			}
		}
		return out
	case string:
		var out []string
		for _, s := range strings.Split(v, ",") {
			if s = strings.TrimSpace(s); s != "" {
				out = append(out, s)
			}
		}
		return out
	}
	return nil
}

// ---------- Схемы ----------

// Obj — схема объекта: Obj(Req("server", "string", "…"), Opt("timeout", "integer", "…")).
func Obj(fields ...Field) map[string]any {
	props := map[string]any{}
	req := []string{}
	for _, f := range fields {
		p := map[string]any{"type": f.Type, "description": f.Desc}
		if f.Type == "array" {
			p["items"] = map[string]any{"type": "string"}
		}
		if len(f.Enum) > 0 {
			p["enum"] = f.Enum
		}
		props[f.Name] = p
		if f.Required {
			req = append(req, f.Name)
		}
	}
	return map[string]any{"type": "object", "properties": props, "required": req}
}

type Field struct {
	Name, Type, Desc string
	Required         bool
	Enum             []string
}

func Req(name, typ, desc string) Field {
	return Field{Name: name, Type: typ, Desc: desc, Required: true}
}
func Opt(name, typ, desc string) Field { return Field{Name: name, Type: typ, Desc: desc} }
func Enum(name, desc string, required bool, vals ...string) Field {
	return Field{Name: name, Type: "string", Desc: desc, Required: required, Enum: vals}
}

// Clip обрезает длинный вывод, сохраняя начало и конец.
func Clip(s string, max int) string {
	if len(s) <= max {
		return s
	}
	head := max * 2 / 3
	tail := max - head
	// не режем посреди UTF-8
	for head > 0 && (s[head]&0xC0) == 0x80 {
		head--
	}
	start := len(s) - tail
	for start < len(s) && (s[start]&0xC0) == 0x80 {
		start++
	}
	return s[:head] + fmt.Sprintf("\n… [пропущено %d байт] …\n", start-head) + s[start:]
}
