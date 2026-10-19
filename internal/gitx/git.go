package gitx

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"infra/internal/proc"
)

// GitPath — путь к git.exe (пусто, если git не установлен).
func GitPath() string {
	if p, err := exec.LookPath("git"); err == nil {
		return p
	}
	for _, p := range []string{
		filepath.Join(os.Getenv("ProgramFiles"), `Git\cmd\git.exe`),
		filepath.Join(os.Getenv("LOCALAPPDATA"), `Programs\Git\cmd\git.exe`),
	} {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}

var ErrNoGit = errors.New("git не найден. Установи Git for Windows: https://git-scm.com/download/win")

// Env — переменные окружения, чтобы git работал от имени аккаунта:
// автор коммитов, авторизация (токен через заголовок или свой SSH-ключ) и
// перезапись адресов remote под выбранный способ входа. Токен не попадает в
// аргументы командной строки — только в окружение процесса git.
func Env(a *Account, token string) []string {
	env := []string{"GIT_TERMINAL_PROMPT=0", "GCM_INTERACTIVE=never", "LC_ALL=C.UTF-8", "LANG=C.UTF-8"}
	if a == nil {
		return env
	}
	if a.Name != "" {
		env = append(env, "GIT_AUTHOR_NAME="+a.Name, "GIT_COMMITTER_NAME="+a.Name)
	}
	if a.Email != "" {
		env = append(env, "GIT_AUTHOR_EMAIL="+a.Email, "GIT_COMMITTER_EMAIL="+a.Email)
	}
	var cfg [][2]string
	host := a.Host
	if a.GitAuth == "ssh" && a.SSHKey != "" {
		key := strings.ReplaceAll(a.SSHKey, `\`, "/")
		env = append(env, fmt.Sprintf(`GIT_SSH_COMMAND=ssh -i "%s" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`, key))
		cfg = append(cfg,
			[2]string{"url.git@" + host + ":.insteadOf", "https://" + host + "/"},
			[2]string{"credential.helper", ""},
		)
	} else if token != "" {
		user := "x-access-token"
		if a.Provider == "gitlab" {
			user = "oauth2"
		}
		auth := base64.StdEncoding.EncodeToString([]byte(user + ":" + token))
		cfg = append(cfg,
			[2]string{"credential.helper", ""}, // не даём Git Credential Manager подставить другой аккаунт
			[2]string{"http.https://" + host + "/.extraheader", "AUTHORIZATION: basic " + auth},
			[2]string{"url.https://" + host + "/.insteadOf", "git@" + host + ":"},
		)
	}
	env = append(env, fmt.Sprintf("GIT_CONFIG_COUNT=%d", len(cfg)))
	for i, kv := range cfg {
		env = append(env, fmt.Sprintf("GIT_CONFIG_KEY_%d=%s", i, kv[0]), fmt.Sprintf("GIT_CONFIG_VALUE_%d=%s", i, kv[1]))
	}
	return env
}

// Run выполняет git в папке dir. progress получает строки прогресса (может быть nil).
func Run(ctx context.Context, dir string, env []string, progress func(string), args ...string) (string, error) {
	git := GitPath()
	if git == "" {
		return "", ErrNoGit
	}
	cmd := proc.Command(ctx, git, args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), env...)
	var out, errb bytes.Buffer
	cmd.Stdout = &out
	if progress != nil {
		cmd.Stderr = io.MultiWriter(&errb, lineWriter(progress))
	} else {
		cmd.Stderr = &errb
	}
	err := cmd.Run()
	if err != nil {
		msg := strings.TrimSpace(errb.String())
		if msg == "" {
			msg = strings.TrimSpace(out.String())
		}
		return out.String(), fmt.Errorf("%s", humanize(lastLines(msg, 6)))
	}
	return out.String(), nil
}

type lineWriter func(string)

func (f lineWriter) Write(p []byte) (int, error) {
	for _, part := range strings.FieldsFunc(string(p), func(r rune) bool { return r == '\r' || r == '\n' }) {
		if s := strings.TrimSpace(part); s != "" {
			f(s)
		}
	}
	return len(p), nil
}

func lastLines(s string, n int) string {
	l := strings.Split(strings.TrimSpace(s), "\n")
	if len(l) > n {
		l = l[len(l)-n:]
	}
	return strings.Join(l, "\n")
}

// humanize добавляет подсказку к частым ошибкам git.
func humanize(msg string) string {
	low := strings.ToLower(msg)
	switch {
	case strings.Contains(low, "authentication failed") || strings.Contains(low, "invalid username or password") || strings.Contains(low, "http basic: access denied"):
		return msg + "\n→ Токен не подошёл: проверь его срок и права (repo / write_repository)."
	case strings.Contains(low, "permission denied (publickey)"):
		return msg + "\n→ SSH-ключ не принят: добавь публичный ключ в настройки аккаунта на сайте."
	case strings.Contains(low, "403") || strings.Contains(low, "permission to") && strings.Contains(low, "denied"):
		return msg + "\n→ У этого аккаунта нет прав на запись в репозиторий. Выбери другой аккаунт."
	case strings.Contains(low, "rejected") && strings.Contains(low, "fetch first") || strings.Contains(low, "non-fast-forward"):
		return msg + "\n→ На сервере есть новые коммиты: сначала Pull, потом Push."
	case strings.Contains(low, "has no upstream branch"):
		return msg + "\n→ Ветка ещё не опубликована: нажми «Опубликовать»."
	case strings.Contains(low, "terminal prompts disabled") || strings.Contains(low, "could not read username"):
		return msg + "\n→ Нужен вход: выбери для репозитория аккаунт с токеном или SSH-ключом."
	}
	return msg
}

// ---------- Статус ----------

type FileChange struct {
	Path      string `json:"path"`
	Orig      string `json:"orig"`
	Index     string `json:"index"` // статус в индексе: M A D R C U или ""
	Work      string `json:"work"`  // статус в рабочей папке
	Untracked bool   `json:"untracked"`
	Conflict  bool   `json:"conflict"`
}

type Status struct {
	IsRepo   bool         `json:"isRepo"`
	Root     string       `json:"root"`
	Branch   string       `json:"branch"`
	Detached bool         `json:"detached"`
	Upstream string       `json:"upstream"`
	Ahead    int          `json:"ahead"`
	Behind   int          `json:"behind"`
	Files    []FileChange `json:"files"`
	Remotes  []Remote     `json:"remotes"`
	Account  string       `json:"account"` // id аккаунта, привязанного к репозиторию
	Empty    bool         `json:"empty"`   // нет ни одного коммита
}

type Remote struct {
	Name string `json:"name"`
	URL  string `json:"url"`
	Host string `json:"host"`
	Path string `json:"path"` // owner/repo
	Web  string `json:"web"`
}

func GetStatus(ctx context.Context, dir string) (Status, error) {
	st := Status{Files: []FileChange{}, Remotes: []Remote{}}
	root, err := Run(ctx, dir, nil, nil, "rev-parse", "--show-toplevel")
	if err != nil {
		if errors.Is(err, ErrNoGit) {
			return st, err
		}
		return st, nil // не репозиторий
	}
	st.IsRepo = true
	st.Root = filepath.FromSlash(strings.TrimSpace(root))
	out, err := Run(ctx, dir, nil, nil, "status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all")
	if err != nil {
		return st, err
	}
	ParsePorcelain(out, &st)
	if r := Remotes(ctx, dir); r != nil {
		st.Remotes = r
	}
	acc, _ := Run(ctx, dir, nil, nil, "config", "--local", "--get", "infra.account")
	st.Account = strings.TrimSpace(acc)
	return st, nil
}

func ParsePorcelain(out string, st *Status) {
	parts := strings.Split(out, "\x00")
	for i := 0; i < len(parts); i++ {
		p := parts[i]
		switch {
		case strings.HasPrefix(p, "# branch.oid "):
			st.Empty = strings.TrimPrefix(p, "# branch.oid ") == "(initial)"
		case strings.HasPrefix(p, "# branch.head "):
			st.Branch = strings.TrimPrefix(p, "# branch.head ")
			st.Detached = st.Branch == "(detached)"
		case strings.HasPrefix(p, "# branch.upstream "):
			st.Upstream = strings.TrimPrefix(p, "# branch.upstream ")
		case strings.HasPrefix(p, "# branch.ab "):
			f := strings.Fields(strings.TrimPrefix(p, "# branch.ab "))
			if len(f) == 2 {
				st.Ahead, _ = strconv.Atoi(strings.TrimPrefix(f[0], "+"))
				st.Behind, _ = strconv.Atoi(strings.TrimPrefix(f[1], "-"))
			}
		case strings.HasPrefix(p, "1 "):
			f := strings.SplitN(p, " ", 9)
			if len(f) == 9 {
				st.Files = append(st.Files, change(f[1], f[8], ""))
			}
		case strings.HasPrefix(p, "2 "):
			f := strings.SplitN(p, " ", 10)
			if len(f) == 10 {
				orig := ""
				if i+1 < len(parts) {
					orig = parts[i+1]
					i++
				}
				st.Files = append(st.Files, change(f[1], f[9], orig))
			}
		case strings.HasPrefix(p, "u "):
			f := strings.SplitN(p, " ", 11)
			if len(f) == 11 {
				c := change(f[1], f[10], "")
				c.Conflict = true
				st.Files = append(st.Files, c)
			}
		case strings.HasPrefix(p, "? "):
			st.Files = append(st.Files, FileChange{Path: p[2:], Untracked: true, Work: "?"})
		}
	}
}

func change(xy, path, orig string) FileChange {
	c := FileChange{Path: path, Orig: orig}
	if len(xy) == 2 {
		if xy[0] != '.' {
			c.Index = string(xy[0])
		}
		if xy[1] != '.' {
			c.Work = string(xy[1])
		}
	}
	return c
}

var scpRe = regexp.MustCompile(`^(?:ssh://)?(?:[\w.-]+@)?([\w.-]+)(?::\d+)?[:/](.+?)(?:\.git)?/?$`)

// ParseRemote разбирает адрес remote в хост и путь owner/repo.
func ParseRemote(name, url string) Remote {
	r := Remote{Name: name, URL: url}
	u := url
	if strings.HasPrefix(u, "https://") || strings.HasPrefix(u, "http://") {
		u = u[strings.Index(u, "://")+3:]
		if at := strings.Index(u, "@"); at >= 0 && at < strings.Index(u+"/", "/") {
			u = u[at+1:]
		}
		if i := strings.Index(u, "/"); i > 0 {
			r.Host, r.Path = strings.ToLower(u[:i]), strings.TrimSuffix(strings.TrimSuffix(u[i+1:], "/"), ".git")
		}
	} else if m := scpRe.FindStringSubmatch(u); m != nil {
		r.Host, r.Path = strings.ToLower(m[1]), m[2]
	}
	if r.Host != "" {
		r.Web = "https://" + r.Host + "/" + r.Path
	}
	return r
}

func Remotes(ctx context.Context, dir string) []Remote {
	out, err := Run(ctx, dir, nil, nil, "remote", "-v")
	if err != nil {
		return nil
	}
	seen := map[string]bool{}
	var res []Remote
	for _, l := range strings.Split(out, "\n") {
		f := strings.Fields(l)
		if len(f) >= 2 && !seen[f[0]] {
			seen[f[0]] = true
			res = append(res, ParseRemote(f[0], f[1]))
		}
	}
	return res
}

// ---------- Ветки и история ----------

type Branch struct {
	Name     string `json:"name"`
	Remote   bool   `json:"remote"`
	Current  bool   `json:"current"`
	Upstream string `json:"upstream"`
}

func Branches(ctx context.Context, dir string) ([]Branch, error) {
	out, err := Run(ctx, dir, nil, nil, "for-each-ref", "--sort=-committerdate", "--format=%(refname)%09%(upstream:short)%09%(HEAD)", "refs/heads", "refs/remotes")
	if err != nil {
		return nil, err
	}
	var res []Branch
	for _, l := range strings.Split(strings.TrimSpace(out), "\n") {
		f := strings.Split(l, "\t")
		if len(f) < 3 || strings.HasSuffix(f[0], "/HEAD") {
			continue
		}
		b := Branch{Upstream: f[1], Current: f[2] == "*"}
		if strings.HasPrefix(f[0], "refs/heads/") {
			b.Name = strings.TrimPrefix(f[0], "refs/heads/")
		} else {
			b.Name = strings.TrimPrefix(f[0], "refs/remotes/")
			b.Remote = true
		}
		res = append(res, b)
	}
	return res, nil
}

type Commit struct {
	Hash    string `json:"hash"`
	Short   string `json:"short"`
	Author  string `json:"author"`
	Email   string `json:"email"`
	Time    int64  `json:"time"`
	Subject string `json:"subject"`
	Refs    string `json:"refs"`
}

func Log(ctx context.Context, dir string, n int) ([]Commit, error) {
	out, err := Run(ctx, dir, nil, nil, "log", fmt.Sprintf("-n%d", n), "--format=%H%x1f%h%x1f%an%x1f%ae%x1f%at%x1f%s%x1f%D%x1e")
	if err != nil {
		if strings.Contains(err.Error(), "does not have any commits") {
			return nil, nil
		}
		return nil, err
	}
	var res []Commit
	for _, rec := range strings.Split(out, "\x1e") {
		f := strings.Split(strings.TrimSpace(rec), "\x1f")
		if len(f) < 7 {
			continue
		}
		t, _ := strconv.ParseInt(f[4], 10, 64)
		res = append(res, Commit{Hash: f[0], Short: f[1], Author: f[2], Email: f[3], Time: t, Subject: f[5], Refs: f[6]})
	}
	return res, nil
}

// Diff — изменения файла (staged — в индексе). Для новых файлов — всё содержимое как добавленное.
func Diff(ctx context.Context, dir, path string, staged, untracked bool) (string, error) {
	if untracked {
		b, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(path)))
		if err != nil {
			return "", err
		}
		if bytes.IndexByte(b, 0) >= 0 {
			return "Новый двоичный файл", nil
		}
		if len(b) > 400*1024 {
			b = b[:400*1024]
		}
		lines := strings.Split(strings.TrimRight(string(b), "\n"), "\n")
		var sb strings.Builder
		fmt.Fprintf(&sb, "@@ новый файл, %d строк @@\n", len(lines))
		for _, l := range lines {
			sb.WriteString("+" + l + "\n")
		}
		return sb.String(), nil
	}
	args := []string{"diff", "--no-color", "--no-ext-diff"}
	if staged {
		args = append(args, "--cached")
	}
	args = append(args, "--", path)
	return Run(ctx, dir, nil, nil, args...)
}

func Show(ctx context.Context, dir, hash string) (string, error) {
	return Run(ctx, dir, nil, nil, "show", "--no-color", "--stat", "--patch", "--format=commit %H%nАвтор: %an <%ae>%nДата:  %ad%n%n%B", "--date=format:%d.%m.%Y %H:%M", hash)
}

// Timeout для сетевых операций.
const NetTimeout = 10 * time.Minute
