//go:build !windows

package shells

// На Linux/macOS — только для разработки и тестов.
func Detect() []Shell {
	var out []Shell
	for _, s := range []Shell{
		{ID: "bash", Name: "bash", Kind: "bash", Path: firstExisting("/bin/bash", "/usr/bin/bash")},
		{ID: "zsh", Name: "zsh", Kind: "other", Path: firstExisting("/bin/zsh", "/usr/bin/zsh")},
		{ID: "sh", Name: "sh", Kind: "other", Path: firstExisting("/bin/sh")},
	} {
		if s.Path != "" {
			out = append(out, s)
		}
	}
	return out
}
