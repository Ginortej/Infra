package main

import (
	"context"
	"errors"
	"os"
	"strings"
	"time"

	"infra/internal/ai"
	"infra/internal/sysmon"
	"infra/internal/vault"
)

// ---------- Мониторинг ----------

func (a *App) SysStats() sysmon.Stats { return a.mon.Sample() }

// ---------- Локальный ИИ (Ollama) ----------

func (a *App) AIStatus() ai.Status {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	return a.ollama.Status(ctx)
}

func (a *App) AIStartServer() error {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	return a.ollama.EnsureServer(ctx)
}

func (a *App) AIUnload(model string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return a.ollama.Unload(ctx, model)
}

// AISetPrefs запоминает модель по умолчанию и свою команду запуска.
func (a *App) AISetPrefs(model, command string) error {
	a.mu.Lock()
	a.settings.AIModel = model
	a.settings.AICommand = command
	s := a.settings
	a.mu.Unlock()
	return vault.SaveSettings(s)
}

// AIOpen открывает вкладку-терминал с моделью.
//
//	mode "run"  — ollama run <model> (чат)
//	mode "pull" — ollama pull <model> (скачать модель)
//	mode "custom" — своя команда (LM Studio, llama.cpp…), {model} подставляется
func (a *App) AIOpen(model, mode, custom string, cols, rows int) (string, error) {
	env := append(os.Environ(), "TERM=xterm-256color", "COLORTERM=truecolor")
	dir, _ := os.UserHomeDir()
	var cmdline string
	switch mode {
	case "custom":
		if strings.TrimSpace(custom) == "" {
			return "", errors.New("не задана команда запуска")
		}
		cmdline = strings.ReplaceAll(custom, "{model}", model)
	case "run", "pull":
		if model == "" {
			return "", errors.New("не выбрана модель")
		}
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		err := a.ollama.EnsureServer(ctx)
		cancel()
		if err != nil {
			return "", err
		}
		cmdline = ai.Quote(ai.Path()) + " " + mode + " " + ai.Quote(model)
	default:
		return "", errors.New("неизвестный режим")
	}
	return a.terms.OpenLocal(cmdline, dir, env, cols, rows)
}
