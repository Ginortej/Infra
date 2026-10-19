package gitx

import (
	"context"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func git(t *testing.T, dir string, args ...string) string {
	t.Helper()
	out, err := Run(context.Background(), dir, []string{"GIT_AUTHOR_NAME=T", "GIT_AUTHOR_EMAIL=t@x", "GIT_COMMITTER_NAME=T", "GIT_COMMITTER_EMAIL=t@x"}, nil, args...)
	if err != nil {
		t.Fatalf("git %v: %v", args, err)
	}
	return out
}

func write(t *testing.T, p, s string) {
	t.Helper()
	_ = os.MkdirAll(filepath.Dir(p), 0o755)
	if err := os.WriteFile(p, []byte(s), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestStatusAndLog(t *testing.T) {
	if GitPath() == "" {
		t.Skip("git not installed")
	}
	d := t.TempDir()
	git(t, d, "init", "-b", "main")
	st, err := GetStatus(context.Background(), d)
	if err != nil || !st.IsRepo || !st.Empty || st.Branch != "main" {
		t.Fatalf("empty repo: %+v %v", st, err)
	}
	write(t, filepath.Join(d, "a.txt"), "a\n")
	write(t, filepath.Join(d, "b.txt"), "b\n")
	write(t, filepath.Join(d, "dir", "c.txt"), "c\n")
	git(t, d, "add", "-A")
	git(t, d, "commit", "-m", "first")
	git(t, d, "remote", "add", "origin", "git@github.com:Ginortej/Infra.git")
	// изменения всех видов
	write(t, filepath.Join(d, "a.txt"), "a2\n")       // изменён (не в индексе)
	git(t, d, "mv", "b.txt", "b2.txt")                // переименован (в индексе)
	write(t, filepath.Join(d, "new file.txt"), "n\n") // новый, с пробелом
	_ = os.Remove(filepath.Join(d, "dir", "c.txt"))   // удалён
	st, err = GetStatus(context.Background(), d)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]FileChange{}
	for _, f := range st.Files {
		got[f.Path] = f
	}
	if f := got["a.txt"]; f.Work != "M" || f.Index != "" {
		t.Errorf("a.txt %+v", f)
	}
	if f := got["b2.txt"]; f.Index != "R" || f.Orig != "b.txt" {
		t.Errorf("b2.txt %+v", f)
	}
	if f := got["new file.txt"]; !f.Untracked {
		t.Errorf("new file %+v", f)
	}
	if f := got["dir/c.txt"]; f.Work != "D" {
		t.Errorf("c.txt %+v", f)
	}
	if len(st.Remotes) != 1 || st.Remotes[0].Host != "github.com" || st.Remotes[0].Path != "Ginortej/Infra" {
		t.Errorf("remotes %+v", st.Remotes)
	}
	log, err := Log(context.Background(), d, 10)
	if err != nil || len(log) != 1 || log[0].Subject != "first" {
		t.Fatalf("log %+v %v", log, err)
	}
	diff, _ := Diff(context.Background(), d, "a.txt", false, false)
	if !strings.Contains(diff, "+a2") {
		t.Errorf("diff %q", diff)
	}
	nd, _ := Diff(context.Background(), d, "new file.txt", false, true)
	if !strings.Contains(nd, "+n") {
		t.Errorf("untracked diff %q", nd)
	}
	br, _ := Branches(context.Background(), d)
	if len(br) != 1 || !br[0].Current || br[0].Name != "main" {
		t.Errorf("branches %+v", br)
	}
}

func TestParseRemote(t *testing.T) {
	cases := map[string][2]string{
		"git@github.com:Ginortej/Infra.git":            {"github.com", "Ginortej/Infra"},
		"https://github.com/Ginortej/Infra.git":        {"github.com", "Ginortej/Infra"},
		"https://oauth2:tok@gitlab.com/grp/sub/proj":   {"gitlab.com", "grp/sub/proj"},
		"ssh://git@git.company.ru:2222/team/infra.git": {"git.company.ru", "team/infra"},
	}
	for u, want := range cases {
		r := ParseRemote("origin", u)
		if r.Host != want[0] || r.Path != want[1] {
			t.Errorf("%s → %s %s", u, r.Host, r.Path)
		}
	}
}

// Токен должен уйти на сервер заголовком Authorization, а не из Credential Manager.
func TestTokenHeader(t *testing.T) {
	if GitPath() == "" {
		t.Skip("git not installed")
	}
	var mu sync.Mutex
	var auth string
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		if a := r.Header.Get("Authorization"); a != "" {
			auth = a
		}
		mu.Unlock()
		w.WriteHeader(404)
	}))
	defer srv.Close()
	host := strings.TrimPrefix(srv.URL, "https://")
	acc := &Account{Provider: "gitlab", Host: host, Name: "Иван", Email: "i@x", GitAuth: "token"}
	env := append(Env(acc, "SECRET"), "GIT_SSL_NO_VERIFY=1")
	_, _ = Run(context.Background(), t.TempDir(), env, nil, "ls-remote", srv.URL+"/grp/proj.git")
	want := "Basic " + base64.StdEncoding.EncodeToString([]byte("oauth2:SECRET"))
	mu.Lock()
	defer mu.Unlock()
	if !strings.EqualFold(auth, want) {
		t.Fatalf("auth header %q, want %q", auth, want)
	}
	for _, e := range env {
		if strings.Contains(e, "SECRET") && !strings.HasPrefix(e, "GIT_CONFIG_VALUE_") {
			t.Fatalf("token leaked into %q", e)
		}
	}
}

func TestEnvSSH(t *testing.T) {
	acc := &Account{Provider: "github", Host: "github.com", GitAuth: "ssh", SSHKey: `C:\Users\u\.ssh\infra_work`}
	env := strings.Join(Env(acc, "tok"), "\n")
	if !strings.Contains(env, `GIT_SSH_COMMAND=ssh -i "C:/Users/u/.ssh/infra_work" -o IdentitiesOnly=yes`) {
		t.Fatal(env)
	}
	if strings.Contains(env, "extraheader") {
		t.Fatal("ssh account must not send token header")
	}
	if !strings.Contains(env, "url.git@github.com:.insteadOf") {
		t.Fatal("https remotes must be rewritten to ssh")
	}
}

func TestGenerateKey(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("USERPROFILE", os.Getenv("HOME"))
	p, pub, err := GenerateKey("github-work", "infra")
	if err != nil || !strings.HasPrefix(pub, "ssh-ed25519 ") {
		t.Fatal(p, pub, err)
	}
	if got, _ := PublicKey(p); got != pub {
		t.Fatalf("pub mismatch %q %q", got, pub)
	}
}
