package main

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"infra/internal/agent"
	"infra/internal/tools"
)

func testAI(t *testing.T) (*App, *string) {
	t.Setenv("APPDATA", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	a := NewApp()
	a.ai = &aiState{agents: agent.NewStoreAt(t.TempDir() + "/a.json"), chats: agent.NewChatsAt(t.TempDir()),
		pending: map[string]*pendingApproval{}, live: map[string]*liveChat{}, mcpAllow: map[string]bool{}, pulls: map[string]context.CancelFunc{}}
	ran := new(string)
	a.ai.reg = &tools.Registry{}
	a.ai.reg.Add(&tools.Tool{Name: "run_command", Danger: true, Params: tools.Obj(),
		Target: func(x tools.Args) tools.Target {
			return tools.Target{Summary: x.Str("command"), Text: x.Str("command"), Servers: []string{x.Str("server")}}
		},
		Run: func(ctx context.Context, x tools.Args) (string, error) {
			*ran = x.Str("command")
			return "ok DB_PASSWORD=hunter2", nil
		}})
	a.ai.reg.Add(&tools.Tool{Name: "list_servers", Params: tools.Obj(), Run: func(ctx context.Context, x tools.Args) (string, error) { return "web", nil }})
	return a, ran
}

func approveNext(a *App, decision string) {
	go func() {
		for i := 0; i < 200; i++ {
			if p := a.AgentPending(); len(p) > 0 {
				a.AgentApprove(p[0].ID, decision)
				return
			}
			time.Sleep(5 * time.Millisecond)
		}
	}()
}

func TestExecTool(t *testing.T) {
	a, ran := testAI(t)
	ag := &agent.Agent{Tools: []string{"run_command", "list_servers"}, Approve: "danger"}
	src := &execSource{Kind: "chat", Agent: ag, Allow: map[string]bool{}}
	args := func(cmd string) json.RawMessage {
		b, _ := json.Marshal(map[string]string{"server": "web", "command": cmd})
		return b
	}

	// чтение — без подтверждения
	if out, err := a.execTool(context.Background(), src, "list_servers", nil); err != nil || !strings.Contains(out, "<data") {
		t.Fatal(out, err)
	}
	// запрет политикой — даже не спрашиваем
	if _, err := a.execTool(context.Background(), src, "run_command", args("rm -rf /")); err == nil || !strings.Contains(err.Error(), "заблокировано") || *ran != "" {
		t.Fatal(err)
	}
	// отказ человека
	approveNext(a, "deny:не сейчас")
	if _, err := a.execTool(context.Background(), src, "run_command", args("uptime")); err == nil || !strings.Contains(err.Error(), "не сейчас") || *ran != "" {
		t.Fatal(err)
	}
	// разрешение + вырезание секрета
	approveNext(a, "always")
	out, err := a.execTool(context.Background(), src, "run_command", args("uptime"))
	if err != nil || *ran != "uptime" || strings.Contains(out, "hunter2") || !strings.Contains(out, "скрыто") {
		t.Fatal(out, err)
	}
	// «разрешать всегда» — дальше без вопроса
	if _, err := a.execTool(context.Background(), src, "run_command", args("df -h")); err != nil || *ran != "df -h" {
		t.Fatal(err)
	}
	// но опасная (strict) команда снова спрашивает
	approveNext(a, "deny")
	if _, err := a.execTool(context.Background(), src, "run_command", args("sudo reboot")); err == nil || *ran == "sudo reboot" {
		t.Fatal("strict must ask", err)
	}
	// инструмент не разрешён агенту
	ag.Tools = []string{"list_servers"}
	if _, err := a.execTool(context.Background(), src, "run_command", args("uptime")); err == nil {
		t.Fatal("tool not allowed")
	}
	// MCP только чтение
	a.settings.MCPReadOnly = true
	if _, err := a.execTool(context.Background(), &execSource{Kind: "mcp", Allow: map[string]bool{}}, "run_command", args("uptime")); err == nil {
		t.Fatal("mcp readonly")
	}
}
