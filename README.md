# Infra

Минималистичное приложение для Windows в духе Obsidian: **серверы, VPN и лабы виртуальных машин** в одном окне.
Вся конфигурация хранится в обычной папке в виде YAML-файлов. Её удобно держать в git.

Написано на **Go + [Wails](https://wails.io)**, интерфейс на чистом JS + [xterm.js](https://xtermjs.org).

---

## Возможности

| | |
|---|---|
| **Терминалы** | Сами находит оболочки на ПК: PowerShell 7, Windows PowerShell, cmd, Git Bash, MSYS2, Cygwin, Nushell, все дистрибутивы WSL. Вкладки, `Ctrl+T`, копирование и вставка как в Windows Terminal |
| **Серверы** | SSH-терминал в один клик, группы, jump-хосты, проверка доступности, файлы по SFTP в двух панелях (ПК ↔ сервер) |
| **VPN** | Несколько профилей одновременно (WireGuard, VLESS, Trojan, Shadowsocks и всё, что умеет sing-box). Для каждой вкладки терминала и каждого сервера выбирается, через какой VPN идёт трафик |
| **Скрипты** | `.sh` по SSH на группе серверов параллельно, `.yml` через Ansible (в WSL, inventory собирается сам), `.ps1` / `.bat` локально. Отдельный вывод и код выхода у каждого сервера |
| **Лабы** | Машины VirtualBox / VMware Workstation из одного YAML: план изменений → клонирование → cloud-init (hostname, ключ, статический IP) → машины появляются в серверах → запуск плейбука |
| **Интерфейс** | Палитра команд `Ctrl+P`, тёмная тема, без лишних панелей |

## Установка

1. Скачай `Infra.exe` из [Releases](../../releases) или [собери сам](#сборка-из-исходников).
2. Запусти. Установка не нужна. Требуется WebView2, он уже есть в Windows 10 и 11.

Дополнительно, по необходимости:

| Для чего | Что поставить |
|---|---|
| VPN | [sing-box](https://github.com/SagerNet/sing-box/releases) 1.11+. Положи `sing-box.exe` в папку `bin` хранилища или укажи путь в Настройках |
| Ansible | WSL (`wsl --install`). Сам Ansible ставится из окна запуска кнопкой «Установить Ansible» |
| Лабы | VirtualBox или VMware Workstation и шаблон VM с cloud-init (например, [Ubuntu Cloud Image](https://cloud-images.ubuntu.com/)) |

## Быстрый старт

1. При первом запуске нажми **«Создать хранилище»** и выбери пустую папку. В ней появится структура с примерами.
2. Добавь сервер кнопкой **+** на панели «Серверы» или создай YAML вручную.
3. Кликни по серверу, откроется SSH-терминал.

Хранилище меняется кнопкой с его названием слева вверху.

## Хранилище

```
my-infra/
├── servers/            серверы: один YAML на сервер, подпапка = группа
│   ├── prod/web-01.yaml
│   └── labs/<лаба>/    сюда лабы сами добавляют свои машины
├── vpn/                VPN-профили (+ .conf WireGuard рядом)
├── labs/               лабы
├── scripts/            скрипты (.sh, .yml, .ps1, .bat)
├── bin/                (необязательно) sing-box.exe
└── .app/               служебное: known_hosts, временные файлы — не коммитить
```

### Сервер

```yaml
name: web-01
host: 10.0.5.12
port: 22
user: deploy
auth: key                  # key | password
key: ~/.ssh/id_ed25519
via_vpn: work              # необязательно: SSH через VPN-профиль
jump: bastion              # необязательно: через другой сервер
tags: [web]
```

### VPN-профиль

```yaml
name: work
type: wireguard            # wireguard | singbox | socks
wireguard: vpn/work.conf   # обычный .conf WireGuard
socks: 10801               # локальный порт прокси (SOCKS5 + HTTP)
autostart: false
```

Для VLESS, Trojan и других протоколов: `type: singbox` и блок `outbound:` в формате sing-box.
Для уже запущенного стороннего клиента: `type: socks` и `proxy: 127.0.0.1:1080`.

### Лаба

```yaml
lab: k8s
provider: virtualbox                 # virtualbox | vmware
template: ubuntu-24.04-template      # VirtualBox: имя VM; VMware: путь к .vmx
snapshot: base                       # со снапшотом клоны связанные — быстро
user: ubuntu
ssh_key: ~/.ssh/id_ed25519           # публичный ключ берётся из .pub
network:
  cidr: 192.168.56.0/24
  hostonly: VirtualBox Host-Only Ethernet Adapter   # VirtualBox
  # vmnet: vmnet8                    # VMware
  # gateway: 192.168.80.2            # VMware
machines:
  - name: master
    cpu: 2
    ram: 4096
    ip: 192.168.56.10
  - name: worker
    count: 2
    cpu: 2
    ram: 2048
    ip_start: 192.168.56.11
provision:
  playbook: scripts/k8s.yml
```

## Как выполняются скрипты

| Файл | Где выполняется | Как |
|---|---|---|
| `.sh` | на выбранных серверах | по SSH: `bash -s < скрипт`, параллельно; можно через `sudo -n` |
| `.yml` | на выбранных серверах | `ansible-playbook` в WSL; inventory собирается из выбранных серверов, ключи копируются в WSL |
| `.ps1` | на этом ПК | PowerShell 7 или Windows PowerShell |
| `.bat` / `.cmd` | на этом ПК | cmd.exe |

Перед запуском открывается окно: тип скрипта, где и как он выполнится, выбор серверов и итоговая команда.

## Безопасность

- **Пароли и пароли ключей не пишутся в YAML.** Их спрашивают при подключении и, если хочешь, сохраняют в диспетчер учётных данных Windows (Credential Manager).
- Ключи хостов проверяются: новый сохраняется в `.app/known_hosts`, а **изменившийся ключ блокирует подключение**.
- Временный inventory для Ansible (там могут быть пароли) удаляется сразу после запуска.
- В `.gitignore` уже есть `.app/`, приватные ключи, `*.conf` (WireGuard) и `.env`. Хранилище с реальными серверами лучше держать в **приватном** репозитории.

## Горячие клавиши

| | |
|---|---|
| `Ctrl+P` | палитра команд |
| `Ctrl+T` / `Ctrl+Shift+T` | терминал по умолчанию / выбор оболочки |
| `Ctrl+W` | закрыть вкладку |
| `Ctrl+Tab` | следующая вкладка |
| `Ctrl+S` | сохранить файл |
| `Ctrl+,` | настройки |

## Сборка из исходников

Нужны Go 1.24+, Node.js 20+ и Wails CLI:

```powershell
go install github.com/wailsapp/wails/v2/cmd/wails@latest
wails build              # результат: build\bin\Infra.exe
wails dev                # режим разработки с перезагрузкой
go test ./...            # тесты бэкенда
```

Интерфейс можно запускать в браузере с тестовыми данными, без Go: `cd frontend && npm install && npm run dev`.

## Структура проекта

```
main.go, app*.go       методы, доступные интерфейсу (window.go.main.App.*)
internal/
  vault/               хранилище, YAML, настройки
  shells/              поиск оболочек на ПК
  term/                терминальные сессии: ConPTY и SSH
  sshx/                SSH: ключи, пароли, known_hosts, VPN-прокси, jump-хосты
  runner/              запуск скриптов: bash по SSH, Ansible в WSL, PowerShell
  vpn/                 sing-box: генерация конфигов и процессы
  virt/                VirtualBox / VMware, cloud-init ISO, план изменений
frontend/src/          интерфейс (vanilla JS + xterm.js), mock.js — тестовый бэкенд
prototype/             первый статический макет интерфейса
```

## Ограничения

- Только Windows: локальные терминалы работают через ConPTY.
- Ansible не пройдёт к серверам за VPN, если в WSL не включён режим сети `mirrored` (`networkingMode=mirrored` в `.wslconfig`).
- Изменения CPU и RAM в YAML лабы применяются только при создании машины.
- Режим TUN (VPN для всей системы или отдельных программ) пока не поддерживается: профили работают как локальные прокси.
