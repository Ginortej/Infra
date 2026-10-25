// Package ai — локальные ИИ-модели через Ollama (https://ollama.com).
package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"infra/internal/proc"
)

type Model struct {
	Name     string `json:"name"`
	Size     int64  `json:"size"`
	Family   string `json:"family"`
	Params   string `json:"params"` // 7.6B
	Quant    string `json:"quant"`  // Q4_K_M
	Modified string `json:"modified"`
}

type Running struct {
	Name     string `json:"name"`
	Size     int64  `json:"size"`
	SizeVRAM int64  `json:"sizeVram"`
	Until    string `json:"until"`
}

type Status struct {
	Installed bool      `json:"installed"`
	Path      string    `json:"path"`
	Running   bool      `json:"running"` // сервер отвечает
	Version   string    `json:"version"`
	Host      string    `json:"host"`
	Models    []Model   `json:"models"`
	Loaded    []Running `json:"loaded"`  // модели в памяти (ollama ps)
	Started   bool      `json:"started"` // сервер запустила Infra
	Error     string    `json:"error"`
}

type Ollama struct {
	mu   sync.Mutex
	srv  *exec.Cmd
	stop context.CancelFunc
}

var client = &http.Client{Timeout: 5 * time.Second}

// Host — адрес сервера Ollama (учитывает OLLAMA_HOST).
func Host() string {
	h := strings.TrimSpace(os.Getenv("OLLAMA_HOST"))
	if h == "" {
		return "http://127.0.0.1:11434"
	}
	if !strings.Contains(h, "://") {
		h = "http://" + h
	}
	h = strings.Replace(h, "0.0.0.0", "127.0.0.1", 1)
	return strings.TrimRight(h, "/")
}

// Path — ollama.exe (PATH или стандартная папка установки).
func Path() string {
	if p, err := exec.LookPath("ollama"); err == nil {
		return p
	}
	for _, p := range []string{
		filepath.Join(os.Getenv("LOCALAPPDATA"), `Programs\Ollama\ollama.exe`),
		filepath.Join(os.Getenv("ProgramFiles"), `Ollama\ollama.exe`),
	} {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}

func get(ctx context.Context, path string, out any) error {
	req, _ := http.NewRequestWithContext(ctx, "GET", Host()+path, nil)
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("ollama: %s", resp.Status)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func (o *Ollama) Status(ctx context.Context) Status {
	st := Status{Path: Path(), Host: Host(), Models: []Model{}, Loaded: []Running{}}
	st.Installed = st.Path != ""
	var v struct{ Version string }
	if err := get(ctx, "/api/version", &v); err != nil {
		return st
	}
	st.Running, st.Version = true, v.Version
	o.mu.Lock()
	st.Started = o.srv != nil
	o.mu.Unlock()
	var tags struct {
		Models []struct {
			Name       string `json:"name"`
			Size       int64  `json:"size"`
			ModifiedAt string `json:"modified_at"`
			Details    struct {
				Family            string `json:"family"`
				ParameterSize     string `json:"parameter_size"`
				QuantizationLevel string `json:"quantization_level"`
			} `json:"details"`
		} `json:"models"`
	}
	if err := get(ctx, "/api/tags", &tags); err != nil {
		st.Error = err.Error()
	}
	for _, m := range tags.Models {
		st.Models = append(st.Models, Model{Name: m.Name, Size: m.Size, Family: m.Details.Family, Params: m.Details.ParameterSize, Quant: m.Details.QuantizationLevel, Modified: m.ModifiedAt})
	}
	sort.Slice(st.Models, func(i, j int) bool { return st.Models[i].Name < st.Models[j].Name })
	var ps struct {
		Models []struct {
			Name      string `json:"name"`
			Size      int64  `json:"size"`
			SizeVRAM  int64  `json:"size_vram"`
			ExpiresAt string `json:"expires_at"`
		} `json:"models"`
	}
	if err := get(ctx, "/api/ps", &ps); err == nil {
		for _, m := range ps.Models {
			st.Loaded = append(st.Loaded, Running{Name: m.Name, Size: m.Size, SizeVRAM: m.SizeVRAM, Until: m.ExpiresAt})
		}
	}
	return st
}

// EnsureServer запускает «ollama serve», если сервер не отвечает (обычно его держит иконка в трее).
func (o *Ollama) EnsureServer(ctx context.Context) error {
	if st := o.Status(ctx); st.Running {
		return nil
	}
	path := Path()
	if path == "" {
		return errors.New("Ollama не установлена. Скачай с https://ollama.com/download или: winget install Ollama.Ollama")
	}
	o.mu.Lock()
	if o.srv == nil {
		sctx, cancel := context.WithCancel(context.Background())
		cmd := proc.Command(sctx, path, "serve")
		if err := cmd.Start(); err != nil {
			o.mu.Unlock()
			cancel()
			return fmt.Errorf("не удалось запустить ollama serve: %v", err)
		}
		o.srv, o.stop = cmd, cancel
		go func() {
			_ = cmd.Wait()
			o.mu.Lock()
			if o.srv == cmd {
				o.srv, o.stop = nil, nil
			}
			o.mu.Unlock()
		}()
	}
	o.mu.Unlock()
	for i := 0; i < 50; i++ { // до 10 секунд
		time.Sleep(200 * time.Millisecond)
		var v struct{ Version string }
		if get(ctx, "/api/version", &v) == nil {
			return nil
		}
	}
	return errors.New("сервер Ollama не ответил за 10 секунд")
}

// Shutdown останавливает сервер, только если его запускала Infra.
func (o *Ollama) Shutdown() {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.stop != nil {
		o.stop()
		o.srv, o.stop = nil, nil
	}
}

// Unload выгружает модель из памяти (освобождает видеопамять).
func (o *Ollama) Unload(ctx context.Context, model string) error {
	body := strings.NewReader(fmt.Sprintf(`{"model":%q,"keep_alive":0}`, model))
	req, _ := http.NewRequestWithContext(ctx, "POST", Host()+"/api/generate", body)
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	resp.Body.Close()
	return nil
}

// Quote — аргумент для командной строки Windows.
func Quote(s string) string {
	if strings.ContainsAny(s, " \t\"") {
		return `"` + strings.ReplaceAll(s, `"`, `\"`) + `"`
	}
	return s
}
