package ai

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/version":
			w.Write([]byte(`{"version":"0.12.6"}`))
		case "/api/tags":
			w.Write([]byte(`{"models":[{"name":"qwen2.5-coder:7b","size":4683087332,"details":{"family":"qwen2","parameter_size":"7.6B","quantization_level":"Q4_K_M"}},{"name":"llama3.2:3b","size":2019393189,"details":{"parameter_size":"3.2B"}}]}`))
		case "/api/ps":
			w.Write([]byte(`{"models":[{"name":"qwen2.5-coder:7b","size":6000000000,"size_vram":5500000000}]}`))
		case "/api/generate":
			w.Write([]byte(`{}`))
		}
	}))
	defer srv.Close()
	t.Setenv("OLLAMA_HOST", strings.TrimPrefix(srv.URL, "http://"))
	o := &Ollama{}
	st := o.Status(context.Background())
	if !st.Running || st.Version != "0.12.6" || len(st.Models) != 2 || st.Models[0].Name != "llama3.2:3b" || st.Models[1].Params != "7.6B" {
		t.Fatalf("%+v", st)
	}
	if len(st.Loaded) != 1 || st.Loaded[0].SizeVRAM != 5500000000 {
		t.Fatalf("loaded %+v", st.Loaded)
	}
	if err := o.EnsureServer(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := o.Unload(context.Background(), "qwen2.5-coder:7b"); err != nil {
		t.Fatal(err)
	}
}

func TestNotRunning(t *testing.T) {
	t.Setenv("OLLAMA_HOST", "127.0.0.1:1")
	st := (&Ollama{}).Status(context.Background())
	if st.Running {
		t.Fatal("must not be running")
	}
}
