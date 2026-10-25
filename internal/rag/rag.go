// Package rag — маленькая база знаний: папка knowledge/ хранилища (*.md, *.txt) режется на
// фрагменты и ищется гибридно — BM25 по словам (работает всегда) плюс векторы через
// модель эмбеддингов Ollama, если она скачана. Результаты объединяются через RRF.
package rag

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"io/fs"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
)

type Chunk struct {
	File    string    `json:"file"` // путь относительно knowledge/
	Heading string    `json:"heading"`
	Text    string    `json:"text"`
	vec     []float32 // эмбеддинг
	terms   map[string]int
	length  int
}

type Hit struct {
	File    string  `json:"file"`
	Heading string  `json:"heading"`
	Text    string  `json:"text"`
	Score   float64 `json:"score"`  // итоговый (RRF)
	Words   float64 `json:"words"`  // BM25
	Vector  float64 `json:"vector"` // косинусная близость, 0 если векторов нет
}

type Stats struct {
	Root     string `json:"root"`
	Files    int    `json:"files"`
	Chunks   int    `json:"chunks"`
	Vectors  bool   `json:"vectors"` // есть ли эмбеддинги
	Model    string `json:"model"`
	Built    int64  `json:"built"`
	Error    string `json:"error"`
	Building bool   `json:"building"`
}

// Embedder — функция получения векторов (nil — только поиск по словам).
type Embedder func(ctx context.Context, texts []string) ([][]float32, error)

type Index struct {
	mu       sync.RWMutex
	root     string // папка knowledge
	cache    string // файл кэша векторов
	model    string
	chunks   []Chunk
	df       map[string]int
	avgLen   float64
	sig      string // отпечаток файлов (пути + время + размер)
	built    time.Time
	err      string
	vectors  bool
	building bool
}

func New(root, cacheFile string) *Index { return &Index{root: root, cache: cacheFile} }

func (x *Index) Root() string { return x.root }

func (x *Index) Stats() Stats {
	x.mu.RLock()
	defer x.mu.RUnlock()
	files := map[string]bool{}
	for _, c := range x.chunks {
		files[c.File] = true
	}
	return Stats{Root: x.root, Files: len(files), Chunks: len(x.chunks), Vectors: x.vectors, Model: x.model, Built: x.built.Unix(), Error: x.err, Building: x.building}
}

func isDoc(p string) bool {
	e := strings.ToLower(filepath.Ext(p))
	return e == ".md" || e == ".txt" || e == ".markdown"
}

// signature — изменилось ли что-то в папке.
func (x *Index) signature() string {
	h := sha1.New()
	_ = filepath.WalkDir(x.root, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !isDoc(p) {
			return nil
		}
		if st, err := d.Info(); err == nil {
			h.Write([]byte(p + "|" + st.ModTime().String() + "|" + strconv.FormatInt(st.Size(), 10) + "\n"))
		}
		return nil
	})
	return hex.EncodeToString(h.Sum(nil))
}

// Ensure пересобирает индекс, если файлы или модель эмбеддингов поменялись.
func (x *Index) Ensure(ctx context.Context, model string, embed Embedder) error {
	sig := x.signature()
	x.mu.RLock()
	fresh := sig == x.sig && model == x.model && (embed == nil || x.vectors || x.err != "")
	x.mu.RUnlock()
	if fresh {
		return nil
	}
	return x.Build(ctx, model, embed)
}

// Build читает все документы и строит индекс заново.
func (x *Index) Build(ctx context.Context, model string, embed Embedder) error {
	x.mu.Lock()
	x.building = true
	x.mu.Unlock()
	defer func() { x.mu.Lock(); x.building = false; x.mu.Unlock() }()

	sig := x.signature()
	var chunks []Chunk
	_ = filepath.WalkDir(x.root, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !isDoc(p) {
			return nil
		}
		b, err := os.ReadFile(p)
		if err != nil || len(b) > 2<<20 {
			return nil
		}
		rel, _ := filepath.Rel(x.root, p)
		rel = filepath.ToSlash(rel)
		for _, c := range Split(string(b), 900) {
			c.File = rel
			chunks = append(chunks, c)
		}
		return nil
	})
	df := map[string]int{}
	total := 0
	for i := range chunks {
		c := &chunks[i]
		c.terms = map[string]int{}
		for _, t := range Tokens(c.Heading + " " + c.Heading + " " + c.Text) {
			c.terms[t]++
			c.length++
		}
		total += c.length
		for t := range c.terms {
			df[t]++
		}
	}
	avg := 1.0
	if len(chunks) > 0 {
		avg = float64(total) / float64(len(chunks))
	}
	errText := ""
	vectors := false
	if embed != nil && len(chunks) > 0 {
		if err := x.embedAll(ctx, model, embed, chunks); err != nil {
			errText = "векторы не построены: " + err.Error() + " — работает поиск по словам"
		} else {
			vectors = true
		}
	}
	x.mu.Lock()
	x.chunks, x.df, x.avgLen, x.sig, x.model, x.built, x.err, x.vectors = chunks, df, avg, sig, model, time.Now(), errText, vectors
	x.mu.Unlock()
	return nil
}

func hashText(model, s string) string {
	h := sha1.Sum([]byte(model + "\x00" + s))
	return hex.EncodeToString(h[:])
}

func (x *Index) embedAll(ctx context.Context, model string, embed Embedder, chunks []Chunk) error {
	cache := map[string][]float32{}
	if x.cache != "" {
		if b, err := os.ReadFile(x.cache); err == nil {
			_ = json.Unmarshal(b, &cache)
		}
	}
	var need []int
	for i := range chunks {
		if v, ok := cache[hashText(model, chunks[i].Heading+"\n"+chunks[i].Text)]; ok {
			chunks[i].vec = v
		} else {
			need = append(need, i)
		}
	}
	for start := 0; start < len(need); start += 16 {
		end := min(start+16, len(need))
		var texts []string
		for _, i := range need[start:end] {
			texts = append(texts, chunks[i].Heading+"\n"+chunks[i].Text)
		}
		vecs, err := embed(ctx, texts)
		if err != nil {
			return err
		}
		for j, i := range need[start:end] {
			chunks[i].vec = normVec(vecs[j])
		}
	}
	if x.cache != "" && len(need) > 0 {
		keep := map[string][]float32{}
		for _, c := range chunks {
			keep[hashText(model, c.Heading+"\n"+c.Text)] = c.vec
		}
		if b, err := json.Marshal(keep); err == nil {
			_ = os.MkdirAll(filepath.Dir(x.cache), 0o755)
			_ = os.WriteFile(x.cache, b, 0o644)
		}
	}
	return nil
}

func normVec(v []float32) []float32 {
	var s float64
	for _, f := range v {
		s += float64(f) * float64(f)
	}
	n := float32(math.Sqrt(s))
	if n == 0 {
		return v
	}
	out := make([]float32, len(v))
	for i, f := range v {
		out[i] = f / n
	}
	return out
}

func dot(a, b []float32) float64 {
	if len(a) != len(b) {
		return 0
	}
	var s float64
	for i := range a {
		s += float64(a[i]) * float64(b[i])
	}
	return s
}

// Search ищет k лучших фрагментов. embed — для вектора запроса (nil — только слова).
func (x *Index) Search(ctx context.Context, q string, k int, embed Embedder) []Hit {
	x.mu.RLock()
	defer x.mu.RUnlock()
	if len(x.chunks) == 0 {
		return nil
	}
	if k <= 0 {
		k = 4
	}
	n := float64(len(x.chunks))
	qt := Tokens(q)
	bm := make([]float64, len(x.chunks))
	const k1, b = 1.4, 0.75
	for i, c := range x.chunks {
		var s float64
		for _, t := range uniq(qt) {
			f := float64(c.terms[t])
			if f == 0 {
				continue
			}
			idf := math.Log(1 + (n-float64(x.df[t])+0.5)/(float64(x.df[t])+0.5))
			s += idf * f * (k1 + 1) / (f + k1*(1-b+b*float64(c.length)/x.avgLen))
		}
		bm[i] = s
	}
	vs := make([]float64, len(x.chunks))
	useVec := false
	if x.vectors && embed != nil {
		if v, err := embed(ctx, []string{q}); err == nil && len(v) == 1 {
			qv := normVec(v[0])
			for i, c := range x.chunks {
				vs[i] = dot(qv, c.vec)
			}
			useVec = true
		}
	}
	rank := func(score []float64, ok func(int) bool) map[int]int {
		idx := make([]int, 0, len(score))
		for i := range score {
			if ok(i) {
				idx = append(idx, i)
			}
		}
		sort.SliceStable(idx, func(a, b int) bool { return score[idx[a]] > score[idx[b]] })
		r := map[int]int{}
		for pos, i := range idx {
			r[i] = pos + 1
		}
		return r
	}
	rb := rank(bm, func(i int) bool { return bm[i] > 0 })
	rv := map[int]int{}
	if useVec {
		rv = rank(vs, func(i int) bool { return vs[i] > 0.35 })
	}
	var hits []Hit
	for i, c := range x.chunks {
		s := 0.0
		if r, ok := rb[i]; ok {
			s += 1 / float64(60+r)
		}
		if r, ok := rv[i]; ok {
			s += 1 / float64(60+r)
		}
		if s == 0 {
			continue
		}
		hits = append(hits, Hit{File: c.File, Heading: c.Heading, Text: c.Text, Score: s, Words: bm[i], Vector: vs[i]})
	}
	sort.SliceStable(hits, func(a, b int) bool { return hits[a].Score > hits[b].Score })
	if len(hits) > k {
		hits = hits[:k]
	}
	return hits
}

func uniq(s []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, x := range s {
		if !seen[x] {
			seen[x] = true
			out = append(out, x)
		}
	}
	return out
}

// ---------- Разбиение и токены ----------

// Split режет markdown по заголовкам, а длинные разделы — по абзацам до ~size символов.
func Split(text string, size int) []Chunk {
	var out []Chunk
	heading := ""
	var buf []string
	blen := 0
	flush := func() {
		t := strings.TrimSpace(strings.Join(buf, "\n"))
		if t != "" {
			out = append(out, Chunk{Heading: heading, Text: t})
		}
		buf, blen = nil, 0
	}
	inCode := false
	for _, line := range strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n") {
		trim := strings.TrimSpace(line)
		if strings.HasPrefix(trim, "```") {
			inCode = !inCode
		}
		if !inCode && strings.HasPrefix(trim, "#") && strings.TrimLeft(trim, "#") != trim && strings.HasPrefix(strings.TrimLeft(trim, "#"), " ") {
			flush()
			heading = strings.TrimSpace(strings.TrimLeft(trim, "#"))
			continue
		}
		if !inCode && trim == "" && blen >= size {
			flush()
			continue
		}
		if blen+len(line) > size*2 && !inCode {
			flush()
		}
		buf = append(buf, line)
		blen += len(line) + 1
	}
	flush()
	return out
}

var stop = map[string]bool{}

func init() {
	for _, w := range strings.Fields("и в во не на с со что как а но или по к ко из у о об от до за для при это то же ли бы да нет его её их он она они мы вы ты я так все всё уже ещё the a an of to in on and or is are be for with by at as it this that from") {
		stop[w] = true
	}
}

// Tokens — слова в нижнем регистре с грубым стеммингом (обрезка окончаний), без стоп-слов.
func Tokens(s string) []string {
	var out []string
	for _, w := range strings.FieldsFunc(strings.ToLower(s), func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != '_' }) {
		if len([]rune(w)) < 2 || stop[w] {
			continue
		}
		r := []rune(w)
		if len(r) > 6 && unicode.Is(unicode.Cyrillic, r[0]) {
			r = r[:len(r)-2]
			if len(r) > 7 {
				r = r[:7]
			}
		} else if len(r) > 5 && !unicode.Is(unicode.Cyrillic, r[0]) {
			w2 := strings.TrimSuffix(strings.TrimSuffix(strings.TrimSuffix(string(r), "ing"), "es"), "s")
			r = []rune(w2)
		}
		out = append(out, string(r))
	}
	return out
}
