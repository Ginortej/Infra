// Package proc запускает внешние программы без всплывающих окон консоли.
package proc

import (
	"bytes"
	"context"
	"os/exec"
	"strings"
	"unicode/utf16"
)

// Command создаёт команду, у которой на Windows не появляется окно консоли.
func Command(ctx context.Context, name string, args ...string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, name, args...)
	hideWindow(cmd)
	return cmd
}

// Output запускает команду и возвращает stdout+stderr одной строкой.
func Output(ctx context.Context, name string, args ...string) (string, error) {
	cmd := Command(ctx, name, args...)
	var b bytes.Buffer
	cmd.Stdout = &b
	cmd.Stderr = &b
	err := cmd.Run()
	return DecodeMaybeUTF16(b.Bytes()), err
}

// DecodeMaybeUTF16 нужен для wsl.exe, который пишет в UTF-16LE.
func DecodeMaybeUTF16(b []byte) string {
	if len(b) >= 2 && len(b)%2 == 0 {
		zeros := 0
		for i := 1; i < len(b); i += 2 {
			if b[i] == 0 {
				zeros++
			}
		}
		if zeros > len(b)/4 {
			u := make([]uint16, 0, len(b)/2)
			for i := 0; i+1 < len(b); i += 2 {
				u = append(u, uint16(b[i])|uint16(b[i+1])<<8)
			}
			s := string(utf16.Decode(u))
			return strings.TrimPrefix(s, "\ufeff")
		}
	}
	return string(b)
}
