package ai

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// stream — клиент без общего таймаута (скачивание и чат идут долго), отмена через ctx.
var stream = &http.Client{}

// PullProgress — шаг скачивания модели.
type PullProgress struct {
	Status    string `json:"status"`
	Completed int64  `json:"completed"`
	Total     int64  `json:"total"`
}

// Pull скачивает модель (ollama pull) и сообщает прогресс.
func (o *Ollama) Pull(ctx context.Context, model string, progress func(PullProgress)) error {
	body, _ := json.Marshal(map[string]any{"model": model, "stream": true})
	req, _ := http.NewRequestWithContext(ctx, "POST", Host()+"/api/pull", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := stream.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return apiError(resp)
	}
	sc := bufio.NewScanner(resp.Body)
	sc.Buffer(make([]byte, 64*1024), 1<<20)
	for sc.Scan() {
		var p struct {
			PullProgress
			Error string `json:"error"`
		}
		if json.Unmarshal(sc.Bytes(), &p) != nil {
			continue
		}
		if p.Error != "" {
			return errors.New(humanPull(p.Error))
		}
		if progress != nil {
			progress(p.PullProgress)
		}
		if p.Status == "success" {
			return nil
		}
	}
	if err := sc.Err(); err != nil {
		return err
	}
	if ctx.Err() != nil {
		return errors.New("скачивание отменено")
	}
	return nil
}

func humanPull(s string) string {
	if strings.Contains(s, "file does not exist") || strings.Contains(s, "not found") {
		return "такой модели нет в библиотеке Ollama: " + s
	}
	return s
}

// Delete удаляет скачанную модель с диска.
func (o *Ollama) Delete(ctx context.Context, model string) error {
	body, _ := json.Marshal(map[string]string{"model": model})
	req, _ := http.NewRequestWithContext(ctx, "DELETE", Host()+"/api/delete", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return apiError(resp)
	}
	return nil
}

// Capabilities — что умеет модель (completion, tools, vision, thinking, embedding).
// Старые версии Ollama этого не сообщают — тогда nil.
func (o *Ollama) Capabilities(ctx context.Context, model string) ([]string, error) {
	body, _ := json.Marshal(map[string]string{"model": model})
	req, _ := http.NewRequestWithContext(ctx, "POST", Host()+"/api/show", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, apiError(resp)
	}
	var v struct {
		Capabilities []string `json:"capabilities"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&v); err != nil {
		return nil, err
	}
	return v.Capabilities, nil
}

func apiError(resp *http.Response) error {
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	var e struct {
		Error string `json:"error"`
	}
	if json.Unmarshal(b, &e) == nil && e.Error != "" {
		return fmt.Errorf("ollama: %s", e.Error)
	}
	return fmt.Errorf("ollama: %s", resp.Status)
}

// Embed — векторы текстов через /api/embed (модель эмбеддингов, например nomic-embed-text).
func (o *Ollama) Embed(ctx context.Context, model string, input []string) ([][]float32, error) {
	body, _ := json.Marshal(map[string]any{"model": model, "input": input})
	req, _ := http.NewRequestWithContext(ctx, "POST", Host()+"/api/embed", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := stream.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, apiError(resp)
	}
	var v struct {
		Embeddings [][]float32 `json:"embeddings"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&v); err != nil {
		return nil, err
	}
	if len(v.Embeddings) != len(input) {
		return nil, fmt.Errorf("ollama: получено %d векторов вместо %d", len(v.Embeddings), len(input))
	}
	return v.Embeddings, nil
}
