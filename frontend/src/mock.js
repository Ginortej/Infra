// Тестовый бэкенд для разработки интерфейса в браузере (без Go).
export function createMock() {
  const listeners = {};
  const emit = (ev, ...a) => setTimeout(() => (listeners[ev] || []).forEach((f) => f(...a)), 0);
  const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
  let seq = 1;
  let vaultPath = localStorage.getItem("mock.vault") ?? "C:\\Users\\user\\Infra";

  const servers = [
    ["prod-web-01", "10.0.5.12", "deploy", "prod", "work"], ["prod-web-02", "10.0.5.13", "deploy", "prod", "work"],
    ["prod-db-01", "10.0.6.20", "admin", "prod", "work"], ["staging-01", "staging.local", "deploy", "staging", "work"],
    ["home-nas", "192.168.1.50", "root", "home", "home-wg"], ["pi-hole", "192.168.1.2", "pi", "home", ""],
    ["demo-master", "192.168.56.10", "ubuntu", "lab: demo", ""], ["demo-worker-1", "192.168.56.11", "ubuntu", "lab: demo", ""],
  ].map(([name, host, user, group, vpn]) => ({ id: name, name, host, user, group, vpn, port: 22, auth: "key", key: "~/.ssh/id_ed25519", file: `servers/${group.startsWith("lab") ? "labs/demo" : group}/${name}.yaml`, tags: [] }));

  const vpns = [
    { id: "work", name: "work", type: "wireguard", socks: 10801, file: "vpn/work.yaml" },
    { id: "home-wg", name: "home-wg", type: "wireguard", socks: 10802, file: "vpn/home-wg.yaml" },
    { id: "nl-vless", name: "nl-vless", type: "singbox", socks: 10803, file: "vpn/nl-vless.yaml" },
  ];
  const vpnOn = { work: Date.now() / 1000 - 3600 };
  const labs = [{ id: "demo", name: "demo", provider: "virtualbox", template: "ubuntu-24.04-template", file: "labs/demo.yaml", network: { cidr: "192.168.56.0/24" }, provision: { playbook: "scripts/update-all.yml" } }];
  const vmState = { "demo-master": "running", "demo-worker-1": "running", "demo-worker-2": "absent" };
  const scripts = [
    { path: "scripts/update-all.yml", kind: "ansible" }, { path: "scripts/k8s.yml", kind: "ansible" },
    { path: "scripts/snippets/disk.sh", kind: "bash" }, { path: "scripts/snippets/uptime.sh", kind: "bash" },
    { path: "scripts/local/ping-servers.ps1", kind: "powershell" },
  ];
  const files = {
    "labs/demo.yaml": "lab: demo\nprovider: virtualbox\ntemplate: ubuntu-24.04-template\nsnapshot: base\nuser: ubuntu\nssh_key: ~/.ssh/id_ed25519\nnetwork:\n  cidr: 192.168.56.0/24\n  hostonly: VirtualBox Host-Only Ethernet Adapter\nmachines:\n  - name: master\n    cpu: 2\n    ram: 4096\n    ip: 192.168.56.10\n  - name: worker\n    count: 2\n    cpu: 1\n    ram: 2048\n    ip_start: 192.168.56.11\nprovision:\n  playbook: scripts/update-all.yml\n",
    "scripts/snippets/disk.sh": "#!/usr/bin/env bash\n# Свободное место на дисках\ndf -h -x tmpfs -x devtmpfs\n",
    "scripts/update-all.yml": "- name: Обновить пакеты\n  hosts: all\n  become: true\n  tasks:\n    - name: apt update && upgrade\n      ansible.builtin.apt:\n        update_cache: true\n        upgrade: dist\n",
  };
  const tree = [...servers.map((s) => s.file), ...vpns.map((v) => v.file), "labs/demo.yaml", ...scripts.map((s) => s.path), "README.md"].sort();
  const snap = () => ({ path: vaultPath, name: vaultPath.split("\\").pop(), servers, vpns, labs, scripts, tree, errors: [] });

  const shells = [
    { id: "pwsh", name: "PowerShell 7", kind: "powershell", path: "C:\\Program Files\\PowerShell\\7\\pwsh.exe" },
    { id: "powershell", name: "Windows PowerShell", kind: "powershell", path: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" },
    { id: "cmd", name: "Командная строка", kind: "cmd", path: "C:\\Windows\\System32\\cmd.exe" },
    { id: "gitbash", name: "Git Bash", kind: "bash", path: "C:\\Program Files\\Git\\bin\\bash.exe" },
    { id: "wsl:Ubuntu", name: "WSL · Ubuntu", kind: "wsl", path: "C:\\Windows\\System32\\wsl.exe" },
  ];
  const terms = {};
  let gitDefault = "github-ginortej";
  const gitAcc = [
    { id: "github-ginortej", provider: "github", host: "github.com", label: "Личный", username: "Ginortej", name: "Ivan Petrov", email: "1234+Ginortej@users.noreply.github.com", gitAuth: "token", sshKey: "", hasToken: true },
    { id: "gitlab-ivan", provider: "gitlab", host: "git.company.ru", label: "Работа", username: "ivan.petrov", name: "Иван Петров", email: "ivan@company.ru", gitAuth: "ssh", sshKey: "C:\\Users\\user\\.ssh\\infra_work", hasToken: true },
  ];
  const gitRepos = [
    { path: "C:\\Users\\user\\Desktop\\Working\\Program_Server", name: "Program_Server", vault: false,
      st: { branch: "main", upstream: "origin/main", ahead: 1, behind: 0, account: "github-ginortej", remotes: [{ name: "origin", url: "https://github.com/Ginortej/Infra.git", host: "github.com", path: "Ginortej/Infra", web: "https://github.com/Ginortej/Infra" }],
        files: [{ path: "frontend/src/views/git.js", index: "A" }, { path: "app_git.go", index: "M" }, { path: "servers/prod/prod-web-01.yaml", work: "M" }, { path: "README.md", work: "M" }, { path: "internal/gitx/old.go", work: "D" }, { path: "notes/todo.md", untracked: true, work: "?" }] },
      log: [
        { hash: "6b28f4e0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6", short: "6b28f4e", author: "Ginortej", time: Date.now() / 1000 - 3600, subject: "Ctrl+A в терминале и скрытие левой панели", refs: "HEAD -> main, origin/main" },
        { hash: "4eb864d0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6", short: "4eb864d", author: "Ginortej", time: Date.now() / 1000 - 7200, subject: "Терминал: темы, отступы, поиск и удобства", refs: "" },
        { hash: "ac5a2610a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6", short: "ac5a261", author: "Ginortej", time: Date.now() / 1000 - 86400 * 2, subject: "Infra: Go + Wails приложение для серверов, VPN и лаб", refs: "tag: v0.1.0" },
      ] },
    { path: "D:\\work\\ansible-roles", name: "ansible-roles", vault: false,
      st: { branch: "develop", upstream: "origin/develop", ahead: 0, behind: 3, account: "gitlab-ivan", remotes: [{ name: "origin", url: "git@git.company.ru:ops/ansible-roles.git", host: "git.company.ru", path: "ops/ansible-roles", web: "https://git.company.ru/ops/ansible-roles" }], files: [] },
      log: [] },
  ];

  const job = (title, done) => {
    const id = "job" + seq++;
    let p = 0;
    const iv = setInterval(() => {
      p = Math.min(100, p + 12);
      emit("job", { id, title, pct: p, msg: "шаг " + Math.round(p / 12), done: p >= 100 });
      if (p >= 100) { clearInterval(iv); done?.(); }
    }, 300);
    return id;
  };

  const ls = (path) => (path ||= vaultPath, {
    path, parent: path.length > 3 ? path.replace(/[\\/][^\\/]+$/, "") || "/" : "",
    entries: [
      { name: "bin", dir: true, size: 0, mtime: 1760600000 }, { name: "notes", dir: true, size: 0, mtime: 1760500000 },
      { name: "deploy.sh", dir: false, size: 2150, mtime: 1760400000 }, { name: "release-1.4.2.tar.gz", dir: false, size: 50650000, mtime: 1760700000 },
    ],
  });

  const api = {
    GetState: () => ({ version: "0.1.0-dev", vault: vaultPath, recent: [vaultPath, "D:\\work\\infra-lab"].filter(Boolean), os: "windows", settings: { parallel: 10, gitDefault },
      detected: { vboxmanage: "C:\\Program Files\\Oracle\\VirtualBox\\VBoxManage.exe", vmrun: "", vmwareDir: "C:\\Users\\user\\Documents\\Virtual Machines", singbox: "", wslDistro: "Ubuntu", parallel: 10 } }),
    PickFolder: () => prompt("Путь к папке (в приложении здесь откроется системный диалог)", "C:\\Users\\user\\Infra") || "",
    PickFile: () => prompt("Путь к файлу", "C:\\Users\\user\\.ssh\\id_ed25519") || "",
    OpenVault: (p) => { vaultPath = p; localStorage.setItem("mock.vault", p); return snap(); },
    CloseVault: () => { vaultPath = ""; localStorage.setItem("mock.vault", ""); },
    ForgetRecent: () => {},
    Load: snap,
    ReadFile: (rel) => files[rel] ?? `# ${rel}\n`,
    WriteFile: (rel, t) => { files[rel] = t; return /\[[^\]]*$/m.test(t) ? "yaml: line 3: did not find expected ',' or ']'" : ""; },
    DeleteFile: () => {},
    SaveServer: (s) => { const rel = `servers/${s.group || "misc"}/${s.name}.yaml`; servers.push({ ...s, id: s.name, file: rel, port: s.port || 22 }); return rel; },
    Reveal: () => {},
    SaveSettings: () => {},
    CheckServers: () => Object.fromEntries(servers.map((s) => [s.id, s.id === "pi-hole" ? "err" : s.vpn && !vpnOn[s.vpn] ? "off" : "ok"])),
    ListShells: () => shells, RescanShells: () => shells,
    TermOpenLocal: (shell, vpn) => {
      const id = "term" + seq++; terms[id] = { line: "" };
      const sh = shells.find((s) => s.id === shell);
      const p = sh.kind === "powershell" ? "PS C:\\Users\\user> " : sh.kind === "cmd" ? "C:\\Users\\user>" : "user@PC:~$ ";
      terms[id].prompt = p;
      emit("term:data", id, b64(`\x1b[90m${sh.name}${vpn ? " · через VPN " + vpn : ""} (тестовый режим)\x1b[0m\r\n${p}`));
      return id;
    },
    TermOpenSSH: (sid, vpn) => {
      if (sid === "staging-01" && !api._pw) throw new Error("NEED_PASSWORD");
      const s = servers.find((x) => x.id === sid);
      const id = "term" + seq++; terms[id] = { line: "", prompt: `\x1b[32m${s.user}@${sid}\x1b[0m:\x1b[34m~\x1b[0m$ ` };
      const via = vpn === "@default" ? s.vpn : vpn;
      emit("term:data", id, b64(`\x1b[90mНовый ключ хоста ssh-ed25519 SHA256:k3x…9fQ сохранён${via ? " · через " + via : ""}\x1b[0m\r\nWelcome to Ubuntu 24.04.1 LTS (GNU/Linux 6.8.0-45-generic x86_64)\r\n\r\nLast login: Sat Oct 17 07:52:11 2026 from 10.8.0.2\r\n${terms[id].prompt}`));
      return id;
    },
    TermWrite: (id, d) => {
      const t = terms[id]; if (!t) return;
      if (d === "\r") {
        const out = t.line === "ls" ? "app  backups  logs  deploy.sh\r\n" : t.line ? `${t.line}: command not found\r\n` : "";
        t.line = ""; emit("term:data", id, b64("\r\n" + out + t.prompt));
      } else if (d === "\x7f") { if (t.line) { t.line = t.line.slice(0, -1); emit("term:data", id, b64("\b \b")); } }
      else { t.line += d; emit("term:data", id, b64(d)); }
    },
    TermResize: () => {}, TermClose: (id) => delete terms[id],
    SetPassword: () => { api._pw = true; }, ForgetPassword: () => {},
    LocalHome: () => vaultPath, LocalList: ls, RemoteList: (s, p) => ls(p || "/home/deploy"),
    Upload: () => job("Загрузка"), Download: () => job("Скачивание"), RemoteMkdir: () => {}, RemoteDelete: () => {},
    VpnStatus: () => vpns.map((v) => ({ id: v.id, type: v.type, running: !!vpnOn[v.id], addr: "127.0.0.1:" + v.socks, since: vpnOn[v.id] || 0, error: v.id === "nl-vless" && !vpnOn[v.id] ? "" : "" })),
    VpnStart: (id) => { if (id === "nl-vless") throw new Error("не найден sing-box.exe. Скачай его с github.com/SagerNet/sing-box/releases и укажи путь в Настройках"); vpnOn[id] = Date.now() / 1000; emit("vpn:changed"); },
    VpnStop: (id) => { delete vpnOn[id]; emit("vpn:changed"); },
    LabPlan: (id) => ({ lab: id, provider: "virtualbox", template: "ubuntu-24.04-template", network: "192.168.56.0/24", playbook: "scripts/update-all.yml",
      vms: [["demo-master", "master", 2, 4096, "192.168.56.10"], ["demo-worker-1", "worker-1", 1, 2048, "192.168.56.11"], ["demo-worker-2", "worker-2", 1, 2048, "192.168.56.12"]]
        .map(([name, host, cpu, ram, ip]) => ({ name, host, cpu, ram, ip, state: vmState[name], action: vmState[name] === "absent" ? "create" : vmState[name] === "stopped" ? "start" : "none" })) }),
    LabApply: (id) => job("lab up " + id, () => { Object.keys(vmState).forEach((k) => (vmState[k] = "running")); emit("vault:changed"); }),
    LabStop: (id) => job("lab stop " + id, () => Object.keys(vmState).forEach((k) => vmState[k] !== "absent" && (vmState[k] = "stopped"))),
    LabDestroy: (id) => job("lab destroy " + id, () => Object.keys(vmState).forEach((k) => (vmState[k] = "absent"))),
    LabSnapshot: (id) => job("snapshot " + id),
    VMAction: (lab, vm, a) => { vmState[vm] = a === "start" ? "running" : "stopped"; },
    AnsibleInfo: () => new Promise((r) => setTimeout(() => r({ wsl: true, distros: ["Ubuntu"], distro: "Ubuntu", ansible: true, version: "ansible-playbook [core 2.16.3]" }), 600)),
    InstallAnsible: () => "run" + seq++,
    PreviewInventory: (t) => "[targets]\n" + t.map((id) => { const s = servers.find((x) => x.id === id); return `${id} ansible_host=${s.host} ansible_port=22 ansible_user=${s.user} ansible_ssh_private_key_file=~/.infra/keys/k0`; }).join("\n"),
    RunScript: (req) => {
      const run = "run" + seq++;
      const kind = scripts.find((s) => s.path === req.script)?.kind;
      const hosts = kind === "powershell" ? ["local"] : req.targets;
      hosts.forEach((h, i) => setTimeout(() => {
        emit("run:host", run, h, "running", 0, 0);
        const out = kind === "ansible" ? "" : kind === "powershell"
          ? "Address   Latency Status\r\n-------   ------- ------\r\n1.1.1.1        12 Success\r\n8.8.8.8        18 Success\r\n"
          : `Filesystem      Size  Used Avail Use% Mounted on\r\n/dev/sda1        80G   ${30 + i}G   47G  ${39 + i}% /\r\n`;
        if (out) emit("run:out", run, h, b64(`\x1b[90m$ ssh ${h} 'bash -s' < ${req.script.split("/").pop()}\x1b[0m\r\n` + out));
        setTimeout(() => emit("run:host", run, h, h === "prod-db-01" ? "fail" : "ok", h === "prod-db-01" ? 1 : 0, 900 + i * 200), 900 + i * 300);
      }, 100 + i * 150));
      if (kind === "ansible") {
        emit("run:out", run, "", b64(`\x1b[90m$ wsl -d Ubuntu -- ansible-playbook -i .app/run/${run}-inventory.ini ${req.script}\x1b[0m\r\n\r\nPLAY [Обновить пакеты] *****************************\r\n\r\nTASK [Gathering Facts] *****************************\r\n` + hosts.map((h) => `\x1b[32mok: [${h}]\x1b[0m\r\n`).join("") + `\r\nPLAY RECAP *****************************************\r\n` + hosts.map((h) => `${h.padEnd(14)}: \x1b[32mok=2\x1b[0m  \x1b[33mchanged=1\x1b[0m  unreachable=0  failed=0\r\n`).join("")));
      }
      setTimeout(() => emit("run:done", run), 900 + hosts.length * 300 + 600);
      return run;
    },
    CancelRun: () => {},

    // ---------- Git ----------
    GitInfo: () => ({ path: "C:\\Program Files\\Git\\cmd\\git.exe", version: "git version 2.47.0.windows.1" }),
    GitAccounts: () => gitAcc,
    GitSetDefault: (id) => { gitDefault = id; },
    GitSaveAccount: (a, tok) => { const x = { ...a, id: a.id || a.provider + "-" + (a.username || "new"), hasToken: a.hasToken || !!tok }; const i = gitAcc.findIndex((y) => y.id === x.id); i >= 0 ? (gitAcc[i] = x) : gitAcc.push(x); return x; },
    GitDeleteAccount: (id) => { const i = gitAcc.findIndex((y) => y.id === id); if (i >= 0) gitAcc.splice(i, 1); },
    GitVerify: (a) => new Promise((r) => setTimeout(() => r({ username: a.provider === "gitlab" ? "ivan.petrov" : "Ginortej", name: "Ivan Petrov", email: a.provider === "gitlab" ? "ivan@company.ru" : "1234+Ginortej@users.noreply.github.com" }), 500)),
    GitTestSSH: () => "Hi Ginortej! You've successfully authenticated, but GitHub does not provide shell access.",
    GitGenerateKey: (n) => ({ path: "C:\\Users\\user\\.ssh\\infra_" + n, pub: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGq3l9Xb8sZ1mock infra" }),
    GitPublicKey: () => "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGq3l9Xb8sZ1mock infra",
    GitUploadKey: () => {},
    GitLinks: (a) => ({ token: `https://${a.host || "github.com"}/settings/tokens/new`, keys: `https://${a.host || "github.com"}/settings/ssh/new` }),
    GitRepos: () => gitRepos.map((r) => ({ ...r, changes: r.st.files.length, branch: r.st.branch, ahead: r.st.ahead, behind: r.st.behind, account: r.st.account, isRepo: true, remote: r.st.remotes[0] ? r.st.remotes[0].host + "/" + r.st.remotes[0].path : "" })),
    GitAddRepo: () => {}, GitRemoveRepo: () => {}, GitInit: () => {},
    GitStatus: (p) => ({ isRepo: true, root: p, ...(gitRepos.find((r) => r.path === p)?.st || {}) }),
    GitSetAccount: (p, id) => { const r = gitRepos.find((x) => x.path === p); if (r) r.st.account = id; },
    GitStage: (p, files) => { const r = gitRepos.find((x) => x.path === p); r.st.files.forEach((f) => { if (!files.length || files.includes(f.path)) { f.index = f.untracked ? "A" : f.work || f.index; f.work = ""; f.untracked = false; } }); },
    GitUnstage: (p, files) => { const r = gitRepos.find((x) => x.path === p); r.st.files.forEach((f) => { if (!files.length || files.includes(f.path)) { f.work = f.index === "A" ? "?" : f.index; f.untracked = f.index === "A"; f.index = ""; } }); },
    GitDiscard: (p, a, b) => { const r = gitRepos.find((x) => x.path === p); r.st.files = r.st.files.filter((f) => !a.includes(f.path) && !b.includes(f.path)); },
    GitDiff: (p, f, staged, untr) => untr ? "@@ новый файл, 3 строк @@\n+name: new\n+host: 10.0.0.5\n+user: root\n" : `diff --git a/${f} b/${f}\nindex 3f2a1c4..9b8e7d2 100644\n--- a/${f}\n+++ b/${f}\n@@ -1,7 +1,8 @@\n name: prod-web-01\n-host: 10.0.5.11\n+host: 10.0.5.12\n port: 22\n user: deploy\n+via_vpn: work\n auth: key\n key: ~/.ssh/id_ed25519\n tags: [web]\n`,
    GitCommit: (p) => { const r = gitRepos.find((x) => x.path === p); r.st.files = r.st.files.filter((f) => !f.index); r.st.ahead++; r.log.unshift({ hash: Math.random().toString(16).slice(2).padEnd(40, "0"), short: Math.random().toString(16).slice(2, 9), author: "Ivan Petrov", time: Date.now() / 1000, subject: "новый коммит", refs: "HEAD -> main" }); return ""; },
    GitPush: (p) => job("git push", () => { gitRepos.find((x) => x.path === p).st.ahead = 0; emit("git:changed", p); }),
    GitPull: (p) => job("git pull", () => { gitRepos.find((x) => x.path === p).st.behind = 0; emit("git:changed", p); }),
    GitFetch: () => job("git fetch"),
    GitBranches: () => [{ name: "main", current: true, upstream: "origin/main" }, { name: "feature/terminal", upstream: "" }, { name: "origin/main", remote: true }, { name: "origin/release", remote: true }],
    GitCheckout: () => {}, GitCreateBranch: () => {},
    GitLog: (p) => gitRepos.find((x) => x.path === p).log,
    GitShow: (p, h) => `commit ${h}\nАвтор: Ivan Petrov <ivan@x>\nДата:  19.10.2026 17:02\n\nТерминал: темы, отступы, поиск\n\n frontend/src/termprefs.js | 160 +++++\n 1 file changed, 160 insertions(+)\n\ndiff --git a/frontend/src/termprefs.js b/frontend/src/termprefs.js\nnew file mode 100644\n--- /dev/null\n+++ b/frontend/src/termprefs.js\n@@ -0,0 +1,4 @@\n+// Оформление терминала\n+import { store } from "./ui.js";\n+\n+export const THEMES = {};\n`,
    GitSetRemote: () => {},
    GitListRemote: () => new Promise((r) => setTimeout(() => r([{ name: "Infra", fullName: "Ginortej/Infra", private: false, https: "https://github.com/Ginortej/Infra.git", ssh: "git@github.com:Ginortej/Infra.git", desc: "Серверы, VPN и лабы" }, { name: "dotfiles", fullName: "Ginortej/dotfiles", private: true, https: "https://github.com/Ginortej/dotfiles.git", ssh: "git@github.com:Ginortej/dotfiles.git", desc: "" }]), 400)),
    GitClone: () => job("git clone"),
    GitCreateRemote: () => job("Создание репозитория"),
    TermOpenLocalAt: (...a) => api.TermOpenLocal(a[0], a[1]),
  };
  return { api, on: (ev, fn) => ((listeners[ev] ??= []).push(fn), () => {}) };
}
