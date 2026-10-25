package rag

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSearchWords(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "security"), 0o755)
	os.WriteFile(filepath.Join(dir, "security", "policy.md"), []byte("# Политика\n\n## Доступ по SSH\nВход под root запрещён, только ключи.\n\n## Фаервол\nФаервол ufw должен быть включён всегда.\n"), 0o644)
	os.WriteFile(filepath.Join(dir, "nginx.md"), []byte("# nginx\n\n## Перезапуск\nПеред reload выполни nginx -t.\n"), 0o644)
	x := New(dir, filepath.Join(t.TempDir(), "cache.json"))
	if err := x.Ensure(context.Background(), "m", nil); err != nil {
		t.Fatal(err)
	}
	if st := x.Stats(); st.Files != 2 || st.Chunks < 3 {
		t.Fatalf("%+v", st)
	}
	h := x.Search(context.Background(), "отключить фаервол ufw", 2, nil)
	if len(h) == 0 || h[0].Heading != "Фаервол" {
		t.Fatalf("%+v", h)
	}
	h = x.Search(context.Background(), "nginx reload", 2, nil)
	if len(h) == 0 || h[0].File != "nginx.md" {
		t.Fatalf("%+v", h)
	}
	if h := x.Search(context.Background(), "kubernetes", 2, nil); len(h) != 0 {
		t.Fatalf("unexpected %+v", h)
	}
}

func TestVectors(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "a.md"), []byte("# Кошки\nмурлыкают\n\n# Собаки\nлают громко\n"), 0o644)
	calls := 0
	// «эмбеддинг»: вектор по наличию слов
	emb := func(ctx context.Context, texts []string) ([][]float32, error) {
		calls++
		var out [][]float32
		for _, s := range texts {
			s = strings.ToLower(s)
			v := []float32{0.01, 0.01}
			if strings.Contains(s, "кош") || strings.Contains(s, "котик") {
				v[0] = 1
			}
			if strings.Contains(s, "соб") || strings.Contains(s, "пёс") {
				v[1] = 1
			}
			out = append(out, v)
		}
		return out, nil
	}
	cache := filepath.Join(t.TempDir(), "c.json")
	x := New(dir, cache)
	x.Ensure(context.Background(), "m", emb)
	if !x.Stats().Vectors {
		t.Fatal("no vectors")
	}
	h := x.Search(context.Background(), "котик", 1, emb) // по словам не найти, только по смыслу
	if len(h) != 1 || h[0].Heading != "Кошки" {
		t.Fatalf("%+v", h)
	}
	// кэш: второй индекс не должен заново считать фрагменты
	y := New(dir, cache)
	before := calls
	y.Ensure(context.Background(), "m", emb)
	if calls != before {
		t.Fatal("cache not used")
	}
}

func TestSplitCode(t *testing.T) {
	c := Split("# A\ntext\n```\n# not heading\n```\n# B\nmore", 900)
	if len(c) != 2 || c[0].Heading != "A" || !strings.Contains(c[0].Text, "# not heading") {
		t.Fatalf("%+v", c)
	}
}
