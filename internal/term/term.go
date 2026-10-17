// Package term — терминальные сессии (локальные оболочки и SSH), поток байтов в интерфейс.
package term

import (
	"encoding/base64"
	"fmt"
	"io"
	"sync"
	"sync/atomic"

	"golang.org/x/crypto/ssh"
)

type session interface {
	io.Writer
	Resize(cols, rows int) error
	Close() error
}

// Emit отправляет событие в интерфейс (runtime.EventsEmit).
type Emit func(event string, data ...any)

type Manager struct {
	emit Emit
	mu   sync.Mutex
	m    map[string]session
	seq  atomic.Int64
}

func NewManager(emit Emit) *Manager {
	return &Manager{emit: emit, m: map[string]session{}}
}

func (mg *Manager) newID() string { return fmt.Sprintf("term%d", mg.seq.Add(1)) }

// pump читает вывод и отправляет его в интерфейс кусками.
func (mg *Manager) pump(id string, r io.Reader, done func() string) {
	buf := make([]byte, 32*1024)
	for {
		n, err := r.Read(buf)
		if n > 0 {
			mg.emit("term:data", id, base64.StdEncoding.EncodeToString(buf[:n]))
		}
		if err != nil {
			break
		}
	}
	msg := ""
	if done != nil {
		msg = done()
	}
	mg.mu.Lock()
	s := mg.m[id]
	delete(mg.m, id)
	mg.mu.Unlock()
	if s != nil {
		_ = s.Close()
	}
	mg.emit("term:exit", id, msg)
}

func (mg *Manager) add(s session) string {
	id := mg.newID()
	mg.mu.Lock()
	mg.m[id] = s
	mg.mu.Unlock()
	return id
}

func (mg *Manager) get(id string) session {
	mg.mu.Lock()
	defer mg.mu.Unlock()
	return mg.m[id]
}

func (mg *Manager) Write(id, data string) error {
	s := mg.get(id)
	if s == nil {
		return fmt.Errorf("сессия закрыта")
	}
	_, err := s.Write([]byte(data))
	return err
}

func (mg *Manager) Resize(id string, cols, rows int) error {
	if s := mg.get(id); s != nil && cols > 0 && rows > 0 {
		return s.Resize(cols, rows)
	}
	return nil
}

func (mg *Manager) Close(id string) {
	mg.mu.Lock()
	s := mg.m[id]
	delete(mg.m, id)
	mg.mu.Unlock()
	if s != nil {
		_ = s.Close()
	}
}

func (mg *Manager) CloseAll() {
	mg.mu.Lock()
	all := mg.m
	mg.m = map[string]session{}
	mg.mu.Unlock()
	for _, s := range all {
		_ = s.Close()
	}
}

// Info пишет служебную строку (серым) в терминал.
func (mg *Manager) Info(id, text string) {
	mg.emit("term:data", id, base64.StdEncoding.EncodeToString([]byte("\x1b[90m"+text+"\x1b[0m\r\n")))
}

// ---------- SSH ----------

type sshSession struct {
	client *ssh.Client
	sess   *ssh.Session
	stdin  io.WriteCloser
	once   sync.Once
}

func (s *sshSession) Write(p []byte) (int, error) { return s.stdin.Write(p) }
func (s *sshSession) Resize(c, r int) error       { return s.sess.WindowChange(r, c) }
func (s *sshSession) Close() error {
	s.once.Do(func() {
		s.sess.Close()
		s.client.Close()
	})
	return nil
}

// OpenSSH запускает интерактивную оболочку на уже подключённом клиенте.
func (mg *Manager) OpenSSH(client *ssh.Client, cols, rows int) (string, error) {
	sess, err := client.NewSession()
	if err != nil {
		client.Close()
		return "", err
	}
	modes := ssh.TerminalModes{ssh.ECHO: 1, ssh.TTY_OP_ISPEED: 115200, ssh.TTY_OP_OSPEED: 115200}
	if err := sess.RequestPty("xterm-256color", rows, cols, modes); err != nil {
		client.Close()
		return "", err
	}
	stdin, _ := sess.StdinPipe()
	pr, pw := io.Pipe()
	sess.Stdout = pw
	sess.Stderr = pw
	if err := sess.Shell(); err != nil {
		client.Close()
		return "", err
	}
	s := &sshSession{client: client, sess: sess, stdin: stdin}
	id := mg.add(s)
	go func() {
		err := sess.Wait()
		pw.Close()
		_ = err
	}()
	go mg.pump(id, pr, func() string { return "соединение закрыто" })
	return id, nil
}

// OpenLocal запускает локальную оболочку (ConPTY на Windows).
func (mg *Manager) OpenLocal(cmdline, dir string, env []string, cols, rows int) (string, error) {
	s, out, wait, err := startLocal(cmdline, dir, env, cols, rows)
	if err != nil {
		return "", err
	}
	id := mg.add(s)
	go mg.pump(id, out, wait)
	return id, nil
}
