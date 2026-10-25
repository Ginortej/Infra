//go:build windows

package sysmon

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

// Загрузка видеокарты через счётчики производительности Windows (PDH) — так же считает
// Диспетчер задач: для каждого движка суммируем загрузку по процессам и берём максимальный движок.

var (
	pdh                      = windows.NewLazySystemDLL("pdh.dll")
	pdhOpenQuery             = pdh.NewProc("PdhOpenQueryW")
	pdhAddEnglishCounter     = pdh.NewProc("PdhAddEnglishCounterW")
	pdhCollectQueryData      = pdh.NewProc("PdhCollectQueryData")
	pdhGetFormattedCounterAr = pdh.NewProc("PdhGetFormattedCounterArrayW")
)

const (
	pdhFmtDouble   = 0x00000200
	pdhFmtLarge    = 0x00000400
	pdhFmtNoCap100 = 0x00008000
	pdhMoreData    = 0x800007D2
)

type pdhItem struct {
	name   *uint16
	status uint32
	_      uint32
	value  [8]byte // double или int64
}

type gpuCounters interface{ sample() []GPU }

type pdhGPU struct {
	query, engine, memory uintptr
	adapters              []adapterInfo
}

type adapterInfo struct {
	name  string
	total uint64
}

func nvidiaSmiFallback() string {
	for _, p := range []string{
		filepath.Join(os.Getenv("SystemRoot"), `System32\nvidia-smi.exe`),
		filepath.Join(os.Getenv("ProgramFiles"), `NVIDIA Corporation\NVSMI\nvidia-smi.exe`),
	} {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}

func newGPUCounters() gpuCounters {
	if pdhOpenQuery.Find() != nil {
		return nil
	}
	g := &pdhGPU{adapters: readAdapters()}
	if r, _, _ := pdhOpenQuery.Call(0, 0, uintptr(unsafe.Pointer(&g.query))); r != 0 {
		return nil
	}
	add := func(path string, h *uintptr) bool {
		p, _ := syscall.UTF16PtrFromString(path)
		r, _, _ := pdhAddEnglishCounter.Call(g.query, uintptr(unsafe.Pointer(p)), 0, uintptr(unsafe.Pointer(h)))
		return r == 0
	}
	if !add(`\GPU Engine(*)\Utilization Percentage`, &g.engine) {
		return nil // старая Windows без счётчиков GPU
	}
	add(`\GPU Adapter Memory(*)\Dedicated Usage`, &g.memory)
	pdhCollectQueryData.Call(g.query)
	return g
}

func (g *pdhGPU) array(counter uintptr, format uint32) map[string][8]byte {
	res := map[string][8]byte{}
	if counter == 0 {
		return res
	}
	var size, count uint32
	r, _, _ := pdhGetFormattedCounterAr.Call(counter, uintptr(format), uintptr(unsafe.Pointer(&size)), uintptr(unsafe.Pointer(&count)), 0)
	if r != pdhMoreData || size == 0 {
		return res
	}
	buf := make([]byte, size)
	r, _, _ = pdhGetFormattedCounterAr.Call(counter, uintptr(format), uintptr(unsafe.Pointer(&size)), uintptr(unsafe.Pointer(&count)), uintptr(unsafe.Pointer(&buf[0])))
	if r != 0 {
		return res
	}
	items := unsafe.Slice((*pdhItem)(unsafe.Pointer(&buf[0])), count)
	for _, it := range items {
		if it.status != 0 && it.status != 1 { // PDH_CSTATUS_VALID_DATA / NEW_DATA
			continue
		}
		res[windows.UTF16PtrToString(it.name)] = it.value
	}
	return res
}

var engRe = regexp.MustCompile(`pid_\d+_(luid_[0-9a-fx]+_[0-9a-fx]+_phys_\d+_eng_\d+_engtype_.*)$`)

func (g *pdhGPU) sample() []GPU {
	if r, _, _ := pdhCollectQueryData.Call(g.query); r != 0 {
		return []GPU{}
	}
	// загрузка: сумма по процессам для каждого движка, затем максимум по движкам
	perEngine := map[string]float64{}
	for name, v := range g.array(g.engine, pdhFmtDouble|pdhFmtNoCap100) {
		key := name
		if m := engRe.FindStringSubmatch(name); m != nil {
			key = m[1]
		}
		perEngine[key] += *(*float64)(unsafe.Pointer(&v[0]))
	}
	util := 0.0
	for _, v := range perEngine {
		if v > util {
			util = v
		}
	}
	if util > 100 {
		util = 100
	}
	var used uint64
	for _, v := range g.array(g.memory, pdhFmtLarge) {
		if n := *(*int64)(unsafe.Pointer(&v[0])); n > 0 && uint64(n) > used {
			used = uint64(n) // берём самый загруженный адаптер (обычно дискретная карта)
		}
	}
	out := GPU{Name: "GPU", Util: util, MemUsed: used, Source: "pdh"}
	if len(g.adapters) > 0 {
		out.Name, out.MemTotal = g.adapters[0].name, g.adapters[0].total
	}
	return []GPU{out}
}

// readAdapters — видеокарты из реестра (имя и объём памяти), крупнейшая первой.
func readAdapters() []adapterInfo {
	const class = `SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}`
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, class, registry.ENUMERATE_SUB_KEYS)
	if err != nil {
		return nil
	}
	defer k.Close()
	names, _ := k.ReadSubKeyNames(-1)
	var res []adapterInfo
	for _, n := range names {
		if len(n) != 4 {
			continue
		}
		sk, err := registry.OpenKey(k, n, registry.QUERY_VALUE)
		if err != nil {
			continue
		}
		desc, _, _ := sk.GetStringValue("DriverDesc")
		var total uint64
		if v, _, err := sk.GetIntegerValue("HardwareInformation.qwMemorySize"); err == nil {
			total = v
		} else if b, _, err := sk.GetBinaryValue("HardwareInformation.MemorySize"); err == nil && len(b) >= 4 {
			total = uint64(b[0]) | uint64(b[1])<<8 | uint64(b[2])<<16 | uint64(b[3])<<24
		}
		sk.Close()
		if desc != "" && !strings.Contains(strings.ToLower(desc), "basic") {
			res = append(res, adapterInfo{desc, total})
		}
	}
	sort.Slice(res, func(i, j int) bool { return res[i].total > res[j].total })
	return res
}
