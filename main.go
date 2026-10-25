package main

import (
	"embed"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"strconv"
	"strings"

	"infra/internal/mcp"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	// Infra.exe mcp — stdio-мост для Claude Desktop и других MCP-клиентов
	if len(os.Args) > 1 && os.Args[1] == "mcp" {
		if err := mcp.Bridge(os.Stdin, os.Stdout, launchSelf); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}
	app := NewApp()
	err := wails.Run(&options.App{
		Title:            "Infra",
		Width:            1360,
		Height:           860,
		MinWidth:         900,
		MinHeight:        560,
		Frameless:        true,
		BackgroundColour: &options.RGBA{R: 27, G: 28, B: 31, A: 255},
		AssetServer:      &assetserver.Options{Assets: assets},
		OnStartup:        app.startup,
		OnShutdown:       app.shutdown,
		Bind:             []interface{}{app},
		Windows: &windows.Options{
			WebviewIsTransparent: false,
			WindowIsTranslucent:  false,
			DisableWindowIcon:    false,
			Theme:                windows.Dark,
		},
	})
	if err != nil {
		log.Fatal(err)
	}
}

// launchSelf запускает окно Infra для stdio-моста, если оно ещё не открыто.
func launchSelf() error {
	if b, err := os.ReadFile(pidPath()); err == nil {
		if pid, err := strconv.Atoi(strings.TrimSpace(string(b))); err == nil && processAlive(pid) {
			return errors.New("Infra открыта, но MCP выключен — включи его: Infra → ИИ → MCP")
		}
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	cmd := exec.Command(exe)
	return cmd.Start()
}
