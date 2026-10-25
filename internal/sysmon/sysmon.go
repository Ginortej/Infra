// Package sysmon — загрузка CPU, память, видеокарта (для виджета в заголовке).
package sysmon

import (
	"context"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/mem"

	"infra/internal/proc"
)

type GPU struct {
	Name     string  `json:"name"`
	Util     float64 `json:"util"`     // %
	MemUsed  uint64  `json:"memUsed"`  // байты
	MemTotal uint64  `json:"memTotal"` // байты (0 — неизвестно)
	Temp     float64 `json:"temp"`     // °C (0 — неизвестно)
	Source   string  `json:"source"`   // nvidia-smi | pdh
}

type Stats struct {
	CPU      float64 `json:"cpu"`
	Cores    int     `json:"cores"`
	RAMUsed  uint64  `json:"ramUsed"`
	RAMTotal uint64  `json:"ramTotal"`
	GPUs     []GPU   `json:"gpus"`
	Time     int64   `json:"time"`
}

type Monitor struct {
	mu     sync.Mutex
	nvsmi  string
	nvOK   bool
	pdh    gpuCounters // Windows: счётчики «GPU Engine» (как в Диспетчере задач)
	cores  int
	primed bool
}

func New() *Monitor {
	m := &Monitor{}
	if p, err := exec.LookPath("nvidia-smi"); err == nil {
		m.nvsmi, m.nvOK = p, true
	} else if p := nvidiaSmiFallback(); p != "" {
		m.nvsmi, m.nvOK = p, true
	}
	m.cores, _ = cpu.Counts(true)
	m.pdh = newGPUCounters()
	return m
}

// Sample — текущие значения. CPU считается с момента прошлого вызова.
func (m *Monitor) Sample() Stats {
	m.mu.Lock()
	defer m.mu.Unlock()
	st := Stats{Cores: m.cores, Time: time.Now().Unix(), GPUs: []GPU{}}
	if !m.primed { // первое измерение CPU «с нуля» бессмысленно — берём короткий интервал
		if p, err := cpu.Percent(200*time.Millisecond, false); err == nil && len(p) > 0 {
			st.CPU = p[0]
		}
		m.primed = true
	} else if p, err := cpu.Percent(0, false); err == nil && len(p) > 0 {
		st.CPU = p[0]
	}
	if v, err := mem.VirtualMemory(); err == nil {
		st.RAMUsed, st.RAMTotal = v.Used, v.Total
	}
	if m.nvOK {
		if g, err := m.nvidia(); err == nil && len(g) > 0 {
			st.GPUs = g
			return st
		}
	}
	if m.pdh != nil {
		st.GPUs = m.pdh.sample()
	}
	return st
}

func (m *Monitor) nvidia() ([]GPU, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	out, err := proc.Output(ctx, m.nvsmi, "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu", "--format=csv,noheader,nounits")
	if err != nil {
		return nil, err
	}
	return ParseNvidiaSmi(out), nil
}

// ParseNvidiaSmi разбирает вывод nvidia-smi (CSV, МиБ).
func ParseNvidiaSmi(out string) []GPU {
	var res []GPU
	for _, l := range strings.Split(strings.TrimSpace(out), "\n") {
		f := strings.Split(l, ",")
		if len(f) < 4 {
			continue
		}
		num := func(s string) float64 { v, _ := strconv.ParseFloat(strings.TrimSpace(s), 64); return v }
		g := GPU{Name: strings.TrimSpace(f[0]), Util: num(f[1]), MemUsed: uint64(num(f[2]) * 1024 * 1024), MemTotal: uint64(num(f[3]) * 1024 * 1024), Source: "nvidia-smi"}
		if len(f) > 4 {
			g.Temp = num(f[4])
		}
		res = append(res, g)
	}
	return res
}
