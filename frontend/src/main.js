import "./styles.css";
import { api, on, win, errText } from "./api.js";
import { S, app, serverById, vpnRunning } from "./core.js";
import { $, $$, h, esc, I, menu, closeMenu, toast, shellIcon, store, confirmBox } from "./ui.js";
import { terminalTab, onTermData, onTermExit } from "./views/terminal.js";
import { editorTab } from "./views/editor.js";
import { sftpTab } from "./views/sftp.js";
import { labTab } from "./views/lab.js";
import { settingsTab } from "./views/settings.js";
import { openRunDialog, onRunOut, onRunHost, onRunDone, onRunOpened, openRunTab } from "./views/run.js";
import { serverForm } from "./dialogs.js";
import { zoom } from "./termprefs.js";
import { startSysWidget } from "./syswidget.js";
import { A, loadAI, aiSideHtml, aiSideClick, openMarket, openHub, agentForm, mountMarket, mountHub } from "./views/ai.js";
import { initChat, toggleChat, openChat, chatTabChanged } from "./views/chat.js";
import { G, loadGit, gitSideHtml, gitSideClick, accountForm, addRepoMenu, cloneDialog, gitTab, gitStatusHtml, quickAccountMenu } from "./views/git.js";

let seq = 1;
const collapsed = new Set(store.get("collapsed", []));
let filter = "";

// ============================================================
//  Хранилище: выбор папки
// ============================================================
async function pickVault(create = false) {
  const p = await api.PickFolder(create ? "Папка для нового хранилища" : "Открыть папку как хранилище", S.state?.vault || "");
  if (p) await openVault(p, create);
}
async function openVault(path, create) {
  try {
    S.snap = await api.OpenVault(path, create);
    S.state = await api.GetState();
    closeAllTabs();
    showWorkspace();
    if (create) toast(`${I.check} Хранилище создано, внутри примеры для каждого раздела`);
  } catch (e) { toast(esc(errText(e)), "err"); }
}
function closeAllTabs() {
  S.tabs.forEach((t) => t.onClose?.());
  S.tabs = [];
  $("#view").innerHTML = "";
}

function showVaultScreen() {
  document.body.classList.add("no-vault");
  const recent = S.state?.recent || [];
  $("#vaultScreen").innerHTML = `
    <div class="vs-card">
      <div class="vs-logo">◆</div>
      <h1>Infra</h1>
      <p class="muted">Выбери папку-хранилище. Это обычная папка на диске: серверы, VPN, лабы и скрипты лежат в ней YAML-файлами, её удобно держать в git.</p>
      <div class="vs-actions">
        <button class="vs-btn" data-open>${I.folderOpen}<div><b>Открыть папку</b><span>Уже есть хранилище или папка с конфигами</span></div></button>
        <button class="vs-btn" data-create>${I.plus}<div><b>Создать хранилище</b><span>Новая структура папок с примерами</span></div></button>
      </div>
      ${recent.length ? `<div class="vs-recent-h">Недавние</div><div class="vs-recent">${recent.map((r) => `
        <div class="vs-r" data-path="${esc(r)}">${I.vault}<div><b>${esc(r.split(/[\\/]/).pop())}</b><span class="mono">${esc(r)}</span></div>
        <button class="icon-btn" data-forget="${esc(r)}" title="Убрать из списка">${I.x}</button></div>`).join("")}</div>` : ""}
    </div>`;
  $("#vaultScreen [data-open]").onclick = () => pickVault(false);
  $("#vaultScreen [data-create]").onclick = () => pickVault(true);
  $$("#vaultScreen .vs-r").forEach((r) => (r.onclick = (e) => {
    if (e.target.closest("[data-forget]")) return;
    openVault(r.dataset.path, false);
  }));
  $$("#vaultScreen [data-forget]").forEach((b) => (b.onclick = async () => { await api.ForgetRecent(b.dataset.forget); S.state = await api.GetState(); showVaultScreen(); }));
}

function vaultMenu(anchor) {
  const recent = (S.state?.recent || []).filter((r) => r !== S.state.vault);
  menu(anchor, [
    { header: S.state.vault },
    { icon: I.folderOpen, label: "Открыть другую папку…", onClick: () => pickVault(false) },
    { icon: I.plus, label: "Создать хранилище…", onClick: () => pickVault(true) },
    { icon: I.folder, label: "Показать в проводнике", onClick: () => api.Reveal(S.state.vault) },
    ...(recent.length ? [{ sep: true }, { header: "Недавние" }, ...recent.map((r) => ({ icon: I.vault, label: r.split(/[\\/]/).pop(), meta: r, onClick: () => openVault(r, false) }))] : []),
    { sep: true },
    { icon: I.x, label: "Закрыть хранилище", onClick: async () => { closeAllTabs(); await api.CloseVault(); S.state = await api.GetState(); showVaultScreen(); } },
  ], { width: 300 });
}

function showWorkspace() {
  document.body.classList.remove("no-vault");
  $("#vaultName").textContent = S.snap.name || "Хранилище";
  renderSidebar();
  if (!S.tabs.length) addTab(homeTab());
  renderTabs();
  renderStatus();
  refreshVpn();
  refreshServers();
  loadGit().then(renderStatus).catch(() => {});
  loadAI().then(renderStatus).catch(() => {});
  if (S.snap.errors?.length) toast(`${I.warn} Ошибки в конфигах: ${esc(S.snap.errors[0])}${S.snap.errors.length > 1 ? ` и ещё ${S.snap.errors.length - 1}` : ""}`, "err");
}

async function reload() {
  if (!S.state?.vault) return;
  S.snap = await api.Load();
  renderSidebar();
  renderStatus();
  S.tabs.forEach((t) => t.type === "home" && t.refresh?.());
}

// ============================================================
//  Боковая панель
// ============================================================
const PANELS = {
  files: { title: "Хранилище", actions: [["Показать в проводнике", I.folder, () => api.Reveal(S.state.vault)], ["Обновить", I.refresh, () => reload()]] },
  servers: { title: "Серверы", actions: [["Добавить сервер", I.plus, () => serverForm()], ["Проверить доступность", I.refresh, () => refreshServers(true)]] },
  vpn: { title: "VPN", actions: [["Новый профиль", I.plus, () => newFile("vpn/new-profile.yaml", "name: new-profile\ntype: wireguard\nwireguard: vpn/new-profile.conf\nsocks: 10810\n")]] },
  labs: { title: "Лабы", actions: [["Новая лаба", I.plus, () => newFile("labs/new-lab.yaml", null, "labs/example-lab.yaml")]] },
  git: { title: "Git", actions: [["Добавить аккаунт GitHub / GitLab", I.user, () => accountForm()], ["Добавить репозиторий", I.plus, (b) => addRepoMenu(b)], ["Обновить", I.refresh, () => loadGit().then(renderList)]] },
  ai: { title: "ИИ", actions: [["Чат (Ctrl+J)", I.chat, () => toggleChat()], ["Новый агент", I.plus, () => agentForm()]] },
  market: { title: "Маркет ИИ", mount: mountMarket, actions: [["Обновить", I.refresh, () => loadAI(true).then(renderSidebar)]] },
  aiset: { title: "Настройки ИИ", mount: mountHub, actions: [["Обновить", I.refresh, () => loadAI(true).then(renderSidebar)]] },
  scripts: { title: "Скрипты", actions: [["Новый bash-скрипт", I.plus, () => newFile("scripts/snippets/new.sh", "#!/usr/bin/env bash\n# выполнится на выбранных серверах\n\nhostname\n")]] },
};

async function newFile(path, text, copyFrom) {
  let p = prompt("Путь нового файла в хранилище", path);
  if (!p) return;
  if (S.snap.tree.includes(p)) return openFile(p);
  if (text == null) text = copyFrom ? await api.ReadFile(copyFrom).catch(() => "") : "";
  await api.WriteFile(p, text);
  await reload();
  openFile(p);
}

function renderSidebar() {
  const P = PANELS[S.panel];
  $$("#ribbon [data-panel]").forEach((b) => b.classList.toggle("active", b.dataset.panel === S.panel));
  document.body.dataset.panel = S.panel;
  if (P.mount) {
    $("#sidebar").innerHTML = `
      <div class="side-head"><span class="side-title">${P.title}</span><div class="side-actions">${P.actions.map(([t, i], n) => `<button class="icon-btn" title="${t}" data-sa="${n}">${i}</button>`).join("")}</div></div>
      <div class="side-mount"></div>`;
    $$("#sidebar [data-sa]").forEach((b) => (b.onclick = () => P.actions[+b.dataset.sa][2](b)));
    P.mount($("#sidebar .side-mount"));
    return;
  }
  $("#sidebar").innerHTML = `
    <div class="side-head"><span class="side-title">${P.title}</span><div class="side-actions">${P.actions.map(([t, i], n) => `<button class="icon-btn" title="${t}" data-sa="${n}">${i}</button>`).join("")}</div></div>
    <div class="side-filter">${I.search}<input placeholder="Фильтр…" spellcheck="false" value="${esc(filter)}"></div>
    <div class="side-scroll" id="sideList"></div>`;
  $$("#sidebar [data-sa]").forEach((b) => (b.onclick = () => P.actions[+b.dataset.sa][2](b)));
  const f = $("#sidebar .side-filter input");
  f.oninput = () => { filter = f.value; renderList(); };
  renderList();
}

const match = (s) => !filter || s.toLowerCase().includes(filter.toLowerCase());
const group = (name, inner, count) => `<div class="group${collapsed.has(name) ? " collapsed" : ""}" data-group="${esc(name)}">
  <div class="group-label">${I.chev}<span>${esc(name)}</span>${count != null ? `<span class="cnt">${count}</span>` : ""}</div><div class="group-items">${inner}</div></div>`;

function renderList() {
  const list = $("#sideList");
  if (!list) return;
  const act = S.tabs.find((t) => t.id === S.active);
  let html = "";

  if (S.panel === "servers") {
    const groups = {};
    S.snap.servers.filter((s) => match(s.id + s.host + (s.tags || []).join())).forEach((s) => (groups[s.group] ??= []).push(s));
    html = Object.entries(groups).map(([g, arr]) => group(g, arr.map((s) => `
      <div class="item${act?.spec?.server === s.id || act?.server === s.id ? " active" : ""}" data-ssh="${esc(s.id)}" title="${esc(s.user + "@" + s.host)} — клик: терминал">
        <span class="dot ${S.srv[s.id] || ""}"></span><span class="name">${esc(s.id)}</span>
        ${s.vpn ? `<span class="meta">${esc(s.vpn)}</span>` : ""}
        <span class="hover-acts">
          <button class="icon-btn" title="Файлы (SFTP)" data-sftp="${esc(s.id)}">${I.folder}</button>
          <button class="icon-btn" title="Ещё" data-srvmenu="${esc(s.id)}">${I.dots}</button>
        </span>
      </div>`).join(""), arr.length)).join("")
      || `<div class="side-empty">${filter ? "Ничего не найдено" : `Серверов пока нет.<br><button class="btn small" data-add-server>${I.plus}Добавить сервер</button>`}</div>`;
  }

  if (S.panel === "vpn") {
    html = S.snap.vpns.filter((v) => match(v.id + v.type)).map((v) => {
      const st = S.vpn[v.id] || {};
      return `<div class="vpn-card${st.running ? " on" : ""}">
        <div class="vpn-row">
          <span class="dot ${st.running ? "ok" : st.error ? "err" : ""}"></span>
          <span class="name" data-open="${esc(v.file)}">${esc(v.id)}</span>
          <span class="tag">${esc(v.type || "singbox")}</span>
          <button class="switch${st.running ? " on" : ""}" data-vpn="${esc(v.id)}" title="${st.running ? "Отключить" : "Подключить"}"></button>
        </div>
        <div class="vpn-sub"><span class="mono">${esc(st.addr || "")}</span><span>${st.running ? (st.since ? "с " + new Date(st.since * 1000).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "работает") : "выключен"}</span></div>
        ${st.error ? `<div class="vpn-err">${esc(st.error)}</div>` : ""}
      </div>`;
    }).join("") || `<div class="side-empty">VPN-профилей нет.<br>Создай файл в папке vpn/</div>`;
    html += `<div class="side-note">Каждый профиль — локальный прокси. Вкладкам терминала и серверам можно указать, через какой профиль идти.</div>`;
  }

  if (S.panel === "labs") {
    html = S.snap.labs.filter((l) => match(l.id + l.provider)).map((l) => `
      <div class="item${act?.lab === l.id ? " active" : ""}" data-lab="${esc(l.id)}">${I.layers}<span class="name">${esc(l.id)}</span><span class="meta">${esc(l.provider || "")}</span></div>
      <div class="item sub" data-open="${esc(l.file)}">${I.file}<span class="name">${esc(l.file.split("/").pop())}</span></div>`).join("")
      || `<div class="side-empty">Лаб нет.<br>Создай YAML в папке labs/</div>`;
  }

  if (S.panel === "scripts") {
    const byKind = { ansible: "Ansible · на серверах", bash: "bash · на серверах по SSH", powershell: "PowerShell · на этом ПК", cmd: "bat/cmd · на этом ПК" };
    html = Object.entries(byKind).map(([k, title]) => {
      const items = S.snap.scripts.filter((s) => s.kind === k && match(s.path));
      if (!items.length) return "";
      return group(title, items.map((s) => `<div class="item${act?.path === s.path ? " active" : ""}" data-open="${esc(s.path)}" title="${esc(s.path)}">
        ${k === "ansible" ? I.layers : k === "bash" ? I.code : I.windows}<span class="name">${esc(s.path.replace(/^scripts\//, ""))}</span>
        <span class="hover-acts"><button class="icon-btn" title="Запустить…" data-run="${esc(s.path)}">${I.play}</button></span></div>`).join(""), items.length);
    }).join("") || `<div class="side-empty">Скриптов нет.<br>Положи .sh, .yml или .ps1 в папку scripts/</div>`;
  }

  if (S.panel === "ai") html = aiSideHtml(match, group);

  if (S.panel === "git") {
    if (!G.loaded) loadGit().then(renderList).catch((e) => toast(esc(errText(e)), "err"));
    html = gitSideHtml(match, act);
  }

  if (S.panel === "files") {
    const tree = {};
    S.snap.tree.filter(match).forEach((p) => {
      const parts = p.split("/");
      let node = tree;
      parts.forEach((x, i) => { node = node[x] ??= i === parts.length - 1 ? p : {}; });
    });
    const walk = (node, depth, prefix) => Object.keys(node).sort((a, b) => (typeof node[a] === "string") - (typeof node[b] === "string") || a.localeCompare(b)).map((k) => {
      const v = node[k];
      if (typeof v === "string") return `<div class="item tree${act?.path === v ? " active" : ""}" style="padding-left:${10 + depth * 14}px" data-open="${esc(v)}">${I.file}<span class="name">${esc(k)}</span></div>`;
      const key = "f:" + prefix + k;
      return `<div class="group${collapsed.has(key) ? " collapsed" : ""}" data-group="${esc(key)}"><div class="group-label tree" style="padding-left:${6 + depth * 14}px">${I.chev}<span>${esc(k)}</span></div><div class="group-items">${walk(v, depth + 1, prefix + k + "/")}</div></div>`;
    }).join("");
    html = walk(tree, 0, "") || `<div class="side-empty">Пусто</div>`;
  }

  list.innerHTML = html;
}

$("#sidebar").addEventListener("click", async (e) => {
  if (S.panel === "git" && gitSideClick(e)) return;
  if (S.panel === "ai" && aiSideClick(e)) return;
  const t = (s) => e.target.closest(s);
  let x;
  if ((x = t("[data-sftp]"))) return openSftp(x.dataset.sftp);
  if ((x = t("[data-srvmenu]"))) return serverMenu(x, x.dataset.srvmenu);
  if ((x = t("[data-run]"))) return openRunDialog(x.dataset.run);
  if ((x = t("[data-vpn]"))) return toggleVpn(x.dataset.vpn);
  if ((x = t("[data-add-server]"))) return serverForm();
  if ((x = t("[data-ssh]"))) return openSSH(x.dataset.ssh);
  if ((x = t("[data-lab]"))) return openLab(x.dataset.lab);
  if ((x = t("[data-open]"))) return openFile(x.dataset.open);
  if ((x = t(".group-label"))) {
    const g = x.parentElement.dataset.group;
    collapsed.has(g) ? collapsed.delete(g) : collapsed.add(g);
    store.set("collapsed", [...collapsed]);
    renderList();
  }
});

function serverMenu(anchor, id) {
  const s = serverById(id);
  menu(anchor, [
    { icon: I.term, label: "Терминал", onClick: () => openSSH(id) },
    { icon: I.folder, label: "Файлы (SFTP)", onClick: () => openSftp(id) },
    { icon: I.play, label: "Запустить скрипт…", onClick: () => palette("Запустить: ") },
    { sep: true },
    { icon: I.gear, label: "Изменить…", onClick: () => serverForm(s) },
    { icon: I.file, label: "Открыть YAML", onClick: () => openFile(s.file) },
    ...(s.auth === "password" ? [{ icon: I.key, label: "Забыть пароль", onClick: () => { api.ForgetPassword(id); toast("Пароль удалён"); } }] : []),
    { sep: true },
    { icon: I.trash, label: "Удалить", onClick: async () => { if (await confirmBox(`Удалить ${id}?`, `Файл ${esc(s.file)} будет удалён.`)) { await api.DeleteFile(s.file); reload(); } } },
  ], { align: "right" });
}

// ============================================================
//  Вкладки
// ============================================================
function addTab(tab) {
  if (tab.key) {
    const ex = S.tabs.find((t) => t.key === tab.key);
    if (ex) return activate(ex.id);
  }
  tab.id = "tab" + seq++;
  S.tabs.push(tab);
  tab.el.dataset.tab = tab.id;
  $("#view").append(tab.el);
  activate(tab.id);
  return tab;
}

function activate(id) {
  S.active = id;
  S.tabs.forEach((t) => t.el.classList.toggle("shown", t.id === id));
  const t = S.tabs.find((t) => t.id === id);
  renderTabs();
  renderList();
  renderStatus();
  chatTabChanged();
  t?.onShow?.();
}

function closeTab(id) {
  const i = S.tabs.findIndex((t) => t.id === id);
  if (i < 0) return;
  const t = S.tabs[i];
  if (t.beforeClose && !t.beforeClose()) return;
  t.onClose?.();
  t.el.remove();
  S.tabs.splice(i, 1);
  if (!S.tabs.length) return addTab(homeTab());
  if (S.active === id) activate((S.tabs[i] || S.tabs[i - 1]).id);
  else renderTabs();
}

function renderTabs() {
  $("#tabbar").innerHTML = S.tabs.map((t) => `
    <div class="tab${t.id === S.active ? " active" : ""}${t.type === "term" ? " is-term" : ""}" data-tab="${t.id}" title="${esc(t.path || t.title)}">
      ${(t.icon || I.file).replace("<svg", '<svg class="ico"')}
      <span class="title">${esc(t.title)}</span>
      ${t.badge ? `<span class="tab-badge ${t.badge}"></span>` : ""}
      <button class="close" data-close="${t.id}">${I.x}</button>
    </div>`).join("") +
    `<div class="tab-new-wrap"><button class="tab-new" title="Новый терминал (Ctrl+T)" data-newterm>${I.plus}</button><button class="tab-new narrow" title="Выбрать оболочку" data-shellmenu>${I.chev}</button></div>`;
  $(".tab.active")?.scrollIntoView({ inline: "nearest" });
}

$("#tabbar").addEventListener("mousedown", (e) => {
  if (e.button === 1) { const t = e.target.closest("[data-tab]"); if (t) { e.preventDefault(); closeTab(t.dataset.tab); } }
});
$("#tabbar").addEventListener("click", (e) => {
  const c = e.target.closest("[data-close]");
  if (c) return closeTab(c.dataset.close);
  const t = e.target.closest("[data-tab]");
  if (t) return activate(t.dataset.tab);
  const n = e.target.closest("[data-newterm]");
  if (n) return S.shells.length > 1 ? shellMenu(n.parentElement) : newTerminal();
  const m = e.target.closest("[data-shellmenu]");
  if (m) return shellMenu(m.parentElement);
});

// ---------- Выбор оболочки ----------
function defaultShell() {
  const d = S.state?.settings?.defaultShell;
  return S.shells.find((s) => s.id === d) || S.shells[0];
}
function openAI(model) {
  addTab(terminalTab({ kind: "ai", mode: "run", model: model || S.state?.settings?.aiModel || "" }));
}
function newTerminalAt(dir) {
  const sh = defaultShell();
  if (sh) addTab(terminalTab({ kind: "local", shell: sh.id, cwd: dir }));
}
function newTerminal(shellId) {
  const sh = shellId ? S.shells.find((s) => s.id === shellId) : defaultShell();
  if (!sh) return toast("Оболочки не найдены", "err");
  addTab(terminalTab({ kind: "local", shell: sh.id }));
}
function shellMenu(anchor) {
  const d = defaultShell();
  const groups = [["powershell", "cmd"], ["bash"], ["wsl"], ["other"]];
  const items = [{ header: "Оболочки на этом ПК" }];
  groups.forEach((kinds, gi) => {
    const list = S.shells.filter((s) => kinds.includes(s.kind));
    if (!list.length) return;
    if (items.length > 1) items.push({ sep: true });
    list.forEach((s) => items.push({ icon: shellIcon(s.kind), label: s.name, meta: s.id === d?.id ? "Ctrl+T" : "", onClick: () => newTerminal(s.id) }));
  });
  if (!S.shells.length) items.push({ label: "Ничего не найдено", disabled: true });
  items.push({ sep: true },
    { icon: I.sparkle, label: "ИИ-модель (Ollama)", meta: "Ctrl+Shift+A", onClick: () => openAI() },
    { icon: I.server, label: "SSH к серверу…", onClick: () => palette("Подключиться: ") },
    { icon: I.refresh, label: "Найти оболочки заново", onClick: async () => { S.shells = await api.RescanShells(); toast(`Найдено оболочек: ${S.shells.length}`); } },
    { icon: I.gear, label: "Оболочка по умолчанию…", onClick: () => addTab(settingsTab()) });
  menu(anchor, items, { width: 270 });
}

// ---------- Открытие вкладок ----------
function openSSH(id) { addTab(terminalTab({ kind: "ssh", server: id })); }
function openSftp(id) { addTab(sftpTab(id)); }
function openFile(p) { addTab(editorTab(p)); }
function openLab(id) { addTab(labTab(id)); }

// ---------- Главная ----------
function homeTab() {
  const tab = { type: "home", key: "home", icon: I.vault, title: "Главная" };
  tab.el = h(`<div class="tabview home"></div>`);
  tab.refresh = () => {
    const vpnOn = Object.values(S.vpn).filter((v) => v.running).length;
    const d = defaultShell();
    tab.el.innerHTML = `<div class="home-inner">
      <h1>${esc(S.snap.name)}</h1>
      <p class="mono dim small">${esc(S.snap.path)}</p>
      <p>${S.snap.servers.length} серверов · ${vpnOn} из ${S.snap.vpns.length} VPN включено · ${S.snap.labs.length} лаб · ${S.snap.scripts.length} скриптов</p>
      <div class="home-actions">
        <button class="home-action" data-h="palette">${I.search}<span>Найти сервер или команду</span><kbd>Ctrl P</kbd></button>
        <button class="home-action" data-h="term">${d ? shellIcon(d.kind) : I.term}<span>${esc(d?.name || "Терминал")}</span><kbd>Ctrl T</kbd></button>
        <button class="home-action" data-h="server">${I.plus}<span>Добавить сервер</span></button>
        <button class="home-action" data-h="shells">${I.term}<span>Другая оболочка…</span></button>
        <button class="home-action" data-h="ai">${I.sparkle}<span>Чат с ИИ-агентом</span><kbd>Ctrl J</kbd></button>
      </div>
      <div class="home-section">Как устроено</div>
      <div class="home-help">
        <div>${I.server}<span><b>Серверы</b> — файлы <span class="mono">servers/**/*.yaml</span>. Клик по серверу открывает SSH-терминал.</span></div>
        <div>${I.shield}<span><b>VPN</b> — каждый профиль поднимает локальный прокси; вкладке терминала можно выбрать, через какой профиль идёт трафик.</span></div>
        <div>${I.layers}<span><b>Лабы</b> — машины VirtualBox/VMware из одного YAML: «Применить» создаёт их и добавляет в серверы.</span></div>
        <div>${I.code}<span><b>Скрипты</b> — <span class="mono">.sh</span> выполняются на серверах по SSH, <span class="mono">.yml</span> — через Ansible в WSL, <span class="mono">.ps1</span> — на этом ПК.</span></div>
      </div></div>`;
    tab.el.querySelectorAll("[data-h]").forEach((b) => (b.onclick = (e) => {
      const a = b.dataset.h;
      if (a === "palette") palette();
      if (a === "term") newTerminal();
      if (a === "server") serverForm();
      if (a === "shells") shellMenu(b);
      if (a === "ai") toggleChat(true);
    }));
  };
  tab.onShow = tab.refresh;
  return tab;
}

// ============================================================
//  VPN, серверы, задачи
// ============================================================
async function refreshVpn() {
  try {
    const list = await api.VpnStatus();
    S.vpn = Object.fromEntries(list.map((v) => [v.id, v]));
  } catch {}
  if (S.panel === "vpn") renderList();
  renderStatus();
  S.tabs.forEach((t) => t.onVpnChange?.());
}
async function toggleVpn(id) {
  const sw = $(`[data-vpn="${CSS.escape(id)}"]`);
  sw?.classList.add("busy");
  try {
    if (vpnRunning(id)) await api.VpnStop(id);
    else { await api.VpnStart(id); toast(`${I.check} VPN ${esc(id)} подключён`); }
  } catch (e) { toast(`VPN ${esc(id)}: ${esc(errText(e))}`, "err"); }
  refreshVpn();
}
let srvCheck = 0;
async function refreshServers(manual) {
  if (!S.snap.servers.length) return;
  const my = ++srvCheck;
  if (manual) toast(`${I.refresh} Проверяю доступность серверов…`);
  try {
    const st = await api.CheckServers();
    if (my !== srvCheck) return;
    S.srv = st;
    if (S.panel === "servers") renderList();
  } catch {}
}

function watchJob(id, done) { (S.jobs[id] ??= { pct: 0 }).onDone = done; }

function renderStatus() {
  const on = S.snap.vpns.filter((v) => vpnRunning(v.id));
  const jobs = Object.entries(S.jobs).filter(([, j]) => !j.done);
  const t = S.tabs.find((t) => t.id === S.active);
  const ok = Object.values(S.srv).filter((x) => x === "ok").length;
  $("#statusbar").innerHTML = `
    <button class="sb" data-go="vpn">${I.shield}${on.length ? on.map((v) => `<span class="dot ok"></span>${esc(v.id)}`).join(" ") : "VPN выкл"}</button>
    ${gitStatusHtml(t)}
    <button class="sb" data-go="servers">${I.server}${ok}/${S.snap.servers.length} доступно</button>
    ${jobs.map(([, j]) => `<span class="sb job" title="${esc(j.msg || "")}">${I.activity}${esc(j.title)}<span class="job-bar"><div style="width:${j.pct}%"></div></span><span class="dim small">${esc(j.msg || "")}</span></span>`).join("")}
    <span class="grow"></span>
    ${A.mcp?.running ? `<button class="sb" data-mcpsb title="MCP-сервер для других ИИ: ${esc(A.mcp.url || "")}"><span class="dot ok"></span>MCP</button>` : ""}
    ${t?.type === "term" ? `<span class="sb mono">${t.spec.kind === "ssh" ? "ssh" : "local"} · ${t.xt.term.cols}×${t.xt.term.rows}</span>` : ""}
    ${t?.type === "editor" ? `<span class="sb mono">UTF-8 · ${esc(t.path.split(".").pop().toUpperCase())}</span>` : ""}
    <button class="sb" data-vault2>${I.vault}${esc(S.snap.name || "")}</button>`;
}
$("#statusbar").addEventListener("click", (e) => {
  const ga = e.target.closest("[data-gitacc]");
  if (ga) return quickAccountMenu(ga, S.tabs.find((t) => t.id === S.active));
  const g = e.target.closest("[data-go]");
  if (g) { S.panel = g.dataset.go; renderSidebar(); }
  if (e.target.closest("[data-vault2]")) vaultMenu(e.target.closest("[data-vault2]"));
  if (e.target.closest("[data-mcpsb]")) openHub("mcp");
});

// ============================================================
//  Палитра команд
// ============================================================
let palItems = [], palSel = 0;
function commands() {
  const c = [];
  S.snap.servers.forEach((s) => {
    c.push({ cat: "SSH", title: `Подключиться: ${s.id}`, hint: s.host, run: () => openSSH(s.id) });
    c.push({ cat: "SFTP", title: `Файлы: ${s.id}`, hint: s.host, run: () => openSftp(s.id) });
  });
  S.shells.forEach((s) => c.push({ cat: "Терминал", title: `Терминал: ${s.name}`, hint: s.id === defaultShell()?.id ? "Ctrl+T" : "", run: () => newTerminal(s.id) }));
  S.snap.vpns.forEach((v) => c.push({ cat: "VPN", title: `${vpnRunning(v.id) ? "Отключить" : "Подключить"} VPN: ${v.id}`, hint: v.type, run: () => toggleVpn(v.id) }));
  S.snap.labs.forEach((l) => c.push({ cat: "Лаба", title: `Лаба: ${l.id}`, hint: l.provider, run: () => openLab(l.id) }));
  S.snap.scripts.forEach((s) => c.push({ cat: "Скрипт", title: `Запустить: ${s.path.replace(/^scripts\//, "")}`, hint: s.kind, run: () => openRunDialog(s.path) }));
  S.snap.tree.forEach((f) => c.push({ cat: "Файл", title: f, run: () => openFile(f) }));
  G.repos.forEach((r) => c.push({ cat: "Git", title: `Репозиторий: ${r.name}`, hint: r.branch || "", run: () => addTab(gitTab(r.path)) }));
  c.push({ cat: "Git", title: "Добавить аккаунт GitHub / GitLab", run: () => accountForm() });
  c.push({ cat: "Git", title: "Клонировать репозиторий…", run: () => { if (!G.loaded) loadGit().then(() => cloneDialog()); else cloneDialog(); } });
  c.push({ cat: "ИИ", title: "Чат с ИИ-агентом", hint: "Ctrl+J", run: () => toggleChat(true) });
  c.push({ cat: "ИИ", title: "Маркет моделей", run: () => openMarket("models") });
  c.push({ cat: "ИИ", title: "Каталог агентов", run: () => openMarket("agents") });
  c.push({ cat: "ИИ", title: "Новый агент…", run: () => agentForm() });
  c.push({ cat: "ИИ", title: "MCP для других ИИ (Claude, Cursor)", run: () => openHub("mcp") });
  c.push({ cat: "ИИ", title: "База знаний и безопасность", run: () => openHub("knowledge") });
  c.push({ cat: "ИИ", title: "ИИ-терминал (ollama run)", hint: "Ctrl+Shift+A", run: () => openAI() });
  A.agents.forEach((a) => c.push({ cat: "Агент", title: a.name, hint: a.model, run: () => openChat(a.id) }));
  c.push({ cat: "Сервер", title: "Добавить сервер", run: () => serverForm() });
  c.push({ cat: "Хранилище", title: "Открыть другую папку…", run: () => pickVault(false) });
  c.push({ cat: "Хранилище", title: "Показать в проводнике", run: () => api.Reveal(S.state.vault) });
  c.push({ cat: "Приложение", title: "Настройки", run: () => addTab(settingsTab()) });
  return c;
}
function palette(q = "") {
  if (!S.state?.vault) return;
  $("#paletteBackdrop").hidden = false;
  const inp = $("#paletteInput");
  inp.value = q; palSel = 0; filterPalette(); inp.focus();
}
function closePalette() { $("#paletteBackdrop").hidden = true; }
function filterPalette() {
  const q = $("#paletteInput").value.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const all = commands();
  palItems = words.length ? all.filter((c) => { const s = (c.cat + " " + c.title + " " + (c.hint || "")).toLowerCase(); return words.every((w) => s.includes(w)); }) : all.slice(0, 50);
  palSel = Math.min(palSel, Math.max(0, palItems.length - 1));
  const re = words.length ? new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi") : null;
  const hl = (s) => (re ? esc(s).replace(re, "<mark>$1</mark>") : esc(s));
  $("#paletteList").innerHTML = palItems.length
    ? palItems.slice(0, 80).map((c, i) => `<li class="${i === palSel ? "sel" : ""}" data-pi="${i}"><span class="cat">${c.cat}</span><span>${hl(c.title)}</span><span class="hint">${esc(c.hint || "")}</span></li>`).join("")
    : `<div class="palette-empty">Ничего не найдено</div>`;
  $("#paletteList .sel")?.scrollIntoView({ block: "nearest" });
}
function runPal(i) { const c = palItems[i]; closePalette(); c?.run(); }
$("#paletteInput").addEventListener("input", () => { palSel = 0; filterPalette(); });
$("#paletteInput").addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") { e.preventDefault(); palSel = Math.min(palSel + 1, palItems.length - 1); filterPalette(); }
  if (e.key === "ArrowUp") { e.preventDefault(); palSel = Math.max(palSel - 1, 0); filterPalette(); }
  if (e.key === "Enter") runPal(palSel);
  if (e.key === "Escape") closePalette();
});
$("#paletteList").addEventListener("click", (e) => { const li = e.target.closest("[data-pi]"); if (li) runPal(+li.dataset.pi); });
$("#paletteBackdrop").addEventListener("mousedown", (e) => { if (e.target.id === "paletteBackdrop") closePalette(); });

// ============================================================
//  Окно, лента, клавиши
// ============================================================
$("#ribbon").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.panel) {
    // клик по активному разделу — свернуть/развернуть панель (как в Obsidian)
    if (b.dataset.panel === S.panel) return toggleSidebar();
    S.panel = b.dataset.panel; filter = ""; store.set("panel", S.panel);
    toggleSidebar(true);
    renderSidebar();
  }
  if (b.dataset.action === "settings") addTab(settingsTab());
});
$("#chatBtn").onclick = () => toggleChat();
$("#openPalette").onclick = () => palette();
$("#sideToggle").onclick = () => toggleSidebar();

// ---------- Скрытие левой панели ----------
function toggleSidebar(show) {
  const hidden = show === undefined ? !document.body.classList.contains("sidebar-hidden") : !show;
  document.body.classList.toggle("sidebar-hidden", hidden);
  store.set("sidebarHidden", hidden);
}
toggleSidebar(!store.get("sidebarHidden", false));
$("#vaultBtn").onclick = (e) => S.state?.vault && vaultMenu(e.currentTarget);
$("#winMin").onclick = win.minimise;
$("#winMax").onclick = win.toggleMax;
$("#winClose").onclick = win.close;
$(".titlebar").addEventListener("dblclick", (e) => { if (!e.target.closest("button")) win.toggleMax(); });

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && document.querySelector(".menu, .popover-panel")) { closeMenu(); return; }
  if (!S.state?.vault || !e.ctrlKey) return;
  const k = e.code;
  let handled = true;
  const cur = S.tabs.find((t) => t.id === S.active);
  if (k === "KeyP") palette();
  else if (k === "KeyB" && !e.shiftKey) toggleSidebar();
  else if (k === "KeyA" && e.shiftKey) openAI();
  else if (k === "KeyJ") toggleChat();
  else if (k === "KeyF" && e.shiftKey && cur?.find) cur.find();
  else if (k === "KeyK" && e.shiftKey && cur?.clear) cur.clear();
  else if (k === "Equal" || k === "NumpadAdd") zoom(1);
  else if (k === "Minus" || k === "NumpadSubtract") zoom(-1);
  else if (k === "Digit0" || k === "Numpad0") zoom(0);
  else if (k === "KeyT" && e.shiftKey) shellMenu($(".tab-new-wrap"));
  else if (k === "KeyT") newTerminal();
  else if (k === "KeyW") S.active && closeTab(S.active);
  else if (k === "Tab") {
    const i = S.tabs.findIndex((t) => t.id === S.active);
    activate(S.tabs[(i + (e.shiftKey ? -1 : 1) + S.tabs.length) % S.tabs.length].id);
  } else if (k === "Comma") addTab(settingsTab());
  else handled = false;
  if (handled) { e.preventDefault(); e.stopPropagation(); }
}, true);

// Ширина боковой панели
(() => {
  const r = $("#resizer");
  const w = store.get("sidebarW", 260);
  document.documentElement.style.setProperty("--sidebar-w", w + "px");
  r.onmousedown = (e) => {
    const x0 = e.clientX, w0 = $("#sidebar").offsetWidth;
    r.classList.add("drag");
    const mv = (ev) => { const nw = Math.min(480, Math.max(180, w0 + ev.clientX - x0)); document.documentElement.style.setProperty("--sidebar-w", nw + "px"); store.set("sidebarW", nw); };
    const up = () => { r.classList.remove("drag"); removeEventListener("mousemove", mv); removeEventListener("mouseup", up); };
    addEventListener("mousemove", mv); addEventListener("mouseup", up);
  };
})();

// ============================================================
//  События бэкенда
// ============================================================
on("term:data", onTermData);
on("term:exit", onTermExit);
on("run:out", onRunOut);
on("run:host", onRunHost);
on("run:done", onRunDone);
on("run:opened", onRunOpened);
on("vpn:changed", refreshVpn);
on("vault:changed", () => { reload(); S.tabs.forEach((t) => t.type === "lab" && t.refresh?.()); });
on("files:changed", (who) => S.tabs.forEach((t) => t.type === "sftp" && (who === "local" || t.server === who) && t.onFilesChanged?.(who)));
on("toast", (m) => toast(esc(m), "err"));
on("info", (m) => toast(`${I.check} ${esc(m)}`));
on("git:changed", (p) => {
  loadGit().then(() => { if (S.panel === "git") renderList(); });
  S.tabs.forEach((t) => t.type === "git" && t.repo === p && S.active !== t.id && t.refresh?.());
});
on("job", (j) => {
  const cur = (S.jobs[j.id] ??= {});
  Object.assign(cur, j);
  if (j.done) {
    if (j.error) toast(`${I.warn} ${esc(j.title)}: ${esc(j.error)}`, "err");
    else toast(`${I.check} ${esc(j.title)} — готово`);
    cur.onDone?.();
    setTimeout(() => { delete S.jobs[j.id]; renderStatus(); }, 400);
  }
  renderStatus();
});
window.addEventListener("focus", () => { if (S.state?.vault) reload(); });
setInterval(() => { if (S.state?.vault && document.hasFocus()) refreshServers(); }, 60000);

// ============================================================
//  Старт
// ============================================================
// Вставить текст (команду из чата) в открытый терминал — без Enter, чтобы человек проверил.
function pasteToTerminal(text) {
  const cur = S.tabs.find((t) => t.id === S.active);
  const t = cur?.type === "term" && !cur.dead ? cur : [...S.tabs].reverse().find((t) => t.type === "term" && !t.dead && t.sid);
  if (!t?.sid) return toast("Нет открытого терминала", "err");
  activate(t.id);
  t.xt.term.paste(text.replace(/\r?\n$/, "")); // bracketed paste: оболочка не выполнит сразу
  t.xt.term.focus();
}

function showPanel(id) { S.panel = id; filter = ""; store.set("panel", id); toggleSidebar(true); renderSidebar(); }

Object.assign(app, {
  showPanel, openAI, openChat, toggleChat, pasteToTerminal,
  addTab, activate, closeTab, renderTabs, renderSidebar, renderStatus, reload, watchJob,
  openSSH, openSftp, openFile, openLab, openRunDialog, newTerminal, newTerminalAt, pickVault, palette,
});

startSysWidget();
initChat();

(async function init() {
  S.panel = store.get("panel", "servers");
  S.state = await api.GetState();
  S.shells = await api.ListShells();
  if (!S.state.vault) return showVaultScreen();
  S.snap = await api.Load();
  if (!S.snap.path) return showVaultScreen();
  showWorkspace();
})();
