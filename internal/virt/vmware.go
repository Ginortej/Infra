package virt

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"infra/internal/proc"
	"infra/internal/vault"
)

// VMware Workstation управляется через vmrun.exe. Машины лежат в <Dir>\<name>\<name>.vmx.
type VMware struct {
	Bin string
	Dir string
}

func (w *VMware) Name() string { return "vmware" }

func (w *VMware) vmx(name string) string { return filepath.Join(w.Dir, name, name+".vmx") }

func (w *VMware) run(ctx context.Context, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	out, err := proc.Output(ctx, w.Bin, append([]string{"-T", "ws"}, args...)...)
	if err != nil {
		msg := strings.TrimSpace(out)
		if msg == "" {
			msg = err.Error()
		}
		return out, fmt.Errorf("vmrun %s: %s", args[0], msg)
	}
	return out, nil
}

func (w *VMware) States(ctx context.Context) (map[string]string, error) {
	if w.Dir == "" {
		return nil, errors.New("не задана папка виртуальных машин VMware (Настройки)")
	}
	out, err := w.run(ctx, "list")
	if err != nil {
		return nil, err
	}
	running := map[string]bool{}
	for _, l := range strings.Split(out, "\n") {
		l = strings.TrimSpace(l)
		if strings.HasSuffix(strings.ToLower(l), ".vmx") {
			running[strings.ToLower(filepath.Clean(l))] = true
		}
	}
	res := map[string]string{}
	entries, _ := os.ReadDir(w.Dir)
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		p := w.vmx(e.Name())
		if _, err := os.Stat(p); err != nil {
			continue
		}
		if running[strings.ToLower(filepath.Clean(p))] {
			res[e.Name()] = "running"
		} else {
			res[e.Name()] = "stopped"
		}
	}
	return res, nil
}

func (w *VMware) Create(ctx context.Context, s vault.VMSpec, lab vault.Lab, iso string, log func(string)) error {
	tpl := lab.Template
	if _, err := os.Stat(tpl); err != nil {
		return fmt.Errorf("шаблон %q не найден (для VMware template — путь к .vmx)", tpl)
	}
	dst := w.vmx(s.Name)
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	args := []string{"clone", tpl, dst}
	if lab.Snapshot != "" {
		args = append(args, "linked", "-snapshot="+lab.Snapshot)
		log("связанный клон " + s.Name)
	} else {
		args = append(args, "full")
		log("полный клон " + s.Name + " (без snapshot это дольше)")
	}
	args = append(args, "-cloneName="+s.Name)
	if _, err := w.run(ctx, args...); err != nil {
		return err
	}
	vnet := lab.Network.VMnet
	if vnet == "" {
		vnet = "vmnet8"
	}
	if err := editVMX(dst, map[string]string{
		"numvcpus":                   fmt.Sprint(s.CPU),
		"memsize":                    fmt.Sprint(s.RAM),
		"displayName":                s.Name,
		"annotation":                 "infra lab: " + lab.ID,
		"ethernet0.present":          "TRUE",
		"ethernet0.connectionType":   "custom",
		"ethernet0.vnet":             vnet,
		"ethernet0.addressType":      "static",
		"ethernet0.address":          macColon(vmwareMAC(s.Name, 0)),
		"ethernet0.generatedAddress": "",
		"ide1:0.present":             "TRUE",
		"ide1:0.deviceType":          "cdrom-image",
		"ide1:0.fileName":            iso,
		"ide1:0.startConnected":      "TRUE",
		"uuid.action":                "create",
	}); err != nil {
		_, _ = w.run(context.Background(), "deleteVM", dst)
		_ = os.RemoveAll(filepath.Dir(dst))
		return err
	}
	return nil
}

var vmxLine = regexp.MustCompile(`^\s*([\w:.]+)\s*=`)

// editVMX меняет/добавляет ключи в .vmx (пустое значение — удалить ключ).
func editVMX(path string, set map[string]string) error {
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	lower := map[string]string{}
	for k := range set {
		lower[strings.ToLower(k)] = k
	}
	done := map[string]bool{}
	var out []string
	for _, l := range strings.Split(strings.ReplaceAll(string(b), "\r\n", "\n"), "\n") {
		if m := vmxLine.FindStringSubmatch(l); m != nil {
			if k, ok := lower[strings.ToLower(m[1])]; ok {
				done[k] = true
				if set[k] != "" {
					out = append(out, fmt.Sprintf("%s = %q", k, set[k]))
				}
				continue
			}
		}
		if l != "" {
			out = append(out, l)
		}
	}
	for k, val := range set {
		if !done[k] && val != "" {
			out = append(out, fmt.Sprintf("%s = %q", k, val))
		}
	}
	return os.WriteFile(path, []byte(strings.Join(out, "\r\n")+"\r\n"), 0o644)
}

func (w *VMware) Start(ctx context.Context, name string) error {
	_, err := w.run(ctx, "start", w.vmx(name), "nogui")
	return err
}

func (w *VMware) Stop(ctx context.Context, name string, force bool) error {
	mode := "soft"
	if force {
		mode = "hard"
	}
	_, err := w.run(ctx, "stop", w.vmx(name), mode)
	return err
}

func (w *VMware) Delete(ctx context.Context, name string) error {
	_, _ = w.run(ctx, "stop", w.vmx(name), "hard")
	_, err := w.run(ctx, "deleteVM", w.vmx(name))
	if err == nil {
		_ = os.RemoveAll(filepath.Dir(w.vmx(name)))
	}
	return err
}

func (w *VMware) Snapshot(ctx context.Context, name, snap string) error {
	_, err := w.run(ctx, "snapshot", w.vmx(name), snap)
	return err
}
