// Package shells ищет оболочки, установленные на компьютере.
package shells

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"infra/internal/proc"
)

type Shell struct {
	ID   string   `json:"id"`
	Name string   `json:"name"`
	Path string   `json:"path"`
	Args []string `json:"args"`
	Kind string   `json:"kind"` // powershell | cmd | bash | wsl | other
}

// CommandLine — строка запуска для ConPTY.
func (s Shell) CommandLine() string {
	parts := []string{quote(s.Path)}
	for _, a := range s.Args {
		parts = append(parts, quote(a))
	}
	return strings.Join(parts, " ")
}

func quote(s string) string {
	if strings.ContainsAny(s, " \t\"") {
		return `"` + strings.ReplaceAll(s, `"`, `\"`) + `"`
	}
	return s
}

func exists(p string) bool {
	st, err := os.Stat(p)
	return err == nil && !st.IsDir()
}

func firstExisting(paths ...string) string {
	for _, p := range paths {
		if p != "" && exists(p) {
			return p
		}
	}
	return ""
}

func look(name string) string {
	p, err := exec.LookPath(name)
	if err != nil {
		return ""
	}
	return p
}

// WSLDistros возвращает установленные дистрибутивы WSL.
func WSLDistros() []string {
	wsl := look("wsl.exe")
	if wsl == "" {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	out, err := proc.Output(ctx, wsl, "-l", "-q")
	if err != nil {
		return nil
	}
	var res []string
	for _, l := range strings.Split(out, "\n") {
		l = strings.TrimSpace(strings.Trim(l, "\x00\r"))
		if l == "" || strings.HasPrefix(strings.ToLower(l), "docker-desktop") {
			continue
		}
		res = append(res, l)
	}
	return res
}

func env(k string) string { return os.Getenv(k) }
func pf(rel string) []string {
	return []string{filepath.Join(env("ProgramFiles"), rel), filepath.Join(env("ProgramW6432"), rel), filepath.Join(env("ProgramFiles(x86)"), rel)}
}

var (
	wslMu     sync.Mutex
	wslCache  []string
	wslCached time.Time
)

// WSLDistrosCached — то же, что WSLDistros, но не чаще раза в минуту (wsl.exe медленный).
func WSLDistrosCached() []string {
	wslMu.Lock()
	defer wslMu.Unlock()
	if time.Since(wslCached) > time.Minute {
		wslCache = WSLDistros()
		wslCached = time.Now()
	}
	return wslCache
}
