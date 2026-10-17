package vpn

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestWireGuard(t *testing.T) {
	ep, err := WireGuardEndpoint(`[Interface]
PrivateKey = aaa=
Address = 10.8.0.2/32, fd00::2/128
DNS = 1.1.1.1
MTU = 1420

[Peer]
PublicKey = bbb=
PresharedKey = ccc=
AllowedIPs = 0.0.0.0/0, ::/0
Endpoint = vpn.example.com:51820
PersistentKeepalive = 25
`)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(ep)
	s := string(b)
	for _, want := range []string{`"private_key":"aaa="`, `"address":["10.8.0.2/32","fd00::2/128"]`, `"port":51820`, `"address":"vpn.example.com"`, `"mtu":1420`, `"persistent_keepalive_interval":25`} {
		if !strings.Contains(s, want) {
			t.Errorf("missing %s in %s", want, s)
		}
	}
}
