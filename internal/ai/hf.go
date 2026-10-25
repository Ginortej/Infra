package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"
)

// Hugging Face: поиск GGUF-моделей. Ollama скачивает их как hf.co/<автор>/<репозиторий>:<квант>.

var hfBase = "https://huggingface.co"

type HFModel struct {
	ID        string   `json:"id"`
	Author    string   `json:"author"`
	Downloads int64    `json:"downloads"`
	Likes     int64    `json:"likes"`
	Updated   string   `json:"updated"`
	Pipeline  string   `json:"pipeline"`
	Tags      []string `json:"tags"`
}

type HFFile struct {
	Name  string `json:"name"`
	Size  int64  `json:"size"`
	Quant string `json:"quant"` // Q4_K_M — тег для ollama pull
	Split bool   `json:"split"` // модель разбита на части — Ollama такие не скачивает
}

var hfc = &http.Client{Timeout: 20 * time.Second}

func hfGet(ctx context.Context, u string, out any) error {
	req, _ := http.NewRequestWithContext(ctx, "GET", u, nil)
	req.Header.Set("User-Agent", "Infra")
	resp, err := hfc.Do(req)
	if err != nil {
		return fmt.Errorf("Hugging Face недоступен: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("Hugging Face: %s", resp.Status)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

// HFSearch ищет GGUF-модели. sort: downloads | likes | trending | modified.
func HFSearch(ctx context.Context, q, sortBy string) ([]HFModel, error) {
	key := map[string]string{"downloads": "downloads", "likes": "likes", "trending": "trendingScore", "modified": "lastModified"}[sortBy]
	if key == "" {
		key = "downloads"
	}
	v := url.Values{"filter": {"gguf"}, "sort": {key}, "direction": {"-1"}, "limit": {"40"}, "full": {"false"}}
	if strings.TrimSpace(q) != "" {
		v.Set("search", strings.TrimSpace(q))
	}
	var raw []struct {
		ID           string   `json:"id"`
		Author       string   `json:"author"`
		Downloads    int64    `json:"downloads"`
		Likes        int64    `json:"likes"`
		LastModified string   `json:"lastModified"`
		Pipeline     string   `json:"pipeline_tag"`
		Tags         []string `json:"tags"`
	}
	if err := hfGet(ctx, hfBase+"/api/models?"+v.Encode(), &raw); err != nil {
		return nil, err
	}
	out := []HFModel{}
	for _, m := range raw {
		author := m.Author
		if author == "" {
			author, _, _ = strings.Cut(m.ID, "/")
		}
		var tags []string
		for _, t := range m.Tags {
			if strings.Contains(t, ":") || t == "gguf" || strings.HasPrefix(t, "region") {
				continue
			}
			tags = append(tags, t)
			if len(tags) == 6 {
				break
			}
		}
		out = append(out, HFModel{ID: m.ID, Author: author, Downloads: m.Downloads, Likes: m.Likes, Updated: m.LastModified, Pipeline: m.Pipeline, Tags: tags})
	}
	return out, nil
}

var (
	quantRe = regexp.MustCompile(`(?i)(?:^|[-_.])((?:I?Q\d(?:_[0-9A-Z]+)*)|BF16|F16|F32)(?:[-_.]|$)`)
	splitRe = regexp.MustCompile(`-\d{5}-of-\d{5}\.gguf$`)
)

// HFFiles — GGUF-файлы репозитория (варианты квантования) с размерами.
func HFFiles(ctx context.Context, repo string) ([]HFFile, error) {
	if !regexp.MustCompile(`^[\w.-]+/[\w.-]+$`).MatchString(repo) {
		return nil, fmt.Errorf("неверное имя репозитория: %s", repo)
	}
	var raw []struct {
		Type string `json:"type"`
		Path string `json:"path"`
		Size int64  `json:"size"`
		LFS  *struct {
			Size int64 `json:"size"`
		} `json:"lfs"`
	}
	if err := hfGet(ctx, hfBase+"/api/models/"+repo+"/tree/main?recursive=true", &raw); err != nil {
		return nil, err
	}
	byQuant := map[string]*HFFile{}
	for _, f := range raw {
		if f.Type != "file" || !strings.HasSuffix(strings.ToLower(f.Path), ".gguf") {
			continue
		}
		name := f.Path[strings.LastIndex(f.Path, "/")+1:]
		if strings.Contains(strings.ToLower(name), "mmproj") {
			continue // проектор для зрения — Ollama подтянет сам
		}
		size := f.Size
		if f.LFS != nil {
			size = f.LFS.Size
		}
		q := quantOf(name)
		if q == "" {
			continue
		}
		split := splitRe.MatchString(name)
		if cur, ok := byQuant[q]; ok {
			cur.Size += size // части одной модели
			cur.Split = cur.Split || split
			continue
		}
		byQuant[q] = &HFFile{Name: name, Size: size, Quant: q, Split: split}
	}
	out := []HFFile{}
	for _, f := range byQuant {
		out = append(out, *f)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Size < out[j].Size })
	return out, nil
}

// quantOf — тег кванта для ollama: Q4_K_M, IQ3_XS, UD-Q4_K_XL (unsloth).
func quantOf(name string) string {
	base := splitRe.ReplaceAllString(name, ".gguf")
	base = strings.TrimSuffix(base, ".gguf")
	idx := quantRe.FindAllStringSubmatchIndex(base, -1)
	if len(idx) == 0 {
		return ""
	}
	m := idx[len(idx)-1] // последнее вхождение — сам квант
	q := strings.ToUpper(base[m[2]:m[3]])
	if m[2] >= 3 && strings.EqualFold(base[m[2]-3:m[2]-1], "UD") {
		q = "UD-" + q
	}
	return q
}
