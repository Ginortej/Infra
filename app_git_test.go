package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"infra/internal/gitx"
)

// Сквозной сценарий: аккаунт → привязка к репо → коммит от его имени → публикация ветки.
func TestGitFlow(t *testing.T) {
	if gitx.GitPath() == "" {
		t.Skip("git not installed")
	}
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("HOME", t.TempDir())
	a := NewApp()
	a.git = gitx.NewStore()
	acc, err := a.GitSaveAccount(gitx.Account{Provider: "github", Label: "Work", Username: "ivan", Name: "Иван Петров", Email: "ivan@corp.ru", GitAuth: "ssh", SSHKey: "/nonexistent"}, "")
	if err != nil || acc.ID != "github-ivan" || acc.Host != "github.com" {
		t.Fatalf("account: %+v %v", acc, err)
	}
	ctx := context.Background()
	bare := filepath.Join(t.TempDir(), "remote.git")
	if _, err := gitx.Run(ctx, "", nil, nil, "init", "--bare", "-b", "main", bare); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	if err := a.GitInit(dir); err != nil {
		t.Fatal(err)
	}
	if err := a.GitSetAccount(dir, acc.ID); err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(dir, "README.md"), []byte("hi\n"), 0o644)
	st, _ := a.GitStatus(dir)
	if st.Account != acc.ID || len(st.Files) != 1 || !st.Files[0].Untracked {
		t.Fatalf("status %+v", st)
	}
	if err := a.GitStage(dir, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := a.GitCommit(dir, "первый коммит", false); err != nil {
		t.Fatal(err)
	}
	log, _ := a.GitLog(dir)
	if len(log) != 1 || log[0].Author != "Иван Петров" || log[0].Email != "ivan@corp.ru" {
		t.Fatalf("commit author: %+v", log)
	}
	// unstage до первого коммита и после
	os.WriteFile(filepath.Join(dir, "a.txt"), []byte("a\n"), 0o644)
	a.GitStage(dir, []string{"a.txt"})
	if err := a.GitUnstage(dir, []string{"a.txt"}); err != nil {
		t.Fatal(err)
	}
	if err := a.GitDiscard(dir, nil, []string{"a.txt"}); err != nil {
		t.Fatal(err)
	}
	if err := a.GitSetRemote(dir, bare); err != nil {
		t.Fatal(err)
	}
	job, err := a.GitPush(dir, false) // нет upstream → push -u origin HEAD
	if err != nil || job == "" {
		t.Fatal(job, err)
	}
	for i := 0; i < 100; i++ {
		st, _ = a.GitStatus(dir)
		if st.Upstream != "" {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if st.Upstream != "origin/main" || len(st.Files) != 0 {
		t.Fatalf("after push: %+v", st)
	}
	out, _ := gitx.Run(ctx, bare, nil, nil, "log", "--format=%an <%ae> %s")
	if !strings.Contains(out, "Иван Петров <ivan@corp.ru> первый коммит") {
		t.Fatalf("remote log: %q", out)
	}
}
