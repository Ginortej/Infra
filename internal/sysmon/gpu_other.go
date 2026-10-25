//go:build !windows

package sysmon

type gpuCounters interface{ sample() []GPU }

func newGPUCounters() gpuCounters { return nil }
func nvidiaSmiFallback() string   { return "" }
