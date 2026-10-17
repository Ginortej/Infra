//go:build !windows

package term

import (
	"errors"
	"io"
)

func startLocal(cmdline, dir string, env []string, cols, rows int) (session, io.Reader, func() string, error) {
	return nil, nil, nil, errors.New("локальный терминал поддерживается только в Windows")
}
