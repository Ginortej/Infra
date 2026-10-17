//go:build windows

package term

import (
	"context"
	"fmt"
	"io"
	"os"
	"sync"
	"time"

	"github.com/UserExistsError/conpty"
)

type localSession struct {
	c    *conpty.ConPty
	once sync.Once
}

func (l *localSession) Write(p []byte) (int, error) { return l.c.Write(p) }
func (l *localSession) Resize(c, r int) error       { return l.c.Resize(c, r) }
func (l *localSession) Close() error {
	l.once.Do(func() {
		if p, err := os.FindProcess(l.c.Pid()); err == nil {
			_ = p.Kill()
		}
		_ = l.c.Close()
	})
	return nil
}

func startLocal(cmdline, dir string, env []string, cols, rows int) (session, io.Reader, func() string, error) {
	c, err := conpty.Start(cmdline, conpty.ConPtyDimensions(cols, rows), conpty.ConPtyWorkDir(dir), conpty.ConPtyEnv(env))
	if err != nil {
		return nil, nil, nil, fmt.Errorf("не удалось запустить %s: %v", cmdline, err)
	}
	ls := &localSession{c: c}
	codeCh := make(chan uint32, 1)
	// Канал вывода ConPTY не закрывается сам после выхода процесса — закрываем вручную.
	go func() {
		code, _ := c.Wait(context.Background())
		time.Sleep(150 * time.Millisecond)
		codeCh <- code
		_ = ls.Close()
	}()
	wait := func() string {
		select {
		case code := <-codeCh:
			return fmt.Sprintf("процесс завершён, код %d", code)
		case <-time.After(2 * time.Second):
			return "сессия закрыта"
		}
	}
	return ls, c, wait, nil
}
