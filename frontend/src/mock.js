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
  const sys = { cpu: 22, gpu: 18, ram: 14 };
  const aiLoaded = [];
  const aiPrefs = { aiModel: "", aiCommand: "" };
  let gitDefault = "github-ginortej";
  const gitAcc = localStorage.getItem("mock.noacc") ? [] : [
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
    GetState: () => ({ version: "0.1.0-dev", vault: vaultPath, recent: [vaultPath, "D:\\work\\infra-lab"].filter(Boolean), os: "windows", settings: { parallel: 10, gitDefault, ...aiPrefs },
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
      if (d === "\r" && t.ai) {
        const q = t.line; t.line = "";
        const ans = q.startsWith("/") ? "" : "Конечно! Вот пример команды для проверки свободного места на сервере:\r\n\r\n  df -h -x tmpfs\r\n\r\nОна покажет размер, занятое и свободное место по каждому разделу.";
        emit("term:data", id, b64("\r\n" + ans + "\r\n\r\n" + t.prompt));
        return;
      }
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
    // ---------- мониторинг и ИИ ----------
    SysStats: () => { const w = (v, d, lo, hi) => Math.max(lo, Math.min(hi, v + (Math.random() - 0.5) * d)); sys.cpu = w(sys.cpu, 18, 3, 97); sys.gpu = w(sys.gpu, 22, 0, 99); sys.ram = w(sys.ram, 0.6, 6, 30);
      return { cpu: sys.cpu, cores: 16, ramUsed: sys.ram * 2 ** 30, ramTotal: 32 * 2 ** 30, time: Date.now() / 1000,
        gpus: [{ name: "NVIDIA GeForce RTX 4070", util: sys.gpu, memUsed: (aiLoaded.length ? 6.1 : 1.2) * 2 ** 30, memTotal: 12 * 2 ** 30, temp: 52 + sys.gpu / 5, source: "nvidia-smi" }] }; },
    AIStatus: () => ({ installed: !localStorage.getItem("mock.noollama"), running: !localStorage.getItem("mock.noollama"), version: "0.12.6", host: "http://127.0.0.1:11434",
      models: [...(localStorage.getItem("mock.nomodels") ? [] : [{ name: "llama3.2:3b", size: 2019393189, params: "3.2B", quant: "Q4_K_M" }, { name: "qwen3:8b", size: 5225376047, params: "8.2B", quant: "Q4_K_M" }, { name: "qwen2.5-coder:7b", size: 4683087332, params: "7.6B", quant: "Q4_K_M" }]), ...aiModels],
      loaded: aiLoaded.map((n) => ({ name: n, size: 5.6 * 2 ** 30, sizeVram: 5.6 * 2 ** 30 })) }),
    AIStartServer: () => {}, AIUnload: (m) => { const i = aiLoaded.indexOf(m); if (i >= 0) aiLoaded.splice(i, 1); },
    AISetPrefs: (m, c) => { aiPrefs.aiModel = m; aiPrefs.aiCommand = c; },
    AIOpen: (model, mode, custom) => {
      const id = "term" + seq++;
      if (mode === "run") {
        if (!aiLoaded.includes(model)) aiLoaded.push(model);
        terms[id] = { line: "", prompt: "\x1b[1m>>> \x1b[0m", ai: true };
        emit("term:data", id, b64(`\x1b[90mollama run ${model}\x1b[0m\r\n\x1b[1m>>> \x1b[0m\x1b[90mSend a message (/? for help)\x1b[0m\r\x1b[4C`));
      } else {
        terms[id] = { line: "", prompt: "" };
        let p = 0; const iv = setInterval(() => { p += 20; emit("term:data", id, b64(`\rpulling ${model}… ${p}%   `)); if (p >= 100) { clearInterval(iv); emit("term:data", id, b64("\r\nsuccess\r\n")); emit("term:exit", id, "процесс завершён, код 0"); } }, 300);
      }
      return id;
    },
    TermOpenLocalWith: (...a) => api.TermOpenLocal(a[0], a[1]),
    // ---------- агенты, маркет, MCP, база знаний ----------
    HFSearch: (q) => new Promise((r) => setTimeout(() => r([
      { id: "unsloth/Qwen3-8B-GGUF", author: "unsloth", downloads: 1840000, likes: 312, pipeline: "text-generation", tags: ["qwen3", "unsloth", "conversational"] },
      { id: "bartowski/Qwen_Qwen3-14B-GGUF", author: "bartowski", downloads: 412000, likes: 98, pipeline: "text-generation", tags: ["imatrix"] },
      { id: "Qwen/Qwen3-VL-8B-Instruct-GGUF", author: "Qwen", downloads: 1083024, likes: 140, pipeline: "image-text-to-text", tags: ["conversational"] },
      { id: "lmstudio-community/gemma-3-12b-it-GGUF", author: "lmstudio-community", downloads: 290000, likes: 77, pipeline: "image-text-to-text", tags: ["gemma3"] },
      { id: "Vikhrmodels/Vikhr-Nemo-12B-Instruct-R-21-09-24-GGUF", author: "Vikhrmodels", downloads: 21000, likes: 64, pipeline: "text-generation", tags: ["ru", "instruct"] },
    ].filter((m) => !q || m.id.toLowerCase().includes(q.toLowerCase().split(" ")[0]))), 500)),
    HFFiles: () => new Promise((r) => setTimeout(() => r([{ quant: "Q3_K_M", size: 4.1e9 }, { quant: "Q4_K_M", size: 5.03e9 }, { quant: "UD-Q4_K_XL", size: 5.1e9 }, { quant: "Q8_0", size: 8.7e9 }, { quant: "BF16", size: 16.4e9, split: true }]), 400)),
    AILoad: (m) => { emit("ai:model", m, "loading"); setTimeout(() => { if (!aiLoaded.includes(m)) aiLoaded.push(m); emit("ai:model", m, "loaded"); }, 2500); },
    AICatalog: () => ({ models: mockModels, agents: mockTemplates, tools: mockTools }),
    AIPull: (m) => { let c = 0; const total = 4.7e9; const iv = setInterval(() => { c += total / 12; if (c >= total) { clearInterval(iv); aiModels.push({ name: m.includes(":") ? m : m + ":latest", size: total, params: "?", quant: "Q4_K_M" }); emit("ai:pull", { model: m, done: true, status: "готово" }); } else emit("ai:pull", { model: m, status: "pulling", completed: c, total }); }, 250); },
    AIPullCancel: () => {}, AIPulling: () => [],
    AIDelete: (m) => { const i = aiModels.findIndex((x) => x.name === m); if (i >= 0) aiModels.splice(i, 1); },
    AIModelCaps: () => ["completion", "tools"],
    AIProvider: () => ({ endpoint: aiProv.endpoint, hasKey: !!aiProv.key }), AISetProvider: (e, k) => { aiProv.endpoint = e; if (k && k !== "-") aiProv.key = k; if (k === "-") aiProv.key = ""; },
    AIProviderModels: () => aiProv.endpoint ? ["qwen2.5-7b-instruct", "llama-3.1-8b"] : Promise.reject("адрес сервера не задан"),
    AgentList: () => agents.map((a) => ({ ...a })),
    AgentSave: (a) => { if (!a.id) a.id = (a.name || "agent").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "agent" + seq++; const i = agents.findIndex((x) => x.id === a.id); i >= 0 ? (agents[i] = a) : agents.push(a); return a; },
    AgentDelete: (id) => { const i = agents.findIndex((x) => x.id === id); if (i >= 0) agents.splice(i, 1); },
    AgentFromTemplate: (id, model) => { const t = mockTemplates.find((x) => x.template === id); const a = { ...t, id: id + "-" + seq++, model: model || t.model, provider: "ollama", approve: "danger", temperature: 0.3 }; delete a.long; agents.push(a); return a; },
    AISetDefaultAgent: () => {},
    ChatList: () => Object.values(chats).filter((c) => c.messages.length).map((c) => ({ id: c.id, agent: c.agent, title: c.title, updated: c.updated, count: c.messages.length })).sort((a, b) => b.updated - a.updated),
    ChatLoad: (id) => chats[id] || Promise.reject("нет чата"), ChatDelete: (id) => { delete chats[id]; }, ChatBusy: () => false, ChatStop: (id) => { chatStop[id] = true; },
    ChatSend: (sid, agentId, text) => mockChat(sid, agentId, text),
    AgentApprove: (id, d) => { const p = pending[id]; if (!p) throw "запрос уже неактуален"; delete pending[id]; p(d); },
    AgentPending: () => [],
    KnowledgeStatus: () => ({ root: "knowledge", exists: knowOn, files: knowOn ? 5 : 0, chunks: knowOn ? 23 : 0, vectors: aiModels.some((m) => m.name.startsWith("nomic")), model: "nomic-embed-text", built: Date.now() / 1000, error: "", rulesFile: "knowledge/security/rules.yaml", hasRules: knowOn, guardErrors: [], embedModel: "nomic-embed-text", embedReady: aiModels.some((m) => m.name.startsWith("nomic")) }),
    KnowledgeInit: () => { knowOn = true; return 6; }, KnowledgeReindex: () => {},
    KnowledgeSearch: (q) => [{ file: "security/policy.md", heading: "Фаервол", text: "Фаервол (ufw/nftables) должен быть включён всегда. Открывать порт — только конкретный, с комментарием.", score: 0.03, words: 4.2, vector: 0.71 }, { file: "security/ssh-hardening.md", heading: "Открытые порты", text: "ss -tlnp — наружу должны слушать только нужные сервисы.", score: 0.02, words: 2.1, vector: 0.55 }],
    SetRAGModel: () => {},
    GuardCheck: (t) => /rm\s+-rf\s+\/(\s|$)|mkfs/.test(t) ? { level: "deny", reasons: ["рекурсивное удаление системных каталогов"] } : /reboot|iptables -F|ufw disable|restart postgres/.test(t) ? { level: "strict", reasons: ["выключение или перезагрузка сервера"] } : { level: "allow", reasons: [] },
    MCPStatus: () => mcpInfo(), MCPSetEnabled: (on) => { mcp.on = on; return mcpInfo(); }, MCPSetReadOnly: (ro) => { mcp.ro = ro; return mcpInfo(); }, MCPNewToken: () => mcpInfo(), MCPResetAllow: () => {},
  };
  // ----- данные ИИ для мока -----
  const aiModels = [];
  const mv = (tag, size) => ({ tag, size });
  const mockModels = [
    { id: "qwen3", title: "Qwen3", publisher: "Alibaba", pick: "8b", desc: "Универсальная модель с режимом рассуждений. Хорошо вызывает инструменты и понимает русский — лучший выбор для агента.", caps: ["tools", "thinking", "ru"], variants: [mv("1.7b", 1.4), mv("4b", 2.5), mv("8b", 5.2), mv("14b", 9.3), mv("32b", 20)] },
    { id: "gpt-oss", title: "gpt-oss", publisher: "OpenAI", pick: "20b", desc: "Открытая модель OpenAI с рассуждениями и инструментами. Нужна видеокарта от 16 ГБ.", caps: ["tools", "thinking", "ru"], variants: [mv("20b", 14), mv("120b", 65)] },
    { id: "qwen2.5-coder", title: "Qwen2.5 Coder", publisher: "Alibaba", pick: "7b", desc: "Для кода, скриптов bash/PowerShell и конфигов. Быстрая и точная.", caps: ["tools", "code", "ru"], variants: [mv("1.5b", 1), mv("3b", 1.9), mv("7b", 4.7), mv("14b", 9), mv("32b", 20)] },
    { id: "llama3.2", title: "Llama 3.2", publisher: "Meta", pick: "3b", desc: "Маленькая и быстрая. Подойдёт для слабых ПК и простых вопросов.", caps: ["tools"], variants: [mv("1b", 1.3), mv("3b", 2)] },
    { id: "gemma3", title: "Gemma 3", publisher: "Google", pick: "4b", desc: "Понимает картинки и скриншоты, хорошо пишет текст. Инструменты не вызывает — только чат.", caps: ["vision", "ru"], variants: [mv("1b", 0.8), mv("4b", 3.3), mv("12b", 8.1), mv("27b", 17)] },
    { id: "deepseek-r1", title: "DeepSeek-R1", publisher: "DeepSeek", pick: "8b", desc: "Рассуждающая модель: думает перед ответом.", caps: ["thinking", "tools"], variants: [mv("8b", 5.2), mv("14b", 9), mv("32b", 20)] },
    { id: "nomic-embed-text", title: "Nomic Embed", publisher: "Nomic AI", pick: "latest", desc: "Модель эмбеддингов для поиска по документам (RAG). Не для чата.", caps: ["embed"], variants: [mv("latest", 0.27)] },
  ];
  const T = (name, title, group, danger) => ({ name, title, group, danger, desc: title });
  const mockTools = [T("list_servers", "Список серверов", "servers"), T("run_command", "Команда на сервере", "servers", true), T("read_file", "Прочитать файл", "files"), T("list_dir", "Содержимое папки", "files"), T("write_file", "Записать файл", "files", true),
    T("list_scripts", "Список скриптов", "scripts"), T("read_vault_file", "Файл хранилища", "scripts"), T("write_vault_file", "Записать в хранилище", "scripts", true), T("run_script", "Запустить скрипт", "scripts", true),
    T("vpn_status", "Состояние VPN", "vpn"), T("vpn_switch", "Вкл/выкл VPN", "vpn", true), T("list_labs", "Лабы", "labs"), T("lab_action", "Действие с лабой", "labs", true),
    T("git_repos", "Репозитории", "git"), T("git_status", "Git: статус", "git"), T("git_diff", "Git: изменения", "git"), T("git_log", "Git: история", "git"), T("local_command", "Команда на этом ПК", "local", true), T("search_knowledge", "Поиск в базе знаний", "knowledge")];
  const rd = ["list_servers", "list_dir", "read_file", "search_knowledge"];
  const mockTemplates = [
    { template: "devops", name: "DevOps-помощник", icon: "server", color: "#8b7cf6", model: "qwen3:8b", desc: "Смотрит состояние серверов, выполняет команды, правит конфиги и запускает скрипты.", long: "Универсальный агент для повседневной работы: «проверь место на дисках на всех prod», «перезапусти nginx на web-01 и покажи логи». Каждое изменение — только после твоего «Разрешить».", tools: [...rd, "run_command", "write_file", "list_scripts", "read_vault_file", "run_script", "vpn_status", "list_labs"], system: "Ты — DevOps-инженер." },
    { template: "logs", name: "Разбор логов", icon: "activity", color: "#e0a03c", model: "qwen3:8b", desc: "Ищет причину ошибок: journalctl, логи nginx, docker, dmesg. Ничего не меняет.", long: "Безопасный агент для расследований: читает логи и состояние сервисов, формулирует причину и план.", tools: [...rd, "run_command"], system: "Ты — инженер по разбору инцидентов." },
    { template: "security", name: "Аудитор безопасности", icon: "shield", color: "#4cc38a", model: "qwen3:8b", desc: "Проверяет серверы по чек-листу из базы знаний: SSH, порты, обновления, фаервол.", long: "Опирается на твою базу знаний (knowledge/security): сверяет конфигурацию серверов с политиками и выдаёт отчёт с рисками и исправлениями.", tools: [...rd, "run_command"], system: "Ты — аудитор безопасности." },
    { template: "scripter", name: "Автор скриптов", icon: "code", color: "#5aa9f0", model: "qwen2.5-coder:7b", desc: "Пишет bash, PowerShell и Ansible-плейбуки прямо в папку scripts/.", long: "Опиши задачу словами — агент напишет скрипт или плейбук и сохранит в хранилище.", tools: ["list_scripts", "read_vault_file", "write_vault_file", "list_servers", "search_knowledge"], system: "Ты пишешь скрипты." },
    { template: "chat", name: "Просто чат", icon: "sparkle", color: "#9aa0a6", model: "llama3.2:3b", desc: "Модель без доступа к серверам.", long: "Обычный локальный чат. Ничего не видит и ничего не трогает.", tools: [], system: "Ты — полезный ассистент." },
  ];
  const agents = localStorage.getItem("mock.noagents") ? [] : [{ ...mockTemplates[0], id: "devops", provider: "ollama", approve: "danger", temperature: 0.3 }, { ...mockTemplates[2], id: "security", provider: "ollama", approve: "danger", temperature: 0.2 }];
  agents.forEach((a) => delete a.long);
  const chats = {}, pending = {}, chatStop = {};
  const aiProv = { endpoint: "", key: "" };
  let knowOn = !localStorage.getItem("mock.noknow");
  const mcp = { on: !!localStorage.getItem("mock.mcp"), ro: false };
  const mcpInfo = () => ({ enabled: mcp.on, running: mcp.on, port: 47821, url: "http://127.0.0.1:47821/mcp", token: "3f9c0a1b7d2e4c6f8a0b1c2d3e4f5a6b7c8d9e0f", readOnly: mcp.ro, exe: "C:\\Users\\user\\Infra\\Infra.exe", tools: mcp.ro ? 12 : 19,
    log: mcp.on ? [{ time: Date.now() / 1000 - 300, client: "claude-ai", what: "подключение", result: "ок" }, { time: Date.now() / 1000 - 200, client: "claude-ai", what: "list_servers", result: "ок" }, { time: Date.now() / 1000 - 100, client: "claude-ai", what: "run_command", result: "отклонено" }] : [],
    configs: [{ client: "Claude Desktop", where: "%APPDATA%\\Claude\\claude_desktop_config.json", lang: "json", text: '{\n  "mcpServers": {\n    "infra": {\n      "command": "C:\\\\Users\\\\user\\\\Infra\\\\Infra.exe",\n      "args": ["mcp"]\n    }\n  }\n}' },
      { client: "Claude Code", where: "в терминале", lang: "shell", text: 'claude mcp add infra --scope user -- "C:\\Users\\user\\Infra\\Infra.exe" mcp' }] });
  function mockChat(sid, agentId, text) {
    const id = sid || "c" + seq++;
    const c = (chats[id] ??= { id, agent: agentId, title: text.slice(0, 46), created: Date.now() / 1000, messages: [] });
    c.messages.push({ role: "user", content: text });
    c.updated = Date.now() / 1000;
    const ev = (type, x = {}) => emit("agent:event", { session: id, type, ...x });
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const say = async (s) => { for (const w of s.match(/\S+\s*/g)) { if (chatStop[id]) return; ev("delta", { text: w }); await wait(25); } };
    (async () => {
      ev("start"); await wait(200);
      const model = agents.find((x) => x.id === agentId)?.model;
      if (!aiLoaded.includes(model)) {
        ev("status", { id: "model", text: `Загружаю ${model} в память (4.9 ГБ)…` }); await wait(2600);
        aiLoaded.push(model);
        ev("loaded", { id: "model", text: `${model} загружена за 2.6 с · 5.6 ГБ в видеопамяти` }); ev("model", { ok: true });
      }
      for (const w of "Нужно посмотреть место на дисках на серверах. Начну со списка.".split(" ")) { ev("thinking", { text: w + " " }); await wait(20); }
      const a1 = { id: "call_1", name: "list_servers", args: {} };
      ev("tool", { id: a1.id, tool: a1.name, args: "{}" }); await wait(300);
      ev("result", { id: a1.id, tool: a1.name, ok: true, text: '<data source="list_servers">\n- prod-web-01: deploy@10.0.5.12:22, group=prod\n- prod-db-01: admin@10.0.6.20:22, group=prod, READ-ONLY by policy\n</data>' });
      await say("Проверю место на дисках на **prod-web-01**:");
      const a2 = { server: "prod-web-01", command: "df -h -x tmpfs -x devtmpfs" };
      ev("tool", { id: "call_2", tool: "run_command", args: JSON.stringify(a2) });
      const d = await new Promise((res) => { const apid = "ap" + seq++; pending[apid] = res; emit("agent:approve", { id: apid, source: "chat", session: id, agent: agents.find((x) => x.id === agentId)?.name, tool: "run_command", title: "Команда на сервере", summary: a2.command, servers: ["prod-web-01"], level: "allow", reasons: [], danger: true,
        knowledge: [{ file: "security/policy.md", heading: "Изменения на серверах", text: "- Перед правкой конфига — резервная копия рядом: file.bak-ДАТА.\n- На серверах группы prod изменения — только в окно обслуживания, кроме аварий." }] }); });
      if (d.startsWith("deny")) { ev("result", { id: "call_2", tool: "run_command", ok: false, text: "ОШИБКА: пользователь отклонил это действие. Не повторяй его без нового запроса" }); await say("Хорошо, не выполняю. Могу предложить команду для ручной проверки:\n\n```bash\ndf -h -x tmpfs -x devtmpfs\n```"); }
      else {
        await wait(500);
        ev("result", { id: "call_2", tool: "run_command", ok: true, text: '<data source="run_command">\nexit code: 0\nFilesystem      Size  Used Avail Use% Mounted on\n/dev/sda1        40G   31G  7.1G  82% /\n/dev/sdb1       200G   94G  106G  47% /var/lib/docker\nDB_PASSWORD=[скрыто]\n</data>\n[Infra: скрыто секретов — 1]' });
        await say("На **prod-web-01**:\n\n- `/` занято **82%** (свободно 7.1 ГБ) — стоит почистить\n- `/var/lib/docker` — 47%, всё в порядке\n\nЧаще всего место на корне съедают журналы. Можно освободить так:\n\n```bash\nsudo journalctl --vacuum-size=500M\nsudo apt-get clean\n```\n\nВыполнить?");
      }
      c.messages.push({ role: "assistant", content: "…" });
      ev("done");
    })();
    return id;
  }
  return { api, on: (ev, fn) => ((listeners[ev] ??= []).push(fn), () => {}) };
}
