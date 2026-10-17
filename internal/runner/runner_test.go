package runner

import (
	"errors"
	"strings"
	"testing"

	"infra/internal/sshx"
	"infra/internal/vault"
)

func TestInventory(t *testing.T) {
	v, _ := vault.Open(t.TempDir(), false)
	r := &Runner{
		Vault:  func() *vault.Vault { return v },
		Dialer: &sshx.Dialer{Vault: v},
		VPNAddr: func(id string) (string, error) {
			if id == "work" {
				return "127.0.0.1:10801", nil
			}
			return "", errors.New("off")
		},
	}
	inv, prolog, notes := r.BuildInventory([]vault.Server{
		{ID: "a", Host: "10.0.0.1", Port: 22, User: "u", Auth: "key", Key: `C:\Users\B\.ssh\id_ed25519`, VPN: "work"},
		{ID: "b", Host: "10.0.0.2", Port: 2222, User: "root", Auth: "key", Key: `C:\Users\B\.ssh\id_ed25519`},
		{ID: "c", Host: "h", Port: 22, User: "x", Auth: "password"},
	})
	t.Log(inv, prolog, notes)
	if len(prolog) != 1 || !strings.Contains(inv, "ansible_port=2222") || !strings.Contains(inv, "nc -X 5 -x 127.0.0.1:10801 %h %p") || len(notes) != 2 {
		t.Fatal("bad inventory")
	}
}
