package gitx

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os/exec"
	"strings"
	"time"

	"infra/internal/proc"
)

var httpClient = &http.Client{Timeout: 30 * time.Second}

func apiBase(a Account) string {
	a = a.Fix()
	if a.Provider == "github" {
		if a.Host == "github.com" {
			return "https://api.github.com"
		}
		return "https://" + a.Host + "/api/v3" // GitHub Enterprise
	}
	return "https://" + a.Host + "/api/v4"
}

func call(ctx context.Context, a Account, token, method, path string, body any, out any) error {
	a = a.Fix()
	if token == "" {
		return fmt.Errorf("у аккаунта %s нет токена — без него API %s недоступен", a.Label, a.Provider)
	}
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, apiBase(a)+path, rd)
	if err != nil {
		return err
	}
	if a.Provider == "github" {
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Accept", "application/vnd.github+json")
	} else {
		req.Header.Set("PRIVATE-TOKEN", token)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "Infra")
	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("%s недоступен: %v", a.Host, err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode >= 300 {
		var e struct {
			Message any    `json:"message"`
			Error   string `json:"error"`
		}
		_ = json.Unmarshal(data, &e)
		msg := fmt.Sprint(e.Message)
		if e.Message == nil {
			msg = e.Error
		}
		switch resp.StatusCode {
		case 401:
			return fmt.Errorf("токен не принят (%d): %s", resp.StatusCode, msg)
		case 403:
			return fmt.Errorf("нет прав (%d): %s — проверь права токена", resp.StatusCode, msg)
		}
		return fmt.Errorf("%s ответил %d: %s", a.Host, resp.StatusCode, msg)
	}
	if out != nil {
		return json.Unmarshal(data, out)
	}
	return nil
}

type Profile struct {
	Username string `json:"username"`
	Name     string `json:"name"`
	Email    string `json:"email"`
	Avatar   string `json:"avatar"`
}

// Verify проверяет токен и возвращает профиль (имя и почту для коммитов).
func Verify(ctx context.Context, a Account, token string) (Profile, error) {
	var p Profile
	if a.Provider == "github" {
		var u struct {
			ID     int64  `json:"id"`
			Login  string `json:"login"`
			Name   string `json:"name"`
			Email  string `json:"email"`
			Avatar string `json:"avatar_url"`
		}
		if err := call(ctx, a, token, "GET", "/user", nil, &u); err != nil {
			return p, err
		}
		p = Profile{Username: u.Login, Name: firstNonEmpty(u.Name, u.Login), Email: u.Email, Avatar: u.Avatar}
		if p.Email == "" {
			// приватная почта — используем noreply-адрес GitHub
			p.Email = fmt.Sprintf("%d+%s@users.noreply.%s", u.ID, u.Login, a.Fix().Domain())
		}
		return p, nil
	}
	var u struct {
		Username    string `json:"username"`
		Name        string `json:"name"`
		Email       string `json:"email"`
		CommitEmail string `json:"commit_email"`
		PublicEmail string `json:"public_email"`
		Avatar      string `json:"avatar_url"`
	}
	if err := call(ctx, a, token, "GET", "/user", nil, &u); err != nil {
		return p, err
	}
	return Profile{Username: u.Username, Name: firstNonEmpty(u.Name, u.Username), Email: firstNonEmpty(u.CommitEmail, u.Email, u.PublicEmail), Avatar: u.Avatar}, nil
}

type RemoteRepo struct {
	Name     string `json:"name"`
	FullName string `json:"fullName"`
	Private  bool   `json:"private"`
	HTTPS    string `json:"https"`
	SSH      string `json:"ssh"`
	Web      string `json:"web"`
	Updated  string `json:"updated"`
	Desc     string `json:"desc"`
}

// ListRepos — репозитории аккаунта (для клонирования).
func ListRepos(ctx context.Context, a Account, token string) ([]RemoteRepo, error) {
	var res []RemoteRepo
	if a.Provider == "github" {
		var raw []map[string]any
		if err := call(ctx, a, token, "GET", "/user/repos?per_page=100&sort=updated", nil, &raw); err != nil {
			return nil, err
		}
		for _, r := range raw {
			res = append(res, RemoteRepo{Name: str(r["name"]), FullName: str(r["full_name"]), Private: r["private"] == true,
				HTTPS: str(r["clone_url"]), SSH: str(r["ssh_url"]), Web: str(r["html_url"]), Updated: str(r["updated_at"]), Desc: str(r["description"])})
		}
		return res, nil
	}
	var raw []map[string]any
	if err := call(ctx, a, token, "GET", "/projects?membership=true&per_page=100&order_by=last_activity_at&simple=true", nil, &raw); err != nil {
		return nil, err
	}
	for _, r := range raw {
		res = append(res, RemoteRepo{Name: str(r["name"]), FullName: str(r["path_with_namespace"]), Private: str(r["visibility"]) != "public",
			HTTPS: str(r["http_url_to_repo"]), SSH: str(r["ssh_url_to_repo"]), Web: str(r["web_url"]), Updated: str(r["last_activity_at"]), Desc: str(r["description"])})
	}
	return res, nil
}

func str(v any) string {
	if v == nil {
		return ""
	}
	return fmt.Sprint(v)
}

// CreateRepo создаёт пустой репозиторий на GitHub / GitLab.
func CreateRepo(ctx context.Context, a Account, token, name, desc string, private bool) (RemoteRepo, error) {
	var raw map[string]any
	if a.Provider == "github" {
		if err := call(ctx, a, token, "POST", "/user/repos", map[string]any{"name": name, "description": desc, "private": private}, &raw); err != nil {
			return RemoteRepo{}, err
		}
		return RemoteRepo{Name: str(raw["name"]), FullName: str(raw["full_name"]), Private: private, HTTPS: str(raw["clone_url"]), SSH: str(raw["ssh_url"]), Web: str(raw["html_url"])}, nil
	}
	vis := "public"
	if private {
		vis = "private"
	}
	if err := call(ctx, a, token, "POST", "/projects", map[string]any{"name": name, "description": desc, "visibility": vis, "initialize_with_readme": false}, &raw); err != nil {
		return RemoteRepo{}, err
	}
	return RemoteRepo{Name: str(raw["name"]), FullName: str(raw["path_with_namespace"]), Private: private, HTTPS: str(raw["http_url_to_repo"]), SSH: str(raw["ssh_url_to_repo"]), Web: str(raw["web_url"])}, nil
}

// UploadKey добавляет публичный SSH-ключ в аккаунт (нужен токен с правом на ключи).
func UploadKey(ctx context.Context, a Account, token, title, pub string) error {
	return call(ctx, a, token, "POST", "/user/keys", map[string]any{"title": title, "key": pub}, nil)
}

// TestSSH проверяет вход по ключу: ssh -T git@host.
func TestSSH(ctx context.Context, a Account) (string, error) {
	sshPath, err := exec.LookPath("ssh")
	if err != nil {
		return "", fmt.Errorf("ssh не найден (установи OpenSSH-клиент Windows или Git for Windows)")
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	out, _ := proc.Output(ctx, sshPath, "-T", "-i", a.SSHKey, "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=accept-new", "-o", "BatchMode=yes", "git@"+a.Fix().Domain())
	out = strings.TrimSpace(out)
	low := strings.ToLower(out)
	if strings.Contains(low, "successfully authenticated") || strings.Contains(low, "welcome to gitlab") || strings.Contains(low, "welcome to") {
		return out, nil
	}
	if out == "" {
		out = "нет ответа"
	}
	return "", fmt.Errorf("%s", out)
}

// TokenURL — страница создания токена с нужными правами.
func TokenURL(a Account) string {
	a = a.Fix()
	if a.Provider == "github" {
		return "https://" + a.Host + "/settings/tokens/new?description=Infra&scopes=repo,read:user,user:email,admin:public_key"
	}
	return "https://" + a.Host + "/-/user_settings/personal_access_tokens?name=Infra&scopes=api,write_repository"
}

// KeysURL — страница добавления SSH-ключа.
func KeysURL(a Account) string {
	a = a.Fix()
	if a.Provider == "github" {
		return "https://" + a.Host + "/settings/ssh/new"
	}
	return "https://" + a.Host + "/-/user_settings/ssh_keys"
}

// CloneURL выбирает адрес под способ входа аккаунта.
func CloneURL(a Account, r RemoteRepo) string {
	if a.GitAuth == "ssh" && r.SSH != "" {
		return r.SSH
	}
	return r.HTTPS
}

var _ = url.QueryEscape
