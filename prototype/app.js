// ============================================================
//  Infra — прототип интерфейса (Obsidian-стиль)
//  Чистый JS без сборки. Логика разбита так, чтобы потом
//  перенести каждый блок в отдельный Svelte-компонент.
// ============================================================
const D = window.DATA;
const $ = (s, el = document) => el.querySelector(s);
const h = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------- Иконки ----------
const I = {
  server: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M7 7.5h.01M7 16.5h.01"/></svg>',
  term: '<svg viewBox="0 0 24 24"><path d="m5 8 4 4-4 4M12 17h7"/></svg>',
  file: '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  layers: '<svg viewBox="0 0 24 24"><path d="M12 3 3 7.5l9 4.5 9-4.5z"/><path d="m3 12 9 4.5 9-4.5"/><path d="m3 16.5 9 4.5 9-4.5"/></svg>',
  shield: '<svg viewBox="0 0 24 24"><path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z"/></svg>',
  code: '<svg viewBox="0 0 24 24"><path d="m8 9-4 3 4 3M16 9l4 3-4 3M14 5l-4 14"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  chev: '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 5v14l11-7z"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  camera: '<svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="3.5"/><path d="M4 8h3l2-3h6l2 3h3v11H4z"/></svg>',
  swap: '<svg viewBox="0 0 24 24"><path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/></svg>',
  upload: '<svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5M4 20h16"/></svg>',
  refresh: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></svg>',
  cpu: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/></svg>',
  activity: '<svg viewBox="0 0 24 24"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>',
  split: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/></svg>',
  globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>',
};

// ---------- Состояние ----------
const S = {
  panel: "servers",
  filter: "",
  collapsed: new Set(),
  tabs: [{ id: "home", type: "home", title: "Главная" }],
  active: "home",
  jobs: [],
  seq: 1,
};

// ============================================================
//  Боковая панель
// ============================================================
function renderSidebar() {
  const sb = $("#sidebar");
  const map = { servers: sideServers, vpn: sideVpn, labs: sideLabs, scripts: sideScripts };
  sb.innerHTML = "";
  sb.append(map[S.panel]());
  const f = $(".side-filter input", sb);
  if (f) { f.value = S.filter; f.oninput = () => { S.filter = f.value; renderList(); }; }
  renderList();
}

function sideShell(title, actions = "") {
  return h(`<div style="display:flex;flex-direction:column;height:100%">
    <div class="side-head"><span class="side-title">${title}</span><div class="side-actions">${actions}</div></div>
    <div class="side-filter">${I.search}<input placeholder="Фильтр…" spellcheck="false"></div>
    <div class="side-scroll" id="sideList"></div></div>`);
}

function sideServers() {
  return sideShell("Серверы",
    `<button class="icon-btn" title="Добавить сервер" data-cmd="server.add">${I.plus}</button>
     <button class="icon-btn" title="Обновить статусы" data-cmd="servers.refresh">${I.refresh}</button>`);
}
function sideVpn() { return sideShell("VPN", `<button class="icon-btn" title="Новый профиль" data-cmd="vpn.add">${I.plus}</button>`); }
function sideLabs() { return sideShell("Лабы", `<button class="icon-btn" title="Новая лаба" data-cmd="lab.new">${I.plus}</button>`); }
function sideScripts() { return sideShell("Скрипты", `<button class="icon-btn" title="Новый скрипт" data-cmd="script.new">${I.plus}</button>`); }

function match(str) { return !S.filter || str.toLowerCase().includes(S.filter.toLowerCase()); }

function group(name, itemsHtml) {
  const c = S.collapsed.has(name) ? " collapsed" : "";
  return `<div class="group${c}" data-group="${esc(name)}">
    <div class="group-label">${I.chev}<span>${esc(name)}</span></div>
    <div class="group-items">${itemsHtml}</div></div>`;
}

function renderList() {
  const list = $("#sideList");
  if (!list) return;
  let html = "";

  if (S.panel === "servers") {
    const groups = {};
    D.servers.filter((s) => match(s.id + s.host + s.tags.join())).forEach((s) => (groups[s.group] ??= []).push(s));
    for (const [g, arr] of Object.entries(groups)) {
      html += group(g, arr.map((s) => `
        <div class="item${activeServer() === s.id ? " active" : ""}" data-open="server:${s.id}" title="${esc(s.user + "@" + s.host)}">
          <span class="dot ${s.status}"></span><span class="name">${esc(s.id)}</span>
          ${s.vpn ? `<span class="meta">${esc(s.vpn)}</span>` : ""}
          <button class="icon-btn hover-act" title="Файлы (SFTP)" data-open="sftp:${s.id}">${I.folder}</button>
        </div>`).join(""));
    }
  }

  if (S.panel === "vpn") {
    html = D.vpns.filter((v) => match(v.id + v.type)).map((v) => `
      <div class="vpn-card${v.on ? " on" : ""}">
        <div class="vpn-row">
          <span class="dot ${v.on ? "ok" : ""}"></span>
          <span class="name">${esc(v.id)}</span>
          <span class="tag">${v.type}</span>
          <button class="switch${v.on ? " on" : ""}" data-vpn="${v.id}" title="${v.on ? "Отключить" : "Подключить"}"></button>
        </div>
        <div class="vpn-sub">
          <span>socks :${v.socks}</span>
          ${v.on ? `<span>${v.ping} ms</span><span>↓ ${v.rx}</span><span>↑ ${v.tx}</span>` : "<span>отключён</span>"}
        </div>
      </div>`).join("") +
      `<div class="group-label" style="cursor:default;margin-top:10px">Правила маршрутизации</div>
       <div class="item" data-open="file:vpn/work.yaml">${I.file}<span class="name">vpn/work.yaml</span></div>
       <div class="item" data-open="file:vpn/work.yaml">${I.globe}<span class="name">*.corp.local → work</span></div>
       <div class="item" data-open="file:vpn/work.yaml">${I.globe}<span class="name">10.0.0.0/8 → work</span></div>`;
  }

  if (S.panel === "labs") {
    html = D.labs.filter((l) => match(l.id + l.provider)).map((l) => {
      const run = l.vms.filter((v) => v.state === "running").length;
      return group(l.id, `
        <div class="item" data-open="lab:${l.id}">${I.layers}<span class="name">Обзор и план</span><span class="meta">${run}/${l.vms.length}</span></div>
        <div class="item" data-open="file:labs/${l.id}.yaml">${I.file}<span class="name">${l.id}.yaml</span></div>
        ${l.vms.map((v) => `<div class="item" data-open="server:${v.name}">
          <span class="dot ${v.state === "running" ? "ok" : v.state === "stopped" ? "warn" : ""}"></span>
          <span class="name">${v.name}</span><span class="meta">${v.state === "absent" ? "нет" : v.ip.split(".").pop()}</span></div>`).join("")}`);
    }).join("");
  }

  if (S.panel === "scripts") {
    const ans = D.scripts.filter((s) => s.kind === "ansible" && match(s.path));
    const sh = D.scripts.filter((s) => s.kind === "sh" && match(s.path));
    const row = (s) => `<div class="item" data-open="file:${s.path}">${s.kind === "ansible" ? I.layers : I.code}
      <span class="name">${s.path.split("/").pop()}</span>
      <button class="icon-btn hover-act" title="Запустить" data-run="${s.path}">${I.play}</button></div>`;
    html = group("Ansible playbooks", ans.map(row).join("")) + group("Сниппеты (bash)", sh.map(row).join(""));
  }

  list.innerHTML = html || `<div class="palette-empty">Ничего не найдено</div>`;
}

function activeServer() {
  const t = S.tabs.find((t) => t.id === S.active);
  return t && (t.type === "term" || t.type === "sftp") ? t.server : null;
}

// ============================================================
//  Вкладки
// ============================================================
function openTab(spec) {
  const [kind, id] = spec.split(/:(.*)/s);
  const existingKey = spec;
  // файлы, лабы и SFTP открываются один раз; терминалы — каждый раз новые
  if (kind !== "server") {
    const ex = S.tabs.find((t) => t.key === existingKey);
    if (ex) return activate(ex.id);
  }
  const tid = "t" + S.seq++;
  let tab;
  if (kind === "server") {
    const srv = D.servers.find((s) => s.id === id) || { id, host: id, user: "root", vpn: null };
    const n = S.tabs.filter((t) => t.server === id).length;
    tab = { id: tid, key: spec, type: "term", title: id + (n ? ` (${n + 1})` : ""), server: id, vpn: srv.vpn, lines: termGreeting(srv) };
  } else if (kind === "sftp") {
    tab = { id: tid, key: spec, type: "sftp", title: id + " · файлы", server: id, sel: null };
  } else if (kind === "file") {
    tab = { id: tid, key: spec, type: "editor", title: id.split("/").pop(), path: id, text: D.files[id] ?? `# ${id}\n` };
  } else if (kind === "lab") {
    tab = { id: tid, key: spec, type: "lab", title: id, lab: id };
  } else if (kind === "local") {
    tab = { id: tid, key: spec + tid, type: "term", title: "PowerShell", server: null, vpn: null, lines: [`<span class="dim">Windows PowerShell · через ConPTY</span>`, ""] };
  }
  S.tabs.push(tab);
  activate(tid);
}

function activate(id) {
  S.active = id;
  renderTabs();
  renderView();
  renderList();
}

function closeTab(id) {
  const i = S.tabs.findIndex((t) => t.id === id);
  if (i < 0) return;
  S.tabs.splice(i, 1);
  if (!S.tabs.length) S.tabs.push({ id: "home", type: "home", title: "Главная" });
  if (S.active === id) S.active = (S.tabs[i] || S.tabs[i - 1] || S.tabs[0]).id;
  renderTabs(); renderView(); renderList();
}

function renderTabs() {
  const icon = { home: I.layers, term: I.term, editor: I.file, sftp: I.folder, lab: I.layers };
  const bar = $("#tabbar");
  bar.innerHTML = S.tabs.map((t) => `
    <div class="tab${t.id === S.active ? " active" : ""}" data-tab="${t.id}" title="${esc(t.path || t.title)}">
      ${icon[t.type].replace("<svg", '<svg class="ico"')}
      <span class="title">${esc(t.title)}</span>
      <button class="close" data-close="${t.id}">${I.x}</button>
    </div>`).join("") +
    `<button class="tab-new" title="Новый терминал" data-cmd="term.local">${I.plus}</button>`;
  bar.querySelector(".tab.active")?.scrollIntoView({ inline: "nearest" });
}

// ============================================================
//  Виды
// ============================================================
function renderView() {
  const t = S.tabs.find((t) => t.id === S.active);
  const v = $("#view");
  v.innerHTML = "";
  ({ home: viewHome, term: viewTerm, editor: viewEditor, sftp: viewSftp, lab: viewLab })[t.type](v, t);
  renderStatus();
}

// ---------- Главная ----------
function viewHome(v) {
  v.append(h(`<div class="home"><div class="home-inner">
    <h1>MyInfra</h1>
    <p>${D.servers.length} серверов · ${D.vpns.filter((x) => x.on).length} VPN активно · ${D.labs.length} лабы</p>
    <div class="home-actions">
      <button class="home-action" data-cmd="palette">${I.search}<span>Найти сервер или команду</span><kbd>Ctrl P</kbd></button>
      <button class="home-action" data-cmd="term.local">${I.term}<span>Локальный терминал</span><kbd>Ctrl T</kbd></button>
      <button class="home-action" data-cmd="server.add">${I.plus}<span>Добавить сервер</span></button>
      <button class="home-action" data-open="lab:k8s-lab">${I.layers}<span>Открыть лабу k8s-lab</span></button>
    </div>
    <div class="home-section">Недавние</div>
    <div class="recent">
      <button data-open="server:prod-web-01">${I.term}<span>prod-web-01</span><span class="when">10 мин назад</span></button>
      <button data-open="file:labs/k8s-lab.yaml">${I.file}<span>labs/k8s-lab.yaml</span><span class="when">вчера</span></button>
      <button data-open="sftp:home-nas">${I.folder}<span>home-nas · файлы</span><span class="when">вчера</span></button>
      <button data-open="file:scripts/update-all.yml">${I.code}<span>scripts/update-all.yml</span><span class="when">3 дня назад</span></button>
    </div></div></div>`));
}

// ---------- Терминал ----------
function termGreeting(s) {
  const via = s.vpn ? ` через <span class="h">${s.vpn}</span> (socks :${D.vpns.find((v) => v.id === s.vpn)?.socks})` : "";
  return [
    `<span class="dim">Подключение к ${esc(s.user)}@${esc(s.host)}${via}…</span>`,
    `<span class="dim">Ключ хоста подтверждён (ED25519 SHA256:k3x…9fQ)</span>`,
    "",
    `Welcome to Ubuntu 24.04.1 LTS (GNU/Linux 6.8.0-45-generic x86_64)`,
    "",
    `  System load:  0.18    Memory usage: 41%   Processes: 132`,
    `  Usage of /:   37.2%   Swap usage:   0%    Users logged in: 1`,
    "",
    `Last login: Sat Oct 17 07:52:11 2026 from 10.8.0.2`,
  ];
}

function prompt(t) {
  if (!t.server) return `<span class="h">PS</span> <span class="p">C:\\Users\\user&gt;</span> `;
  const s = D.servers.find((x) => x.id === t.server);
  return `<span class="u">${esc(s?.user || "root")}@${esc(t.server)}</span><span class="p">:</span><span class="h">~</span><span class="p">$</span> `;
}

const fakeCmd = {
  help: () => ["Это прототип: попробуй ls, uptime, df -h, whoami, hostname, docker ps, clear"],
  ls: () => [`<span class="h">app</span>  <span class="h">backups</span>  <span class="h">logs</span>  docker-compose.yml  deploy.sh  nginx.conf`],
  uptime: () => [" 08:47:03 up 41 days,  3:12,  1 user,  load average: 0.18, 0.21, 0.19"],
  whoami: (t) => [D.servers.find((s) => s.id === t.server)?.user || "user"],
  hostname: (t) => [t.server || "DESKTOP-PC"],
  "df -h": () => [
    "Filesystem      Size  Used Avail Use% Mounted on",
    "/dev/sda1        80G   30G   47G  39% /",
    `/dev/sdb1       500G  431G   44G  <span class="y">91%</span> /var/backups`,
  ],
  "docker ps": () => [
    "CONTAINER ID   IMAGE            STATUS        NAMES",
    "a1f3c9e2b7d0   nginx:1.27       Up 6 days     web",
    "4c8d02e19a6f   app:1.4.2        Up 6 days     app",
    "9e7b3a51c2d8   redis:7          Up 6 days     cache",
  ],
};

function viewTerm(v, t) {
  const vpn = t.vpn ? D.vpns.find((x) => x.id === t.vpn) : null;
  const srv = D.servers.find((s) => s.id === t.server);
  v.append(h(`<div class="view-head">
    <div class="crumbs">${t.server ? `${I.server}<span>${esc(srv?.group || "")}</span>/<b>${esc(t.server)}</b>` : `${I.term}<b>Локальный терминал</b>`}</div>
    <div class="spacer"></div>
    ${t.server ? `<button class="chip" data-cmd="sftp.current">${I.folder}Файлы</button>` : ""}
    <button class="chip" data-vpnpick="${t.id}" title="Через какой VPN идёт трафик этой вкладки">
      <span class="dot ${vpn?.on ? "ok" : ""}"></span>${vpn ? esc(vpn.id) : "напрямую"} ${I.chev}
    </button>
  </div>`));

  const term = h(`<div class="term"></div>`);
  term.innerHTML = t.lines.map((l) => `<div class="ln">${l}</div>`).join("") +
    `<div class="input-line">${prompt(t)}<span class="cmd" contenteditable="plaintext-only" spellcheck="false"></span></div>`;
  v.append(term);
  const cmd = $(".cmd", term);
  term.onclick = () => { if (!getSelection().toString()) cmd.focus(); };
  cmd.onkeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const c = cmd.textContent.trim();
      t.lines.push(prompt(t) + esc(c));
      if (c === "clear") t.lines = [];
      else if (c && fakeCmd[c]) t.lines.push(...fakeCmd[c](t));
      else if (c) t.lines.push(`<span class="r">${esc(c.split(" ")[0])}: command not found</span>`);
      renderView();
    }
  };
  setTimeout(() => { cmd.focus(); term.scrollTop = term.scrollHeight; });
}

// ---------- Редактор YAML ----------
function hlYaml(src) {
  return src.split("\n").map((line) => {
    let l = esc(line), com = "";
    const ci = l.search(/(^|\s)#/);
    if (ci >= 0) { com = `<span class="y-com">${l.slice(ci)}</span>`; l = l.slice(0, ci); }
    l = l.replace(/^(\s*)(- )/, '$1<span class="y-dash">$2</span>')
         .replace(/^(\s*(?:<span class="y-dash">- <\/span>)?)([\w.\-]+)(:)(?=\s|$)/, '$1<span class="y-key">$2</span>$3')
         .replace(/(:\s+|- <\/span>)(true|false|yes|no|null)\s*$/, '$1<span class="y-bool">$2</span>')
         .replace(/(:\s+|- <\/span>|\[|, )(\d[\d.]*)(?=\s*$|,|\])/g, '$1<span class="y-num">$2</span>')
         .replace(/(&quot;.*?&quot;|'.*?')/g, '<span class="y-str">$1</span>');
    return l + com;
  }).join("\n") + "\n";
}

function viewEditor(v, t) {
  const parts = t.path.split("/");
  const isLab = t.path.startsWith("labs/");
  const isPlay = t.path.endsWith(".yml");
  v.append(h(`<div class="view-head">
    <div class="crumbs">${parts.slice(0, -1).map((p) => `<span>${esc(p)}</span>/`).join("")}<b>${esc(parts.at(-1))}</b></div>
    <div class="spacer"></div>
    ${isLab ? `<button class="btn" data-open="lab:${parts.at(-1).replace(".yaml", "")}">${I.layers}План</button>` : ""}
    ${isPlay || t.path.endsWith(".sh") ? `<button class="btn primary" data-run="${t.path}">${I.play}Запустить</button>` : ""}
  </div>`));

  const ed = h(`<div class="editor">
    <div class="gutter"></div>
    <div class="code-wrap"><pre></pre><textarea spellcheck="false"></textarea></div>
    <div class="editor-status"><span class="ok-badge">✓ схема ок</span></div>
  </div>`);
  v.append(ed);
  const ta = $("textarea", ed), pre = $("pre", ed), gut = $(".gutter", ed), wrap = $(".code-wrap", ed);
  const sync = () => {
    pre.innerHTML = hlYaml(ta.value);
    const n = ta.value.split("\n").length;
    gut.innerHTML = Array.from({ length: n }, (_, i) => i + 1).join("<br>");
    ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px";
    ta.style.width = "auto"; ta.style.width = Math.max(wrap.clientWidth, ta.scrollWidth) + "px";
  };
  ta.value = t.text;
  ta.oninput = () => { t.text = ta.value; sync(); };
  ta.onkeydown = (e) => {
    if (e.key === "Tab") { e.preventDefault(); document.execCommand("insertText", false, "  "); }
    if (e.ctrlKey && e.key === "s") { e.preventDefault(); toast(`${I.check} Сохранено: ${t.path}`); }
  };
  wrap.onscroll = () => (gut.scrollTop = wrap.scrollTop);
  requestAnimationFrame(sync);
  setTimeout(() => ta.focus());
}

// ---------- SFTP ----------
function viewSftp(v, t) {
  const s = D.servers.find((x) => x.id === t.server);
  v.append(h(`<div class="view-head">
    <div class="crumbs">${I.folder}<b>${esc(t.server)}</b><span>· SFTP</span></div>
    <div class="spacer"></div>
    <button class="btn" data-open="server:${t.server}">${I.term}Терминал</button>
    <button class="btn">${I.upload}Загрузить</button>
  </div>`));
  const rows = (list, side) => `<div class="frow head"><span class="fn">Имя</span><span>Размер</span><span>Изменён</span></div>` +
    list.map((f, i) => `<div class="frow${f.dir ? " dir" : ""}${t.sel === side + i ? " sel" : ""}" data-fsel="${side + i}">
      <span class="fn">${f.dir ? I.folder : I.file}${esc(f.n)}</span><span>${f.s || ""}</span><span>${f.d || ""}</span></div>`).join("");
  const el = h(`<div class="sftp">
    <div class="pane"><div class="pane-head"><b>Этот ПК</b> C:\\Users\\user\\Desktop\\Working</div><div class="files">${rows(D.localFiles, "l")}</div></div>
    <div class="pane"><div class="pane-head"><b>${esc(t.server)}</b> /home/${esc(s?.user || "root")}</div>
      <div class="files">${rows(D.remoteFiles, "r")}<div class="drop-hint">Перетащи файлы сюда из проводника или из левой панели</div></div></div>
  </div>`);
  el.onclick = (e) => { const r = e.target.closest("[data-fsel]"); if (r) { t.sel = r.dataset.fsel; renderView(); } };
  v.append(el);
}

// ---------- Лаба ----------
function viewLab(v, t) {
  const lab = D.labs.find((l) => l.id === t.lab);
  const absent = lab.vms.filter((x) => x.state === "absent");
  const stateTxt = { running: "работает", stopped: "остановлена", absent: "не создана" };
  const dot = { running: "ok", stopped: "warn", absent: "" };
  v.append(h(`<div class="view-head">
    <div class="crumbs">${I.layers}<span>labs</span>/<b>${esc(lab.id)}</b></div>
    <div class="spacer"></div>
    <button class="btn" data-open="file:labs/${lab.id}.yaml">${I.file}YAML</button>
  </div>`));
  v.append(h(`<div class="lab">
    <div class="lab-top">
      <div><h2>${esc(lab.id)}</h2><div class="sub">${lab.provider} · шаблон ${lab.template} · сеть ${lab.network}</div></div>
      <div class="acts">
        <button class="btn" data-labact="snapshot">${I.camera}Снапшот</button>
        <button class="btn" data-labact="stop">${I.stop}Остановить</button>
        <button class="btn danger" data-labact="destroy">${I.trash}Удалить</button>
        <button class="btn primary" data-labact="apply" data-lab="${lab.id}">${I.play}Применить</button>
      </div>
    </div>
    <div class="vm-grid">${lab.vms.map((m) => `
      <div class="vm">
        <div class="vm-h"><span class="dot ${dot[m.state]}"></span><span class="name">${m.name}</span><span class="tag">${stateTxt[m.state]}</span></div>
        <div class="vm-spec"><span>${m.cpu} vCPU</span><span>${m.ram / 1024} GB</span></div>
        <div class="vm-ip">${m.ip}</div>
        <div class="vm-acts">
          <button class="icon-btn" title="Терминал" data-open="server:${m.name}">${I.term}</button>
          <button class="icon-btn" title="Файлы" data-open="sftp:${m.name}">${I.folder}</button>
          <button class="icon-btn" title="${m.state === "running" ? "Остановить" : "Запустить"}">${m.state === "running" ? I.stop : I.play}</button>
        </div>
      </div>`).join("")}
    </div>
    <div class="plan">
      <div class="plan-h">${I.activity}План: YAML → текущее состояние</div>
      <pre>${absent.length || lab.vms.some((m) => m.state === "stopped")
        ? lab.vms.map((m) => m.state === "absent" ? `<span class="add">+ создать  ${m.name}  (${m.cpu} vCPU, ${m.ram} MB, ${m.ip})</span>`
          : m.state === "stopped" ? `<span class="chg">~ запустить ${m.name}</span>` : `<span class="dim">  без изменений ${m.name}</span>`).join("\n")
          + `\n\n<span class="chg">→ затем: ansible-playbook ${lab.playbook}</span>`
        : `<span class="dim">Всё совпадает с конфигом. Изменений нет.</span>\n<span class="dim">Последний provision: ${lab.playbook} · сегодня 07:40 · ok=42 changed=0</span>`}</pre>
    </div>
  </div>`));
}

// ============================================================
//  Статус-бар и задачи
// ============================================================
function renderStatus() {
  const on = D.vpns.filter((v) => v.on);
  const vms = D.labs.flatMap((l) => l.vms).filter((v) => v.state === "running").length;
  const t = S.tabs.find((t) => t.id === S.active);
  $("#statusbar").innerHTML = `
    <button class="sb" data-panel-go="vpn">${I.shield}${on.length ? on.map((v) => `<span class="dot ok"></span>${v.id}`).join(" ") : "VPN выкл"}</button>
    <button class="sb" data-panel-go="labs">${I.cpu}${vms} VM</button>
    ${S.jobs.map((j) => `<span class="sb">${I.activity}${esc(j.title)}<span class="job-bar"><div style="width:${j.p}%"></div></span></span>`).join("")}
    <span class="grow"></span>
    ${t.type === "term" && t.server ? `<span class="sb mono">ssh · ${t.vpn ? "socks :" + D.vpns.find((v) => v.id === t.vpn)?.socks : "direct"}</span>` : ""}
    ${t.type === "editor" ? `<span class="sb mono">YAML · UTF-8 · LF</span>` : ""}
    <span class="sb">MyInfra</span>`;
}

function runJob(title, done) {
  const j = { title, p: 0 };
  S.jobs.push(j);
  renderStatus();
  const iv = setInterval(() => {
    j.p = Math.min(100, j.p + 8 + Math.random() * 14);
    if (j.p >= 100) {
      clearInterval(iv);
      S.jobs = S.jobs.filter((x) => x !== j);
      done?.();
      toast(`${I.check} ${title} — готово`);
      renderView();
    } else renderStatus();
  }, 280);
}

// ============================================================
//  Палитра команд
// ============================================================
function commands() {
  const c = [];
  D.servers.forEach((s) => {
    c.push({ cat: "SSH", title: `Подключиться: ${s.id}`, hint: s.host, run: () => openTab("server:" + s.id) });
    c.push({ cat: "SFTP", title: `Файлы: ${s.id}`, hint: s.host, run: () => openTab("sftp:" + s.id) });
  });
  D.vpns.forEach((v) => c.push({ cat: "VPN", title: `${v.on ? "Отключить" : "Подключить"} VPN: ${v.id}`, hint: v.type, run: () => toggleVpn(v.id) }));
  D.labs.forEach((l) => {
    c.push({ cat: "Лаба", title: `Открыть лабу: ${l.id}`, hint: l.provider, run: () => openTab("lab:" + l.id) });
    c.push({ cat: "Лаба", title: `lab up ${l.id}`, hint: "применить конфиг", run: () => labApply(l.id) });
  });
  D.scripts.forEach((s) => c.push({ cat: s.kind === "ansible" ? "Ansible" : "Сниппет", title: `Запустить: ${s.path.split("/").pop()}`, hint: s.path, run: () => runScript(s.path) }));
  Object.keys(D.files).forEach((f) => c.push({ cat: "Файл", title: f, run: () => openTab("file:" + f) }));
  c.push({ cat: "Терминал", title: "Новый локальный терминал", hint: "Ctrl+T", run: () => openTab("local:") });
  c.push({ cat: "Сервер", title: "Добавить сервер", run: () => openTab("file:servers/new-server.yaml") });
  return c;
}

let palItems = [], palSel = 0;
function openPalette(q = "") {
  $("#paletteBackdrop").hidden = false;
  const inp = $("#paletteInput");
  inp.value = q; palSel = 0; filterPalette(); inp.focus();
}
function closePalette() { $("#paletteBackdrop").hidden = true; }
function filterPalette() {
  const q = $("#paletteInput").value.trim().toLowerCase();
  const all = commands();
  palItems = q ? all.filter((c) => fuzzy(q, (c.cat + " " + c.title + " " + (c.hint || "")).toLowerCase())) : all.slice(0, 40);
  palSel = Math.min(palSel, Math.max(0, palItems.length - 1));
  const hl = (s) => q ? esc(s).replace(new RegExp(`(${q.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi"), "<mark>$1</mark>") : esc(s);
  $("#paletteList").innerHTML = palItems.length
    ? palItems.slice(0, 60).map((c, i) => `<li class="${i === palSel ? "sel" : ""}" data-pi="${i}"><span class="cat">${c.cat}</span><span>${hl(c.title)}</span><span class="hint">${esc(c.hint || "")}</span></li>`).join("")
    : `<div class="palette-empty">Нет команд</div>`;
  $("#paletteList .sel")?.scrollIntoView({ block: "nearest" });
}
function fuzzy(q, s) { return q.split(/\s+/).every((w) => s.includes(w)); }
function runPal(i) { const c = palItems[i]; closePalette(); c?.run(); }

// ============================================================
//  Действия
// ============================================================
function toggleVpn(id) {
  const v = D.vpns.find((x) => x.id === id);
  if (!v.on) {
    runJob(`VPN ${id}: подключение`, () => { v.on = true; v.ping = 40 + Math.round(Math.random() * 30); v.rx = "0 B"; v.tx = "0 B"; renderList(); });
  } else { v.on = false; toast(`VPN ${id} отключён`); renderList(); renderView(); }
}

function labApply(id) {
  const lab = D.labs.find((l) => l.id === id);
  openTab("lab:" + id);
  runJob(`lab up ${id}`, () => { lab.vms.forEach((m) => (m.state = "running")); renderList(); });
}

function runScript(path) {
  const tid = "t" + S.seq++;
  const ansible = path.endsWith(".yml");
  const lines = ansible ? [
    `<span class="dim">wsl -d infra -- ansible-playbook -i .app/inventory.ini ${esc(path)}</span>`, "",
    `PLAY [Обновить все серверы] ****************************************`, "",
    `TASK [Gathering Facts] *********************************************`,
    ...["prod-web-01", "prod-web-02", "prod-db-01", "staging-01"].map((s) => `<span class="u">ok: [${s}]</span>`), "",
    `TASK [apt update && upgrade] ***************************************`,
    `<span class="y">changed: [prod-web-01]</span>`, `<span class="y">changed: [prod-web-02]</span>`, `<span class="u">ok: [prod-db-01]</span>`, `<span class="y">changed: [staging-01]</span>`, "",
    `PLAY RECAP *********************************************************`,
    `prod-web-01  : <span class="u">ok=3</span>  <span class="y">changed=1</span>  unreachable=0  failed=0`,
    `prod-web-02  : <span class="u">ok=3</span>  <span class="y">changed=1</span>  unreachable=0  failed=0`,
    `prod-db-01   : <span class="u">ok=3</span>  changed=0  unreachable=0  failed=0`,
    `staging-01   : <span class="u">ok=3</span>  <span class="y">changed=1</span>  unreachable=0  failed=0`,
  ] : [
    `<span class="dim">Сниппет ${esc(path)} → группа prod (3 сервера, параллельно)</span>`, "",
    `<span class="h">── prod-web-01</span>`, "/dev/sda1   80G   30G   47G  39% /", "",
    `<span class="h">── prod-web-02</span>`, "/dev/sda1   80G   28G   49G  37% /", "",
    `<span class="h">── prod-db-01</span>`, "/dev/sda1  200G  120G   70G  63% /", `/dev/sdb1  500G  431G   44G  <span class="y">91%</span> /var/backups`,
  ];
  S.tabs.push({ id: tid, key: "run:" + tid, type: "term", title: "▶ " + path.split("/").pop(), server: null, vpn: null, lines });
  activate(tid);
}

function vpnMenu(btn, t) {
  document.querySelector(".menu")?.remove();
  const r = btn.getBoundingClientRect();
  const m = h(`<div class="menu" style="top:${r.bottom + 4}px;left:${Math.max(8, r.right - 220)}px">
    <button data-pick="">${I.globe}Напрямую<span class="meta">без VPN</span></button><div class="sep"></div>
    ${D.vpns.map((v) => `<button data-pick="${v.id}"><span class="dot ${v.on ? "ok" : ""}"></span>${v.id}<span class="meta">:${v.socks}</span></button>`).join("")}
  </div>`);
  m.onclick = (e) => {
    const b = e.target.closest("[data-pick]"); if (!b) return;
    t.vpn = b.dataset.pick || null;
    t.lines.push(`<span class="dim">── трафик вкладки переключён: ${t.vpn ? t.vpn : "напрямую"} (переподключение…)</span>`);
    m.remove(); renderView();
  };
  document.body.append(m);
  setTimeout(() => document.addEventListener("click", () => m.remove(), { once: true }));
}

let toastT;
function toast(html) {
  const el = $("#toast"); el.innerHTML = html; el.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => (el.hidden = true), 2400);
}

// ============================================================
//  События
// ============================================================
document.addEventListener("click", (e) => {
  const el = (sel) => e.target.closest(sel);
  let x;
  if ((x = el("[data-close]"))) { e.stopPropagation(); return closeTab(x.dataset.close); }
  if ((x = el("[data-vpn]"))) return toggleVpn(x.dataset.vpn);
  if ((x = el("[data-run]"))) { e.stopPropagation(); return runScript(x.dataset.run); }
  if ((x = el("[data-open]"))) { e.stopPropagation(); return openTab(x.dataset.open); }
  if ((x = el("[data-tab]"))) return activate(x.dataset.tab);
  if ((x = el("[data-vpnpick]"))) { e.stopPropagation(); return vpnMenu(x, S.tabs.find((t) => t.id === x.dataset.vpnpick)); }
  if ((x = el("[data-labact]"))) {
    const a = x.dataset.labact, lab = S.tabs.find((t) => t.id === S.active)?.lab;
    if (a === "apply") return labApply(lab);
    if (a === "snapshot") return runJob(`snapshot ${lab}`);
    if (a === "stop") return runJob(`lab stop ${lab}`, () => D.labs.find((l) => l.id === lab).vms.forEach((m) => m.state !== "absent" && (m.state = "stopped")));
    if (a === "destroy") return toast("Удаление требует подтверждения (в прототипе отключено)");
  }
  if ((x = el(".group-label"))) {
    const g = x.parentElement.dataset.group; if (!g) return;
    S.collapsed.has(g) ? S.collapsed.delete(g) : S.collapsed.add(g); return renderList();
  }
  if ((x = el("[data-panel]"))) {
    document.querySelectorAll("#ribbon [data-panel]").forEach((b) => b.classList.toggle("active", b === x));
    S.panel = x.dataset.panel; S.filter = ""; return renderSidebar();
  }
  if ((x = el("[data-panel-go]"))) return $(`#ribbon [data-panel="${x.dataset.panelGo}"]`).click();
  if ((x = el("[data-pi]"))) return runPal(+x.dataset.pi);
  if ((x = el("[data-cmd]"))) {
    const c = x.dataset.cmd;
    if (c === "palette") return openPalette();
    if (c === "term.local") return openTab("local:");
    if (c === "server.add") return openTab("file:servers/prod-web-01.yaml");
    if (c === "sftp.current") return openTab("sftp:" + activeServer());
    if (c === "servers.refresh") return runJob("Проверка доступности серверов");
    if (c === "lab.new") return openTab("file:labs/k8s-lab.yaml");
    if (c === "vpn.add") return openTab("file:vpn/work.yaml");
    if (c === "script.new") return openTab("file:scripts/snippets/disk.sh");
  }
  if (el("#openPalette")) return openPalette();
  if (e.target.id === "paletteBackdrop") closePalette();
});

$("#paletteInput").addEventListener("input", () => { palSel = 0; filterPalette(); });
$("#paletteInput").addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") { e.preventDefault(); palSel = Math.min(palSel + 1, palItems.length - 1); filterPalette(); }
  if (e.key === "ArrowUp") { e.preventDefault(); palSel = Math.max(palSel - 1, 0); filterPalette(); }
  if (e.key === "Enter") runPal(palSel);
  if (e.key === "Escape") closePalette();
});

document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && (e.key === "p" || e.key === "з")) { e.preventDefault(); openPalette(); }
  if (e.ctrlKey && (e.key === "t" || e.key === "е")) { e.preventDefault(); openTab("local:"); }
  if (e.ctrlKey && (e.key === "w" || e.key === "ц")) { e.preventDefault(); closeTab(S.active); }
  if (e.ctrlKey && e.key === "Tab") {
    e.preventDefault();
    const i = S.tabs.findIndex((t) => t.id === S.active);
    activate(S.tabs[(i + (e.shiftKey ? -1 : 1) + S.tabs.length) % S.tabs.length].id);
  }
  if (e.key === "Escape") document.querySelector(".menu")?.remove();
});

// Ширина боковой панели
(() => {
  const r = $("#resizer"); let x0, w0;
  r.onmousedown = (e) => {
    x0 = e.clientX; w0 = $("#sidebar").offsetWidth; r.classList.add("drag");
    const mv = (ev) => document.documentElement.style.setProperty("--sidebar-w", Math.min(480, Math.max(180, w0 + ev.clientX - x0)) + "px");
    const up = () => { r.classList.remove("drag"); removeEventListener("mousemove", mv); removeEventListener("mouseup", up); };
    addEventListener("mousemove", mv); addEventListener("mouseup", up);
  };
})();

// Старт
renderSidebar();
renderTabs();
renderView();
