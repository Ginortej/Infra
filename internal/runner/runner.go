// Package runner запускает скрипты из scripts/:
//
//	*.sh / *.bash  — на выбранных серверах по SSH (bash -s, параллельно)
//	*.yml / *.yaml — ansible-playbook внутри WSL, inventory из выбранных серверов
//	*.ps1          — на этом ПК в PowerShell
//	*.bat / *.cmd  — на этом ПК в cmd
package runner

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/crypto/ssh"

	"infra/internal/proc"
	"infra/internal/sshx"
	"infra/internal/vault"
)

type Request struct {
	Script   string   `json:"script"`
	Targets  []string `json:"targets"`  // id серверов
	Shell    string   `json:"shell"`    // для .ps1: путь к pwsh/powershell
	Parallel int      `json:"parallel"` // для bash
	Sudo     bool     `json:"sudo"`     // bash: выполнить через sudo (без пароля)
}

type Emit func(event string, data ...any)

type Runner struct {
	Vault     func() *vault.Vault
	Dialer    *sshx.Dialer
	Servers   func() []vault.Server
	VPNAddr   func(id string) (string, error)
	WSLDistro func() string
	Emit      Emit

	seq    atomic.Int64
	mu     sync.Mutex
	cancel map[string]context.CancelFunc
}

func (r *Runner) out(run, host string, b []byte) {
	if len(b) > 0 {
		r.Emit("run:out", run, host, base64.StdEncoding.EncodeToString(b))
	}
}

func (r *Runner) info(run, host, s string) {
	r.out(run, host, []byte("\x1b[90m"+s+"\x1b[0m\r\n"))
}

func (r *Runner) hostState(run, host, state string, code int, start time.Time) {
	r.Emit("run:host", run, host, state, code, time.Since(start).Milliseconds())
}

// emitWriter превращает поток вывода в события (с \n -> \r\n для терминала).
type emitWriter struct {
	r         *Runner
	run, host string
}

func (w emitWriter) Write(p []byte) (int, error) {
	w.r.out(w.run, w.host, bytes.ReplaceAll(bytes.ReplaceAll(p, []byte("\r\n"), []byte("\n")), []byte("\n"), []byte("\r\n")))
	return len(p), nil
}

func (r *Runner) Cancel(run string) {
	r.mu.Lock()
	c := r.cancel[run]
	r.mu.Unlock()
	if c != nil {
		c()
	}
}

func (r *Runner) servers(ids []string) ([]vault.Server, error) {
	all := map[string]vault.Server{}
	for _, s := range r.Servers() {
		all[s.ID] = s
	}
	var out []vault.Server
	for _, id := range ids {
		s, ok := all[id]
		if !ok {
			return nil, fmt.Errorf("сервер %q не найден", id)
		}
		out = append(out, s)
	}
	return out, nil
}

// Start запускает скрипт и сразу возвращает id запуска; дальше — события run:*.
func (r *Runner) Start(req Request) (string, error) {
	v := r.Vault()
	path, err := v.Abs(req.Script)
	if err != nil {
		return "", err
	}
	kind := vault.ScriptKind(req.Script)
	if kind == "" {
		return "", errors.New("неизвестный тип скрипта (нужно .sh, .yml, .ps1, .bat)")
	}
	run := fmt.Sprintf("run%d", r.seq.Add(1))
	ctx, cancel := context.WithCancel(context.Background())
	r.mu.Lock()
	if r.cancel == nil {
		r.cancel = map[string]context.CancelFunc{}
	}
	r.cancel[run] = cancel
	r.mu.Unlock()

	finish := func() {
		r.mu.Lock()
		delete(r.cancel, run)
		r.mu.Unlock()
		cancel()
		r.Emit("run:done", run)
	}

	switch kind {
	case "bash":
		srv, err := r.servers(req.Targets)
		if err != nil || len(srv) == 0 {
			finish()
			if err == nil {
				err = errors.New("не выбраны серверы")
			}
			return "", err
		}
		body, err := os.ReadFile(path)
		if err != nil {
			finish()
			return "", err
		}
		go func() { defer finish(); r.runBash(ctx, run, srv, body, req) }()
	case "ansible":
		srv, err := r.servers(req.Targets)
		if err != nil || len(srv) == 0 {
			finish()
			if err == nil {
				err = errors.New("не выбраны серверы")
			}
			return "", err
		}
		go func() { defer finish(); r.runAnsible(ctx, run, req.Script, srv) }()
	case "powershell", "cmd":
		go func() { defer finish(); r.runLocal(ctx, run, kind, path, req.Shell) }()
	}
	return run, nil
}

// ---------- bash по SSH ----------

func (r *Runner) runBash(ctx context.Context, run string, srv []vault.Server, body []byte, req Request) {
	par := req.Parallel
	if par <= 0 {
		par = 10
	}
	sem := make(chan struct{}, par)
	var wg sync.WaitGroup
	cmd := "bash -s"
	if req.Sudo {
		cmd = "sudo -n bash -s"
	}
	for _, s := range srv {
		wg.Add(1)
		go func(s vault.Server) {
			defer wg.Done()
			select {
			case sem <- struct{}{}:
			case <-ctx.Done():
				r.hostState(run, s.ID, "cancel", -1, time.Now())
				return
			}
			defer func() { <-sem }()
			start := time.Now()
			r.hostState(run, s.ID, "running", 0, start)
			r.info(run, s.ID, fmt.Sprintf("$ ssh %s@%s '%s' < %s", s.User, s.Host, cmd, filepath.Base(req.Script)))
			code, err := r.sshExec(ctx, run, s, cmd, body)
			if err != nil {
				msg := err.Error()
				if errors.Is(err, sshx.ErrNeedPassword) {
					msg = "нужен пароль — подключись к серверу один раз из терминала и сохрани пароль"
				}
				r.out(run, s.ID, []byte("\x1b[31m"+msg+"\x1b[0m\r\n"))
				r.hostState(run, s.ID, "fail", -1, start)
				return
			}
			st := "ok"
			if code != 0 {
				st = "fail"
			}
			if ctx.Err() != nil {
				st = "cancel"
			}
			r.info(run, s.ID, fmt.Sprintf("── код выхода %d · %.1f с", code, time.Since(start).Seconds()))
			r.hostState(run, s.ID, st, code, start)
		}(s)
	}
	wg.Wait()
}

func (r *Runner) sshExec(ctx context.Context, run string, s vault.Server, cmd string, stdin []byte) (int, error) {
	client, err := r.Dialer.Dial(s.ID, nil)
	if err != nil {
		return -1, err
	}
	defer client.Close()
	sess, err := client.NewSession()
	if err != nil {
		return -1, err
	}
	defer sess.Close()
	w := emitWriter{r, run, s.ID}
	sess.Stdout = w
	sess.Stderr = w
	sess.Stdin = bytes.NewReader(bytes.ReplaceAll(stdin, []byte("\r\n"), []byte("\n")))
	done := make(chan error, 1)
	go func() { done <- sess.Run(cmd) }()
	select {
	case err = <-done:
	case <-ctx.Done():
		_ = sess.Signal(ssh.SIGTERM)
		client.Close()
		return -1, errors.New("остановлено")
	}
	if err == nil {
		return 0, nil
	}
	var ee *ssh.ExitError
	if errors.As(err, &ee) {
		return ee.ExitStatus(), nil
	}
	return -1, err
}

// ---------- локально ----------

func (r *Runner) runLocal(ctx context.Context, run, kind, path, shell string) {
	start := time.Now()
	r.hostState(run, "local", "running", 0, start)
	var cmd *exec.Cmd
	if kind == "powershell" {
		if shell == "" {
			shell = "powershell.exe"
		}
		ps := fmt.Sprintf("[Console]::OutputEncoding=[Text.Encoding]::UTF8; $OutputEncoding=[Text.Encoding]::UTF8; & '%s'", strings.ReplaceAll(path, "'", "''"))
		cmd = proc.Command(ctx, shell, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", ps)
		r.info(run, "local", fmt.Sprintf("$ %s -File %s", filepath.Base(shell), path))
	} else {
		cmd = proc.Command(ctx, "cmd.exe", "/d", "/c", "chcp 65001 >nul & call \""+path+"\"")
		r.info(run, "local", "$ cmd /c "+path)
	}
	cmd.Dir = filepath.Dir(path)
	w := emitWriter{r, run, "local"}
	cmd.Stdout = w
	cmd.Stderr = w
	err := cmd.Run()
	code := exitCode(err)
	st := "ok"
	if code != 0 {
		st = "fail"
		if code == -1 && err != nil {
			r.out(run, "local", []byte("\x1b[31m"+err.Error()+"\x1b[0m\r\n"))
		}
	}
	r.info(run, "local", fmt.Sprintf("── код выхода %d · %.1f с", code, time.Since(start).Seconds()))
	r.hostState(run, "local", st, code, start)
}

func exitCode(err error) int {
	if err == nil {
		return 0
	}
	var ee *exec.ExitError
	if errors.As(err, &ee) {
		return ee.ExitCode()
	}
	return -1
}

// ---------- Ansible в WSL ----------

type AnsibleInfo struct {
	WSL     bool     `json:"wsl"`
	Distros []string `json:"distros"`
	Distro  string   `json:"distro"`
	Ansible bool     `json:"ansible"`
	Version string   `json:"version"`
	Error   string   `json:"error"`
}

func wslExe() string {
	if p, err := exec.LookPath("wsl.exe"); err == nil {
		return p
	}
	return ""
}

// CheckAnsible проверяет WSL и ansible-playbook внутри выбранного дистрибутива.
func CheckAnsible(distro string, distros []string) AnsibleInfo {
	info := AnsibleInfo{Distros: distros}
	if wslExe() == "" {
		info.Error = "WSL не установлен. Открой PowerShell от администратора и выполни: wsl --install"
		return info
	}
	info.WSL = true
	if distro == "" && len(distros) > 0 {
		distro = distros[0]
	}
	info.Distro = distro
	if distro == "" {
		info.Error = "В WSL нет ни одного дистрибутива. Выполни: wsl --install -d Ubuntu"
		return info
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	out, err := proc.Output(ctx, wslExe(), "-d", distro, "-e", "sh", "-lc", "ansible-playbook --version 2>/dev/null | head -1")
	out = strings.TrimSpace(out)
	if err == nil && strings.Contains(out, "ansible") {
		info.Ansible = true
		info.Version = out
	}
	return info
}

// InstallAnsible ставит ansible в WSL (apt), вывод — как обычный запуск.
func (r *Runner) InstallAnsible(distro string) (string, error) {
	if wslExe() == "" || distro == "" {
		return "", errors.New("WSL или дистрибутив не найден")
	}
	run := fmt.Sprintf("run%d", r.seq.Add(1))
	ctx, cancel := context.WithCancel(context.Background())
	r.mu.Lock()
	if r.cancel == nil {
		r.cancel = map[string]context.CancelFunc{}
	}
	r.cancel[run] = cancel
	r.mu.Unlock()
	go func() {
		defer func() {
			r.mu.Lock()
			delete(r.cancel, run)
			r.mu.Unlock()
			cancel()
			r.Emit("run:done", run)
		}()
		start := time.Now()
		r.hostState(run, "local", "running", 0, start)
		script := "export DEBIAN_FRONTEND=noninteractive; if command -v apt-get >/dev/null; then apt-get update && apt-get install -y ansible sshpass netcat-openbsd; elif command -v dnf >/dev/null; then dnf install -y ansible-core sshpass nmap-ncat; else echo 'Неизвестный пакетный менеджер'; exit 1; fi"
		r.info(run, "local", "$ wsl -d "+distro+" -u root -- sh -c 'apt-get install -y ansible sshpass'")
		cmd := proc.Command(ctx, wslExe(), "-d", distro, "-u", "root", "-e", "sh", "-c", script)
		w := emitWriter{r, run, "local"}
		cmd.Stdout = w
		cmd.Stderr = w
		code := exitCode(cmd.Run())
		st := "ok"
		if code != 0 {
			st = "fail"
		}
		r.hostState(run, "local", st, code, start)
	}()
	return run, nil
}

var recapRe = regexp.MustCompile(`(?m)^(\S+)\s+:\s+ok=\d+\s+changed=\d+\s+unreachable=(\d+)\s+failed=(\d+)`)
var ansiRe = regexp.MustCompile(`\x1b\[[0-9;]*m`)

// BuildInventory собирает INI-inventory и bash-пролог, копирующий ключи внутрь WSL
// (с /mnt/c ssh не примет ключ из-за прав доступа).
func (r *Runner) BuildInventory(srv []vault.Server) (inv string, prolog []string, notes []string) {
	v := r.Vault()
	keys := map[string]string{}
	var b strings.Builder
	b.WriteString("[targets]\n")
	for _, s := range srv {
		line := fmt.Sprintf("%s ansible_host=%s ansible_port=%d ansible_user=%s", s.ID, s.Host, s.Port, s.User)
		if s.Auth == "key" && s.Key != "" {
			kp := v.Resolve(s.Key)
			name, ok := keys[kp]
			if !ok {
				name = fmt.Sprintf("k%d", len(keys))
				keys[kp] = name
				prolog = append(prolog, fmt.Sprintf("cp %s ~/.infra/keys/%s && chmod 600 ~/.infra/keys/%s", proc.ShellQuote(proc.ToWSL(kp)), name, name))
			}
			line += " ansible_ssh_private_key_file=~/.infra/keys/" + name
		} else if s.Auth == "password" {
			if pw := r.Dialer.Password(s.ID); pw != "" {
				line += " ansible_password=" + quoteIni(pw)
			} else {
				notes = append(notes, s.ID+": пароль не сохранён — подключись к серверу из терминала и отметь «Сохранить пароль»")
			}
		}
		if s.VPN != "" {
			if addr, err := r.VPNAddr(s.VPN); err == nil {
				line += fmt.Sprintf(` ansible_ssh_common_args='-o ProxyCommand="nc -X 5 -x %s %%h %%p"'`, addr)
				notes = append(notes, s.ID+": через VPN "+s.VPN+" — нужен режим сети WSL mirrored (networkingMode=mirrored в .wslconfig)")
			} else {
				notes = append(notes, s.ID+": VPN "+s.VPN+" не подключён")
			}
		}
		b.WriteString(line + "\n")
	}
	return b.String(), prolog, notes
}

func quoteIni(s string) string {
	return `"` + strings.ReplaceAll(strings.ReplaceAll(s, `\`, `\\`), `"`, `\"`) + `"`
}

func (r *Runner) runAnsible(ctx context.Context, run, playbook string, srv []vault.Server) {
	start := time.Now()
	v := r.Vault()
	for _, s := range srv {
		r.hostState(run, s.ID, "running", 0, start)
	}
	fail := func(msg string) {
		r.out(run, "", []byte("\x1b[31m"+msg+"\x1b[0m\r\n"))
		for _, s := range srv {
			r.hostState(run, s.ID, "fail", -1, start)
		}
	}
	distro := r.WSLDistro()
	if wslExe() == "" || distro == "" {
		fail("WSL не найден. Ansible работает внутри WSL: выполни «wsl --install» и перезапусти программу.")
		return
	}
	inv, prolog, notes := r.BuildInventory(srv)
	invPath := filepath.Join(v.AppDir("run"), run+"-inventory.ini")
	if err := os.WriteFile(invPath, []byte(inv), 0o600); err != nil {
		fail(err.Error())
		return
	}
	defer os.Remove(invPath) // там могут быть пароли
	for _, n := range notes {
		r.out(run, "", []byte("\x1b[33m! "+n+"\x1b[0m\r\n"))
	}
	script := []string{
		"set -e",
		"command -v ansible-playbook >/dev/null || { echo 'ansible-playbook не найден в WSL. Нажми «Установить Ansible» в окне запуска.'; exit 127; }",
		"mkdir -p ~/.infra/keys && chmod 700 ~/.infra/keys",
	}
	script = append(script, prolog...)
	script = append(script,
		"export ANSIBLE_HOST_KEY_CHECKING=False ANSIBLE_FORCE_COLOR=1 PYTHONUNBUFFERED=1 ANSIBLE_STDOUT_CALLBACK=default",
		"cd "+proc.ShellQuote(proc.ToWSL(v.Root)),
		"ansible-playbook -i "+proc.ShellQuote(proc.ToWSL(invPath))+" "+proc.ShellQuote(playbook),
	)
	r.info(run, "", fmt.Sprintf("$ wsl -d %s -- ansible-playbook -i .app/run/%s %s", distro, filepath.Base(invPath), playbook))
	cmd := proc.Command(ctx, wslExe(), "-d", distro, "-e", "bash", "-lc", strings.Join(script, "\n"))
	var all bytes.Buffer
	w := emitWriter{r, run, ""}
	cmd.Stdout = io.MultiWriter(w, &all)
	cmd.Stderr = cmd.Stdout
	code := exitCode(cmd.Run())

	// итог по каждому серверу из PLAY RECAP
	seen := map[string]bool{}
	for _, m := range recapRe.FindAllStringSubmatch(ansiRe.ReplaceAllString(all.String(), ""), -1) {
		st := "ok"
		if m[2] != "0" || m[3] != "0" {
			st = "fail"
		}
		seen[m[1]] = true
		c := 0
		if st == "fail" {
			c = 2
		}
		r.hostState(run, m[1], st, c, start)
	}
	for _, s := range srv {
		if !seen[s.ID] {
			st := "fail"
			if ctx.Err() != nil {
				st = "cancel"
			}
			r.hostState(run, s.ID, st, code, start)
		}
	}
	r.info(run, "", fmt.Sprintf("── ansible-playbook завершился с кодом %d · %.1f с", code, time.Since(start).Seconds()))
}
