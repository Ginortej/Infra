// Вкладка терминала: xterm.js + сессия Go (локальная оболочка через ConPTY или SSH).
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { api, errText, win } from "../api.js";
import { S, app, serverById, vpnRunning } from "../core.js";
import { h, esc, I, menu, popover, closeMenu, shellIcon, b64bytes, toast } from "../ui.js";
import { askPassword } from "../dialogs.js";
import { xtermOptions, onPrefs, appearancePanel, zoom, currentTheme } from "../termprefs.js";
import { G, loadGit, accountForm } from "./git.js";

// Создаёт xterm с текущим оформлением; оформление меняется на лету для всех терминалов.
export function makeXterm(opts = {}) {
  const term = new Terminal({ allowProposedApi: true, scrollback: 10000, smoothScrollDuration: 80, ...xtermOptions(), ...opts });
  const fit = new FitAddon();
  const search = new SearchAddon();
  term.loadAddon(fit);
  term.loadAddon(search);
  term.loadAddon(new Unicode11Addon());
  term.unicode.activeVersion = "11";
  term.loadAddon(new WebLinksAddon((e, uri) => { if (e.ctrlKey) win.openURL(uri); }, { hover: () => {} }));
  const off = onPrefs(() => {
    const o = xtermOptions();
    for (const [k, v] of Object.entries(o)) if (!(k in opts)) term.options[k] = v;
    requestAnimationFrame(() => { try { fit.fit(); } catch {} });
  });
  const xt = { term, fit, search, dispose: () => { off(); term.dispose(); } };
  // WebGL — быстрее и чётче; если видеокарта/драйвер не дали контекст, остаётся обычный рендер
  xt.enableWebgl = () => {
    try {
      const gl = new WebglAddon();
      gl.onContextLoss(() => gl.dispose());
      term.loadAddon(gl);
    } catch {}
  };
  return xt;
}

// Ctrl+C копирует при выделении, Ctrl+V вставляет, правая кнопка — копировать/вставить (как в Windows Terminal)
export function clipboardKeys(term, host) {
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== "keydown") return true;
    // Ctrl+A — выделить весь вывод (в оболочку не отправляется; начало строки — клавиша Home)
    if (e.ctrlKey && !e.altKey && !e.shiftKey && e.code === "KeyA") {
      e.preventDefault(); term.selectAll(); return false;
    }
    if (e.ctrlKey && !e.altKey && !e.shiftKey && e.code === "KeyC" && term.hasSelection()) {
      navigator.clipboard.writeText(term.getSelection()); term.clearSelection(); return false;
    }
    if (e.ctrlKey && e.shiftKey && e.code === "KeyC") { if (term.hasSelection()) navigator.clipboard.writeText(term.getSelection()); return false; }
    if (e.ctrlKey && !e.altKey && e.code === "KeyV") {
      e.preventDefault();
      navigator.clipboard.readText().then((t) => t && term.paste(t)); return false;
    }
    return true;
  });
  host.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (term.hasSelection()) { navigator.clipboard.writeText(term.getSelection()); term.clearSelection(); toast(`${I.copy} Скопировано`); }
    else navigator.clipboard.readText().then((t) => t && term.paste(t));
  });
  host.addEventListener("wheel", (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    zoom(e.deltaY < 0 ? 1 : -1);
  }, { passive: false });
}

const sessions = new Map(); // sessionId -> tab
// Go начинает слать вывод (приглашение, MOTD) раньше, чем вернётся id сессии — копим до регистрации
const early = new Map();
function hold(id, ev) {
  if (!early.has(id)) early.set(id, []);
  early.get(id).push(ev);
  if (early.size > 20) early.delete(early.keys().next().value);
}
function register(id, tab) {
  sessions.set(id, tab);
  const evs = early.get(id) || [];
  early.delete(id);
  evs.forEach(([kind, a]) => (kind === "data" ? onTermData(id, a) : onTermExit(id, a)));
}
export function onTermData(id, data) {
  const tab = sessions.get(id);
  if (!tab) return hold(id, ["data", data]);
  tab.xt.term.write(b64bytes(data));
  tab.markActivity();
}
export function onTermExit(id, msg) {
  const tab = sessions.get(id);
  if (!tab) return hold(id, ["exit", msg]);
  sessions.delete(id);
  tab.sid = null;
  if (tab.onExit?.(msg)) return; // вкладка сама решила, что делать дальше (ИИ: после скачивания — запуск)
  tab.xt.term.write(`\r\n\x1b[90m── ${msg || "сессия завершена"}. Enter — подключиться заново\x1b[0m\r\n`);
  tab.setDead(true);
}

// spec: {kind: "local", shell} | {kind: "ssh", server}; vpn: undefined = по конфигу, "" = напрямую, "id"
export function terminalTab(spec) {
  const tab = {
    type: "term", spec, vpn: spec.vpn, sid: null, dead: false, badge: "", osTitle: "",
    get title() {
      if (spec.kind === "ai") return "ИИ · " + (spec.model || "модель");
      return spec.kind === "ssh" ? spec.server : (S.shells.find((s) => s.id === spec.shell)?.name || spec.shell);
    },
    get icon() { return spec.kind === "ai" ? I.sparkle : spec.kind === "ssh" ? I.server : shellIcon(S.shells.find((s) => s.id === spec.shell)?.kind); },
  };
  const el = h(`<div class="tabview term-view">
    <div class="view-head term-head"></div>
    <div class="term-wrap">
      <div class="term-host"></div>
      <div class="term-find" hidden>
        ${I.search}<input placeholder="Найти в выводе" spellcheck="false">
        <span class="tf-count dim small"></span>
        <button class="icon-btn" data-f="case" title="Учитывать регистр">Aa</button>
        <button class="icon-btn" data-f="prev" title="Предыдущее (Shift+Enter)">${I.up}</button>
        <button class="icon-btn" data-f="next" title="Следующее (Enter)">${I.chev}</button>
        <button class="icon-btn" data-f="close" title="Закрыть (Esc)">${I.x}</button>
      </div>
      <button class="term-bottom" hidden title="Вниз">${I.arrowDown}</button>
      <div class="ai-setup" hidden></div>
    </div></div>`);
  tab.el = el;
  const head = el.querySelector(".view-head");
  const host = el.querySelector(".term-host");
  const findBar = el.querySelector(".term-find");
  const bottomBtn = el.querySelector(".term-bottom");
  const xt = makeXterm();
  tab.xt = xt;
  let opened = false;

  // git-аккаунт терминала: undefined — по умолчанию, "" — системный git, id — конкретный
  tab.git = spec.git;
  tab.gitUsed = null; // с каким аккаунтом реально запущена сессия
  const effectiveGit = () => (tab.git === undefined ? S.state?.settings?.gitDefault || "" : tab.git);
  const gitIcon = (p) => (p === "gitlab" ? I.gitlab : I.github);

  const effectiveVpn = () => {
    if (spec.kind === "ssh" && tab.vpn === undefined) return serverById(spec.server)?.vpn || "";
    return tab.vpn || "";
  };

  // индикаторы на вкладке: красная точка — сессия закрыта, акцентная — новый вывод в фоне
  tab.setDead = (d) => { tab.dead = d; tab.badge = d ? "dead" : ""; tab.renderHead(); app.renderTabs(); };
  tab.markActivity = () => {
    if (S.active !== tab.id && !tab.dead && tab.badge !== "activity") { tab.badge = "activity"; app.renderTabs(); }
  };

  tab.renderHead = () => {
    if (spec.kind === "ai") return aiHead();
    const v = effectiveVpn();
    const srv = spec.kind === "ssh" ? serverById(spec.server) : null;
    const sh = S.shells.find((s) => s.id === spec.shell);
    const state = tab.dead ? `<span class="conn off">отключено</span>` : tab.sid ? `<span class="conn on">подключено</span>` : `<span class="conn wait">подключение…</span>`;
    head.innerHTML = `
      <div class="crumbs">${spec.kind === "ssh"
        ? `${I.server}<b>${esc(spec.server)}</b><span class="dim mono">${esc(srv ? srv.user + "@" + srv.host : "")}</span>${state}`
        : `<button class="chip" data-shell>${shellIcon(sh?.kind)}${esc(sh?.name || spec.shell)} ${I.chev}</button><span class="dim mono os-title">${esc(tab.osTitle)}</span>`}</div>
      <div class="spacer"></div>
      ${tab.dead ? `<button class="btn small" data-reconnect>${I.refresh}Переподключиться</button>` : ""}
      ${spec.kind === "ssh" ? `<button class="chip" data-sftp>${I.folder}Файлы</button>` : gitChip()}
      <button class="chip" data-vpn title="Через какой VPN идёт трафик этой вкладки">
        <span class="dot ${v ? (vpnRunning(v) ? "ok" : "warn") : ""}"></span>${v ? esc(v) : "напрямую"} ${I.chev}
      </button>
      <span class="head-sep"></span>
      <button class="icon-btn" data-find title="Найти (Ctrl+Shift+F)">${I.search}</button>
      <button class="icon-btn" data-look title="Оформление терминала">${I.palette}</button>
      <button class="icon-btn" data-more title="Ещё">${I.dots}</button>`;
    head.querySelector("[data-vpn]").onclick = (e) => vpnMenu(e.currentTarget);
    head.querySelector("[data-git]")?.addEventListener("click", (e) => gitMenu(e.currentTarget));
    head.querySelector("[data-sftp]")?.addEventListener("click", () => app.openSftp(spec.server));
    head.querySelector("[data-reconnect]")?.addEventListener("click", () => connect(true));
    head.querySelector("[data-shell]")?.addEventListener("click", (e) => shellMenu(e.currentTarget));
    head.querySelector("[data-find]").onclick = () => tab.find();
    head.querySelector("[data-look]").onclick = (e) => popover(e.currentTarget, appearancePanel(), { width: 392 });
    head.querySelector("[data-more]").onclick = (e) => moreMenu(e.currentTarget);
  };

  function gitChip() {
    if (!G.loaded) { loadGit().then(() => tab.renderHead()).catch(() => {}); return ""; }
    const used = tab.gitUsed ?? effectiveGit();
    const a = G.accounts.find((x) => x.id === used);
    const stale = tab.gitUsed !== null && tab.gitUsed !== effectiveGit();
    const title = a ? `git в этой вкладке коммитит и пушит от ${a.label} (${a.username}@${a.host})` : "git в этой вкладке — системный (без аккаунта Infra)";
    return `<button class="chip git-chip" data-git title="${esc(title)}">
      ${a ? `<span class="prov ${a.provider}">${gitIcon(a.provider)}</span>${esc(a.label || a.username)}` : `${I.branch}<span class="dim">git: системный</span>`}
      ${stale ? `<span class="dot warn" title="Аккаунт по умолчанию изменился — перезапусти сессию"></span>` : ""} ${I.chev}</button>`;
  }

  function gitMenu(anchor) {
    const used = tab.gitUsed ?? effectiveGit();
    const def = G.accounts.find((x) => x.id === (S.state?.settings?.gitDefault || ""));
    const pick = (v, label) => { tab.git = v; connect(true, `── git-аккаунт: ${label}, перезапуск сессии…`); };
    menu(anchor, [
      { header: "git в этой вкладке пушит от" },
      ...G.accounts.map((a) => ({ icon: gitIcon(a.provider), label: a.label || a.username, meta: `${a.username}@${a.host}`, checked: a.id === used, onClick: () => pick(a.id, a.label) })),
      { icon: I.branch, label: "Системный git", meta: "без аккаунта", checked: !used, onClick: () => pick("", "системный git") },
      { sep: true },
      { icon: I.check, label: def ? `Как по умолчанию (${def.label})` : "Как по умолчанию", checked: tab.git === undefined, onClick: () => pick(undefined, def ? def.label : "по умолчанию") },
      { icon: I.plus, label: "Добавить аккаунт…", onClick: () => accountForm() },
    ], { align: "right", width: 300 });
  }

  function vpnMenu(anchor) {
    const cur = effectiveVpn();
    menu(anchor, [
      { header: "Трафик этой вкладки" },
      { icon: I.globe, label: "Напрямую", meta: "без VPN", checked: !cur, onClick: () => switchVpn("") },
      ...(S.snap.vpns.length ? [{ sep: true }] : []),
      ...S.snap.vpns.map((v) => ({
        icon: `<span class="dot ${vpnRunning(v.id) ? "ok" : ""}"></span>`, label: v.id,
        meta: vpnRunning(v.id) ? S.vpn[v.id]?.addr : "выключен", checked: cur === v.id, onClick: () => switchVpn(v.id),
      })),
    ], { align: "right", width: 250 });
  }

  function shellMenu(anchor) {
    menu(anchor, S.shells.map((s) => ({ icon: shellIcon(s.kind), label: s.name, checked: s.id === spec.shell, onClick: () => {
      spec.shell = s.id; app.renderTabs(); connect(true, `── оболочка: ${s.name}`);
    } })), { width: 240 });
  }

  function moreMenu(anchor) {
    menu(anchor, [
      { icon: I.copy, label: "Выделить всё", meta: "Ctrl+A", onClick: () => { xt.term.selectAll(); xt.term.focus(); } },
      { icon: I.copy, label: "Копировать весь вывод", onClick: copyAll },
      { icon: I.eraser, label: "Очистить экран", meta: "Ctrl+Shift+K", onClick: () => xt.term.clear() },
      { icon: I.refresh, label: "Перезапустить сессию", onClick: () => connect(true, "── перезапуск…") },
      { sep: true },
      { icon: I.term, label: "Дублировать вкладку", onClick: () => app.addTab(terminalTab({ ...spec, vpn: tab.vpn, git: tab.git })) },
      { icon: I.palette, label: "Оформление…", onClick: () => popover(head.querySelector("[data-look]"), appearancePanel(), { width: 392 }) },
    ], { align: "right", width: 250 });
  }

  function copyAll() {
    const b = xt.term.buffer.active;
    const lines = [];
    for (let i = 0; i < b.length; i++) lines.push(b.getLine(i)?.translateToString(true) ?? "");
    navigator.clipboard.writeText(lines.join("\n").replace(/\n+$/, ""));
    toast(`${I.copy} Скопировано строк: ${lines.length}`);
  }

  async function switchVpn(v) {
    if (v && !vpnRunning(v)) {
      try { await api.VpnStart(v); } catch (e) { xt.term.write(`\r\n\x1b[31mVPN ${v}: ${errText(e)}\x1b[0m\r\n`); return; }
    }
    tab.vpn = v;
    connect(true, `── трафик вкладки: ${v ? "через " + v : "напрямую"}, переподключение…`);
  }

  async function connect(reopen = false, note = "") {
    if (spec.kind === "ai") return aiConnect(note);
    if (tab.sid) { api.TermClose(tab.sid); sessions.delete(tab.sid); tab.sid = null; }
    if (note) xt.term.write(`\r\n\x1b[90m${note}\x1b[0m\r\n`);
    tab.dead = false;
    tab.badge = "";
    tab.renderHead();
    const { cols, rows } = xt.term;
    if (spec.kind === "ssh" && !reopen) {
      const srv = serverById(spec.server);
      xt.term.write(`\x1b[90mПодключение к ${srv?.user}@${srv?.host}${effectiveVpn() ? " через " + effectiveVpn() : ""}…\x1b[0m\r\n`);
    }
    try {
      tab.sid = spec.kind === "ssh"
        ? await api.TermOpenSSH(spec.server, tab.vpn === undefined ? "@default" : tab.vpn, cols, rows)
        : await api.TermOpenLocalWith(spec.shell, tab.vpn || "", spec.cwd || "", tab.git === undefined ? "@default" : tab.git, cols, rows);
      if (spec.kind !== "ssh") tab.gitUsed = effectiveGit();
      register(tab.sid, tab);
      tab.renderHead();
      app.renderTabs();
    } catch (e) {
      const m = errText(e);
      if (m === "NEED_PASSWORD") {
        const ok = await askPassword(spec.server);
        if (ok) return connect(true);
        xt.term.write("\x1b[33mПодключение отменено. Enter — попробовать снова\x1b[0m\r\n");
      } else {
        xt.term.write(`\x1b[31m${m}\x1b[0m\r\n\x1b[90mEnter — попробовать снова\x1b[0m\r\n`);
      }
      tab.setDead(true);
    }
  }

  // =================== ИИ-терминал (Ollama) ===================
  const setup = el.querySelector(".ai-setup");
  tab.ai = null; // AIStatus
  const fmtGB = (b) => (b / 1073741824).toFixed(b >= 10 * 1073741824 ? 0 : 1) + " GB";
  const SUGGEST = [
    ["llama3.2:3b", "≈2 GB", "быстрая, простые вопросы"],
    ["qwen2.5-coder:7b", "≈4.7 GB", "код, скрипты, DevOps"],
    ["gemma3:4b", "≈3.3 GB", "универсальная"],
    ["deepseek-r1:8b", "≈5.2 GB", "рассуждения, сложные задачи"],
    ["mistral:7b", "≈4.1 GB", "универсальная"],
    ["qwen2.5:14b", "≈9 GB", "умнее, нужна видеокарта 12+ GB"],
  ];

  async function refreshAI() {
    try { tab.ai = await api.AIStatus(); } catch { tab.ai = null; }
    if (spec.kind === "ai") aiHead();
    return tab.ai;
  }

  function aiHead() {
    const st = tab.ai;
    const loaded = st?.loaded?.find((m) => m.name === spec.model);
    const info = !st ? "" : !st.installed && !st.running ? `<span class="conn off">Ollama не установлена</span>` : !st.running ? `<span class="conn off">Ollama не запущена</span>`
      : `<span class="dim small">Ollama ${esc(st.version)}${loaded ? ` · в памяти ${fmtGB(loaded.size)}${loaded.sizeVram ? ` (видеокарта ${Math.round(loaded.sizeVram / loaded.size * 100)}%)` : " (CPU)"}` : ""}</span>`;
    head.innerHTML = `
      <div class="crumbs"><button class="chip ai-chip" data-aimodel>${I.sparkle}${esc(spec.mode === "custom" ? "своя команда" : spec.model || "выбери модель")} ${I.chev}</button>${info}</div>
      <div class="spacer"></div>
      ${tab.dead ? `<button class="btn small" data-reconnect>${I.refresh}Запустить снова</button>` : ""}
      ${spec.mode !== "custom" && spec.model ? `<button class="btn small" data-ainew title="Начать разговор заново (контекст сбрасывается)">${I.plus}Новый чат</button>
        <button class="icon-btn" data-aiunload title="Выгрузить модель из памяти (освободить видеопамять)">${I.eject}</button>` : ""}
      <span class="head-sep"></span>
      <button class="icon-btn" data-find title="Найти (Ctrl+Shift+F)">${I.search}</button>
      <button class="icon-btn" data-look title="Оформление терминала">${I.palette}</button>
      <button class="icon-btn" data-more title="Ещё">${I.dots}</button>`;
    head.querySelector("[data-aimodel]").onclick = (e) => aiModelMenu(e.currentTarget);
    head.querySelector("[data-reconnect]")?.addEventListener("click", () => connect(true));
    head.querySelector("[data-ainew]")?.addEventListener("click", () => connect(true, "── новый чат"));
    head.querySelector("[data-aiunload]")?.addEventListener("click", async () => {
      try { await api.AIUnload(spec.model); toast(`${I.eject} ${esc(spec.model)} выгружена из памяти`); } catch (e) { toast(esc(errText(e)), "err"); }
      refreshAI();
    });
    head.querySelector("[data-find]").onclick = () => tab.find();
    head.querySelector("[data-look]").onclick = (e) => popover(e.currentTarget, appearancePanel(), { width: 392 });
    head.querySelector("[data-more]").onclick = (e) => moreMenu(e.currentTarget);
  }

  async function aiModelMenu(anchor) {
    const st = tab.ai || (await refreshAI());
    const models = st?.models || [];
    menu(anchor, [
      { header: models.length ? "Модели Ollama" : "Моделей пока нет" },
      ...models.map((m) => ({ icon: I.sparkle, label: m.name, meta: [m.params, fmtGB(m.size)].filter(Boolean).join(" · "), checked: spec.mode !== "custom" && m.name === spec.model,
        onClick: () => { spec.mode = "run"; spec.model = m.name; app.renderTabs(); connect(true, `── модель: ${m.name}`); } })),
      { sep: true },
      { icon: I.download, label: "Скачать модель…", onClick: () => showSetup("models") },
      { icon: I.term, label: "Своя команда запуска…", meta: "LM Studio, llama.cpp", onClick: customCommand },
      { icon: I.refresh, label: "Обновить список", onClick: refreshAI },
      ...(st?.installed || st?.running ? [] : [{ icon: I.ext, label: "Установить Ollama…", onClick: () => showSetup("install") }]),
    ], { width: 320 });
  }

  async function customCommand() {
    const cur = S.state?.settings?.aiCommand || "";
    const c = prompt("Команда запуска модели в терминале. {model} заменится на имя модели.\nНапример: lms chat {model}   или   llama-cli -m C:\\models\\{model}.gguf -cnv", cur);
    if (c == null) return;
    await api.AISetPrefs(S.state?.settings?.aiModel || "", c.trim());
    S.state = await api.GetState();
    if (c.trim()) { spec.mode = "custom"; connect(true, "── своя команда: " + c.trim()); }
  }

  function showSetup(kind) {
    setup.hidden = false;
    if (kind === "install") {
      setup.innerHTML = `<div class="ai-card">
        <div class="ai-ico">${I.sparkle}</div>
        <h3>Нужна Ollama</h3>
        <p class="dim">Ollama запускает ИИ-модели прямо на этом компьютере: без интернета и без отправки данных наружу. Установка займёт минуту.</p>
        <div class="ai-acts">
          <button class="btn primary" data-s="winget">${I.download}Установить через winget</button>
          <button class="btn" data-s="site">${I.ext}Скачать с ollama.com</button>
          <button class="btn ghost" data-s="recheck">${I.refresh}Проверить снова</button>
        </div>
        <p class="dim small">Уже используешь LM Studio или llama.cpp? <button class="link" data-s="custom">Укажи свою команду запуска</button></p></div>`;
    } else {
      const have = new Set((tab.ai?.models || []).map((m) => m.name));
      setup.innerHTML = `<div class="ai-card wide">
        <div class="ai-ico">${I.download}</div>
        <h3>${have.size ? "Скачать ещё модель" : "Скачай первую модель"}</h3>
        <p class="dim">Модель скачается один раз и будет работать без интернета. Чем больше модель — тем умнее, но тем больше нужно памяти.</p>
        <div class="ai-models">${SUGGEST.map(([n, sz, d]) => `<button class="ai-m${have.has(n) ? " have" : ""}" data-pull="${n}"><b>${n}</b><span class="dim small">${d}</span><span class="tag">${have.has(n) ? "есть" : sz}</span></button>`).join("")}</div>
        <div class="path-input"><input placeholder="или любая модель из ollama.com/library, например phi4:14b" data-name><button class="btn primary" data-s="pull">${I.download}Скачать</button></div>
        ${have.size ? `<button class="btn ghost" data-s="close">${I.x}Закрыть</button>` : ""}</div>`;
    }
    setup.onclick = async (e) => {
      const b = e.target.closest("[data-s],[data-pull]");
      if (!b) return;
      if (b.dataset.pull) return pull(b.dataset.pull);
      const a = b.dataset.s;
      if (a === "site") win.openURL("https://ollama.com/download");
      if (a === "winget") { spec.mode = "custom"; spec.after = "recheck"; aiOpenRaw("winget install -e --id Ollama.Ollama --accept-source-agreements --accept-package-agreements"); }
      if (a === "recheck") { spec.mode = "run"; connect(true); }
      if (a === "custom") customCommand();
      if (a === "pull") { const n = setup.querySelector("[data-name]").value.trim(); if (n) pull(n); }
      if (a === "close") { setup.hidden = true; xt.term.focus(); }
    };
    setup.querySelector("[data-name]")?.addEventListener("keydown", (e) => { if (e.key === "Enter") { const n = e.target.value.trim(); if (n) pull(n); } });
  }

  function pull(name) {
    spec.model = name;
    spec.mode = "pull";
    app.renderTabs();
    connect(true, `── скачиваю ${name}…`);
  }

  // после скачивания — сразу чат; после установки Ollama — проверка
  tab.onExit = (msg) => {
    if (spec.kind !== "ai") return false;
    const ok = /код 0\b/.test(msg || "");
    if (spec.mode === "pull") {
      if (ok) { spec.mode = "run"; refreshAI(); connect(true, `── модель ${spec.model} скачана, запускаю чат…`); return true; }
      xt.term.write(`\r\n\x1b[31m── не удалось скачать ${spec.model}\x1b[0m\r\n`);
    }
    if (spec.after === "recheck") { spec.after = ""; spec.mode = "run"; xt.term.write("\r\n\x1b[90m── установка завершена, проверяю Ollama…\x1b[0m\r\n"); setTimeout(() => connect(true), 1500); return true; }
    return false;
  };

  async function aiOpenRaw(cmd) {
    setup.hidden = true;
    if (tab.sid) { api.TermClose(tab.sid); sessions.delete(tab.sid); tab.sid = null; }
    xt.term.write(`\r\n\x1b[90m$ ${cmd}\x1b[0m\r\n`);
    try {
      tab.sid = await api.AIOpen("", "custom", cmd, xt.term.cols, xt.term.rows);
      register(tab.sid, tab);
      tab.dead = false;
    } catch (e) { xt.term.write(`\x1b[31m${errText(e)}\x1b[0m\r\n`); tab.setDead(true); }
  }

  async function aiConnect(note) {
    if (tab.sid) { api.TermClose(tab.sid); sessions.delete(tab.sid); tab.sid = null; }
    if (note) xt.term.write(`\r\n\x1b[90m${note}\x1b[0m\r\n`);
    tab.dead = false; tab.badge = "";
    const st = await refreshAI();
    const custom = S.state?.settings?.aiCommand || "";
    if (spec.mode === "custom" && !custom && !spec.after) spec.mode = "run";
    if (spec.mode !== "custom") {
      if (!st?.installed && !st?.running) return showSetup("install");
      if (spec.mode !== "pull") {
        const names = (st.models || []).map((m) => m.name);
        if (!spec.model || !names.includes(spec.model)) spec.model = names.includes(S.state?.settings?.aiModel) ? S.state.settings.aiModel : names[0];
        if (!spec.model) return showSetup("models");
      }
    }
    setup.hidden = true;
    app.renderTabs();
    if (spec.mode === "run") xt.term.write(`\x1b[90m── запускаю ${spec.model}… (первый запуск модели может занять до минуты)\x1b[0m\r\n`);
    try {
      tab.sid = await api.AIOpen(spec.model || "", spec.mode || "run", custom, xt.term.cols, xt.term.rows);
      register(tab.sid, tab);
      if (spec.mode === "run") api.AISetPrefs(spec.model, custom).then(async () => { S.state = await api.GetState(); });
      aiHead();
      setTimeout(refreshAI, 4000);
    } catch (e) {
      xt.term.write(`\x1b[31m${errText(e)}\x1b[0m\r\n\x1b[90mEnter — попробовать снова\x1b[0m\r\n`);
      tab.setDead(true);
    }
  }
  let aiTimer = null;
  if (spec.kind === "ai") aiTimer = setInterval(() => { if (S.active === tab.id && document.visibilityState === "visible") refreshAI(); }, 8000);

  xt.term.onData((d) => {
    if (tab.sid) api.TermWrite(tab.sid, d);
    else if (tab.dead && d === "\r") connect(true);
  });
  xt.term.onTitleChange((t) => {
    tab.osTitle = t;
    const o = head.querySelector(".os-title");
    if (o) o.textContent = t;
  });
  xt.term.onBell(() => { el.classList.remove("bell"); void el.offsetWidth; el.classList.add("bell"); });

  // кнопка «вниз», когда пролистали историю
  const updBottom = () => {
    const b = xt.term.buffer.active;
    bottomBtn.hidden = b.viewportY >= b.baseY;
  };
  xt.term.onScroll(updBottom);
  xt.term.onWriteParsed(updBottom);
  bottomBtn.onclick = () => { xt.term.scrollToBottom(); xt.term.focus(); };

  // ---------- поиск ----------
  const findInput = findBar.querySelector("input");
  const findCount = findBar.querySelector(".tf-count");
  let caseSensitive = false;
  const t = () => currentTheme();
  const findOpts = () => ({
    caseSensitive,
    decorations: { matchBorder: t().yellow, matchOverviewRuler: t().yellow, activeMatchBackground: t().brightBlack, activeMatchBorder: t().yellow, activeMatchColorOverviewRuler: t().cursor },
  });
  xt.search.onDidChangeResults?.(({ resultIndex, resultCount }) => {
    findCount.textContent = findInput.value ? (resultCount ? `${resultIndex + 1} из ${resultCount}` : "нет") : "";
  });
  const doFind = (dir) => {
    if (!findInput.value) { xt.search.clearDecorations(); findCount.textContent = ""; return; }
    dir < 0 ? xt.search.findPrevious(findInput.value, findOpts()) : xt.search.findNext(findInput.value, { ...findOpts(), incremental: dir === 0 });
  };
  tab.find = () => {
    findBar.hidden = false;
    const sel = xt.term.getSelection();
    if (sel && !sel.includes("\n")) findInput.value = sel;
    findInput.focus();
    findInput.select();
    doFind(0);
  };
  const closeFind = () => { findBar.hidden = true; xt.search.clearDecorations(); xt.term.focus(); };
  findInput.oninput = () => doFind(0);
  findInput.onkeydown = (e) => {
    if (e.key === "Enter") { e.preventDefault(); doFind(e.shiftKey ? -1 : 1); }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeFind(); }
  };
  findBar.onclick = (e) => {
    const f = e.target.closest("[data-f]")?.dataset.f;
    if (f === "close") closeFind();
    if (f === "next") doFind(1);
    if (f === "prev") doFind(-1);
    if (f === "case") { caseSensitive = !caseSensitive; e.target.closest("button").classList.toggle("on", caseSensitive); doFind(0); }
  };
  tab.clear = () => xt.term.clear();

  const fitNow = () => {
    if (!el.isConnected || el.offsetParent === null) return;
    try { xt.fit.fit(); } catch {}
    if (tab.sid) api.TermResize(tab.sid, xt.term.cols, xt.term.rows);
    if (S.active === tab.id) app.renderStatus();
  };
  new ResizeObserver(() => requestAnimationFrame(fitNow)).observe(host);
  xt.term.onResize(() => { if (tab.sid) api.TermResize(tab.sid, xt.term.cols, xt.term.rows); });

  tab.onShow = () => {
    if (tab.badge === "activity") { tab.badge = ""; app.renderTabs(); }
    if (!opened) {
      opened = true;
      xt.term.open(host);
      xt.enableWebgl();
      clipboardKeys(xt.term, host);
      requestAnimationFrame(() => { fitNow(); connect(); });
    } else requestAnimationFrame(fitNow);
    setTimeout(() => xt.term.focus(), 30);
  };
  tab.onClose = () => { clearInterval(aiTimer); closeMenu(); if (tab.sid) { api.TermClose(tab.sid); sessions.delete(tab.sid); } xt.dispose(); };
  tab.onVpnChange = () => tab.renderHead();
  tab.renderHead();
  return tab;
}
