package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"infra/internal/gitx"
	"infra/internal/proc"
	"infra/internal/runner"
	"infra/internal/shells"
	"infra/internal/sshx"
	"infra/internal/term"
	"infra/internal/vault"
	"infra/internal/virt"
	"infra/internal/vpn"
)

const Version = "0.1.0"

// App — всё, что видит интерфейс: методы становятся window.go.main.App.*.
type App struct {
	ctx context.Context

	mu       sync.RWMutex
	vault    *vault.Vault
	snap     vault.Snapshot
	settings vault.Settings
	shells   []shells.Shell
	shellsMu sync.Mutex

	terms  *term.Manager
	dialer *sshx.Dialer
	vpn    *vpn.Manager
	runner *runner.Runner
	sftp   *sftpPool
	git    *gitx.Store
	jobSeq atomic.Int64
}

func NewApp() *App { return &App{} }

func (a *App) emit(event string, data ...any) {
	if a.ctx != nil {
		runtime.EventsEmit(a.ctx, event, data...)
	}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.settings = vault.LoadSettings()
	a.terms = term.NewManager(a.emit)
	a.git = gitx.NewStore()
	a.vpn = &vpn.Manager{
		Vault:    a.Vault,
		Profiles: func() []vault.VPNProfile { a.mu.RLock(); defer a.mu.RUnlock(); return a.snap.VPNs },
		SingBox:  func() string { return a.tools().SingBox },
		OnChange: func() { a.emit("vpn:changed") },
	}
	a.dialer = &sshx.Dialer{
		Vault:   nil,
		VPNAddr: a.vpn.Addr,
		Servers: a.servers,
	}
	a.runner = &runner.Runner{
		Vault:     a.Vault,
		Dialer:    a.dialer,
		Servers:   a.servers,
		VPNAddr:   a.vpn.Addr,
		WSLDistro: func() string { return a.tools().WSLDistro },
		Emit:      a.emit,
	}
	a.sftp = &sftpPool{dial: func(id string) (*sshClient, error) { c, err := a.dialer.Dial(id, nil); return (*sshClient)(c), err }}
	if a.settings.Vault != "" {
		if _, err := a.OpenVault(a.settings.Vault, false); err != nil {
			a.settings.Vault = ""
		}
	}
}

func (a *App) shutdown(ctx context.Context) {
	a.vpn.StopAll()
	a.terms.CloseAll()
	a.sftp.closeAll()
}

func (a *App) Vault() *vault.Vault {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.vault
}

func (a *App) servers() []vault.Server {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.snap.Servers
}

func (a *App) needVault() (*vault.Vault, error) {
	v := a.Vault()
	if v == nil {
		return nil, errors.New("хранилище не открыто")
	}
	return v, nil
}

// ---------- Состояние и хранилище ----------

type State struct {
	Version  string         `json:"version"`
	Vault    string         `json:"vault"`
	Recent   []string       `json:"recent"`
	Settings vault.Settings `json:"settings"` // как сохранены
	Detected vault.Settings `json:"detected"` // что реально используется (с автопоиском)
	OS       string         `json:"os"`
}

func (a *App) GetState() State {
	a.mu.RLock()
	s := a.settings
	a.mu.RUnlock()
	return State{Version: Version, Vault: s.Vault, Recent: s.Recent, Settings: s, Detected: a.tools(), OS: goos()}
}

// PickFolder — системный диалог выбора папки.
func (a *App) PickFolder(title, start string) (string, error) {
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{Title: title, DefaultDirectory: existingDir(start)})
}

// PickFile — системный диалог выбора файла.
func (a *App) PickFile(title, start string) (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{Title: title, DefaultDirectory: existingDir(start), ShowHiddenFiles: true})
}

func existingDir(p string) string {
	if p == "" {
		return ""
	}
	if st, err := os.Stat(p); err == nil {
		if st.IsDir() {
			return p
		}
		return filepath.Dir(p)
	}
	return ""
}

func (a *App) OpenVault(path string, create bool) (vault.Snapshot, error) {
	v, err := vault.Open(path, create)
	if err != nil {
		return vault.Snapshot{}, err
	}
	a.vpn.StopAll()
	a.sftp.closeAll()
	a.mu.Lock()
	a.vault = v
	a.dialer.Vault = v
	a.settings.Vault = v.Root
	a.settings.AddRecent(v.Root)
	s := a.settings
	a.mu.Unlock()
	_ = vault.SaveSettings(s)
	snap := a.Load()
	for _, p := range snap.VPNs {
		if p.Autostart && p.Type != "socks" {
			go func(id string) {
				if err := a.vpn.Start(id); err != nil {
					a.emit("toast", "VPN "+id+": "+err.Error())
				}
			}(p.ID)
		}
	}
	return snap, nil
}

func (a *App) CloseVault() {
	a.vpn.StopAll()
	a.sftp.closeAll()
	a.mu.Lock()
	a.vault = nil
	a.snap = vault.Snapshot{}
	a.settings.Vault = ""
	s := a.settings
	a.mu.Unlock()
	_ = vault.SaveSettings(s)
}

func (a *App) ForgetRecent(path string) {
	a.mu.Lock()
	var out []string
	for _, r := range a.settings.Recent {
		if r != path {
			out = append(out, r)
		}
	}
	a.settings.Recent = out
	s := a.settings
	a.mu.Unlock()
	_ = vault.SaveSettings(s)
}

// Load перечитывает хранилище с диска.
func (a *App) Load() vault.Snapshot {
	v := a.Vault()
	if v == nil {
		return vault.Snapshot{}
	}
	snap := v.Load()
	a.mu.Lock()
	a.snap = snap
	a.mu.Unlock()
	return snap
}

func (a *App) ReadFile(rel string) (string, error) {
	v, err := a.needVault()
	if err != nil {
		return "", err
	}
	return v.ReadFile(rel)
}

// WriteFile сохраняет файл; второй результат — ошибка синтаксиса YAML (файл всё равно сохранён).
func (a *App) WriteFile(rel, text string) (string, error) {
	v, err := a.needVault()
	if err != nil {
		return "", err
	}
	warn, err := v.WriteFile(rel, text)
	if err == nil {
		a.Load()
	}
	return warn, err
}

func (a *App) DeleteFile(rel string) error {
	v, err := a.needVault()
	if err != nil {
		return err
	}
	err = v.Delete(rel)
	a.Load()
	return err
}

func (a *App) SaveServer(s vault.Server) (string, error) {
	v, err := a.needVault()
	if err != nil {
		return "", err
	}
	rel, err := v.SaveServer(s)
	a.Load()
	return rel, err
}

// Reveal открывает папку/файл в проводнике. Относительный путь — внутри хранилища.
func (a *App) Reveal(p string) error {
	if v := a.Vault(); v != nil && !filepath.IsAbs(p) {
		p = v.Resolve(p)
	}
	if goos() != "windows" {
		return errors.New("только в Windows")
	}
	if st, err := os.Stat(p); err == nil && !st.IsDir() {
		return proc.Command(context.Background(), "explorer.exe", "/select,", p).Start()
	}
	return proc.Command(context.Background(), "explorer.exe", p).Start()
}

// ---------- Настройки и поиск программ ----------

func (a *App) SaveSettings(s vault.Settings) error {
	a.mu.Lock()
	s.Vault = a.settings.Vault
	s.Recent = a.settings.Recent
	s.GitRepos = a.settings.GitRepos
	s.GitDefault = a.settings.GitDefault
	a.settings = s
	a.mu.Unlock()
	return vault.SaveSettings(s)
}

// tools — настройки + автопоиск для пустых полей.
func (a *App) tools() vault.Settings {
	a.mu.RLock()
	s := a.settings
	v := a.vault
	a.mu.RUnlock()
	pf := func(rel string) []string {
		return []string{filepath.Join(os.Getenv("ProgramFiles"), rel), filepath.Join(os.Getenv("ProgramFiles(x86)"), rel)}
	}
	if s.VBoxManage == "" {
		s.VBoxManage = first(append(pf(`Oracle\VirtualBox\VBoxManage.exe`), lookPath("VBoxManage.exe"))...)
	}
	if s.Vmrun == "" {
		s.Vmrun = first(append(pf(`VMware\VMware Workstation\vmrun.exe`), lookPath("vmrun.exe"))...)
	}
	if s.VMwareDir == "" {
		home, _ := os.UserHomeDir()
		s.VMwareDir = filepath.Join(home, "Documents", "Virtual Machines")
	}
	if s.SingBox == "" {
		var c []string
		if v != nil {
			c = append(c, filepath.Join(v.Root, "bin", "sing-box.exe"))
		}
		if exe, err := os.Executable(); err == nil {
			c = append(c, filepath.Join(filepath.Dir(exe), "sing-box.exe"))
		}
		c = append(c, lookPath("sing-box.exe"), lookPath("sing-box"))
		s.SingBox = first(c...)
	}
	if s.WSLDistro == "" {
		if d := shells.WSLDistrosCached(); len(d) > 0 {
			s.WSLDistro = d[0]
		}
	}
	return s
}

func first(paths ...string) string {
	for _, p := range paths {
		if p == "" {
			continue
		}
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p
		}
	}
	return ""
}

func lookPath(n string) string {
	p, err := exec.LookPath(n)
	if err != nil {
		return ""
	}
	return p
}

// ---------- Задачи (долгие операции с прогрессом) ----------

type jobFn func(ctx context.Context, progress func(pct int, msg string)) error

func (a *App) job(title string, fn jobFn) string {
	id := fmt.Sprintf("job%d", a.jobSeq.Add(1))
	a.emit("job", map[string]any{"id": id, "title": title, "pct": 0})
	go func() {
		err := fn(context.Background(), func(pct int, msg string) {
			a.emit("job", map[string]any{"id": id, "title": title, "pct": pct, "msg": msg})
		})
		ev := map[string]any{"id": id, "title": title, "pct": 100, "done": true}
		if err != nil {
			ev["error"] = err.Error()
		}
		a.emit("job", ev)
	}()
	return id
}

func trimLines(s string, n int) string {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.Join(lines, "\n")
}

var _ = trimLines

// ---------- Лабы ----------

func (a *App) virtTools() virt.Tools {
	t := a.tools()
	return virt.Tools{VBoxManage: t.VBoxManage, Vmrun: t.Vmrun, VMwareDir: t.VMwareDir}
}

func (a *App) lab(id string) (vault.Lab, error) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	for _, l := range a.snap.Labs {
		if l.ID == id {
			return l, nil
		}
	}
	return vault.Lab{}, fmt.Errorf("лаба %q не найдена", id)
}

func (a *App) LabPlan(id string) (virt.Plan, error) {
	l, err := a.lab(id)
	if err != nil {
		return virt.Plan{}, err
	}
	return virt.MakePlan(context.Background(), a.virtTools(), l), nil
}

// LabApply создаёт/запускает машины, добавляет их в серверы и запускает provision-плейбук.
func (a *App) LabApply(id string) (string, error) {
	l, err := a.lab(id)
	if err != nil {
		return "", err
	}
	v, err := a.needVault()
	if err != nil {
		return "", err
	}
	return a.job("lab up "+id, func(ctx context.Context, progress func(int, string)) error {
		specs, err := virt.Apply(ctx, a.virtTools(), v, l, progress)
		a.Load()
		a.emit("vault:changed")
		if err != nil {
			return err
		}
		if l.Provision.Playbook == "" || len(specs) == 0 {
			return nil
		}
		if err := virt.WaitSSH(ctx, specs, 5*time.Minute, progress); err != nil {
			return err
		}
		var targets []string
		for _, s := range specs {
			targets = append(targets, s.Name)
		}
		run, err := a.runner.Start(runner.Request{Script: l.Provision.Playbook, Targets: targets})
		if err != nil {
			return fmt.Errorf("provision: %v", err)
		}
		a.emit("run:opened", run, l.Provision.Playbook, targets, "ansible")
		return nil
	}), nil
}

func (a *App) LabStop(id string) (string, error) {
	l, err := a.lab(id)
	if err != nil {
		return "", err
	}
	return a.job("lab stop "+id, func(ctx context.Context, progress func(int, string)) error {
		return virt.ForEach(ctx, a.virtTools(), l, func(p virt.Provider, name, st string) error {
			if st != "running" {
				return nil
			}
			progress(50, "выключаю "+name)
			return p.Stop(ctx, name, false)
		})
	}), nil
}

func (a *App) LabSnapshot(id, name string) (string, error) {
	l, err := a.lab(id)
	if err != nil {
		return "", err
	}
	if name == "" {
		name = "snap"
	}
	return a.job("snapshot "+id, func(ctx context.Context, progress func(int, string)) error {
		return virt.ForEach(ctx, a.virtTools(), l, func(p virt.Provider, vm, _ string) error {
			progress(50, "снапшот "+vm)
			return p.Snapshot(ctx, vm, name)
		})
	}), nil
}

func (a *App) LabDestroy(id string) (string, error) {
	l, err := a.lab(id)
	if err != nil {
		return "", err
	}
	v, err := a.needVault()
	if err != nil {
		return "", err
	}
	return a.job("lab destroy "+id, func(ctx context.Context, progress func(int, string)) error {
		err := virt.Destroy(ctx, a.virtTools(), v, l, progress)
		a.Load()
		a.emit("vault:changed")
		return err
	}), nil
}

// VMAction: start | stop | poweroff для одной машины лабы.
func (a *App) VMAction(labID, vm, action string) error {
	l, err := a.lab(labID)
	if err != nil {
		return err
	}
	p, err := a.virtTools().Provider(l.Provider)
	if err != nil {
		return err
	}
	ctx := context.Background()
	switch action {
	case "start":
		return p.Start(ctx, vm)
	case "stop":
		return p.Stop(ctx, vm, false)
	case "poweroff":
		return p.Stop(ctx, vm, true)
	}
	return fmt.Errorf("неизвестное действие %s", action)
}

// ---------- VPN ----------

func (a *App) VpnStatus() []vpn.Status  { return a.vpn.Status() }
func (a *App) VpnStart(id string) error { return a.vpn.Start(id) }
func (a *App) VpnStop(id string)        { a.vpn.Stop(id) }

// ---------- Скрипты ----------

func (a *App) RunScript(req runner.Request) (string, error) {
	if req.Parallel == 0 {
		req.Parallel = a.tools().Parallel
	}
	return a.runner.Start(req)
}

func (a *App) CancelRun(id string) { a.runner.Cancel(id) }

func (a *App) AnsibleInfo() runner.AnsibleInfo {
	t := a.tools()
	return runner.CheckAnsible(t.WSLDistro, shells.WSLDistrosCached())
}

func (a *App) InstallAnsible() (string, error) {
	return a.runner.InstallAnsible(a.tools().WSLDistro)
}

// PreviewInventory — inventory, который увидит Ansible (для окна запуска).
func (a *App) PreviewInventory(targets []string) string {
	var srv []vault.Server
	set := map[string]bool{}
	for _, t := range targets {
		set[t] = true
	}
	for _, s := range a.servers() {
		if set[s.ID] {
			srv = append(srv, s)
		}
	}
	inv, _, _ := a.runner.BuildInventory(srv)
	// пароли в превью не показываем
	var out []string
	for _, l := range strings.Split(inv, "\n") {
		if i := strings.Index(l, " ansible_password="); i >= 0 {
			l = l[:i] + " ansible_password=***"
		}
		out = append(out, l)
	}
	return strings.Join(out, "\n")
}
