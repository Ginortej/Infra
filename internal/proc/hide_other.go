//go:build !windows

package proc

import "os/exec"

func hideWindow(cmd *exec.Cmd) {}
