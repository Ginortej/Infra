package sysmon

import "testing"

func TestParseNvidiaSmi(t *testing.T) {
	g := ParseNvidiaSmi("NVIDIA GeForce RTX 4070, 37, 6144, 12282, 58\n")
	if len(g) != 1 || g[0].Name != "NVIDIA GeForce RTX 4070" || g[0].Util != 37 || g[0].MemUsed != 6144<<20 || g[0].MemTotal != 12282<<20 || g[0].Temp != 58 {
		t.Fatalf("%+v", g)
	}
}

func TestSample(t *testing.T) {
	m := New()
	s := m.Sample()
	if s.RAMTotal == 0 || s.Cores == 0 || s.CPU < 0 || s.CPU > 100 {
		t.Fatalf("%+v", s)
	}
	s2 := m.Sample()
	if s2.CPU < 0 || s2.CPU > 100 {
		t.Fatalf("%+v", s2)
	}
}
