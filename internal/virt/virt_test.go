package virt

import (
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	diskfs "github.com/diskfs/go-diskfs"

	"infra/internal/vault"
)

func TestSeedISO(t *testing.T) {
	lab := vault.Lab{ID: "demo", Name: "demo", User: "ubuntu", Network: vault.LabNetwork{CIDR: "192.168.56.0/24"}}
	s := vault.VMSpec{Name: "demo-master", Host: "master", IP: "192.168.56.10"}
	p := filepath.Join(t.TempDir(), "seed.iso")
	if err := WriteSeedISO(p, lab, s, "ssh-ed25519 AAAA test", "virtualbox"); err != nil {
		t.Fatal(err)
	}
	d, err := diskfs.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	fs, err := d.GetFilesystem(0)
	if err != nil {
		t.Fatal(err)
	}
	if lbl := strings.Trim(fs.Label(), " \x00"); !strings.EqualFold(lbl, "cidata") {
		t.Fatalf("label %q", lbl)
	}
	ents, _ := fs.ReadDir("/")
	var names []string
	for _, e := range ents {
		names = append(names, e.Name())
	}
	t.Log(names)
	f, err := fs.OpenFile("/network-config", os.O_RDONLY)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(f)
	if !strings.Contains(string(b), "192.168.56.10/24") {
		t.Fatal(string(b))
	}
}

func TestEditVMX(t *testing.T) {
	p := filepath.Join(t.TempDir(), "a.vmx")
	os.WriteFile(p, []byte("memsize = \"1024\"\r\nethernet0.generatedAddress = \"x\"\r\nfoo = \"1\"\r\n"), 0o644)
	if err := editVMX(p, map[string]string{"memsize": "4096", "ethernet0.generatedAddress": "", "numvcpus": "2"}); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(p)
	s := string(b)
	if !strings.Contains(s, `memsize = "4096"`) || strings.Contains(s, "generatedAddress") || !strings.Contains(s, `numvcpus = "2"`) || !strings.Contains(s, `foo = "1"`) {
		t.Fatal(s)
	}
}

func TestSeedISOKeep(t *testing.T) {
	lab := vault.Lab{ID: "demo", Name: "demo", User: "ubuntu", Network: vault.LabNetwork{CIDR: "192.168.56.0/24"}}
	s := vault.VMSpec{Name: "demo-master", Host: "master", IP: "192.168.56.10"}
	if p := os.Getenv("SEED_OUT"); p != "" {
		WriteSeedISO(p, lab, s, "ssh-ed25519 AAAA test", "virtualbox")
	}
}
