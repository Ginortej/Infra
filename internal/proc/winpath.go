package proc

import "strings"

// ToWSL переводит путь Windows в путь внутри WSL: C:\a\b -> /mnt/c/a/b.
func ToWSL(p string) string {
	p = strings.ReplaceAll(p, "\\", "/")
	if len(p) >= 2 && p[1] == ':' {
		return "/mnt/" + strings.ToLower(p[:1]) + p[2:]
	}
	return p
}

// ShellQuote заключает строку в одинарные кавычки для bash.
func ShellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}
