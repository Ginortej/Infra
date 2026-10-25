package vault

import (
	"os"
	"path/filepath"
)

var examples = map[string]string{
	"README.md": `# Хранилище Infra

Все настройки лежат здесь в виде обычных файлов. Папку удобно держать в git.

- servers/  — серверы, по одному YAML на сервер; подпапка = группа
- vpn/      — VPN-профили
- labs/     — лабы (виртуальные машины из YAML)
- scripts/  — скрипты: *.sh (по SSH на серверах), *.yml (Ansible), *.ps1 / *.bat (на этом ПК)
- knowledge/ — база знаний для ИИ-агентов (*.md) и правила безопасности security/rules.yaml
- .app/     — служебные файлы приложения (known_hosts, состояние, временные файлы)
`,
	"servers/example/my-server.yaml": `# Пример сервера. Скопируй файл и поменяй значения.
name: my-server
host: 192.168.1.10
port: 22
user: root
auth: key                  # key — по ключу, password — по паролю (спросит при подключении)
key: ~/.ssh/id_ed25519     # путь к приватному ключу
# via_vpn: work            # SSH пойдёт через VPN-профиль work
tags: [example]
`,
	"vpn/work.yaml": `# VPN-профиль. Каждый профиль поднимает локальный прокси на порту socks:
# вкладки терминала и SSH-подключения можно пустить через него.
name: work
type: wireguard            # wireguard | singbox | socks
wireguard: vpn/work.conf   # обычный .conf из WireGuard (положи рядом)
socks: 10801
autostart: false

# Для VLESS / Shadowsocks / Trojan и др.:
# type: singbox
# outbound:                # outbound в формате sing-box
#   type: vless
#   server: example.com
#   server_port: 443
#   uuid: ...
#
# Если VPN-клиент уже даёт SOCKS-прокси:
# type: socks
# proxy: 127.0.0.1:1080
`,
	"labs/example-lab.yaml": `# Лаба: набор виртуальных машин из одного файла.
# Шаблон — готовая VM с cloud-init (например, Ubuntu Cloud Image).
lab: demo
provider: virtualbox                 # virtualbox | vmware
template: ubuntu-24.04-template      # VirtualBox: имя VM; VMware: путь к .vmx
snapshot: base                       # если есть снапшот — клоны будут связанными (быстро)
user: ubuntu
ssh_key: ~/.ssh/id_ed25519           # публичный ключ берётся из <ssh_key>.pub
network:
  cidr: 192.168.56.0/24
  hostonly: VirtualBox Host-Only Ethernet Adapter   # VirtualBox
  # vmnet: vmnet8                    # VMware
  # gateway: 192.168.80.2            # VMware NAT: шлюз сети
machines:
  - name: master
    cpu: 2
    ram: 2048
    ip: 192.168.56.10
  - name: worker
    count: 2
    cpu: 1
    ram: 1024
    ip_start: 192.168.56.11
provision:
  playbook: scripts/update-all.yml   # запустится после создания машин
`,
	"scripts/snippets/disk.sh": `#!/usr/bin/env bash
# Свободное место на дисках
df -h -x tmpfs -x devtmpfs
`,
	"scripts/snippets/uptime.sh": `#!/usr/bin/env bash
echo "$(hostname): $(uptime -p)"
free -h | head -2
`,
	"scripts/update-all.yml": `- name: Обновить пакеты
  hosts: all
  become: true
  tasks:
    - name: apt update && upgrade
      ansible.builtin.apt:
        update_cache: true
        upgrade: dist
      when: ansible_os_family == "Debian"
`,
	"scripts/local/ping-servers.ps1": `# Выполняется на этом ПК в PowerShell
Test-Connection -Count 1 -ComputerName 1.1.1.1, 8.8.8.8 | Format-Table Address, Latency, Status
`,
}

func (v *Vault) writeExamples() {
	for rel, body := range examples {
		p := filepath.Join(v.Root, filepath.FromSlash(rel))
		if _, err := os.Stat(p); err == nil {
			continue
		}
		_ = os.MkdirAll(filepath.Dir(p), 0o755)
		_ = os.WriteFile(p, []byte(body), 0o644)
	}
	gi := filepath.Join(v.Root, ".gitignore")
	if _, err := os.Stat(gi); err != nil {
		_ = os.WriteFile(gi, []byte(".app/run/\n.app/seeds/\n.app/vpn/\n"), 0o644)
	}
}
