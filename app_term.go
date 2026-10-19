package main

import (
	"errors"
	"fmt"
	"os"
	goruntime "runtime"
	"strings"

	"infra/internal/shells"
	"infra/internal/sshx"
)

func goos() string { return goruntime.GOOS }

// ListShells — оболочки, найденные на этом компьютере.
func (a *App) ListShells() []shells.Shell {
	a.shellsMu.Lock()
	defer a.shellsMu.Unlock()
	if a.shells == nil {
		a.shells = shells.Detect()
	}
	return a.shells
}

// RescanShells — искать оболочки заново (например, после установки WSL).
func (a *App) RescanShells() []shells.Shell {
	list := shells.Detect()
	a.shellsMu.Lock()
	a.shells = list
	a.shellsMu.Unlock()
	return list
}

// TermOpenLocal открывает локальную оболочку. vpn — id профиля или "" (напрямую).
func (a *App) TermOpenLocal(shellID, vpnID string, cols, rows int) (string, error) {
	return a.TermOpenLocalAt(shellID, vpnID, "", cols, rows)
}

// TermOpenLocalAt — то же, но в указанной папке.
func (a *App) TermOpenLocalAt(shellID, vpnID, cwd string, cols, rows int) (string, error) {
	return a.TermOpenLocalWith(shellID, vpnID, cwd, "@default", cols, rows)
}

// TermOpenLocalWith — с выбором git-аккаунта: "@default" — по умолчанию, "" — системный git, id — конкретный.
func (a *App) TermOpenLocalWith(shellID, vpnID, cwd, gitAccount string, cols, rows int) (string, error) {
	var sh *shells.Shell
	for _, s := range a.ListShells() {
		if s.ID == shellID {
			s := s
			sh = &s
			break
		}
	}
	if sh == nil {
		return "", fmt.Errorf("оболочка %q не найдена", shellID)
	}
	env := append(os.Environ(), "TERM=xterm-256color", "COLORTERM=truecolor")
	if sh.Kind != "wsl" {
		env = append(env, a.accountEnv(gitAccount)...) // git в этом терминале — от выбранного аккаунта
	}
	if vpnID != "" {
		pe, err := a.vpn.ProxyEnv(vpnID)
		if err != nil {
			return "", err
		}
		env = append(env, pe...)
		if sh.Kind == "wsl" {
			// пробрасываем переменные прокси внутрь WSL
			env = append(env, "WSLENV=ALL_PROXY/u:all_proxy/u:HTTP_PROXY/u:HTTPS_PROXY/u:http_proxy/u:https_proxy/u")
		}
	}
	dir, _ := os.UserHomeDir()
	if v := a.Vault(); v != nil && sh.Kind != "wsl" {
		dir = v.Root
	}
	cmdline := sh.CommandLine()
	if cwd != "" {
		dir = cwd
		if sh.Kind == "wsl" { // wsl --cd принимает и путь Windows
			c := *sh
			c.Args = []string{"-d", strings.TrimPrefix(sh.ID, "wsl:"), "--cd", cwd}
			cmdline = c.CommandLine()
		}
	}
	return a.terms.OpenLocal(cmdline, dir, env, cols, rows)
}

// TermOpenSSH подключается к серверу. vpnID: "@default" — как в конфиге сервера, "" — напрямую.
// Ошибка "NEED_PASSWORD" — нужно спросить пароль и вызвать SetPassword.
func (a *App) TermOpenSSH(serverID, vpnID string, cols, rows int) (string, error) {
	var over *string
	if vpnID != "@default" {
		over = &vpnID
	}
	var notes []string
	client, err := a.dialer.DialNotify(serverID, over, func(msg string) { notes = append(notes, msg) })
	if err != nil {
		if errors.Is(err, sshx.ErrNeedPassword) {
			return "", errors.New("NEED_PASSWORD")
		}
		return "", err
	}
	id, err := a.terms.OpenSSH(client, cols, rows)
	if err == nil {
		for _, n := range notes {
			a.terms.Info(id, n)
		}
	}
	return id, err
}

func (a *App) TermWrite(id, data string) error            { return a.terms.Write(id, data) }
func (a *App) TermResize(id string, cols, rows int) error { return a.terms.Resize(id, cols, rows) }
func (a *App) TermClose(id string)                        { a.terms.Close(id) }

func (a *App) SetPassword(serverID, password string, remember bool) error {
	return a.dialer.SetPassword(serverID, password, remember)
}

func (a *App) ForgetPassword(serverID string) { a.dialer.ForgetPassword(serverID) }

// CheckServers — открыт ли SSH-порт на каждом сервере.
func (a *App) CheckServers() map[string]string {
	res := map[string]string{}
	srv := a.servers()
	type r struct{ id, st string }
	ch := make(chan r, len(srv))
	for _, s := range srv {
		go func() { ch <- r{s.ID, a.dialer.Ping(s)} }()
	}
	for range srv {
		x := <-ch
		res[x.id] = x.st
	}
	return res
}
