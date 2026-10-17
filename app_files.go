package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

type sshClient ssh.Client

// sftpPool держит по одному SFTP-соединению на сервер.
type sftpPool struct {
	dial func(id string) (*sshClient, error)
	mu   sync.Mutex
	m    map[string]*sftpConn
}

type sftpConn struct {
	ssh  *ssh.Client
	sftp *sftp.Client
}

func (p *sftpPool) get(id string) (*sftp.Client, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.m == nil {
		p.m = map[string]*sftpConn{}
	}
	if c, ok := p.m[id]; ok {
		if _, err := c.sftp.Getwd(); err == nil {
			return c.sftp, nil
		}
		c.sftp.Close()
		c.ssh.Close()
		delete(p.m, id)
	}
	sc, err := p.dial(id)
	if err != nil {
		return nil, err
	}
	cl := (*ssh.Client)(sc)
	fc, err := sftp.NewClient(cl)
	if err != nil {
		cl.Close()
		return nil, fmt.Errorf("SFTP недоступен: %v", err)
	}
	p.m[id] = &sftpConn{cl, fc}
	return fc, nil
}

func (p *sftpPool) closeAll() {
	if p == nil {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, c := range p.m {
		c.sftp.Close()
		c.ssh.Close()
	}
	p.m = nil
}

type FileEntry struct {
	Name  string `json:"name"`
	Dir   bool   `json:"dir"`
	Size  int64  `json:"size"`
	Mtime int64  `json:"mtime"`
}

type Listing struct {
	Path    string      `json:"path"`
	Parent  string      `json:"parent"`
	Entries []FileEntry `json:"entries"`
}

func sortEntries(e []FileEntry) {
	sort.Slice(e, func(i, j int) bool {
		if e[i].Dir != e[j].Dir {
			return e[i].Dir
		}
		return strings.ToLower(e[i].Name) < strings.ToLower(e[j].Name)
	})
}

// LocalHome — стартовая папка для левой панели.
func (a *App) LocalHome() string {
	if v := a.Vault(); v != nil {
		return v.Root
	}
	h, _ := os.UserHomeDir()
	return h
}

func (a *App) LocalList(dir string) (Listing, error) {
	if dir == "" {
		dir = a.LocalHome()
	}
	dir = filepath.Clean(dir)
	ents, err := os.ReadDir(dir)
	if err != nil {
		return Listing{}, err
	}
	l := Listing{Path: dir, Parent: filepath.Dir(dir)}
	if l.Parent == dir {
		l.Parent = ""
	}
	for _, e := range ents {
		info, err := e.Info()
		if err != nil {
			continue
		}
		l.Entries = append(l.Entries, FileEntry{Name: e.Name(), Dir: e.IsDir(), Size: info.Size(), Mtime: info.ModTime().Unix()})
	}
	sortEntries(l.Entries)
	return l, nil
}

func (a *App) RemoteList(serverID, dir string) (Listing, error) {
	c, err := a.sftp.get(serverID)
	if err != nil {
		if err.Error() == "NEED_PASSWORD" {
			return Listing{}, errors.New("NEED_PASSWORD")
		}
		return Listing{}, err
	}
	if dir == "" {
		if dir, err = c.Getwd(); err != nil {
			dir = "/"
		}
	}
	ents, err := c.ReadDir(dir)
	if err != nil {
		return Listing{}, err
	}
	l := Listing{Path: dir, Parent: path.Dir(dir)}
	if dir == "/" {
		l.Parent = ""
	}
	for _, e := range ents {
		l.Entries = append(l.Entries, FileEntry{Name: e.Name(), Dir: e.IsDir(), Size: e.Size(), Mtime: e.ModTime().Unix()})
	}
	sortEntries(l.Entries)
	return l, nil
}

func (a *App) RemoteMkdir(serverID, dir string) error {
	c, err := a.sftp.get(serverID)
	if err != nil {
		return err
	}
	return c.MkdirAll(dir)
}

func (a *App) RemoteDelete(serverID, p string) error {
	c, err := a.sftp.get(serverID)
	if err != nil {
		return err
	}
	st, err := c.Stat(p)
	if err != nil {
		return err
	}
	if st.IsDir() {
		return c.RemoveAll(p)
	}
	return c.Remove(p)
}

// progressWriter считает переданные байты.
type counter struct {
	total, done int64
	last        time.Time
	report      func(pct int, msg string)
	name        string
}

func (c *counter) add(n int) {
	c.done += int64(n)
	if time.Since(c.last) > 200*time.Millisecond && c.total > 0 {
		c.last = time.Now()
		c.report(int(c.done*100/c.total), fmt.Sprintf("%s · %s / %s", c.name, human(c.done), human(c.total)))
	}
}

type countW struct {
	w io.Writer
	c *counter
}

func (w countW) Write(p []byte) (int, error) { n, err := w.w.Write(p); w.c.add(n); return n, err }

func human(n int64) string {
	f := float64(n)
	for _, u := range []string{"B", "KB", "MB", "GB"} {
		if f < 1024 {
			return fmt.Sprintf("%.1f %s", f, u)
		}
		f /= 1024
	}
	return fmt.Sprintf("%.1f TB", f)
}

// Upload копирует файлы/папки с этого ПК в папку на сервере.
func (a *App) Upload(serverID string, locals []string, remoteDir string) (string, error) {
	c, err := a.sftp.get(serverID)
	if err != nil {
		return "", err
	}
	title := fmt.Sprintf("Загрузка на %s", serverID)
	return a.job(title, func(ctx context.Context, progress func(int, string)) error {
		cnt := &counter{report: progress}
		for _, l := range locals {
			_ = filepath.Walk(l, func(_ string, info os.FileInfo, err error) error {
				if err == nil && !info.IsDir() {
					cnt.total += info.Size()
				}
				return nil
			})
		}
		for _, l := range locals {
			base := filepath.Dir(l)
			err := filepath.Walk(l, func(p string, info os.FileInfo, err error) error {
				if err != nil {
					return err
				}
				rel, _ := filepath.Rel(base, p)
				dst := path.Join(remoteDir, filepath.ToSlash(rel))
				if info.IsDir() {
					return c.MkdirAll(dst)
				}
				cnt.name = info.Name()
				src, err := os.Open(p)
				if err != nil {
					return err
				}
				defer src.Close()
				out, err := c.Create(dst)
				if err != nil {
					return fmt.Errorf("%s: %v", dst, err)
				}
				defer out.Close()
				_, err = io.Copy(countW{out, cnt}, src)
				return err
			})
			if err != nil {
				return err
			}
		}
		a.emit("files:changed", serverID)
		return nil
	}), nil
}

// Download копирует файлы/папки с сервера в папку на этом ПК.
func (a *App) Download(serverID string, remotes []string, localDir string) (string, error) {
	c, err := a.sftp.get(serverID)
	if err != nil {
		return "", err
	}
	title := fmt.Sprintf("Скачивание с %s", serverID)
	return a.job(title, func(ctx context.Context, progress func(int, string)) error {
		cnt := &counter{report: progress}
		for _, r := range remotes {
			w := c.Walk(r)
			for w.Step() {
				if w.Err() == nil && !w.Stat().IsDir() {
					cnt.total += w.Stat().Size()
				}
			}
		}
		for _, r := range remotes {
			base := path.Dir(r)
			w := c.Walk(r)
			for w.Step() {
				if err := w.Err(); err != nil {
					return err
				}
				rel := strings.TrimPrefix(strings.TrimPrefix(w.Path(), base), "/")
				dst := filepath.Join(localDir, filepath.FromSlash(rel))
				if w.Stat().IsDir() {
					if err := os.MkdirAll(dst, 0o755); err != nil {
						return err
					}
					continue
				}
				cnt.name = w.Stat().Name()
				if err := func() error {
					src, err := c.Open(w.Path())
					if err != nil {
						return err
					}
					defer src.Close()
					out, err := os.Create(dst)
					if err != nil {
						return err
					}
					defer out.Close()
					_, err = io.Copy(countW{out, cnt}, src)
					return err
				}(); err != nil {
					return fmt.Errorf("%s: %v", w.Path(), err)
				}
			}
		}
		a.emit("files:changed", "local")
		return nil
	}), nil
}
