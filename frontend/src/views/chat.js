// Чат с ИИ-агентом — панель справа. Агент может работать с серверами через инструменты;
// опасные действия ждут «Разрешить» прямо в ленте чата.
import { api, errText, on, win } from "../api.js";
import { S, app, serverById } from "../core.js";
import { $, $$, h, esc, I, menu, toast, store, popover, closeMenu } from "../ui.js";
import { A, loadAI, agentIcon, agentForm, toolTitle, installed, pull, pullBar, openMarket, openHub } from "./ai.js";

const C = { open: false, agentId: store.get("chat.agent", ""), sid: "", busy: false, turn: null, text: null, cards: {}, early: [], sending: false };
let el, msgs, input;

// ============================================================
//  Разметка
// ============================================================
export function initChat() {
  el = h(`<aside class="chat" id="chat">
    <div class="chat-resizer"></div>
    <div class="chat-h">
      <button class="ag-chip" data-agpick></button>
      <span class="grow"></span>
      <button class="icon-btn" data-hist title="История чатов">${I.clock}</button>
      <button class="icon-btn" data-new title="Новый чат">${I.plus}</button>
      <button class="icon-btn" data-close title="Скрыть (Ctrl+J)">${I.x}</button>
    </div>
    <div class="chat-ext"></div>
    <div class="chat-msgs"></div>
    <div class="chat-in">
      <div class="chat-ctx"></div>
      <div class="chat-box"><textarea rows="1" placeholder="Спроси или поручи… (Enter — отправить)" spellcheck="false"></textarea>
        <button class="send" data-send title="Отправить">${I.send}</button></div>
    </div>
  </aside>`);
  $(".body").append(el);
  msgs = $(".chat-msgs", el);
  input = $("textarea", el);
  document.documentElement.style.setProperty("--chat-w", store.get("chat.w", 400) + "px");

  input.addEventListener("input", autosize);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
    if (e.key === "Escape") { e.preventDefault(); if (C.busy) stop(); }
  });
  el.addEventListener("click", onClick);

  // ширина
  const r = $(".chat-resizer", el);
  r.onmousedown = (e) => {
    const x0 = e.clientX, w0 = el.offsetWidth;
    r.classList.add("drag");
    const mv = (ev) => { const w = Math.min(760, Math.max(320, w0 - (ev.clientX - x0))); document.documentElement.style.setProperty("--chat-w", w + "px"); store.set("chat.w", w); };
    const up = () => { r.classList.remove("drag"); removeEventListener("mousemove", mv); removeEventListener("mouseup", up); S.tabs.find((t) => t.id === S.active)?.onShow?.(); };
    addEventListener("mousemove", mv); addEventListener("mouseup", up);
  };

  on("agent:event", onEvent);
  on("agent:approve", onApprove);
  on("agent:approved", (id, d) => {
    const card = document.querySelector(`.ap[data-ap="${id}"]`);
    if (card && !card.classList.contains("done")) settle(card, d);
  });
  app.chatRefreshAgents = () => { if (C.open) { renderHead(); renderCtx(); if (!C.sid) renderEmpty(); } };
  if (store.get("chat.open", false)) toggleChat(true);
  // неотвеченные запросы (например, после перезагрузки интерфейса)
  api.AgentPending().then((l) => l.forEach(onApprove)).catch(() => {});
}

function autosize() {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 220) + "px";
}

export function toggleChat(show) {
  C.open = show ?? !C.open;
  document.body.classList.toggle("chat-open", C.open);
  store.set("chat.open", C.open);
  $("#chatBtn")?.classList.toggle("on", C.open);
  if (C.open) {
    loadAI().then(() => {
      if (!A.agents.find((a) => a.id === C.agentId)) C.agentId = A.agents[0]?.id || "";
      renderHead(); renderCtx();
      const last = store.get("chat.sid", "");
      if (!C.sid && last && !C.restored) { C.restored = true; loadChat(last).catch(() => renderEmpty()); }
      else if (!C.sid && !msgs.children.length) renderEmpty();
    });
    setTimeout(() => input.focus(), 50);
  }
  // терминалам — пересчитать размер
  setTimeout(() => S.tabs.find((t) => t.id === S.active)?.onShow?.(), 60);
}

export function openChat(agentId, text) {
  if (agentId && agentId !== C.agentId) { C.agentId = agentId; store.set("chat.agent", agentId); newChat(); }
  toggleChat(true);
  if (text) { input.value = text; autosize(); }
}

const agent = () => A.agents.find((a) => a.id === C.agentId);

function renderHead() {
  const a = agent();
  $("[data-agpick]", el).innerHTML = a
    ? `${agentIcon(a, "sm")}<span class="ag-n"><b>${esc(a.name)}</b><small>${esc(a.model || "модель не выбрана")}</small></span>${I.chev}`
    : `${I.sparkle}<span class="ag-n"><b>Выбери агента</b></span>${I.chev}`;
  const btn = $("[data-send]", el);
  btn.innerHTML = C.busy ? I.stop : I.send;
  btn.title = C.busy ? "Остановить (Esc)" : "Отправить";
  btn.classList.toggle("stop", C.busy);
}

// что сейчас открыто — подсказка агенту
function contextHint() {
  const t = S.tabs.find((t) => t.id === S.active);
  if (!t) return null;
  if (t.type === "term" && t.spec?.kind === "ssh") return { label: t.spec.server, hint: `терминал сервера ${t.spec.server}` };
  if (t.type === "sftp") return { label: t.server, hint: `файлы (SFTP) сервера ${t.server}` };
  if (t.type === "editor") return { label: t.path.split("/").pop(), hint: `файл хранилища ${t.path}` };
  if (t.type === "lab") return { label: "лаба " + t.lab, hint: `лаба ${t.lab}` };
  if (t.type === "git") return { label: t.title, hint: `git-репозиторий ${t.repo}` };
  return null;
}

const MODES = { all: ["Каждый шаг", "спрашивать перед каждым вызовом"], danger: ["Подтверждать изменения", "чтение — сразу, изменения — после «Разрешить»"], never: ["Автопилот", "без вопросов, кроме особо опасного"] };

function renderCtx() {
  const a = agent();
  const c = contextHint();
  const useCtx = store.get("chat.ctx", true);
  const tools = a?.tools?.length || 0;
  $(".chat-ctx", el).innerHTML = `
    ${c ? `<button class="cchip${useCtx ? " on" : ""}" data-ctx title="Сообщить агенту, что открыто сейчас">${I.eye}${esc(c.label)}</button>` : ""}
    ${a ? (tools ? `<button class="cchip mode-${a.approve || "danger"}" data-mode title="${esc(MODES[a.approve || "danger"][1])}">${a.approve === "never" ? I.warn : I.shield}${MODES[a.approve || "danger"][0]}</button>`
      : `<span class="cchip off" title="У агента нет инструментов">${I.chat}только чат</span>`) : ""}
    ${a && a.provider !== "openai" && a.model && A.status?.running && !installed(a.model) ? (A.pulls[a.model] ? pullBar(a.model) : `<button class="cchip warn" data-getmodel>${I.download}скачать ${esc(a.model)}</button>`) : ""}`;
}

// ============================================================
//  Пустой чат
// ============================================================
function renderEmpty() {
  const a = agent();
  msgs.innerHTML = "";
  if (!A.agents.length) {
    msgs.append(h(`<div class="chat-empty">${I.sparkle}<b>Агентов пока нет</b><p class="dim">Добавь готового из каталога или создай своего.</p>
      <button class="btn primary" data-market>${I.store}Каталог агентов</button></div>`));
    return;
  }
  if (!a) return;
  const st = A.status;
  const srv = S.snap.servers.slice(0, 2).map((s) => s.id);
  const sugg = {
    devops: [`Проверь место на дисках на всех серверах`, srv[0] && `Что сейчас грузит ${srv[0]}?`, `Какие сервисы упали за последний час?`],
    logs: [srv[0] && `Почему на ${srv[0]} ошибки 502?`, `Найди ошибки в journalctl за сегодня`, `Что в dmesg подозрительного?`],
    security: [srv[0] && `Проверь ${srv[0]} по чек-листу безопасности`, `Какие порты открыты наружу на всех серверах?`, `Найди серверы, где можно войти по паролю`],
    scripter: [`Напиши скрипт проверки сертификатов`, `Сделай плейбук установки docker`, `Скрипт бэкапа /etc в архив`],
    git: [`Что изменилось в репозиториях?`, `Напиши сообщение коммита по изменениям`, `Кто последним менял код?`],
    lab: [`Какие лабы есть и что запущено?`, `Подними лабу и проверь машины`],
  }[a.template] || [`Какие серверы у меня есть?`, `Что ты умеешь?`];
  const tl = (a.tools || []).map((t) => A.catalog?.tools?.find((x) => x.name === t)).filter(Boolean);
  msgs.append(h(`<div class="chat-empty">
    ${agentIcon(a, "xl")}<b>${esc(a.name)}</b>
    <p class="dim">${esc(a.desc || "")}</p>
    ${tl.length ? `<div class="ce-tools">${tl.map((t) => `<span class="tool-chip${t.danger ? " danger" : ""}" title="${esc(t.desc)}">${esc(t.title)}</span>`).join("")}</div>` : `<div class="dim small">Без доступа к серверам — только разговор.</div>`}
    ${st && !st.running && a.provider !== "openai" ? `<div class="ce-warn">${I.warn}${st.installed ? `Ollama не запущена — запущу при отправке.` : `Ollama не установлена. <button class="link" data-oinst>Установить</button>`}</div>` : ""}
    <div class="ce-sugg">${sugg.filter(Boolean).map((s) => `<button data-sugg>${esc(s)}</button>`).join("")}</div>
    <button class="link" data-agedit>${I.gear} настроить агента</button>
  </div>`));
}

// ============================================================
//  Отправка
// ============================================================
async function send() {
  if (C.busy) return stop();
  const text = input.value.trim();
  const a = agent();
  if (!text || C.sending) return;
  if (!a) return toast("Сначала выбери агента", "err");
  const c = store.get("chat.ctx", true) ? contextHint() : null;
  if (!C.sid) msgs.innerHTML = "";
  userMsg(text);
  input.value = ""; autosize();
  C.sending = true;
  setBusy(true);
  startTurn();
  try {
    const sid = await api.ChatSend(C.sid, a.id, text, c?.hint || "");
    C.sid = sid;
    store.set("chat.sid", sid);
    const early = C.early.filter((e) => e.session === sid);
    C.early = [];
    early.forEach(onEvent);
  } catch (e) {
    errorLine(errText(e));
    setBusy(false);
  } finally { C.sending = false; }
}

function stop() { if (C.sid) api.ChatStop(C.sid); }

function setBusy(b) {
  C.busy = b;
  renderHead();
  el.classList.toggle("busy", b);
}

function newChat() {
  if (C.busy) stop();
  C.sid = ""; C.turn = null; C.text = null; C.cards = {};
  store.set("chat.sid", "");
  setBusy(false);
  renderEmpty();
  renderCtx();
}

// ============================================================
//  Лента
// ============================================================
function scrollDown(force) {
  const near = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 120;
  if (near || force) msgs.scrollTop = msgs.scrollHeight;
}

function userMsg(text) {
  msgs.append(h(`<div class="msg user"><div class="bubble">${esc(text).replace(/\n/g, "<br>")}</div></div>`));
  scrollDown(true);
}

function startTurn() {
  const a = agent();
  C.turn = h(`<div class="msg bot"><div class="bot-h">${agentIcon(a, "xs")}<b>${esc(a?.name || "Агент")}</b><span class="typing"><i></i><i></i><i></i></span></div><div class="parts"></div></div>`);
  C.text = null;
  C.think = null;
  msgs.append(C.turn);
  scrollDown(true);
}

function part(cls, html = "") {
  if (!C.turn) startTurn();
  const p = h(`<div class="${cls}">${html}</div>`);
  $(".parts", C.turn).append(p);
  return p;
}

let renderQ = null;
function appendText(t) {
  if (!C.text) { C.text = part("md"); C.text._raw = ""; }
  C.text._raw += t;
  const node = C.text;
  if (renderQ) return;
  renderQ = requestAnimationFrame(() => { renderQ = null; node.innerHTML = md(node._raw); scrollDown(); });
}

function appendThink(t) {
  if (!C.think) {
    C.think = part("think", `<details open><summary>${I.sparkle}Размышляет…</summary><div class="think-t"></div></details>`);
    C.think._raw = "";
  }
  C.think._raw += t;
  $(".think-t", C.think).textContent = C.think._raw;
  scrollDown();
}

function closeThink() {
  if (C.think) { const d = $("details", C.think); d.open = false; $("summary", C.think).innerHTML = `${I.sparkle}Размышления`; C.think = null; }
}

// ---------- инструменты ----------
const GROUP_ICON = { servers: I.server, files: I.folder, scripts: I.code, vpn: I.shield, labs: I.layers, git: I.branch, local: I.windows, knowledge: I.search };

function parseArgs(s) { try { const v = typeof s === "string" ? JSON.parse(s || "{}") : s; return typeof v === "string" ? JSON.parse(v) : v || {}; } catch { return {}; } }

function toolTarget(name, args) {
  const a = parseArgs(args);
  const srv = a.server ? `<span class="tc-srv">${esc(a.server)}</span>` : "";
  const main = a.command || a.path || a.script || a.query || a.repo || a.lab || a.id || "";
  return `${srv}${main ? `<span class="tc-arg mono">${esc(String(main).split("\n")[0].slice(0, 120))}</span>` : ""}`;
}

function toolCard(id, name, args) {
  const t = A.catalog?.tools?.find((x) => x.name === name);
  const card = part("tc running", `
    <div class="tc-h" data-tctoggle><span class="tc-ico">${GROUP_ICON[t?.group] || I.code}</span><span class="tc-t">${esc(toolTitle(name))}</span>${toolTarget(name, args)}<span class="tc-st"><span class="spin"></span></span></div>
    <div class="tc-b" hidden></div>`);
  card.dataset.call = id;
  card._args = parseArgs(args);
  C.cards[id] = card;
  C.text = null;
  closeThink();
  scrollDown();
  return card;
}

function cleanOut(s) {
  return String(s || "").replace(/^<data source="[^"]*">\n?/, "").replace(/\n?<\/data>(\n\[ВНИМАНИЕ Infra:[^\]]*\])?$/, "");
}

function toolResult(id, ok, text) {
  const card = C.cards[id];
  if (!card) return;
  card.classList.remove("running");
  card.classList.add(ok ? "ok" : "fail");
  const inj = /\[ВНИМАНИЕ Infra:/.test(text);
  const sec = /\[Infra: скрыто секретов — (\d+)\]/.exec(text);
  const blocked = /^ОШИБКА: заблокировано политикой/.test(text);
  const denied = /пользователь отклонил/.test(text);
  $(".tc-st", card).innerHTML = blocked ? `<span class="tc-badge bad">${I.shield}запрещено</span>` : denied ? `<span class="tc-badge">отклонено</span>` : ok ? I.check : `<span class="tc-badge bad">ошибка</span>`;
  if (inj) $(".tc-h", card).insertAdjacentHTML("beforeend", `<span class="tc-badge warn" title="В выводе текст, похожий на команды для ИИ — агенту сказано не выполнять его">${I.warn}инъекция?</span>`);
  if (sec) $(".tc-h", card).insertAdjacentHTML("beforeend", `<span class="tc-badge" title="Секреты скрыты перед отправкой модели">${I.key}${sec[1]}</span>`);
  const a = card._args || {};
  const extra = a.content ? `<div class="tc-l">содержимое</div><pre>${esc(String(a.content).slice(0, 4000))}</pre>` : a.command && String(a.command).includes("\n") ? `<pre>${esc(a.command)}</pre>` : "";
  $(".tc-b", card).innerHTML = `${extra}<div class="tc-l">${ok ? "результат" : "ошибка"}</div><pre>${esc(cleanOut(text.replace(/^ОШИБКА: /, "")).slice(0, 20000))}</pre>`;
  if (!ok && !denied) $(".tc-b", card).hidden = false;
  scrollDown();
}

function notice(text, cls = "") { part(`chat-note ${cls}`, `${I.info}<span>${esc(text)}</span>`); scrollDown(); }
function errorLine(text) {
  const p = part("chat-note err", `${I.warn}<span>${esc(text)}</span>${/модель не скачана|not found/.test(text) ? ` <button class="link" data-getmodel>скачать</button>` : ""}${/Ollama не установлена/.test(text) ? ` <button class="link" data-oinst>установить</button>` : ""}`);
  scrollDown(true);
  return p;
}

function finishTurn() {
  closeThink();
  if (C.turn) {
    $(".typing", C.turn)?.remove();
    if (!$(".parts", C.turn).children.length) C.turn.remove();
  }
  C.turn = null; C.text = null;
}

function onEvent(ev) {
  if (ev.session !== C.sid) {
    if (C.sending) C.early.push(ev);
    return;
  }
  switch (ev.type) {
    case "start": if (!C.turn) startTurn(); setBusy(true); break;
    case "thinking": appendThink(ev.text); break;
    case "delta": closeThink(); appendText(ev.text); break;
    case "tool": toolCard(ev.id, ev.tool, ev.args); break;
    case "result": toolResult(ev.id, ev.ok, ev.text || ""); break;
    case "notice": notice(ev.text); break;
    case "error": errorLine(ev.text); finishTurn(); setBusy(false); break;
    case "done": if (ev.text) notice(ev.text); finishTurn(); setBusy(false); refreshStatusLater(); break;
  }
}

function refreshStatusLater() { setTimeout(async () => { A.status = await api.AIStatus().catch(() => A.status); }, 500); }

// ============================================================
//  Подтверждения
// ============================================================
const LEVEL = { strict: ["Особо опасное действие", "strict"], confirm: ["Нужно подтверждение", "confirm"], allow: ["Агент хочет выполнить", ""] };

function approvalCard(ap) {
  const [title, cls] = LEVEL[ap.level] || LEVEL.allow;
  const who = ap.source === "mcp" ? `<b>${esc(ap.client || "Внешний ИИ")}</b> через MCP` : `<b>${esc(ap.agent || "Агент")}</b>`;
  const card = h(`<div class="ap ${cls}" data-ap="${esc(ap.id)}">
    <div class="ap-h">${ap.level === "strict" ? I.warn : I.shield}<span>${title}</span><span class="grow"></span><span class="dim small">${who}</span></div>
    <div class="ap-what"><b>${esc(ap.title || ap.tool)}</b>${(ap.servers || []).filter(Boolean).map((s) => `<span class="tc-srv">${esc(s)}${serverById(s)?.group ? ` · ${esc(serverById(s).group)}` : ""}</span>`).join("")}</div>
    ${ap.summary ? `<pre class="ap-cmd">${esc(ap.summary)}</pre>` : ""}
    ${(ap.reasons || []).length ? `<div class="ap-why">${I.warn}<span>${ap.reasons.map(esc).join(" · ")}</span></div>` : ""}
    ${(ap.knowledge || []).length ? `<details class="ap-kb"><summary>${I.file}Из базы знаний: ${ap.knowledge.map((k) => esc(k.heading || k.file)).join(" · ")}</summary>
      ${ap.knowledge.map((k) => `<div class="ap-kbi"><div class="dim small mono">${esc(k.file)}${k.heading ? " — " + esc(k.heading) : ""}</div><div>${md(k.text)}</div></div>`).join("")}</details>` : ""}
    <div class="ap-act">
      <button class="btn small primary" data-dec="allow">${I.check}Разрешить</button>
      ${ap.level !== "strict" ? `<button class="btn small" data-dec="always" title="${ap.source === "mcp" ? "До перезапуска Infra" : "В этом чате"} — для «${esc(ap.title)}»">Разрешать всегда</button>` : ""}
      <span class="grow"></span>
      <input class="ap-note" placeholder="почему нет (необязательно)">
      <button class="btn small danger" data-dec="deny">${I.x}Отклонить</button>
    </div></div>`);
  if (ap.level === "strict" || (ap.knowledge || []).length) setTimeout(() => { const d = $(".ap-kb", card); if (d && ap.level === "strict") d.open = true; });
  return card;
}

function settle(card, d) {
  card.classList.add("done");
  const txt = { allow: `${I.check}Разрешено`, always: `${I.check}Разрешено (всегда)`, cancel: "Отменено", timeout: "Нет ответа — отклонено" }[d] || `${I.x}Отклонено${d.startsWith("deny:") && d.length > 5 ? ": " + esc(d.slice(5)) : ""}`;
  $(".ap-act", card).innerHTML = `<span class="ap-res ${d === "allow" || d === "always" ? "ok" : "bad"}">${txt}</span>`;
  $(".ap-kb", card)?.removeAttribute("open");
}

function onApprove(ap) {
  const card = approvalCard(ap);
  if (ap.source === "mcp") {
    $(".chat-ext", el).append(card);
    if (!C.open) toggleChat(true);
    toast(`${I.shield} ${esc(ap.client || "Внешний ИИ")} просит: ${esc(ap.title)}`);
    try { if (document.hidden) new Notification("Infra: нужно подтверждение", { body: `${ap.client}: ${ap.title}` }); } catch {}
    return;
  }
  if (ap.session === C.sid) {
    if (!C.turn) startTurn();
    $(".parts", C.turn).append(card);
    scrollDown(true);
    $("[data-dec=allow]", card)?.focus({ preventScroll: true });
  } else {
    // фоновый чат — показываем сверху, чтобы не потерять
    $(".chat-ext", el).append(card);
    if (!C.open) toggleChat(true);
  }
  if (!C.open) toggleChat(true);
}

async function decide(card, dec) {
  const id = card.dataset.ap;
  if (dec === "deny") { const n = $(".ap-note", card)?.value.trim(); if (n) dec = "deny:" + n; }
  try { await api.AgentApprove(id, dec); settle(card, dec); if (card.parentElement.classList.contains("chat-ext")) setTimeout(() => card.remove(), 2500); }
  catch (e) { toast(esc(errText(e)), "err"); settle(card, "cancel"); }
}

// ============================================================
//  История
// ============================================================
async function historyMenu(anchor) {
  const list = await api.ChatList();
  const box = h(`<div class="hist">${list.length ? list.map((c) => {
    const a = A.agents.find((x) => x.id === c.agent);
    return `<div class="hist-i${c.id === C.sid ? " on" : ""}" data-load="${esc(c.id)}">${agentIcon(a, "xs")}<div class="hist-t"><b>${esc(c.title || "Без названия")}</b><span class="dim small">${esc(a?.name || c.agent)} · ${new Date(c.updated * 1000).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span></div>
      <button class="icon-btn" data-delchat="${esc(c.id)}" title="Удалить">${I.trash}</button></div>`;
  }).join("") : `<div class="dim" style="padding:12px">История пуста</div>`}</div>`);
  box.onclick = async (e) => {
    const del = e.target.closest("[data-delchat]");
    if (del) { e.stopPropagation(); await api.ChatDelete(del.dataset.delchat); del.closest(".hist-i").remove(); if (del.dataset.delchat === C.sid) newChat(); return; }
    const it = e.target.closest("[data-load]");
    if (it) { closeMenu(); loadChat(it.dataset.load); }
  };
  popover(anchor, box, { align: "right", width: 340 });
}

async function loadChat(id) {
  try {
    const s = await api.ChatLoad(id);
    C.sid = s.id; C.cards = {};
    if (s.agent && A.agents.find((a) => a.id === s.agent)) { C.agentId = s.agent; store.set("chat.agent", s.agent); }
    store.set("chat.sid", s.id);
    msgs.innerHTML = "";
    const results = {};
    s.messages.forEach((m) => { if (m.role === "tool") results[m.toolId] = m; });
    let turnOpen = false;
    for (const m of s.messages) {
      if (m.role === "user") { finishTurn(); turnOpen = false; userMsg(m.content); continue; }
      if (m.role === "assistant") {
        if (!turnOpen) { startTurn(); turnOpen = true; }
        if (m.thinking) { appendThink(m.thinking); closeThink(); }
        if (m.content) { C.text = part("md"); C.text._raw = m.content; C.text.innerHTML = md(m.content); C.text = null; }
        for (const c of m.toolCalls || []) {
          toolCard(c.id, c.name, c.args);
          const r = results[c.id];
          if (r) toolResult(c.id, !r.content.startsWith("ОШИБКА:"), r.content);
          else toolResult(c.id, false, "ОШИБКА: прервано");
        }
      }
    }
    finishTurn();
    const busy = await api.ChatBusy(s.id);
    setBusy(busy);
    if (busy) { startTurn(); notice("Агент ещё работает — новые сообщения появятся здесь"); }
    renderHead(); renderCtx();
    scrollDown(true);
  } catch (e) { store.set("chat.sid", ""); C.sid = ""; renderEmpty(); }
}

// ============================================================
//  Клики
// ============================================================
function agentMenu(anchor) {
  menu(anchor, [
    { header: "Агенты" },
    ...A.agents.map((a) => ({ icon: agentIcon(a, "xs"), label: a.name, meta: a.model, checked: a.id === C.agentId, onClick: () => { C.agentId = a.id; store.set("chat.agent", a.id); api.AISetDefaultAgent(a.id); newChat(); renderHead(); } })),
    { sep: true },
    ...(agent() ? [{ icon: I.gear, label: "Настроить агента…", onClick: () => agentForm(agent()) }] : []),
    { icon: I.plus, label: "Новый агент…", onClick: () => agentForm() },
    { icon: I.store, label: "Каталог агентов", onClick: () => openMarket("agents") },
    { icon: I.shield, label: "Безопасность и MCP", onClick: () => openHub("knowledge") },
  ], { width: 280 });
}

async function onClick(e) {
  const t = (s) => e.target.closest(s);
  let x;
  if ((x = t("[data-dec]"))) return decide(x.closest(".ap"), x.dataset.dec);
  if (t("[data-send]")) return send();
  if (t("[data-close]")) return toggleChat(false);
  if (t("[data-new]")) return newChat();
  if ((x = t("[data-hist]"))) return historyMenu(x);
  if ((x = t("[data-agpick]"))) return agentMenu(x);
  if (t("[data-agedit]")) return agentForm(agent());
  if (t("[data-market]")) return openMarket("agents");
  if (t("[data-oinst]")) return app.openAI();
  if ((x = t("[data-sugg]"))) { input.value = x.textContent; autosize(); return send(); }
  if (t("[data-ctx]")) { store.set("chat.ctx", !store.get("chat.ctx", true)); return renderCtx(); }
  if ((x = t("[data-getmodel]"))) { const m = agent()?.model; if (m) pull(m); return; }
  if ((x = t("[data-pullcancel]"))) return api.AIPullCancel(x.dataset.pullcancel);
  if ((x = t("[data-mode]"))) {
    const a = agent();
    return menu(x, Object.entries(MODES).map(([k, [l, d]]) => ({ label: l, meta: d, checked: (a.approve || "danger") === k, onClick: async () => {
      a.approve = k; await api.AgentSave(a); A.agents = await api.AgentList(); renderCtx();
    } })), { width: 360 });
  }
  if ((x = t("[data-tctoggle]"))) { const b = $(".tc-b", x.closest(".tc")); if (b.innerHTML) b.hidden = !b.hidden; return; }
  if ((x = t(".md a[href]"))) { e.preventDefault(); return win.openURL(x.getAttribute("href")); }
  if ((x = t("[data-copycode]"))) { await navigator.clipboard.writeText(x.closest(".code-b").querySelector("code").textContent); return toast(`${I.copy} Скопировано`); }
  if ((x = t("[data-runcode]"))) { app.pasteToTerminal?.(x.closest(".code-b").querySelector("code").textContent); return; }
}

// при смене вкладки — обновить подсказку контекста
export function chatTabChanged() { if (C.open) renderCtx(); }

// ============================================================
//  Markdown (небольшой и безопасный: сначала экранируем)
// ============================================================
export function md(src) {
  src = String(src || "");
  // <think>…</think> у моделей без отдельного поля thinking
  src = src.replace(/<think>([\s\S]*?)(<\/think>|$)/g, (_, t) => `\u0000THINK${btoa(unescape(encodeURIComponent(t)))}\u0000`);
  const blocks = [];
  src = src.replace(/```([\w+-]*)[^\n]*\n([\s\S]*?)(```|$)/g, (_, lang, code) => {
    blocks.push(`<div class="code-b"><div class="code-h"><span>${esc(lang || "код")}</span><button class="icon-btn" data-copycode title="Копировать">${I.copy}</button>${/^(bash|sh|shell|zsh|console|powershell|ps1|pwsh|cmd)?$/.test(lang) ? `<button class="icon-btn" data-runcode title="Вставить в открытый терминал">${I.term}</button>` : ""}</div><pre><code>${esc(code.replace(/\n$/, ""))}</code></pre></div>`);
    return `\u0000B${blocks.length - 1}\u0000`;
  });
  const inline = (s) => esc(s)
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<i>$2</i>")
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
  const out = [];
  let list = null;
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  let para = [];
  const flushPara = () => { if (para.length) { out.push(`<p>${para.map(inline).join("<br>")}</p>`); para = []; } };
  for (const line of src.split("\n")) {
    let m;
    if ((m = /^\u0000B(\d+)\u0000$/.exec(line.trim()))) { flushPara(); closeList(); out.push(blocks[+m[1]]); continue; }
    if ((m = /^\u0000THINK([^\u0000]*)\u0000/.exec(line.trim()))) { flushPara(); closeList(); out.push(`<details class="think-inl"><summary>Размышления</summary><div class="think-t">${esc(decodeURIComponent(escape(atob(m[1]))))}</div></details>`); continue; }
    if ((m = /^(#{1,4})\s+(.*)$/.exec(line))) { flushPara(); closeList(); out.push(`<h${m[1].length + 2}>${inline(m[2])}</h${m[1].length + 2}>`); continue; }
    if ((m = /^\s*[-*•]\s+(.*)$/.exec(line))) { flushPara(); if (list !== "ul") { closeList(); out.push("<ul>"); list = "ul"; } out.push(`<li>${inline(m[1])}</li>`); continue; }
    if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) { flushPara(); if (list !== "ol") { closeList(); out.push("<ol>"); list = "ol"; } out.push(`<li>${inline(m[1])}</li>`); continue; }
    if (/^\s*(---|\*\*\*)\s*$/.test(line)) { flushPara(); closeList(); out.push("<hr>"); continue; }
    if (!line.trim()) { flushPara(); closeList(); continue; }
    if (list) closeList();
    para.push(line);
  }
  flushPara(); closeList();
  return out.join("").replace(/\u0000B(\d+)\u0000/g, (_, i) => blocks[+i]);
}
