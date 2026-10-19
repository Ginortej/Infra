package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"infra/internal/gitx"
	"infra/internal/vault"
)

// ---------- Аккаунты ----------

type GitInfo struct {
	Path    string `json:"path"`
	Version string `json:"version"`
}

func (a *App) GitInfo() GitInfo {
	p := gitx.GitPath()
	if p == "" {
		return GitInfo{}
	}
	v, _ := gitx.Run(context.Background(), "", nil, nil, "--version")
	return GitInfo{Path: p, Version: strings.TrimSpace(v)}
}

func (a *App) GitAccounts() []gitx.Account { return a.git.List() }

// GitSaveAccount: token "" — не менять, "-" — удалить.
func (a *App) GitSaveAccount(acc gitx.Account, token string) (gitx.Account, error) {
	return a.git.Save(acc, token)
}

func (a *App) GitDeleteAccount(id string) error {
	if a.gitDefault() == id {
		_ = a.GitSetDefault("")
	}
	return a.git.Delete(id)
}

func (a *App) gitDefault() string {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.settings.GitDefault
}

// GitSetDefault — аккаунт по умолчанию: git в новых терминалах Infra и репозитории без своего аккаунта.
func (a *App) GitSetDefault(id string) error {
	if id != "" {
		if _, err := a.git.Get(id); err != nil {
			return err
		}
	}
	a.mu.Lock()
	a.settings.GitDefault = id
	s := a.settings
	a.mu.Unlock()
	return vault.SaveSettings(s)
}

// accountEnv — окружение git-аккаунта для терминала ("@default" — аккаунт по умолчанию).
func (a *App) accountEnv(id string) []string {
	if id == "@default" {
		id = a.gitDefault()
	}
	if id == "" {
		return nil
	}
	acc, err := a.git.Get(id)
	if err != nil {
		return nil
	}
	return gitx.AccountEnv(&acc, a.git.Token(id))
}

// GitVerify проверяет токен (новый или сохранённый) и возвращает профиль.
func (a *App) GitVerify(acc gitx.Account, token string) (gitx.Profile, error) {
	if token == "" && acc.ID != "" {
		token = a.git.Token(acc.ID)
	}
	if acc.Host == "" {
		acc.Host = map[string]string{"github": "github.com", "gitlab": "gitlab.com"}[acc.Provider]
	}
	return gitx.Verify(context.Background(), acc, token)
}

func (a *App) GitTestSSH(acc gitx.Account) (string, error) {
	if acc.SSHKey == "" {
		return "", errors.New("не указан SSH-ключ")
	}
	if acc.Host == "" {
		acc.Host = map[string]string{"github": "github.com", "gitlab": "gitlab.com"}[acc.Provider]
	}
	return gitx.TestSSH(context.Background(), acc)
}

type KeyInfo struct {
	Path string `json:"path"`
	Pub  string `json:"pub"`
}

func (a *App) GitGenerateKey(name, comment string) (KeyInfo, error) {
	p, pub, err := gitx.GenerateKey(name, comment)
	return KeyInfo{p, pub}, err
}

func (a *App) GitPublicKey(path string) (string, error) { return gitx.PublicKey(path) }

// GitUploadKey добавляет публичный ключ аккаунта на сайт через API.
func (a *App) GitUploadKey(id string) error {
	acc, err := a.git.Get(id)
	if err != nil {
		return err
	}
	pub, err := gitx.PublicKey(acc.SSHKey)
	if err != nil {
		return err
	}
	return gitx.UploadKey(context.Background(), acc, a.git.Token(id), "Infra · "+hostname(), pub)
}

func hostname() string { h, _ := os.Hostname(); return h }

type GitLinks struct {
	Token string `json:"token"`
	Keys  string `json:"keys"`
}

func (a *App) GitLinks(acc gitx.Account) GitLinks {
	if acc.Host == "" {
		acc.Host = map[string]string{"github": "github.com", "gitlab": "gitlab.com"}[acc.Provider]
	}
	return GitLinks{gitx.TokenURL(acc), gitx.KeysURL(acc)}
}

// ---------- Репозитории ----------

type RepoSummary struct {
	Path    string `json:"path"`
	Name    string `json:"name"`
	IsRepo  bool   `json:"isRepo"`
	Branch  string `json:"branch"`
	Ahead   int    `json:"ahead"`
	Behind  int    `json:"behind"`
	Changes int    `json:"changes"`
	Account string `json:"account"`
	Remote  string `json:"remote"` // host/owner/repo
	Error   string `json:"error"`
	Vault   bool   `json:"vault"`
}

func (a *App) repoList() []string {
	a.mu.RLock()
	list := append([]string(nil), a.settings.GitRepos...)
	v := a.vault
	a.mu.RUnlock()
	if v != nil {
		if _, err := os.Stat(filepath.Join(v.Root, ".git")); err == nil && !contains(list, v.Root) {
			list = append([]string{v.Root}, list...)
		}
	}
	return list
}

func contains(l []string, s string) bool {
	for _, x := range l {
		if strings.EqualFold(filepath.Clean(x), filepath.Clean(s)) {
			return true
		}
	}
	return false
}

func (a *App) GitRepos() []RepoSummary {
	paths := a.repoList()
	res := make([]RepoSummary, len(paths))
	done := make(chan struct{}, len(paths))
	v := a.Vault()
	for i, p := range paths {
		go func() {
			defer func() { done <- struct{}{} }()
			r := RepoSummary{Path: p, Name: filepath.Base(p), Vault: v != nil && strings.EqualFold(filepath.Clean(v.Root), filepath.Clean(p))}
			st, err := gitx.GetStatus(context.Background(), p)
			if err != nil {
				r.Error = err.Error()
			} else if _, serr := os.Stat(p); serr != nil {
				r.Error = "папка не найдена"
			}
			r.IsRepo, r.Branch, r.Ahead, r.Behind, r.Changes, r.Account = st.IsRepo, st.Branch, st.Ahead, st.Behind, len(st.Files), st.Account
			if r.Account == "" {
				r.Account = a.guessAccount(st)
			}
			for _, rm := range st.Remotes {
				if rm.Name == "origin" || r.Remote == "" {
					r.Remote = rm.Host + "/" + rm.Path
				}
			}
			res[i] = r
		}()
	}
	for range paths {
		<-done
	}
	sort.SliceStable(res, func(i, j int) bool { return res[i].Vault && !res[j].Vault })
	return res
}

func (a *App) saveRepoList(list []string) error {
	a.mu.Lock()
	a.settings.GitRepos = list
	s := a.settings
	a.mu.Unlock()
	return vault.SaveSettings(s)
}

func (a *App) GitAddRepo(path string) error {
	path = filepath.Clean(path)
	if st, err := os.Stat(path); err != nil || !st.IsDir() {
		return fmt.Errorf("папка не найдена: %s", path)
	}
	a.mu.RLock()
	list := append([]string(nil), a.settings.GitRepos...)
	a.mu.RUnlock()
	if contains(list, path) {
		return nil
	}
	return a.saveRepoList(append(list, path))
}

func (a *App) GitRemoveRepo(path string) error {
	a.mu.RLock()
	var out []string
	for _, p := range a.settings.GitRepos {
		if !strings.EqualFold(filepath.Clean(p), filepath.Clean(path)) {
			out = append(out, p)
		}
	}
	a.mu.RUnlock()
	return a.saveRepoList(out)
}

// guessAccount — если аккаунт не выбран явно, берём единственный аккаунт с хостом origin.
func (a *App) guessAccount(st gitx.Status) string {
	host := ""
	for _, r := range st.Remotes {
		if r.Name == "origin" || host == "" {
			host = r.Host
		}
	}
	if host == "" {
		return a.gitDefault() // remote ещё нет — аккаунт по умолчанию
	}
	var found []string
	for _, acc := range a.git.List() {
		if acc.Host == host {
			found = append(found, acc.ID)
		}
	}
	if len(found) == 1 {
		return found[0]
	}
	if d := a.gitDefault(); d != "" {
		if acc, err := a.git.Get(d); err == nil && acc.Host == host {
			return d
		}
	}
	return ""
}

// repoEnv — окружение git для репозитория: его аккаунт (явный или угаданный).
func (a *App) repoEnv(path string) (*gitx.Account, []string) {
	ctx := context.Background()
	id, _ := gitx.Run(ctx, path, nil, nil, "config", "--local", "--get", "infra.account")
	id = strings.TrimSpace(id)
	if id == "" {
		st, _ := gitx.GetStatus(ctx, path)
		id = a.guessAccount(st)
	}
	if id == "" {
		return nil, gitx.Env(nil, "")
	}
	acc, err := a.git.Get(id)
	if err != nil {
		return nil, gitx.Env(nil, "")
	}
	return &acc, gitx.Env(&acc, a.git.Token(id))
}

func (a *App) GitStatus(path string) (gitx.Status, error) {
	st, err := gitx.GetStatus(context.Background(), path)
	if err == nil && st.IsRepo && st.Account == "" {
		st.Account = a.guessAccount(st)
	}
	return st, err
}

// GitSetAccount привязывает аккаунт к репозиторию и прописывает имя/почту для коммитов
// (так коммиты из обычного терминала тоже пойдут от этого аккаунта).
func (a *App) GitSetAccount(path, id string) error {
	ctx := context.Background()
	if id == "" {
		_, _ = gitx.Run(ctx, path, nil, nil, "config", "--local", "--unset", "infra.account")
		return nil
	}
	acc, err := a.git.Get(id)
	if err != nil {
		return err
	}
	if _, err := gitx.Run(ctx, path, nil, nil, "config", "--local", "infra.account", id); err != nil {
		return err
	}
	if acc.Name != "" {
		_, _ = gitx.Run(ctx, path, nil, nil, "config", "--local", "user.name", acc.Name)
	}
	if acc.Email != "" {
		_, _ = gitx.Run(ctx, path, nil, nil, "config", "--local", "user.email", acc.Email)
	}
	return nil
}

func (a *App) git1(path string, args ...string) error {
	_, env := a.repoEnv(path)
	_, err := gitx.Run(context.Background(), path, env, nil, args...)
	return err
}

func (a *App) GitStage(path string, files []string) error {
	if len(files) == 0 {
		return a.git1(path, "add", "-A")
	}
	return a.git1(path, append([]string{"add", "--"}, files...)...)
}

func (a *App) GitUnstage(path string, files []string) error {
	st, _ := gitx.GetStatus(context.Background(), path)
	if st.Empty { // до первого коммита restore --staged не работает
		return a.git1(path, append([]string{"rm", "--cached", "-r", "-q", "--"}, orAll(files)...)...)
	}
	return a.git1(path, append([]string{"restore", "--staged", "--"}, orAll(files)...)...)
}

func orAll(f []string) []string {
	if len(f) == 0 {
		return []string{"."}
	}
	return f
}

// GitDiscard отменяет изменения в файлах; новые (неотслеживаемые) файлы удаляются.
func (a *App) GitDiscard(path string, files, untracked []string) error {
	if len(files) > 0 {
		if err := a.git1(path, append([]string{"restore", "--worktree", "--"}, files...)...); err != nil {
			return err
		}
	}
	for _, f := range untracked {
		full := filepath.Join(path, filepath.FromSlash(f))
		rel, err := filepath.Rel(path, full)
		if err != nil || strings.HasPrefix(rel, "..") {
			continue
		}
		_ = os.RemoveAll(full)
	}
	return nil
}

func (a *App) GitDiff(path, file string, staged, untracked bool) (string, error) {
	return gitx.Diff(context.Background(), path, file, staged, untracked)
}

func (a *App) GitCommit(path, message string, amend bool) (string, error) {
	if strings.TrimSpace(message) == "" && !amend {
		return "", errors.New("напиши сообщение коммита")
	}
	acc, env := a.repoEnv(path)
	args := []string{"commit", "-m", message}
	if amend {
		args = []string{"commit", "--amend", "--no-edit"}
		if strings.TrimSpace(message) != "" {
			args = []string{"commit", "--amend", "-m", message}
		}
	}
	out, err := gitx.Run(context.Background(), path, env, nil, args...)
	if err != nil && strings.Contains(err.Error(), "Please tell me who you are") {
		return "", errors.New("не задано имя автора: выбери для репозитория git-аккаунт")
	}
	_ = acc
	return strings.TrimSpace(out), err
}

// Сетевые операции — задачами с прогрессом в статус-баре.
func (a *App) gitJob(title, path string, args ...string) string {
	return a.job(title, func(ctx context.Context, progress func(int, string)) error {
		_, env := a.repoEnv(path)
		ctx, cancel := context.WithTimeout(ctx, gitx.NetTimeout)
		defer cancel()
		_, err := gitx.Run(ctx, path, env, func(l string) { progress(50, l) }, args...)
		a.emit("git:changed", path)
		return err
	})
}

func (a *App) GitFetch(path string) string {
	return a.gitJob("git fetch", path, "fetch", "--all", "--prune", "--progress")
}
func (a *App) GitPull(path string, rebase bool) string {
	if rebase {
		return a.gitJob("git pull", path, "pull", "--rebase", "--autostash", "--progress")
	}
	return a.gitJob("git pull", path, "pull", "--ff-only", "--progress")
}

// GitPush; если у ветки нет upstream — публикует её (push -u origin HEAD).
func (a *App) GitPush(path string, force bool) (string, error) {
	st, err := gitx.GetStatus(context.Background(), path)
	if err != nil {
		return "", err
	}
	if len(st.Remotes) == 0 {
		return "", errors.New("у репозитория нет remote — создай репозиторий на GitHub/GitLab или укажи адрес")
	}
	args := []string{"push", "--progress"}
	if force {
		args = append(args, "--force-with-lease")
	}
	if st.Upstream == "" {
		remote := "origin"
		if !hasRemote(st, "origin") {
			remote = st.Remotes[0].Name
		}
		args = append(args, "-u", remote, "HEAD")
	}
	return a.gitJob("git push", path, args...), nil
}

func hasRemote(st gitx.Status, name string) bool {
	for _, r := range st.Remotes {
		if r.Name == name {
			return true
		}
	}
	return false
}

func (a *App) GitBranches(path string) ([]gitx.Branch, error) {
	return gitx.Branches(context.Background(), path)
}

func (a *App) GitCheckout(path, name string, remote bool) error {
	if remote {
		local := name
		if i := strings.Index(name, "/"); i >= 0 {
			local = name[i+1:]
		}
		return a.git1(path, "switch", "-c", local, "--track", name)
	}
	return a.git1(path, "switch", name)
}

func (a *App) GitCreateBranch(path, name string) error { return a.git1(path, "switch", "-c", name) }

func (a *App) GitLog(path string) ([]gitx.Commit, error) {
	return gitx.Log(context.Background(), path, 200)
}

func (a *App) GitShow(path, hash string) (string, error) {
	return gitx.Show(context.Background(), path, hash)
}

func (a *App) GitInit(path string) error {
	if _, err := gitx.Run(context.Background(), path, nil, nil, "init", "-b", "main"); err != nil {
		// старые git без -b
		if _, err2 := gitx.Run(context.Background(), path, nil, nil, "init"); err2 != nil {
			return err
		}
	}
	return a.GitAddRepo(path)
}

// GitSetRemote задаёт origin (добавляет или меняет адрес).
func (a *App) GitSetRemote(path, url string) error {
	st, _ := gitx.GetStatus(context.Background(), path)
	if hasRemote(st, "origin") {
		return a.git1(path, "remote", "set-url", "origin", strings.TrimSpace(url))
	}
	return a.git1(path, "remote", "add", "origin", strings.TrimSpace(url))
}

func (a *App) GitListRemote(accountID string) ([]gitx.RemoteRepo, error) {
	acc, err := a.git.Get(accountID)
	if err != nil {
		return nil, err
	}
	return gitx.ListRepos(context.Background(), acc, a.git.Token(accountID))
}

// GitClone клонирует репозиторий в parent\name от имени аккаунта и добавляет его в список.
func (a *App) GitClone(accountID, url, parent, name string) (string, error) {
	var acc *gitx.Account
	if accountID != "" {
		x, err := a.git.Get(accountID)
		if err != nil {
			return "", err
		}
		acc = &x
	}
	if name == "" {
		name = strings.TrimSuffix(filepath.Base(strings.TrimRight(strings.ReplaceAll(url, ":", "/"), "/")), ".git")
	}
	dest := filepath.Join(parent, name)
	if _, err := os.Stat(dest); err == nil {
		return "", fmt.Errorf("папка уже существует: %s", dest)
	}
	env := gitx.Env(acc, "")
	if acc != nil {
		env = gitx.Env(acc, a.git.Token(acc.ID))
	}
	return a.job("git clone "+name, func(ctx context.Context, progress func(int, string)) error {
		ctx, cancel := context.WithTimeout(ctx, gitx.NetTimeout)
		defer cancel()
		if _, err := gitx.Run(ctx, parent, env, func(l string) { progress(50, l) }, "clone", "--progress", url, dest); err != nil {
			return err
		}
		if err := a.GitAddRepo(dest); err != nil {
			return err
		}
		if acc != nil {
			_ = a.GitSetAccount(dest, acc.ID)
		}
		a.emit("git:changed", dest)
		return nil
	}), nil
}

// GitCreateRemote создаёт репозиторий на GitHub/GitLab, прописывает origin и публикует текущую ветку.
func (a *App) GitCreateRemote(path, accountID, name, desc string, private bool) (string, error) {
	acc, err := a.git.Get(accountID)
	if err != nil {
		return "", err
	}
	token := a.git.Token(accountID)
	if token == "" {
		return "", errors.New("для создания репозитория нужен токен аккаунта (Настройки аккаунта → токен)")
	}
	return a.job("Создание "+name+" на "+acc.Host, func(ctx context.Context, progress func(int, string)) error {
		progress(20, "создаю репозиторий через API")
		r, err := gitx.CreateRepo(ctx, acc, token, name, desc, private)
		if err != nil {
			return err
		}
		progress(50, "origin → "+r.Web)
		if err := a.GitSetRemote(path, gitx.CloneURL(acc, r)); err != nil {
			return err
		}
		_ = a.GitSetAccount(path, accountID)
		st, _ := gitx.GetStatus(ctx, path)
		if !st.Empty {
			env := gitx.Env(&acc, token)
			if _, err := gitx.Run(ctx, path, env, func(l string) { progress(80, l) }, "push", "--progress", "-u", "origin", "HEAD"); err != nil {
				return err
			}
		}
		a.emit("git:changed", path)
		a.emit("info", "Репозиторий создан: "+r.Web)
		return nil
	}), nil
}
