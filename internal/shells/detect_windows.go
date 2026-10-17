//go:build windows

package shells

import "path/filepath"

func Detect() []Shell {
	var out []Shell
	add := func(s Shell) {
		if s.Path != "" {
			out = append(out, s)
		}
	}
	sys := filepath.Join(env("SystemRoot"), "System32")

	add(Shell{ID: "pwsh", Name: "PowerShell 7", Kind: "powershell", Args: []string{"-NoLogo"},
		Path: firstExisting(append(pf(`PowerShell\7\pwsh.exe`), look("pwsh.exe"))...)})
	add(Shell{ID: "powershell", Name: "Windows PowerShell", Kind: "powershell", Args: []string{"-NoLogo"},
		Path: firstExisting(filepath.Join(sys, `WindowsPowerShell\v1.0\powershell.exe`), look("powershell.exe"))})
	add(Shell{ID: "cmd", Name: "Командная строка", Kind: "cmd",
		Path: firstExisting(env("ComSpec"), filepath.Join(sys, "cmd.exe"))})

	gitBash := firstExisting(append(pf(`Git\bin\bash.exe`), filepath.Join(env("LOCALAPPDATA"), `Programs\Git\bin\bash.exe`))...)
	if gitBash == "" {
		if g := look("git.exe"); g != "" {
			gitBash = firstExisting(filepath.Join(filepath.Dir(filepath.Dir(g)), `bin\bash.exe`))
		}
	}
	add(Shell{ID: "gitbash", Name: "Git Bash", Kind: "bash", Path: gitBash, Args: []string{"--login", "-i"}})
	add(Shell{ID: "msys2", Name: "MSYS2", Kind: "bash", Path: firstExisting(`C:\msys64\usr\bin\bash.exe`), Args: []string{"--login", "-i"}})
	add(Shell{ID: "cygwin", Name: "Cygwin", Kind: "bash", Path: firstExisting(`C:\cygwin64\bin\bash.exe`), Args: []string{"--login", "-i"}})
	add(Shell{ID: "nu", Name: "Nushell", Kind: "other", Path: look("nu.exe")})

	if wsl := look("wsl.exe"); wsl != "" {
		for _, d := range WSLDistros() {
			add(Shell{ID: "wsl:" + d, Name: "WSL · " + d, Kind: "wsl", Path: wsl, Args: []string{"-d", d, "--cd", "~"}})
		}
	}
	return out
}
