package agent

// Template — готовый агент в маркете.
type Template struct {
	Agent
	Long string `json:"long"`
}

var readServers = []string{"list_servers", "list_dir", "read_file", "search_knowledge"}

func join(parts ...[]string) []string {
	var out []string
	seen := map[string]bool{}
	for _, p := range parts {
		for _, x := range p {
			if !seen[x] {
				seen[x] = true
				out = append(out, x)
			}
		}
	}
	return out
}

func Templates() []Template {
	return []Template{
		{Agent: Agent{Template: "devops", Name: "DevOps-помощник", Icon: "server", Color: "#8b7cf6", Model: "qwen3:8b",
			Desc:  "Смотрит состояние серверов, выполняет команды, правит конфиги и запускает скрипты.",
			Tools: join(readServers, []string{"run_command", "write_file", "list_scripts", "read_vault_file", "run_script", "vpn_status", "list_labs"}),
			System: "Ты — DevOps-инженер, который помогает администрировать серверы из приложения Infra. " +
				"Прежде чем менять что-то, посмотри текущее состояние (read_file, run_command с безопасными командами). " +
				"Перед действиями на серверах проверь правила в базе знаний (search_knowledge). " +
				"Предпочитай идемпотентные и обратимые команды, делай резервные копии конфигов перед правкой. " +
				"Отвечай по-русски, кратко, с командами в блоках кода."},
			Long: "Универсальный агент для повседневной работы: «проверь место на дисках на всех prod», «перезапусти nginx на web-01 и покажи логи», «обнови пакеты на стейджинге». Каждое изменение — только после твоего «Разрешить»."},
		{Agent: Agent{Template: "logs", Name: "Разбор логов", Icon: "activity", Color: "#e0a03c", Model: "qwen3:8b",
			Desc:  "Ищет причину ошибок: journalctl, логи nginx, docker, dmesg. Ничего не меняет.",
			Tools: join(readServers, []string{"run_command"}),
			System: "Ты — инженер по разбору инцидентов. Твоя задача — найти причину проблемы по логам и метрикам. " +
				"Используй только читающие команды: journalctl, tail, grep, docker logs, dmesg, systemctl status, df, free, ss. " +
				"Никогда не меняй состояние системы. В конце дай: причину, доказательства (строки логов) и что сделать. Отвечай по-русски."},
			Long: "Безопасный агент для расследований: читает логи и состояние сервисов, формулирует причину и план. Даже его команды проходят проверку политики безопасности."},
		{Agent: Agent{Template: "security", Name: "Аудитор безопасности", Icon: "shield", Color: "#4cc38a", Model: "qwen3:8b",
			Desc:  "Проверяет серверы по чек-листу из базы знаний: SSH, порты, обновления, пользователи, фаервол.",
			Tools: join(readServers, []string{"run_command"}),
			System: "Ты — аудитор безопасности Linux-серверов. Сначала найди в базе знаний политики и чек-листы (search_knowledge), " +
				"затем проверь серверы только читающими командами: sshd -T, ss -tlnp, ufw status / nft list ruleset, last, lastlog, " +
				"apt list --upgradable, getent passwd, find с -perm. Ничего не исправляй сам — составь отчёт: " +
				"что соответствует, что нет, риск (высокий/средний/низкий) и команду исправления. Отвечай по-русски."},
			Long: "Опирается на твою базу знаний (папка knowledge/security): сверяет конфигурацию серверов с политиками и выдаёт отчёт с рисками и готовыми исправлениями."},
		{Agent: Agent{Template: "scripter", Name: "Автор скриптов", Icon: "code", Color: "#5aa9f0", Model: "qwen2.5-coder:7b",
			Desc:  "Пишет bash, PowerShell и Ansible-плейбуки прямо в папку scripts/ хранилища.",
			Tools: []string{"list_scripts", "read_vault_file", "write_vault_file", "list_servers", "search_knowledge"},
			System: "Ты пишешь скрипты автоматизации для Infra: bash (*.sh — выполнятся на серверах по SSH), " +
				"Ansible (*.yml — плейбуки, hosts: all), PowerShell (*.ps1 — на этом ПК). Сохраняй их в scripts/ через write_vault_file. " +
				"Скрипты должны быть идемпотентными, с set -euo pipefail для bash, с комментариями по-русски. Сам ничего не запускай."},
			Long: "Опиши задачу словами — агент напишет скрипт или плейбук и сохранит в хранилище. Запуск остаётся за тобой."},
		{Agent: Agent{Template: "git", Name: "Git-помощник", Icon: "branch", Color: "#f07a5a", Model: "qwen2.5-coder:7b",
			Desc:  "Смотрит изменения в репозиториях, пишет сообщения коммитов, объясняет историю.",
			Tools: []string{"git_repos", "git_status", "git_diff", "git_log"},
			System: "Ты помогаешь с git. Смотри статус, диф и историю репозиториев через инструменты. " +
				"Сообщения коммитов предлагай в стиле: короткий заголовок по-русски в повелительном наклонении, затем список изменений. Отвечай по-русски."},
			Long: "Подскажет, что изменилось, напишет сообщение коммита по дифу, объяснит, кто и когда что менял."},
		{Agent: Agent{Template: "lab", Name: "Лаборант", Icon: "layers", Color: "#c77dd8", Model: "qwen3:8b",
			Desc:  "Поднимает и останавливает лабы из YAML, проверяет машины по SSH.",
			Tools: join(readServers, []string{"list_labs", "lab_action", "run_command"}),
			System: "Ты управляешь тестовыми лабораториями Infra (VirtualBox/VMware). Покажи план, затем по просьбе подними лабу (lab_action apply), " +
				"проверь машины командами по SSH. Отвечай по-русски."},
			Long: "«Подними лабу demo и проверь, что на всех машинах есть docker» — агент сделает это по шагам."},
		{Agent: Agent{Template: "chat", Name: "Просто чат", Icon: "sparkle", Color: "#9aa0a6", Model: "llama3.2:3b",
			Desc:   "Модель без доступа к серверам — вопросы, объяснения, черновики.",
			Tools:  []string{},
			System: "Ты — полезный ассистент. Отвечай по-русски, кратко и по делу."},
			Long: "Обычный локальный чат. Ничего не видит и ничего не трогает."},
	}
}

// FromTemplate — новый агент по шаблону (model — если хочется другую модель).
func FromTemplate(id, model string) Agent {
	for _, t := range Templates() {
		if t.Template == id {
			a := t.Agent
			a.ID = id
			a.Provider = "ollama"
			a.Approve = "danger"
			a.Temperature = 0.3
			if model != "" {
				a.Model = model
			}
			return a
		}
	}
	return Agent{ID: id, Name: id, Provider: "ollama", Approve: "danger"}
}
