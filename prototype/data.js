// Тестовые данные. В Wails-версии их заменят вызовы Go-бэкенда
// (например: window.go.servers.Service.List()).
window.DATA = {
  servers: [
    { id: "prod-web-01", host: "10.0.5.12", user: "deploy", group: "prod", vpn: "work", status: "ok", tags: ["web"] },
    { id: "prod-web-02", host: "10.0.5.13", user: "deploy", group: "prod", vpn: "work", status: "ok", tags: ["web"] },
    { id: "prod-db-01", host: "10.0.6.20", user: "admin", group: "prod", vpn: "work", status: "warn", tags: ["db"] },
    { id: "staging-01", host: "staging.example.local", user: "deploy", group: "staging", vpn: "work", status: "ok", tags: ["web"] },
    { id: "home-nas", host: "192.168.1.50", user: "root", group: "home", vpn: "home-wg", status: "ok", tags: ["nas"] },
    { id: "pi-hole", host: "192.168.1.2", user: "pi", group: "home", vpn: "home-wg", status: "off", tags: ["dns"] },
    { id: "k8s-master", host: "192.168.56.10", user: "ubuntu", group: "lab: k8s-lab", vpn: null, status: "ok", tags: ["lab"] },
    { id: "k8s-worker-1", host: "192.168.56.11", user: "ubuntu", group: "lab: k8s-lab", vpn: null, status: "ok", tags: ["lab"] },
    { id: "k8s-worker-2", host: "192.168.56.12", user: "ubuntu", group: "lab: k8s-lab", vpn: null, status: "ok", tags: ["lab"] },
  ],

  vpns: [
    { id: "work", type: "WireGuard", on: true, socks: 10801, ping: 34, rx: "1.2 GB", tx: "84 MB" },
    { id: "home-wg", type: "WireGuard", on: true, socks: 10802, ping: 12, rx: "320 MB", tx: "41 MB" },
    { id: "nl-vless", type: "VLESS", on: false, socks: 10803, ping: null, rx: "—", tx: "—" },
    { id: "office-ovpn", type: "OpenVPN", on: false, socks: 10804, ping: null, rx: "—", tx: "—" },
  ],

  labs: [
    {
      id: "k8s-lab", provider: "VirtualBox", template: "ubuntu-24.04", network: "192.168.56.0/24",
      playbook: "scripts/k8s.yml",
      vms: [
        { name: "k8s-master", cpu: 2, ram: 4096, ip: "192.168.56.10", state: "running" },
        { name: "k8s-worker-1", cpu: 2, ram: 2048, ip: "192.168.56.11", state: "running" },
        { name: "k8s-worker-2", cpu: 2, ram: 2048, ip: "192.168.56.12", state: "running" },
      ],
    },
    {
      id: "ansible-lab", provider: "VMware", template: "debian-12", network: "192.168.80.0/24",
      playbook: "scripts/base.yml",
      vms: [
        { name: "control", cpu: 2, ram: 2048, ip: "192.168.80.10", state: "stopped" },
        { name: "node-1", cpu: 1, ram: 1024, ip: "192.168.80.11", state: "stopped" },
        { name: "node-2", cpu: 1, ram: 1024, ip: "192.168.80.12", state: "absent" },
      ],
    },
  ],

  scripts: [
    { path: "scripts/update-all.yml", kind: "ansible" },
    { path: "scripts/k8s.yml", kind: "ansible" },
    { path: "scripts/base.yml", kind: "ansible" },
    { path: "scripts/snippets/disk.sh", kind: "sh" },
    { path: "scripts/snippets/uptime.sh", kind: "sh" },
    { path: "scripts/snippets/docker-clean.sh", kind: "sh" },
  ],

  files: {
    "servers/prod-web-01.yaml":
`# Сервер из хранилища
name: prod-web-01
host: 10.0.5.12
port: 22
user: deploy
auth: key:prod-key        # секрет из Credential Manager
via_vpn: work             # SSH пойдёт через SOCKS профиля work
tags: [web, prod]
forwards:
  - local: 8080
    remote: localhost:80
`,
    "labs/k8s-lab.yaml":
`lab: k8s-lab
provider: virtualbox        # или vmware
template: ubuntu-24.04
network:
  name: labnet
  cidr: 192.168.56.0/24
machines:
  - name: k8s-master
    cpu: 2
    ram: 4096
    ip: 192.168.56.10
  - name: k8s-worker
    count: 2
    cpu: 2
    ram: 2048
    ip_start: 192.168.56.11
provision:
  playbook: scripts/k8s.yml
  auto: true
`,
    "labs/ansible-lab.yaml":
`lab: ansible-lab
provider: vmware
template: debian-12
network:
  cidr: 192.168.80.0/24
machines:
  - name: control
    cpu: 2
    ram: 2048
    ip: 192.168.80.10
  - name: node
    count: 2
    cpu: 1
    ram: 1024
    ip_start: 192.168.80.11
provision:
  playbook: scripts/base.yml
`,
    "vpn/work.yaml":
`name: work
type: wireguard
config: vpn/work.conf     # обычный конфиг WireGuard
socks: 10801              # локальный порт для вкладок и SSH
autostart: true
route:
  - domain_suffix: [corp.local]
  - ip_cidr: [10.0.0.0/8]
`,
    "scripts/update-all.yml":
`- name: Обновить все серверы
  hosts: all
  become: true
  tasks:
    - name: apt update && upgrade
      ansible.builtin.apt:
        update_cache: true
        upgrade: dist
    - name: Нужна ли перезагрузка
      ansible.builtin.stat:
        path: /var/run/reboot-required
      register: reboot
`,
    "scripts/snippets/disk.sh":
`#!/usr/bin/env bash
# Свободное место на дисках
df -h --output=source,size,used,avail,pcent,target | grep -v tmpfs
`,
  },

  remoteFiles: [
    { n: "..", dir: true },
    { n: ".ssh", dir: true, s: "", d: "12.09.2026" },
    { n: "app", dir: true, s: "", d: "15.10.2026" },
    { n: "backups", dir: true, s: "", d: "17.10.2026" },
    { n: "logs", dir: true, s: "", d: "17.10.2026" },
    { n: "docker-compose.yml", s: "1.4 KB", d: "15.10.2026" },
    { n: ".env", s: "612 B", d: "02.10.2026" },
    { n: "deploy.sh", s: "2.1 KB", d: "28.09.2026" },
    { n: "nginx.conf", s: "3.8 KB", d: "11.10.2026" },
  ],
  localFiles: [
    { n: "..", dir: true },
    { n: "Program_Server", dir: true, s: "", d: "17.10.2026" },
    { n: "dumps", dir: true, s: "", d: "10.10.2026" },
    { n: "certs", dir: true, s: "", d: "01.10.2026" },
    { n: "nginx.conf", s: "3.6 KB", d: "09.10.2026" },
    { n: "release-1.4.2.tar.gz", s: "48.3 MB", d: "16.10.2026" },
    { n: "notes.md", s: "4.0 KB", d: "14.10.2026" },
  ],
};
