package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"

	"infra/internal/proc"
	"infra/internal/runner"
	"infra/internal/sshx"
	"infra/internal/tools"
	"infra/internal/vault"
)

// Инструменты, которые Infra даёт ИИ (агентам в чате и внешним клиентам по MCP).
// Описания — по-английски: так их надёжнее понимают локальные модели.

func (a *App) buildTools() *tools.Registry {
	r := &tools.Registry{}
	srvArg := tools.Req("server", "string", "Server id from list_servers")
	one := func(args tools.Args) []string { return []string{args.Str("server")} }

	r.Add(&tools.Tool{Name: "list_servers", Title: "Список серверов", Group: "servers",
		Description: "List servers configured in Infra: id, user@host:port, group, VPN, tags. Set check=true to also test whether SSH port is reachable.",
		Params:      tools.Obj(tools.Opt("check", "boolean", "Ping SSH port of every server")),
		Run: func(ctx context.Context, args tools.Args) (string, error) {
			srv := a.servers()
			if len(srv) == 0 {
				return "No servers configured (vault is empty or not opened).", nil
			}
			var st map[string]string
			if args.Bool("check") {
				st = a.CheckServers()
			}
			var b strings.Builder
			for _, s := range srv {
				port := s.Port
				if port == 0 {
					port = 22
				}
				fmt.Fprintf(&b, "- %s: %s@%s:%d", s.ID, s.User, s.Host, port)
				if s.Group != "" {
					fmt.Fprintf(&b, ", group=%s", s.Group)
				}
				if s.VPN != "" {
					fmt.Fprintf(&b, ", via_vpn=%s", s.VPN)
				}
				if len(s.Tags) > 0 {
					fmt.Fprintf(&b, ", tags=%s", strings.Join(s.Tags, ","))
				}
				if a.guard().ReadOnly(s.ID) {
					b.WriteString(", READ-ONLY by policy")
				}
				if st != nil {
					fmt.Fprintf(&b, ", ssh=%s", st[s.ID])
				}
				b.WriteString("\n")
			}
			return b.String(), nil
		}})

	r.Add(&tools.Tool{Name: "run_command", Title: "Команда на сервере", Group: "servers", Danger: true,
		Description: "Run a shell command on a server over SSH and return its output and exit code. Prefer read-only commands to inspect state first. Non-interactive: no prompts, use -y flags, sudo only if passwordless.",
		Params: tools.Obj(srvArg, tools.Req("command", "string", "Shell command (bash). Can be multi-line."),
			tools.Opt("timeout", "integer", "Timeout in seconds (default 60, max 900)")),
		Target: func(args tools.Args) tools.Target {
			return tools.Target{Summary: args.Str("command"), Text: args.Str("command"), Servers: one(args)}
		},
		Run: func(ctx context.Context, args tools.Args) (string, error) {
			s, err := args.Need("server")
			if err != nil {
				return "", err
			}
			cmd, err := args.Need("command")
			if err != nil {
				return "", err
			}
			t := args.Int("timeout", 60)
			t = max(5, min(t, 900))
			out, code, err := a.sshRun(ctx, s, cmd, time.Duration(t)*time.Second)
			if err != nil && code == -1 {
				return out, err
			}
			return fmt.Sprintf("exit code: %d\n%s", code, out), nil
		}})

	r.Add(&tools.Tool{Name: "read_file", Title: "Прочитать файл", Group: "files",
		Description: "Read a text file on a server via SFTP. Large files are truncated; use run_command with tail/grep for logs.",
		Params:      tools.Obj(srvArg, tools.Req("path", "string", "Absolute path on the server"), tools.Opt("max_bytes", "integer", "Read at most this many bytes (default 65536)")),
		Target: func(args tools.Args) tools.Target {
			return tools.Target{Summary: args.Str("path"), Text: args.Str("path"), Servers: one(args)}
		},
		Run: func(ctx context.Context, args tools.Args) (string, error) {
			s, p, err := need2(args, "server", "path")
			if err != nil {
				return "", err
			}
			c, err := a.sftp.get(s)
			if err != nil {
				return "", sshErr(err)
			}
			f, err := c.Open(p)
			if err != nil {
				return "", err
			}
			defer f.Close()
			n := int64(min(max(args.Int("max_bytes", 65536), 1024), 512*1024))
			b, err := io.ReadAll(io.LimitReader(f, n+1))
			if err != nil {
				return "", err
			}
			if bytes.IndexByte(b, 0) >= 0 {
				return "", errors.New("это бинарный файл")
			}
			if int64(len(b)) > n {
				return string(b[:n]) + "\n… [файл обрезан]", nil
			}
			return string(b), nil
		}})

	r.Add(&tools.Tool{Name: "list_dir", Title: "Содержимое папки", Group: "files",
		Description: "List a directory on a server via SFTP (name, type, size, modified).",
		Params:      tools.Obj(srvArg, tools.Opt("path", "string", "Directory (default: home)")),
		Target: func(args tools.Args) tools.Target {
			return tools.Target{Summary: args.Str("path"), Servers: one(args)}
		},
		Run: func(ctx context.Context, args tools.Args) (string, error) {
			s, err := args.Need("server")
			if err != nil {
				return "", err
			}
			l, err := a.RemoteList(s, args.Str("path"))
			if err != nil {
				return "", sshErr(err)
			}
			var b strings.Builder
			fmt.Fprintf(&b, "%s\n", l.Path)
			for i, e := range l.Entries {
				if i >= 400 {
					fmt.Fprintf(&b, "… ещё %d\n", len(l.Entries)-i)
					break
				}
				kind := "file"
				if e.Dir {
					kind = "dir "
				}
				fmt.Fprintf(&b, "%s %10d %s %s\n", kind, e.Size, time.Unix(e.Mtime, 0).Format("2006-01-02 15:04"), e.Name)
			}
			return b.String(), nil
		}})

	r.Add(&tools.Tool{Name: "write_file", Title: "Записать файл", Group: "files", Danger: true,
		Description: "Write a text file on a server via SFTP (creates or replaces). An existing file is backed up next to it as <path>.bak-<timestamp> unless backup=false.",
		Params: tools.Obj(srvArg, tools.Req("path", "string", "Absolute path on the server"), tools.Req("content", "string", "Full new file content"),
			tools.Opt("backup", "boolean", "Back up existing file first (default true)")),
		Target: func(args tools.Args) tools.Target {
			c := args.Str("content")
			return tools.Target{Summary: args.Str("path") + "\n\n" + tools.Clip(c, 3000), Text: args.Str("path") + "\n" + c, Servers: one(args)}
		},
		Run: func(ctx context.Context, args tools.Args) (string, error) {
			s, p, err := need2(args, "server", "path")
			if err != nil {
				return "", err
			}
			content, _ := args["content"].(string)
			c, err := a.sftp.get(s)
			if err != nil {
				return "", sshErr(err)
			}
			backup := ""
			if _, ok := args["backup"]; !ok || args.Bool("backup") {
				if old, err := c.Open(p); err == nil {
					backup = p + ".bak-" + time.Now().Format("20060102-150405")
					if dst, err := c.Create(backup); err == nil {
						_, err = io.Copy(dst, old)
						dst.Close()
						if err != nil {
							backup = ""
						}
					} else {
						backup = ""
					}
					old.Close()
				}
			}
			f, err := c.Create(p)
			if err != nil {
				return "", err
			}
			_, err = f.Write([]byte(content))
			f.Close()
			if err != nil {
				return "", err
			}
			a.emit("files:changed", s)
			msg := fmt.Sprintf("записано %d байт в %s", len(content), p)
			if backup != "" {
				msg += ", копия: " + backup
			}
			return msg, nil
		}})

	r.Add(&tools.Tool{Name: "list_scripts", Title: "Список скриптов", Group: "scripts",
		Description: "List automation scripts in the Infra vault: *.sh (run on servers via SSH), *.yml (Ansible playbooks), *.ps1/*.bat (run on this PC).",
		Params:      tools.Obj(),
		Run: func(ctx context.Context, args tools.Args) (string, error) {
			a.mu.RLock()
			sc := a.snap.Scripts
			a.mu.RUnlock()
			if len(sc) == 0 {
				return "Скриптов нет (папка scripts/ пуста).", nil
			}
			var b strings.Builder
			for _, s := range sc {
				fmt.Fprintf(&b, "- %s (%s)\n", s.Path, s.Kind)
			}
			return b.String(), nil
		}})

	r.Add(&tools.Tool{Name: "read_vault_file", Title: "Файл хранилища", Group: "scripts",
		Description: "Read a file from the Infra vault by relative path (scripts/..., servers/..., labs/..., knowledge/...).",
		Params:      tools.Obj(tools.Req("path", "string", "Relative path inside the vault")),
		Target: func(args tools.Args) tools.Target {
			return tools.Target{Summary: args.Str("path"), Text: args.Str("path")}
		},
		Run: func(ctx context.Context, args tools.Args) (string, error) {
			p, err := args.Need("path")
			if err != nil {
				return "", err
			}
			if isSecretPath(p) {
				return "", errors.New("этот файл содержит ключи VPN — ИИ его не читает")
			}
			return a.ReadFile(p)
		}})

	r.Add(&tools.Tool{Name: "write_vault_file", Title: "Записать в хранилище", Group: "scripts", Danger: true,
		Description: "Create or replace a file in the Infra vault (for example a new script in scripts/ or a note in knowledge/). Does not run anything.",
		Params:      tools.Obj(tools.Req("path", "string", "Relative path inside the vault, e.g. scripts/snippets/check-disk.sh"), tools.Req("content", "string", "File content")),
		Target: func(args tools.Args) tools.Target {
			c := args.Str("content")
			return tools.Target{Summary: args.Str("path") + "\n\n" + tools.Clip(c, 3000), Text: args.Str("path")}
		},
		Run: func(ctx context.Context, args tools.Args) (string, error) {
			p, err := args.Need("path")
			if err != nil {
				return "", err
			}
			if isSecretPath(p) || strings.HasPrefix(path.Clean(p), ".app") || p == vault.RulesFile {
				return "", errors.New("этот файл ИИ менять нельзя")
			}
			content, _ := args["content"].(string)
			warn, err := a.WriteFile(p, content)
			if err != nil {
				return "", err
			}
			a.Load()
			a.emit("vault:changed")
			if warn != "" {
				return "сохранено, но: " + warn, nil
			}
			return "сохранено: " + p, nil
		}})

	r.Add(&tools.Tool{Name: "run_script", Title: "Запустить скрипт", Group: "scripts", Danger: true,
		Description: "Run a script from the vault: .sh on the given servers via SSH (in parallel), .yml as Ansible playbook against the given servers, .ps1/.bat on this PC. Returns the output.",
		Params: tools.Obj(tools.Req("script", "string", "Script path from list_scripts"), tools.Opt("servers", "array", "Server ids (for .sh and .yml)"),
			tools.Opt("sudo", "boolean", "Run bash script with sudo (passwordless)")),
		Target: func(args tools.Args) tools.Target {
			body, _ := a.ReadFile(args.Str("script"))
			return tools.Target{Summary: args.Str("script") + " → " + strings.Join(args.List("servers"), ", ") + "\n\n" + tools.Clip(body, 2000),
				Text: body, Servers: args.List("servers")}
		},
		Run: func(ctx context.Context, args tools.Args) (string, error) {
			sc, err := args.Need("script")
			if err != nil {
				return "", err
			}
			return a.runScriptCapture(ctx, runner.Request{Script: sc, Targets: args.List("servers"), Sudo: args.Bool("sudo"), Parallel: a.tools().Parallel})
		}})

	r.Add(&tools.Tool{Name: "vpn_status", Title: "Состояние VPN", Group: "vpn",
		Description: "List VPN profiles and whether each is connected. Servers with via_vpn use them for SSH.",
		Params:      tools.Obj(),
		Run: func(ctx context.Context, args tools.Args) (string, error) {
			var b strings.Builder
			for _, s := range a.vpn.Status() {
				st := "off"
				if s.Running {
					st = "connected, proxy " + s.Addr
				}
				if s.Error != "" {
					st += ", error: " + s.Error
				}
				fmt.Fprintf(&b, "- %s (%s): %s\n", s.ID, s.Type, st)
			}
			if b.Len() == 0 {
				return "VPN-профилей нет.", nil
			}
			return b.String(), nil
		}})

	r.Add(&tools.Tool{Name: "vpn_switch", Title: "Вкл/выкл VPN", Group: "vpn", Danger: true,
		Description: "Connect or disconnect a VPN profile.",
		Params:      tools.Obj(tools.Req("id", "string", "VPN profile id"), tools.Req("on", "boolean", "true to connect, false to disconnect")),
		Target: func(args tools.Args) tools.Target {
			act := "выключить"
			if args.Bool("on") {
				act = "включить"
			}
			return tools.Target{Summary: act + " VPN " + args.Str("id")}
		},
		Run: func(ctx context.Context, args tools.Args) (string, error) {
			id, err := args.Need("id")
			if err != nil {
				return "", err
			}
			if args.Bool("on") {
				if err := a.vpn.Start(id); err != nil {
					return "", err
				}
				return "VPN " + id + " подключён", nil
			}
			a.vpn.Stop(id)
			return "VPN " + id + " отключён", nil
		}})

	r.Add(&tools.Tool{Name: "list_labs", Title: "Лабы", Group: "labs",
		Description: "List lab environments (virtual machines defined in YAML) and their machines with state.",
		Params:      tools.Obj(),
		Run: func(ctx context.Context, args tools.Args) (string, error) {
			a.mu.RLock()
			labs := a.snap.Labs
			a.mu.RUnlock()
			if len(labs) == 0 {
				return "Лаб нет.", nil
			}
			var b strings.Builder
			for _, l := range labs {
				fmt.Fprintf(&b, "lab %s (%s, template %s)\n", l.ID, l.Provider, l.Template)
				if p, err := a.LabPlan(l.ID); err == nil && p.Error == "" {
					for _, m := range p.VMs {
						fmt.Fprintf(&b, "  - %s %s state=%s\n", m.Name, m.IP, m.State)
					}
				} else {
					fmt.Fprintf(&b, "  (состояние недоступно: %v %s)\n", err, p.Error)
				}
			}
			return b.String(), nil
		}})

	r.Add(&tools.Tool{Name: "lab_action", Title: "Действие с лабой", Group: "labs", Danger: true,
		Description: "Start (apply: create missing VMs, start, provision) or stop a lab. Runs in background; progress is shown in Infra.",
		Params:      tools.Obj(tools.Req("lab", "string", "Lab id"), tools.Enum("action", "apply or stop", true, "apply", "stop")),
		Target: func(args tools.Args) tools.Target {
			return tools.Target{Summary: args.Str("action") + " lab " + args.Str("lab")}
		},
		Run: func(ctx context.Context, args tools.Args) (string, error) {
			lab, err := args.Need("lab")
			if err != nil {
				return "", err
			}
			switch args.Str("action") {
			case "apply":
				_, err = a.LabApply(lab)
			case "stop":
				_, err = a.LabStop(lab)
			default:
				return "", errors.New("action: apply или stop")
			}
			if err != nil {
				return "", err
			}
			return "запущено в фоне — прогресс в строке состояния Infra. Проверь позже через list_labs.", nil
		}})

	r.Add(&tools.Tool{Name: "git_repos", Title: "Репозитории", Group: "git",
		Description: "List git repositories added to Infra with branch, ahead/behind and number of changed files.",
		Params:      tools.Obj(),
		Run: func(ctx context.Context, args tools.Args) (string, error) {
			var b strings.Builder
			for _, r := range a.GitRepos() {
				fmt.Fprintf(&b, "- %s (%s): branch %s, ahead %d, behind %d, changes %d, remote %s\n", r.Name, r.Path, r.Branch, r.Ahead, r.Behind, r.Changes, r.Remote)
			}
			if b.Len() == 0 {
				return "Репозиториев нет.", nil
			}
			return b.String(), nil
		}})

	repoArg := tools.Req("repo", "string", "Repository path or name from git_repos")
	r.Add(&tools.Tool{Name: "git_status", Title: "Git: статус", Group: "git",
		Description: "Show branch and changed files of a repository.",
		Params:      tools.Obj(repoArg),
		Run: func(ctx context.Context, args tools.Args) (string, error) {
			p, err := a.repoPath(args.Str("repo"))
			if err != nil {
				return "", err
			}
			st, err := a.GitStatus(p)
			if err != nil {
				return "", err
			}
			var b strings.Builder
			fmt.Fprintf(&b, "branch %s, upstream %s, ahead %d, behind %d\n", st.Branch, st.Upstream, st.Ahead, st.Behind)
			for _, f := range st.Files {
				fmt.Fprintf(&b, "%s%s %s\n", or(f.Index, " "), or(f.Work, " "), f.Path)
			}
			return b.String(), nil
		}})

	r.Add(&tools.Tool{Name: "git_diff", Title: "Git: изменения", Group: "git",
		Description: "Show diff of uncommitted changes in a repository (optionally one file, optionally staged).",
		Params:      tools.Obj(repoArg, tools.Opt("file", "string", "Only this file"), tools.Opt("staged", "boolean", "Staged changes instead of working tree")),
		Run: func(ctx context.Context, args tools.Args) (string, error) {
			p, err := a.repoPath(args.Str("repo"))
			if err != nil {
				return "", err
			}
			if f := args.Str("file"); f != "" {
				return a.GitDiff(p, f, args.Bool("staged"), false)
			}
			st, err := a.GitStatus(p)
			if err != nil {
				return "", err
			}
			var b strings.Builder
			for _, f := range st.Files {
				if f.Untracked {
					fmt.Fprintf(&b, "new file (untracked): %s\n", f.Path)
					continue
				}
				d, _ := a.GitDiff(p, f.Path, args.Bool("staged"), false)
				b.WriteString(d)
				b.WriteString("\n")
				if b.Len() > 60000 {
					break
				}
			}
			return b.String(), nil
		}})

	r.Add(&tools.Tool{Name: "git_log", Title: "Git: история", Group: "git",
		Description: "Show recent commits of a repository.",
		Params:      tools.Obj(repoArg, tools.Opt("count", "integer", "How many commits (default 20)")),
		Run: func(ctx context.Context, args tools.Args) (string, error) {
			p, err := a.repoPath(args.Str("repo"))
			if err != nil {
				return "", err
			}
			log, err := a.GitLog(p)
			if err != nil {
				return "", err
			}
			n := min(max(args.Int("count", 20), 1), len(log))
			var b strings.Builder
			for _, c := range log[:n] {
				fmt.Fprintf(&b, "%s %s %s: %s\n", c.Short, time.Unix(c.Time, 0).Format("2006-01-02"), c.Author, c.Subject)
			}
			return b.String(), nil
		}})

	r.Add(&tools.Tool{Name: "local_command", Title: "Команда на этом ПК", Group: "local", Danger: true,
		Description: "Run a PowerShell command on this Windows PC (where Infra runs) and return output. Use for local checks like ping, Test-NetConnection, nslookup.",
		Params:      tools.Obj(tools.Req("command", "string", "PowerShell command"), tools.Opt("timeout", "integer", "Timeout in seconds (default 60, max 600)")),
		Target: func(args tools.Args) tools.Target {
			return tools.Target{Summary: args.Str("command"), Text: args.Str("command"), Servers: []string{"local"}}
		},
		Run: func(ctx context.Context, args tools.Args) (string, error) {
			cmd, err := args.Need("command")
			if err != nil {
				return "", err
			}
			t := min(max(args.Int("timeout", 60), 5), 600)
			cctx, cancel := context.WithTimeout(ctx, time.Duration(t)*time.Second)
			defer cancel()
			ps := "powershell.exe"
			if p := lookPath("pwsh"); p != "" {
				ps = p
			}
			c := proc.Command(cctx, ps, "-NoProfile", "-NonInteractive", "-Command",
				"[Console]::OutputEncoding=[Text.Encoding]::UTF8; $ProgressPreference='SilentlyContinue'; "+cmd)
			var buf limited
			c.Stdout, c.Stderr = &buf, &buf
			err = c.Run()
			code := 0
			if err != nil {
				code = -1
				if ee, ok := err.(interface{ ExitCode() int }); ok {
					code = ee.ExitCode()
				}
				if cctx.Err() != nil {
					return buf.String(), fmt.Errorf("таймаут %d с", t)
				}
			}
			return fmt.Sprintf("exit code: %d\n%s", code, buf.String()), nil
		}})

	r.Add(&tools.Tool{Name: "search_knowledge", Title: "Поиск в базе знаний", Group: "knowledge",
		Description: "Search the team knowledge base (security policies, runbooks, notes about servers and services). Use before changing anything on servers and when unsure how things are done here.",
		Params:      tools.Obj(tools.Req("query", "string", "What to look for, in Russian or English"), tools.Opt("limit", "integer", "Max results (default 4)")),
		Run: func(ctx context.Context, args tools.Args) (string, error) {
			q, err := args.Need("query")
			if err != nil {
				return "", err
			}
			hits, err := a.knowledgeSearch(ctx, q, min(max(args.Int("limit", 4), 1), 10))
			if err != nil {
				return "", err
			}
			if len(hits) == 0 {
				return "В базе знаний ничего не найдено по запросу: " + q, nil
			}
			var b strings.Builder
			for _, h := range hits {
				fmt.Fprintf(&b, "### %s — %s\n%s\n\n", h.File, h.Heading, h.Text)
			}
			return b.String(), nil
		}})
	return r
}

// ---------- помощники ----------

func need2(a tools.Args, k1, k2 string) (string, string, error) {
	x, err := a.Need(k1)
	if err != nil {
		return "", "", err
	}
	y, err := a.Need(k2)
	return x, y, err
}

func or(s, d string) string {
	if s == "" {
		return d
	}
	return s
}

func sshErr(err error) error {
	if errors.Is(err, sshx.ErrNeedPassword) || (err != nil && err.Error() == "NEED_PASSWORD") {
		return errors.New("для этого сервера нужен пароль: открой его терминал в Infra и сохрани пароль («запомнить»)")
	}
	return err
}

var secretPathRe = regexp.MustCompile(`(?i)\.(conf|key|pem)$|(^|/)\.app/`)

// isSecretPath — файлы хранилища с ключами (WireGuard .conf и т.п.) ИИ не показываем.
func isSecretPath(p string) bool {
	return secretPathRe.MatchString(path.Clean(strings.ReplaceAll(p, `\`, "/")))
}

// limited — буфер с потолком 512 КБ.
type limited struct {
	mu  sync.Mutex
	b   bytes.Buffer
	cut bool
}

func (l *limited) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if room := 512*1024 - l.b.Len(); room > 0 {
		if len(p) > room {
			l.b.Write(p[:room])
			l.cut = true
		} else {
			l.b.Write(p)
		}
	} else {
		l.cut = true
	}
	return len(p), nil
}

func (l *limited) String() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	s := strings.ToValidUTF8(l.b.String(), "?")
	if l.cut {
		s += "\n… [вывод обрезан]"
	}
	return s
}

// sshRun выполняет команду на сервере. code = -1 — команда не запустилась.
func (a *App) sshRun(ctx context.Context, server, cmd string, timeout time.Duration) (string, int, error) {
	if !serverExists(a.servers(), server) {
		return "", -1, fmt.Errorf("сервер %q не найден — см. list_servers", server)
	}
	client, err := a.dialer.Dial(server, nil)
	if err != nil {
		return "", -1, sshErr(err)
	}
	defer client.Close()
	sess, err := client.NewSession()
	if err != nil {
		return "", -1, err
	}
	defer sess.Close()
	var buf limited
	sess.Stdout, sess.Stderr = &buf, &buf
	done := make(chan error, 1)
	go func() { done <- sess.Run(cmd) }()
	tm := time.NewTimer(timeout)
	defer tm.Stop()
	select {
	case err = <-done:
	case <-ctx.Done():
		_ = sess.Signal(ssh.SIGTERM)
		return buf.String(), -1, errors.New("остановлено")
	case <-tm.C:
		_ = sess.Signal(ssh.SIGTERM)
		return buf.String() + fmt.Sprintf("\n[таймаут %s — команда прервана]", timeout), 124, nil
	}
	if err == nil {
		return buf.String(), 0, nil
	}
	var ee *ssh.ExitError
	if errors.As(err, &ee) {
		return buf.String(), ee.ExitStatus(), nil
	}
	var em *ssh.ExitMissingError
	if errors.As(err, &em) {
		return buf.String(), -2, nil
	}
	return buf.String(), -1, err
}

func serverExists(list []vault.Server, id string) bool {
	for _, s := range list {
		if s.ID == id {
			return true
		}
	}
	return false
}

func (a *App) repoPath(q string) (string, error) {
	repos := a.GitRepos()
	if q == "" && len(repos) == 1 {
		return repos[0].Path, nil
	}
	for _, r := range repos {
		if strings.EqualFold(r.Path, q) || strings.EqualFold(r.Name, q) {
			return r.Path, nil
		}
	}
	var names []string
	for _, r := range repos {
		names = append(names, r.Name)
	}
	sort.Strings(names)
	return "", fmt.Errorf("репозиторий %q не найден; есть: %s", q, strings.Join(names, ", "))
}

var ansiRe = regexp.MustCompile(`\x1b\[[0-9;?]*[A-Za-z]`)

// runScriptCapture запускает скрипт и собирает вывод по серверам.
func (a *App) runScriptCapture(ctx context.Context, req runner.Request) (string, error) {
	var (
		mu    sync.Mutex
		out   = map[string]*limited{}
		state = map[string]string{}
		order []string
		done  = make(chan struct{})
		once  sync.Once
	)
	req.Hook = func(event string, data ...any) {
		mu.Lock()
		defer mu.Unlock()
		switch event {
		case "run:out":
			host, _ := data[1].(string)
			b, _ := base64.StdEncoding.DecodeString(fmt.Sprint(data[2]))
			if out[host] == nil {
				out[host] = &limited{}
				order = append(order, host)
			}
			_, _ = out[host].Write(bytes.ReplaceAll(b, []byte("\r\n"), []byte("\n")))
		case "run:host":
			host, _ := data[1].(string)
			state[host] = fmt.Sprintf("%v (код %v)", data[2], data[3])
		case "run:done":
			once.Do(func() { close(done) })
		}
	}
	run, err := a.runner.Start(req)
	if err != nil {
		return "", err
	}
	select {
	case <-done:
	case <-ctx.Done():
		a.runner.Cancel(run)
		<-done
	}
	mu.Lock()
	defer mu.Unlock()
	var b strings.Builder
	for _, h := range order {
		fmt.Fprintf(&b, "=== %s: %s ===\n%s\n", h, state[h], ansiRe.ReplaceAllString(out[h].String(), ""))
	}
	if b.Len() == 0 {
		b.WriteString("скрипт завершился без вывода")
	}
	return b.String(), nil
}

var _ = os.Getenv
