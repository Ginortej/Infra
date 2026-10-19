package vault

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

// Settings — настройки приложения (не хранилища): %APPDATA%\Infra\settings.json
type Settings struct {
	Vault        string   `json:"vault"`
	Recent       []string `json:"recent"`
	DefaultShell string   `json:"defaultShell"`
	VBoxManage   string   `json:"vboxmanage"`
	Vmrun        string   `json:"vmrun"`
	VMwareDir    string   `json:"vmwareDir"`
	SingBox      string   `json:"singbox"`
	WSLDistro    string   `json:"wslDistro"`
	Parallel     int      `json:"parallel"`
	GitRepos     []string `json:"gitRepos"`
}

var settingsMu sync.Mutex

func settingsPath() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		dir = "."
	}
	dir = filepath.Join(dir, "Infra")
	_ = os.MkdirAll(dir, 0o755)
	return filepath.Join(dir, "settings.json")
}

func LoadSettings() Settings {
	settingsMu.Lock()
	defer settingsMu.Unlock()
	s := Settings{Parallel: 10}
	if b, err := os.ReadFile(settingsPath()); err == nil {
		_ = json.Unmarshal(b, &s)
	}
	if s.Parallel <= 0 {
		s.Parallel = 10
	}
	return s
}

func SaveSettings(s Settings) error {
	settingsMu.Lock()
	defer settingsMu.Unlock()
	b, _ := json.MarshalIndent(s, "", "  ")
	return os.WriteFile(settingsPath(), b, 0o644)
}

// AddRecent ставит путь первым в списке недавних.
func (s *Settings) AddRecent(p string) {
	out := []string{p}
	for _, r := range s.Recent {
		if r != p && len(out) < 8 {
			out = append(out, r)
		}
	}
	s.Recent = out
}
