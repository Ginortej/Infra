package virt

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"infra/internal/proc"
	"infra/internal/vault"
)

// VirtualBox управляется через VBoxManage.exe.
type VirtualBox struct{ Bin string }

func (v *VirtualBox) Name() string { return "virtualbox" }

func (v *VirtualBox) run(ctx context.Context, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	out, err := proc.Output(ctx, v.Bin, args...)
	if err != nil {
		msg := strings.TrimSpace(out)
		if i := strings.LastIndex(msg, "VBoxManage: error:"); i >= 0 {
			msg = strings.TrimSpace(msg[i+len("VBoxManage: error:"):])
			if j := strings.Index(msg, "\n"); j > 0 {
				msg = msg[:j]
			}
		}
		if msg == "" {
			msg = err.Error()
		}
		return out, fmt.Errorf("VBoxManage %s: %s", args[0], msg)
	}
	return out, nil
}

var vboxLine = regexp.MustCompile(`^"(.+)" \{[0-9a-fA-F-]+\}$`)

func (v *VirtualBox) list(ctx context.Context, what string) (map[string]bool, error) {
	out, err := v.run(ctx, "list", what)
	if err != nil {
		return nil, err
	}
	res := map[string]bool{}
	for _, l := range strings.Split(out, "\n") {
		if m := vboxLine.FindStringSubmatch(strings.TrimSpace(l)); m != nil {
			res[m[1]] = true
		}
	}
	return res, nil
}

func (v *VirtualBox) States(ctx context.Context) (map[string]string, error) {
	all, err := v.list(ctx, "vms")
	if err != nil {
		return nil, err
	}
	running, err := v.list(ctx, "runningvms")
	if err != nil {
		return nil, err
	}
	res := map[string]string{}
	for n := range all {
		if running[n] {
			res[n] = "running"
		} else {
			res[n] = "stopped"
		}
	}
	return res, nil
}

func (v *VirtualBox) Create(ctx context.Context, s vault.VMSpec, lab vault.Lab, iso string, log func(string)) error {
	if lab.Network.HostOnly == "" {
		return errors.New("для VirtualBox укажи network.hostonly — имя host-only адаптера (VirtualBox → Сеть → Host-only)")
	}
	all, err := v.list(ctx, "vms")
	if err != nil {
		return err
	}
	if !all[lab.Template] {
		return fmt.Errorf("шаблон %q не найден среди VM VirtualBox", lab.Template)
	}
	args := []string{"clonevm", lab.Template, "--name", s.Name, "--register"}
	if lab.Snapshot != "" {
		args = append(args, "--snapshot", lab.Snapshot, "--options", "link")
		log("связанный клон " + s.Name + " из " + lab.Template + "@" + lab.Snapshot)
	} else {
		log("полный клон " + s.Name + " (без snapshot это дольше)")
	}
	if _, err := v.run(ctx, args...); err != nil {
		return err
	}
	ok := false
	defer func() {
		if !ok {
			_, _ = v.run(context.Background(), "unregistervm", s.Name, "--delete")
		}
	}()
	if _, err := v.run(ctx, "modifyvm", s.Name,
		"--cpus", fmt.Sprint(s.CPU), "--memory", fmt.Sprint(s.RAM),
		"--nic1", "nat", "--macaddress1", macPlain(vboxMAC(s.Name, 1)),
		"--nic2", "hostonly", "--hostonlyadapter2", lab.Network.HostOnly, "--macaddress2", macPlain(vboxMAC(s.Name, 2)),
		"--description", "infra lab: "+lab.ID,
	); err != nil {
		return err
	}
	// отдельный контроллер для диска cloud-init
	_, _ = v.run(ctx, "storagectl", s.Name, "--name", "Seed", "--add", "sata", "--portcount", "1")
	if _, err = v.run(ctx, "storageattach", s.Name, "--storagectl", "Seed", "--port", "0", "--device", "0", "--type", "dvddrive", "--medium", iso); err != nil {
		return err
	}
	ok = true
	return nil
}

func (v *VirtualBox) Start(ctx context.Context, name string) error {
	_, err := v.run(ctx, "startvm", name, "--type", "headless")
	return err
}

func (v *VirtualBox) Stop(ctx context.Context, name string, force bool) error {
	if force {
		_, err := v.run(ctx, "controlvm", name, "poweroff")
		return err
	}
	if _, err := v.run(ctx, "controlvm", name, "acpipowerbutton"); err != nil {
		return err
	}
	for i := 0; i < 40; i++ { // до 2 минут на корректное выключение
		time.Sleep(3 * time.Second)
		r, err := v.list(ctx, "runningvms")
		if err == nil && !r[name] {
			return nil
		}
	}
	_, err := v.run(ctx, "controlvm", name, "poweroff")
	return err
}

func (v *VirtualBox) Delete(ctx context.Context, name string) error {
	if r, _ := v.list(ctx, "runningvms"); r[name] {
		_, _ = v.run(ctx, "controlvm", name, "poweroff")
		time.Sleep(2 * time.Second)
	}
	_, err := v.run(ctx, "unregistervm", name, "--delete")
	return err
}

func (v *VirtualBox) Snapshot(ctx context.Context, name, snap string) error {
	_, err := v.run(ctx, "snapshot", name, "take", snap, "--live")
	return err
}
