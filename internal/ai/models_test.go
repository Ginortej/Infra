package ai

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPullEmbedDelete(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/pull":
			fmt.Fprintln(w, `{"status":"pulling manifest"}`)
			fmt.Fprintln(w, `{"status":"pulling abc","completed":50,"total":100}`)
			fmt.Fprintln(w, `{"status":"success"}`)
		case "/api/embed":
			fmt.Fprint(w, `{"embeddings":[[0.1,0.2],[0.3,0.4]]}`)
		case "/api/delete":
			if r.Method != "DELETE" {
				w.WriteHeader(405)
			}
		case "/api/show":
			fmt.Fprint(w, `{"capabilities":["completion","tools"]}`)
		}
	}))
	defer ts.Close()
	t.Setenv("OLLAMA_HOST", ts.URL)
	o := &Ollama{}
	var steps []PullProgress
	if err := o.Pull(context.Background(), "m", func(p PullProgress) { steps = append(steps, p) }); err != nil || len(steps) != 3 || steps[1].Completed != 50 {
		t.Fatal(err, steps)
	}
	v, err := o.Embed(context.Background(), "e", []string{"a", "b"})
	if err != nil || len(v) != 2 || v[1][0] != 0.3 {
		t.Fatal(err, v)
	}
	if err := o.Delete(context.Background(), "m"); err != nil {
		t.Fatal(err)
	}
	if c, _ := o.Capabilities(context.Background(), "m"); len(c) != 2 {
		t.Fatal(c)
	}
	if len(Catalog()) < 10 {
		t.Fatal("catalog")
	}
}
