//go:build live

package ai

import (
	"context"
	"testing"
)

func TestHFLive(t *testing.T) {
	m, err := HFSearch(context.Background(), "qwen3 8b", "downloads")
	if err != nil || len(m) == 0 {
		t.Fatal(err, m)
	}
	t.Log(m[0].ID, m[0].Downloads, m[0].Tags)
	f, err := HFFiles(context.Background(), m[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, x := range f {
		t.Log(x.Quant, x.Size>>20, "MB", x.Name, x.Split)
	}
}
