package vault

import (
	"os"
	"path/filepath"

	"infra/internal/guard"
)

// RulesFile — файл политики безопасности для ИИ.
const RulesFile = "knowledge/security/rules.yaml"

// Knowledge — стартовая база знаний: её читают агенты (search_knowledge) и проверка перед действиями.
var Knowledge = map[string]string{
	"knowledge/README.md": `# База знаний

Сюда кладутся заметки, которые должны знать ИИ-агенты: политики безопасности, ранбуки,
описание сервисов, особенности серверов. Формат — обычный Markdown (*.md, *.txt).

Как это работает:

- Infra режет файлы на фрагменты по заголовкам и ищет по ним: по словам всегда,
  а если скачана модель эмбеддингов (nomic-embed-text) — ещё и по смыслу.
- Агенты ищут здесь инструментом search_knowledge перед действиями на серверах.
- Когда агент хочет выполнить опасное действие, в карточке подтверждения показываются
  найденные правила — видно, что говорит политика про эту команду.
- security/rules.yaml — машинные правила: что запрещено, что требует особого
  подтверждения, какие серверы только для чтения, какие секреты скрывать.

Пиши коротко и конкретно, с заголовками: один заголовок — одна тема.
`,
	"knowledge/security/policy.md": `# Политика безопасности серверов

## Доступ по SSH
- Вход только по ключам, пароли отключены (PasswordAuthentication no).
- Вход под root запрещён (PermitRootLogin no), работаем через sudo.
- Нельзя останавливать sshd, менять его порт или правила фаервола для SSH без второго открытого
  сеанса — можно потерять доступ к серверу.

## Изменения на серверах
- Перед правкой конфига — резервная копия рядом: file.bak-ДАТА.
- После правки — проверка синтаксиса (nginx -t, sshd -t, visudo -c), потом reload, а не restart.
- На серверах группы prod изменения — только в окно обслуживания, кроме аварий.
- Перезагрузка prod-серверов и баз данных — только по явной просьбе человека.

## Данные и базы
- Удаление баз, таблиц, томов docker и бэкапов запрещено агентам.
- Перед миграцией базы — свежий дамп.

## Секреты
- Пароли, токены и ключи не выводить в чат и не записывать в файлы хранилища.
- Секреты хранятся в менеджере паролей Windows (Infra сама кладёт их туда).

## Фаервол
- Фаервол (ufw/nftables) должен быть включён всегда. Открывать порт — только конкретный,
  с комментарием, зачем он нужен.
`,
	"knowledge/security/ssh-hardening.md": `# Чек-лист: безопасность Linux-сервера

## SSH
- sshd -T | grep -Ei 'permitrootlogin|passwordauthentication|pubkeyauthentication'
- Ожидается: permitrootlogin no, passwordauthentication no, pubkeyauthentication yes.

## Открытые порты
- ss -tlnp — наружу должны слушать только нужные сервисы (22, 80, 443 и т.п.).
- Базы данных (5432, 3306, 6379, 27017) не должны слушать 0.0.0.0.

## Обновления
- apt list --upgradable 2>/dev/null | grep -i security
- Включены автоматические обновления безопасности: systemctl status unattended-upgrades.

## Пользователи
- getent passwd | awk -F: '$3 >= 1000' — нет лишних пользователей.
- Нет пустых паролей: sudo awk -F: '($2 == "") {print $1}' /etc/shadow.
- Группа sudo: getent group sudo.

## Фаервол
- sudo ufw status verbose или sudo nft list ruleset — политика по умолчанию deny для входящих.

## Журналы
- Неудачные входы: journalctl -u ssh --since "24 hours ago" | grep -i "failed"
- Установлен fail2ban или аналог: systemctl status fail2ban.
`,
	"knowledge/security/incident.md": `# Ранбук: подозрение на взлом

1. Ничего не удалять и не перезагружать — сохранить следы.
2. Посмотреть активные сеансы и входы: who, last -n 30, journalctl -u ssh --since today.
3. Процессы и соединения: ps auxf --sort=-%cpu | head -30, ss -tunap.
4. Недавно изменённые файлы: find /etc /usr/bin /usr/sbin -mtime -2 -type f.
5. Cron и автозапуск: crontab -l, ls -la /etc/cron.*, systemctl list-timers.
6. Сообщить человеку и предложить изоляцию сервера (фаервол), но не выполнять её самому.
`,
	"knowledge/runbooks/nginx.md": `# Ранбук: nginx

## Проверка
- systemctl status nginx --no-pager
- nginx -t — проверка конфигурации перед любым reload.
- Логи: tail -n 100 /var/log/nginx/error.log

## Изменение конфига
1. Копия: cp /etc/nginx/sites-available/site /etc/nginx/sites-available/site.bak-$(date +%F)
2. Правка, затем nginx -t.
3. Только если проверка прошла: systemctl reload nginx.

## 502 Bad Gateway
- Упал бэкенд: проверь upstream-сервис (systemctl status, docker ps) и порт (ss -tlnp).
`,
	RulesFile: guard.Example,
}

func init() {
	for k, v := range Knowledge {
		examples[k] = v
	}
}

// WriteKnowledge добавляет стартовую базу знаний (существующие файлы не трогает). Возвращает число новых файлов.
func (v *Vault) WriteKnowledge() int {
	n := 0
	for rel, text := range Knowledge {
		p := filepath.Join(v.Root, filepath.FromSlash(rel))
		if _, err := os.Stat(p); err == nil {
			continue
		}
		_ = os.MkdirAll(filepath.Dir(p), 0o755)
		if os.WriteFile(p, []byte(text), 0o644) == nil {
			n++
		}
	}
	return n
}
