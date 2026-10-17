package vault

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCreateAndLoad(t *testing.T) {
	dir := t.TempDir()
	v, err := Open(dir, true)
	if err != nil {
		t.Fatal(err)
	}
	s := v.Load()
	if len(s.Errors) > 0 {
		t.Fatal(s.Errors)
	}
	if len(s.Servers) != 1 || s.Servers[0].Group != "example" || s.Servers[0].Auth != "key" {
		t.Fatalf("servers: %+v", s.Servers)
	}
	if len(s.VPNs) != 1 || s.VPNs[0].Socks != 10801 {
		t.Fatalf("vpn: %+v", s.VPNs)
	}
	if len(s.Labs) != 1 || len(s.Scripts) != 4 {
		t.Fatalf("labs %d scripts %d", len(s.Labs), len(s.Scripts))
	}
	specs, err := s.Labs[0].Expand()
	if err != nil {
		t.Fatal(err)
	}
	if len(specs) != 3 || specs[2].Name != "demo-worker-2" || specs[2].IP != "192.168.56.12" {
		t.Fatalf("%+v", specs)
	}
	if _, err := v.Abs("../x"); err == nil {
		t.Fatal("must reject path outside vault")
	}
	rel, err := v.SaveServer(Server{Name: "web 1", Host: "h", User: "u", Group: "prod", Port: 22})
	if err != nil || rel != "servers/prod/web-1.yaml" {
		t.Fatal(rel, err)
	}
	if _, err := os.Stat(filepath.Join(dir, "servers", "prod", "web-1.yaml")); err != nil {
		t.Fatal(err)
	}
	warn, _ := v.WriteFile("labs/bad.yaml", "a: [1, 2")
	if warn == "" {
		t.Fatal("expected yaml warning")
	}
}
