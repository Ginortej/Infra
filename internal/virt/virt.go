// Package virt — лабы: виртуальные машины VirtualBox / VMware Workstation из YAML.
package virt

import (
	"context"
	"crypto/sha1"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"

	"infra/internal/vault"
)

// Provider — общий интерфейс гипервизоров.
type Provider interface {
	Name() string
	States(ctx context.Context) (map[string]string, error) // имя VM -> running | stopped
	Create(ctx context.Context, spec vault.VMSpec, lab vault.Lab, seedISO string, log func(string)) error
	Start(ctx context.Context, name string) error
	Stop(ctx context.Context, name string, force bool) error
	Delete(ctx context.Context, name string) error
	Snapshot(ctx context.Context, name, snap string) error
}

type Tools struct {
	VBoxManage string
	Vmrun      string
	VMwareDir  string
}

func (t Tools) Provider(name string) (Provider, error) {
	switch strings.ToLower(name) {
	case "virtualbox", "vbox", "":
		if t.VBoxManage == "" {
			return nil, errors.New("VBoxManage.exe не найден — установи VirtualBox или укажи путь в Настройках")
		}
		return &VirtualBox{Bin: t.VBoxManage}, nil
	case "vmware", "workstation":
		if t.Vmrun == "" {
			return nil, errors.New("vmrun.exe не найден — установи VMware Workstation или укажи путь в Настройках")
		}
		return &VMware{Bin: t.Vmrun, Dir: t.VMwareDir}, nil
	}
	return nil, fmt.Errorf("неизвестный provider: %s", name)
}

// ---------- План ----------

type VMStatus struct {
	vault.VMSpec
	State  string `json:"state"`  // running | stopped | absent
	Action string `json:"action"` // create | start | none
}

type Plan struct {
	Lab      string     `json:"lab"`
	Provider string     `json:"provider"`
	Template string     `json:"template"`
	Network  string     `json:"network"`
	Playbook string     `json:"playbook"`
	VMs      []VMStatus `json:"vms"`
	Error    string     `json:"error"`
}

func MakePlan(ctx context.Context, t Tools, lab vault.Lab) Plan {
	p := Plan{Lab: lab.ID, Provider: lab.Provider, Template: lab.Template, Network: lab.Network.CIDR, Playbook: lab.Provision.Playbook}
	specs, err := lab.Expand()
	if err != nil {
		p.Error = err.Error()
		return p
	}
	states := map[string]string{}
	prov, err := t.Provider(lab.Provider)
	if err == nil {
		states, err = prov.States(ctx)
	}
	if err != nil {
		p.Error = err.Error()
	}
	for _, s := range specs {
		st := VMStatus{VMSpec: s, State: "absent", Action: "create"}
		if prov == nil || err != nil {
			st.State, st.Action = "unknown", "none"
		} else if v, ok := states[s.Name]; ok {
			st.State = v
			if v == "running" {
				st.Action = "none"
			} else {
				st.Action = "start"
			}
		}
		p.VMs = append(p.VMs, st)
	}
	return p
}

// Progress — сообщения о ходе работы (0..100).
type Progress func(pct int, msg string)

// Apply приводит машины к состоянию из YAML. Возвращает созданные/запущенные спецификации.
func Apply(ctx context.Context, t Tools, v *vault.Vault, lab vault.Lab, progress Progress) ([]vault.VMSpec, error) {
	prov, err := t.Provider(lab.Provider)
	if err != nil {
		return nil, err
	}
	plan := MakePlan(ctx, t, lab)
	if plan.Error != "" {
		return nil, errors.New(plan.Error)
	}
	if lab.Template == "" {
		return nil, errors.New("не указан template")
	}
	pub, err := readPubKey(v, lab.SSHKey)
	if err != nil {
		return nil, err
	}
	steps := len(plan.VMs) + 1
	var specs []vault.VMSpec
	for i, vm := range plan.VMs {
		base := i * 100 / steps
		specs = append(specs, vm.VMSpec)
		switch vm.Action {
		case "create":
			progress(base, "создаю "+vm.Name)
			iso := filepath.Join(v.AppDir("seeds"), vm.Name+".iso")
			if err := WriteSeedISO(iso, lab, vm.VMSpec, pub, prov.Name()); err != nil {
				return specs, fmt.Errorf("cloud-init ISO: %v", err)
			}
			if err := prov.Create(ctx, vm.VMSpec, lab, iso, func(s string) { progress(base, s) }); err != nil {
				return specs, fmt.Errorf("%s: %v", vm.Name, err)
			}
			fallthrough
		case "start":
			progress(base+50/steps, "запускаю "+vm.Name)
			if err := prov.Start(ctx, vm.Name); err != nil {
				return specs, fmt.Errorf("%s: %v", vm.Name, err)
			}
		}
		if err := writeServer(v, lab, vm.VMSpec); err != nil {
			return specs, err
		}
	}
	return specs, nil
}

// WaitSSH ждёт, пока на всех машинах откроется порт 22.
func WaitSSH(ctx context.Context, specs []vault.VMSpec, timeout time.Duration, progress Progress) error {
	deadline := time.Now().Add(timeout)
	for _, s := range specs {
		progress(90, "жду SSH на "+s.Name+" ("+s.IP+")")
		for {
			c, err := net.DialTimeout("tcp", net.JoinHostPort(s.IP, "22"), 3*time.Second)
			if err == nil {
				c.Close()
				break
			}
			if time.Now().After(deadline) {
				return fmt.Errorf("%s: SSH не ответил за %s", s.Name, timeout)
			}
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(3 * time.Second):
			}
		}
	}
	return nil
}

func ServerFile(lab vault.Lab, s vault.VMSpec) string {
	return "servers/labs/" + vault.Slug(lab.ID) + "/" + vault.Slug(s.Name) + ".yaml"
}

func writeServer(v *vault.Vault, lab vault.Lab, s vault.VMSpec) error {
	_, err := v.SaveServer(vault.Server{
		File: ServerFile(lab, s), Name: s.Name, Host: s.IP, User: lab.User,
		Auth: "key", Key: lab.SSHKey, Lab: lab.ID, Tags: []string{"lab"},
	})
	return err
}

// Destroy удаляет все машины лабы и их файлы серверов.
func Destroy(ctx context.Context, t Tools, v *vault.Vault, lab vault.Lab, progress Progress) error {
	prov, err := t.Provider(lab.Provider)
	if err != nil {
		return err
	}
	specs, err := lab.Expand()
	if err != nil {
		return err
	}
	states, err := prov.States(ctx)
	if err != nil {
		return err
	}
	for i, s := range specs {
		progress(i*100/len(specs), "удаляю "+s.Name)
		if _, ok := states[s.Name]; ok {
			if err := prov.Delete(ctx, s.Name); err != nil {
				return fmt.Errorf("%s: %v", s.Name, err)
			}
		}
		_ = v.Delete(ServerFile(lab, s))
		_ = os.Remove(filepath.Join(v.AppDir("seeds"), s.Name+".iso"))
	}
	if dir, err := v.Abs("servers/labs/" + vault.Slug(lab.ID)); err == nil {
		_ = os.Remove(dir)
	}
	return nil
}

// ForEach выполняет действие над всеми существующими машинами лабы.
func ForEach(ctx context.Context, t Tools, lab vault.Lab, fn func(Provider, string, string) error) error {
	prov, err := t.Provider(lab.Provider)
	if err != nil {
		return err
	}
	specs, err := lab.Expand()
	if err != nil {
		return err
	}
	states, err := prov.States(ctx)
	if err != nil {
		return err
	}
	for _, s := range specs {
		if st, ok := states[s.Name]; ok {
			if err := fn(prov, s.Name, st); err != nil {
				return fmt.Errorf("%s: %v", s.Name, err)
			}
		}
	}
	return nil
}

func readPubKey(v *vault.Vault, key string) (string, error) {
	if key == "" {
		home, _ := os.UserHomeDir()
		for _, n := range []string{"id_ed25519", "id_ecdsa", "id_rsa"} {
			if _, err := os.Stat(filepath.Join(home, ".ssh", n+".pub")); err == nil {
				key = filepath.Join(home, ".ssh", n)
				break
			}
		}
	}
	p := v.Resolve(key)
	if !strings.HasSuffix(p, ".pub") {
		p += ".pub"
	}
	b, err := os.ReadFile(p)
	if err != nil {
		return "", fmt.Errorf("не найден публичный ключ %s (укажи ssh_key в лабе; создать: ssh-keygen -t ed25519)", p)
	}
	return strings.TrimSpace(string(b)), nil
}

// mac — стабильный MAC-адрес для VM (чтобы cloud-init нашёл нужную сетевую карту).
func mac(prefix []byte, name string, nic int) []byte {
	h := sha1.Sum([]byte(fmt.Sprintf("%s#%d", name, nic)))
	m := append(append([]byte{}, prefix...), h[:6-len(prefix)]...)
	return m
}

func macColon(m []byte) string {
	parts := make([]string, len(m))
	for i, b := range m {
		parts[i] = fmt.Sprintf("%02x", b)
	}
	return strings.Join(parts, ":")
}

func macPlain(m []byte) string { return strings.ToUpper(strings.ReplaceAll(macColon(m), ":", "")) }

// VBox: 08:00:27:xx:xx:xx; VMware static: 00:50:56:[00-3F]:xx:xx
func vboxMAC(name string, nic int) []byte { return mac([]byte{0x08, 0x00, 0x27}, name, nic) }
func vmwareMAC(name string, nic int) []byte {
	m := mac([]byte{0x00, 0x50, 0x56}, name, nic)
	m[3] &= 0x3f
	return m
}
