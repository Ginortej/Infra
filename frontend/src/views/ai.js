// Раздел «ИИ»: агенты, модели, маркет, база знаний и безопасность, MCP.
import { api, errText, on, win } from "../api.js";
import { S, app } from "../core.js";
import { $, $$, h, esc, I, menu, modal, toast, confirmBox, store, fmtDate } from "../ui.js";

// ---------- Состояние ----------
export const A = {
  loaded: false, status: null, catalog: null, agents: [], pulls: {}, mcp: null, know: null, sys: null,
};

const GB = (b) => (b / 1073741824);
const gb = (n) => (n >= 10 ? n.toFixed(0) : n.toFixed(1));

export async function loadAI(full = false) {
  const tasks = [api.AIStatus().then((s) => (A.status = s)), api.AgentList().then((l) => (A.agents = l))];
  if (!A.catalog || full) tasks.push(api.AICatalog().then((c) => (A.catalog = c)));
  if (!A.mcp || full) tasks.push(api.MCPStatus().then((m) => (A.mcp = m)));
  tasks.push(api.KnowledgeStatus().then((k) => (A.know = k)).catch(() => (A.know = null)));
  tasks.push(api.SysStats().then((s) => (A.sys = s)).catch(() => {}));
  await Promise.allSettled(tasks);
  A.loaded = true;
  return A;
}

export const installed = (name) => !!A.status?.models?.some((m) => m.name === name || m.name === name + ":latest" || (!name.includes(":") && m.name.startsWith(name + ":")));

// ---------- Иконки агентов ----------
export const AGENT_ICONS = { server: I.server, activity: I.activity, shield: I.shield, code: I.code, branch: I.branch, layers: I.layers, sparkle: I.sparkle, globe: I.globe, cpu: I.cpu, key: I.key };
export const COLORS = ["#8b7cf6", "#5aa9f0", "#4cc38a", "#e0a03c", "#f07a5a", "#c77dd8", "#9aa0a6", "#e5c07b"];
export const agentIcon = (a, size = "") => `<span class="ag-ico ${size}" style="--c:${esc(a?.color || "#8b9cf4")}">${AGENT_ICONS[a?.icon] || I.sparkle}</span>`;

export const toolTitle = (name) => A.catalog?.tools?.find((t) => t.name === name)?.title || name;

const CAPS = {
  tools: ["инструменты", "Может управлять серверами через агента"], code: ["код", "Сильна в коде и скриптах"], vision: ["зрение", "Понимает картинки"],
  thinking: ["рассуждения", "Думает перед ответом"], embed: ["эмбеддинги", "Для поиска по базе знаний"], ru: ["русский", "Хорошо говорит по-русски"],
};
const capBadge = (c) => CAPS[c] ? `<span class="cap cap-${c}" title="${CAPS[c][1]}">${CAPS[c][0]}</span>` : "";

// Влезет ли модель: по видеопамяти и ОЗУ.
export function fit(sizeGB) {
  const g = A.sys?.gpus?.[0];
  const vram = g?.memTotal ? GB(g.memTotal) : 0;
  const ram = A.sys?.ramTotal ? GB(A.sys.ramTotal) : 0;
  const need = sizeGB * 1.15 + 0.6;
  if (!ram && !vram) return { k: "?", t: "" };
  if (vram && need <= vram * 0.95) return { k: "gpu", t: `влезет в видеокарту (~${gb(need)} из ${gb(vram)} ГБ)` };
  if (vram && need <= vram + ram * 0.6) return { k: "part", t: `частично в ОЗУ — медленнее (~${gb(need)} ГБ, видеокарта ${gb(vram)})` };
  if (!vram && need <= ram * 0.6) return { k: "part", t: `на процессоре — медленно (~${gb(need)} ГБ ОЗУ)` };
  return { k: "no", t: `не хватит памяти (~${gb(need)} ГБ)` };
}

// ---------- Скачивание ----------
export async function pull(model) {
  if (A.pulls[model]) return;
  A.pulls[model] = { status: "запуск…", completed: 0, total: 0 };
  refreshAIViews();
  try { await api.AIPull(model); } catch (e) { delete A.pulls[model]; toast(esc(errText(e)), "err"); refreshAIViews(); }
}
on("ai:pull", async (ev) => {
  if (ev.done) {
    delete A.pulls[ev.model];
    if (ev.error) toast(`${I.warn} ${esc(ev.model)}: ${esc(ev.error)}`, "err");
    else { toast(`${I.check} Модель ${esc(ev.model)} установлена`); A.status = await api.AIStatus(); }
  } else A.pulls[ev.model] = ev;
  refreshAIViews(true);
});
on("mcp:log", (e) => { if (A.mcp) { A.mcp.log = [...(A.mcp.log || []), e].slice(-50); refreshAIViews(true); } });

const pct = (p) => (p?.total ? Math.round((p.completed / p.total) * 100) : 0);
export const pullBar = (m) => {
  const p = A.pulls[m];
  return `<div class="pull"><div class="pull-bar"><i style="width:${pct(p)}%"></i></div><span class="dim small">${p.total ? pct(p) + "% · " + gb(GB(p.completed)) + "/" + gb(GB(p.total)) + " ГБ" : esc(p.status || "")}</span><button class="icon-btn" data-pullcancel="${esc(m)}" title="Отменить">${I.x}</button></div>`;
};

// Обновить всё, что показывает ИИ-данные (боковую панель и открытые вкладки).
let rt;
export function refreshAIViews(light = false) {
  clearTimeout(rt);
  rt = setTimeout(() => {
    if (S.panel === "ai") app.renderSidebar?.();
    if (S.panel === "market") side.market?.refresh(light);
    if (S.panel === "aiset") side.aiset?.refresh(light);
    app.chatRefreshAgents?.();
  }, light ? 60 : 0);
}

// ============================================================
//  Боковая панель
// ============================================================
export function aiSideHtml(match, group) {
  if (!A.loaded) { loadAI().then(() => app.renderSidebar()); return `<div class="side-empty">Загрузка…</div>`; }
  const st = A.status || {};
  let html = "";
  const ags = A.agents.filter((a) => match(a.name + a.model));
  html += group("Агенты", ags.map((a) => `
    <div class="item ag-item" data-chat="${esc(a.id)}" title="${esc(a.desc || "")}">${agentIcon(a, "sm")}<span class="name">${esc(a.name)}</span><span class="meta">${esc(a.model)}</span>
      <span class="hover-acts"><button class="icon-btn" title="Настроить" data-agedit="${esc(a.id)}">${I.gear}</button></span></div>`).join("")
    + `<div class="item sub" data-market="agents">${I.plus}<span class="name dim">Добавить агента…</span></div>`, ags.length);

  let models = "";
  if (!st.running) {
    models = `<div class="side-mini">${st.installed ? `Ollama не запущена. <button class="link" data-ollama-start>Запустить</button>` : `Ollama не установлена. <button class="link" data-ollama-install>Установить</button>`}</div>`;
  } else {
    const loaded = new Set((st.loaded || []).map((m) => m.name));
    models = (st.models || []).filter((m) => match(m.name)).map((m) => `
      <div class="item" title="${esc(m.params + " " + m.quant)}"><span class="dot ${loaded.has(m.name) ? "ok" : ""}" title="${loaded.has(m.name) ? "в памяти" : ""}"></span><span class="name">${esc(m.name)}</span><span class="meta">${gb(GB(m.size))} ГБ</span>
        <span class="hover-acts"><button class="icon-btn" title="Меню" data-modelmenu="${esc(m.name)}">${I.dots}</button></span></div>`).join("");
    models += Object.keys(A.pulls).map((m) => `<div class="item pulling"><span class="spin"></span><span class="name">${esc(m)}</span><span class="meta">${pct(A.pulls[m])}%</span></div>`).join("");
    if (!(st.models || []).length && !Object.keys(A.pulls).length) models += `<div class="side-mini">Моделей нет. <button class="link" data-market="models">Открыть маркет</button></div>`;
  }
  html += group("Модели", models + `<div class="item sub" data-market="models">${I.download}<span class="name dim">Маркет моделей…</span></div>`, st.models?.length || 0);

  const k = A.know;
  const kn = !k ? `<div class="side-mini">Открой хранилище</div>` : !k.exists
    ? `<div class="side-mini">Базы знаний нет. <button class="link" data-know-init>Создать с примерами</button></div>`
    : `<div class="item" data-hub="knowledge">${I.file}<span class="name">База знаний</span><span class="meta">${k.files} ф. · ${k.chunks}${k.vectors ? " · вект." : ""}</span></div>
       <div class="item" data-open="${esc(k.rulesFile)}">${I.shield}<span class="name">Правила для ИИ</span><span class="meta">${k.hasRules ? (k.guardErrors?.length ? "ошибка" : "rules.yaml") : "встроенные"}</span></div>`;
  html += group("Безопасность", kn);

  const m = A.mcp;
  html += group("MCP для других ИИ", `<div class="item" data-hub="mcp"><span class="dot ${m?.running ? "ok" : ""}"></span><span class="name">${m?.running ? "Включён" : "Выключен"}</span>
    <span class="meta">${m?.running ? (m.readOnly ? "только чтение" : m.tools + " инстр.") : ""}</span>
    <button class="switch${m?.running ? " on" : ""}" data-mcp-toggle title="${m?.running ? "Выключить" : "Включить"}"></button></div>`);
  return html;
}

export function aiSideClick(e) {
  const t = (s) => e.target.closest(s);
  let x;
  if ((x = t("[data-pullcancel]"))) { api.AIPullCancel(x.dataset.pullcancel); return true; }
  if ((x = t("[data-agedit]"))) { agentForm(A.agents.find((a) => a.id === x.dataset.agedit)); return true; }
  if ((x = t("[data-chat]"))) { app.openChat(x.dataset.chat); return true; }
  if ((x = t("[data-market]"))) { openMarket(x.dataset.market); return true; }
  if ((x = t("[data-modelmenu]"))) { modelMenu(x, x.dataset.modelmenu); return true; }
  if ((x = t("[data-mcp-toggle]"))) { e.stopPropagation(); toggleMCP(!A.mcp?.running); return true; }
  if ((x = t("[data-hub]"))) { openHub(x.dataset.hub); return true; }
  if (t("[data-know-init]")) { knowInit(); return true; }
  if (t("[data-ollama-start]")) { api.AIStartServer().then(() => loadAI()).then(refreshAIViews).catch((e) => toast(esc(errText(e)), "err")); return true; }
  if (t("[data-ollama-install]")) { app.openAI(); return true; }
  return false;
}

function modelMenu(anchor, name) {
  const loaded = A.status?.loaded?.some((m) => m.name === name);
  menu(anchor, [
    { icon: I.sparkle, label: "Чат с этой моделью", onClick: () => chatWithModel(name) },
    { icon: I.term, label: "В терминале (ollama run)", onClick: () => app.openAI(name) },
    ...(loaded ? [{ icon: I.eject, label: "Выгрузить из памяти", onClick: async () => { await api.AIUnload(name); A.status = await api.AIStatus(); refreshAIViews(); } }] : []),
    { sep: true },
    { icon: I.trash, label: "Удалить с диска", onClick: () => deleteModel(name) },
  ], { align: "right" });
}

export async function deleteModel(name) {
  if (!(await confirmBox(`Удалить ${name}?`, "Модель будет удалена с диска. Скачать её можно снова в маркете."))) return;
  try { await api.AIDelete(name); A.status = await api.AIStatus(); refreshAIViews(); toast(`${I.trash} ${esc(name)} удалена`); }
  catch (e) { toast(esc(errText(e)), "err"); }
}

// Чат с моделью: агент «Просто чат» с этой моделью (создаётся при необходимости).
export async function chatWithModel(model) {
  let a = A.agents.find((x) => x.template === "chat" && x.model === model);
  if (!a) {
    a = await api.AgentSave({ name: "Чат · " + model, icon: "sparkle", color: "#9aa0a6", provider: "ollama", model, system: "Ты — полезный ассистент. Отвечай по-русски, кратко и по делу.", tools: [], approve: "danger", temperature: 0.5, template: "chat" });
    A.agents = await api.AgentList();
    refreshAIViews();
  }
  app.openChat(a.id);
}

async function toggleMCP(on) {
  try { A.mcp = await api.MCPSetEnabled(on); toast(on ? `${I.check} MCP включён — порт ${A.mcp.port}` : "MCP выключен"); }
  catch (e) { toast(esc(errText(e)), "err"); A.mcp = await api.MCPStatus(); }
  refreshAIViews();
  app.renderStatus?.();
}

async function knowInit() {
  try {
    const n = await api.KnowledgeInit();
    A.know = await api.KnowledgeStatus();
    toast(`${I.check} База знаний: добавлено файлов — ${n}. Политика — knowledge/security/rules.yaml`);
    refreshAIViews();
  } catch (e) { toast(esc(errText(e)), "err"); }
}

// ============================================================
//  Маркет
// ============================================================
// Маркет и настройки ИИ живут в левой панели (свои иконки на ленте), а не во вкладках.
const side = { market: null, aiset: null };
export function mountMarket(box) {
  side.market ??= marketTab(store.get("mk.sec", "models"));
  side.market.el.classList.add("shown", "in-side");
  box.append(side.market.el);
  side.market.onShow();
}
export function mountHub(box) {
  side.aiset ??= aiHubTab(store.get("hub.sec", "mcp"));
  side.aiset.el.classList.add("shown", "in-side");
  box.append(side.aiset.el);
  side.aiset.onShow();
}
export function openMarket(section = "models") {
  store.set("mk.sec", section);
  side.market?.show(section);
  app.showPanel("market");
}
export function openHub(section = "mcp") {
  store.set("hub.sec", section);
  side.aiset?.show(section);
  app.showPanel("aiset");
}
const FILTERS = [["all", "Все"], ["tools", "Для агентов"], ["code", "Код"], ["thinking", "Рассуждения"], ["vision", "Зрение"], ["embed", "Эмбеддинги"], ["small", "Лёгкие"], ["have", "Установленные"]];
const HF_SORT = [["trending", "в тренде"], ["downloads", "популярные"], ["likes", "по лайкам"], ["modified", "новые"]];
const fmtNum = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + " млн" : n >= 1e3 ? Math.round(n / 1e3) + " тыс" : String(n || 0));

export function marketTab(section = "models") {
  const tab = { type: "market", key: "market", title: "Маркет ИИ", icon: I.sparkle };
  const el = h(`<div class="tabview market"><div class="mk-head"></div><div class="mk-body"></div></div>`);
  tab.el = el;
  let sec = section, filter = store.get("mk.filter", "all"), q = "";
  const pick = {}; // выбранный размер по модели
  let src = store.get("mk.src", "ollama"); // ollama | hf
  const hf = { q: "", sort: "trending", list: null, loading: false, err: "", open: {}, files: {} };

  tab.onShow = () => loadAI().then(() => render());
  tab.refresh = (light) => (light ? renderBody() : render());
  tab.show = (s) => { sec = s; render(); };

  function head() {
    const st = A.status || {};
    const g = A.sys?.gpus?.[0];
    const pc = [g ? `${esc(g.name.replace(/NVIDIA GeForce |AMD Radeon /, ""))}${g.memTotal ? " · " + gb(GB(g.memTotal)) + " ГБ" : ""}` : "без видеокарты", A.sys?.ramTotal ? `ОЗУ ${gb(GB(A.sys.ramTotal))} ГБ` : ""].filter(Boolean).join(" · ");
    $(".mk-head", el).innerHTML = `
      <div class="mk-title"><h2>${I.sparkle}Маркет ИИ</h2>
        <div class="mk-pc dim small">${I.cpu}${pc}</div>
        <span class="mk-ollama ${st.running ? "ok" : "bad"}">${st.running ? `Ollama ${esc(st.version)}` : st.installed ? `Ollama не запущена <button class="link" data-ostart>запустить</button>` : `Ollama не установлена <button class="link" data-oinst>установить</button>`}</span></div>
      <div class="mk-bar">
        <div class="seg"><button data-sec="models" class="${sec === "models" ? "on" : ""}">Модели</button><button data-sec="agents" class="${sec === "agents" ? "on" : ""}">Агенты</button></div>
        ${sec === "models" ? `<div class="seg src"><button data-src="ollama" class="${src === "ollama" ? "on" : ""}" title="Проверенная подборка из ollama.com/library">Ollama</button><button data-src="hf" class="${src === "hf" ? "on" : ""}" title="Тысячи GGUF-моделей с huggingface.co">Hugging Face</button></div>` : ""}
        ${sec === "models" && src === "hf" ? `<div class="mk-search hf">${I.search}<input data-hfq placeholder="Поиск GGUF на Hugging Face (Enter)…" value="${esc(hf.q)}" spellcheck="false"></div>
          <div class="chips">${HF_SORT.map(([k, t]) => `<button class="fchip${hf.sort === k ? " on" : ""}" data-hfsort="${k}">${t}</button>`).join("")}</div>` : ""}
        ${sec === "models" && src === "ollama" ? `<div class="chips">${FILTERS.map(([k, t]) => `<button class="fchip${filter === k ? " on" : ""}" data-filter="${k}">${t}</button>`).join("")}</div>
        <div class="mk-search">${I.search}<input placeholder="Поиск…" value="${esc(q)}" spellcheck="false"></div>` : ""}
      </div>`;
    const inp = $(".mk-search input", el);
    if (inp) inp.oninput = () => { q = inp.value; renderBody(); };
  }

  function render() { head(); renderBody(); }

  function renderBody() {
    const body = $(".mk-body", el);
    const keep = body.scrollTop;
    body.innerHTML = sec !== "models" ? agentsHtml() : src === "hf" ? hfHtml() : modelsHtml();
    body.scrollTop = keep;
  }

  function modelsHtml() {
    const list = (A.catalog?.models || []).filter((m) => {
      if (q && !(m.title + m.id + m.desc + m.publisher).toLowerCase().includes(q.toLowerCase())) return false;
      if (filter === "small") return m.variants.some((v) => v.size <= 3);
      if (filter === "have") return m.variants.some((v) => installed(`${m.id}:${v.tag}`));
      if (filter !== "all") return m.caps.includes(filter);
      return true;
    });
    const cards = list.map((m) => {
      const have = m.variants.filter((v) => installed(`${m.id}:${v.tag}`)).map((v) => v.tag);
      const tag = pick[m.id] || have[0] || m.pick;
      const v = m.variants.find((x) => x.tag === tag) || m.variants[0];
      const name = `${m.id}:${v.tag}`;
      const f = fit(v.size);
      const isHave = installed(name);
      return `<div class="mk-card${isHave ? " have" : ""}">
        <div class="mk-c-h"><b>${esc(m.title)}</b><span class="dim small">${esc(m.publisher)}</span>${isHave ? `<span class="mk-have">${I.check}установлена</span>` : ""}</div>
        <div class="mk-caps">${m.caps.map(capBadge).join("")}</div>
        <p class="mk-desc">${esc(m.desc)}</p>
        <div class="mk-sizes">${m.variants.map((x) => `<button class="sz${x.tag === v.tag ? " on" : ""}${installed(`${m.id}:${x.tag}`) ? " have" : ""}" data-size="${esc(m.id)}|${esc(x.tag)}" title="${esc(fit(x.size).t)}"><span class="fitdot ${fit(x.size).k}"></span>${esc(x.tag)}<span class="dim">${gb(x.size)} ГБ</span></button>`).join("")}</div>
        <div class="mk-fit ${f.k}">${f.k === "gpu" ? I.check : f.k === "no" ? I.x : I.info}<span>${esc(f.t)}</span></div>
        <div class="mk-c-f">
          ${A.pulls[name] ? pullBar(name) : isHave
            ? `<button class="btn small" data-chatmodel="${esc(name)}">${I.sparkle}Чат</button><button class="btn small" data-newagent="${esc(name)}">${I.plus}Агент</button><span class="grow"></span><button class="icon-btn" title="Удалить" data-del="${esc(name)}">${I.trash}</button>`
            : `<button class="btn small primary" data-pull="${esc(name)}"${A.status?.running || A.status?.installed ? "" : " disabled"}>${I.download}Установить · ${gb(v.size)} ГБ</button><a class="link" data-lib="${esc(m.id)}">ollama.com</a>`}
        </div></div>`;
    }).join("");
    const extra = Object.keys(A.pulls).filter((n) => !(A.catalog?.models || []).some((m) => n.startsWith(m.id + ":")));
    return `<div class="mk-grid">${cards || `<div class="dim">Ничего не найдено</div>`}</div>
      <div class="mk-custom">
        <div><b>Другая модель</b><div class="dim small">Любая из библиотеки ollama.com/library или Hugging Face (hf.co/автор/модель:Q4_K_M)</div></div>
        <input placeholder="например phi4:14b" spellcheck="false" data-custom><button class="btn" data-pullcustom>${I.download}Скачать</button>
      </div>
      ${extra.map((n) => `<div class="mk-extra"><b class="mono">${esc(n)}</b>${pullBar(n)}</div>`).join("")}`;
  }

  // ---------- Hugging Face ----------
  async function hfSearch() {
    hf.loading = true; hf.err = ""; renderBody();
    try { hf.list = await api.HFSearch(hf.q, hf.sort); } catch (e) { hf.err = errText(e); hf.list = []; }
    hf.loading = false; renderBody();
  }
  async function hfLoadFiles(id) {
    hf.files[id] = "loading"; renderBody();
    try { hf.files[id] = await api.HFFiles(id); } catch (e) { hf.files[id] = { err: errText(e) }; }
    renderBody();
  }
  function hfHtml() {
    if (!hf.list && !hf.loading) { setTimeout(hfSearch); return `<div class="dim">Загрузка…</div>`; }
    const intro = `<div class="hf-intro dim small">${I.info}<span>GGUF-модели с Hugging Face скачиваются через Ollama как <span class="mono">hf.co/автор/модель:квант</span>. Выбирай <b>Q4_K_M</b> — лучший баланс размера и качества. Инструменты (для агентов) поддерживают не все модели — ищи в названии instruct / tools.</span></div>`;
    if (hf.loading) return intro + `<div class="dim row-load"><span class="spin"></span>Ищу на Hugging Face…</div>`;
    if (hf.err) return intro + `<div class="notice err">${I.warn}<span>${esc(hf.err)}</span></div>`;
    if (!hf.list.length) return intro + `<div class="dim">Ничего не найдено</div>`;
    return intro + `<div class="hf-list">${hf.list.map((m) => {
      const [author, name] = m.id.split("/");
      const fl = hf.files[m.id];
      return `<div class="hf-item${hf.open[m.id] ? " open" : ""}">
        <div class="hf-h" data-hfopen="${esc(m.id)}">
          <div class="hf-n"><b>${esc(name)}</b><span class="dim small">${esc(author)}</span></div>
          <span class="hf-stat" title="Скачиваний">${I.download}${fmtNum(m.downloads)}</span><span class="hf-stat" title="Лайков">♥ ${fmtNum(m.likes)}</span>
          ${I.chev}
        </div>
        ${m.tags?.length || m.pipeline ? `<div class="mk-caps">${m.pipeline ? `<span class="cap">${esc(m.pipeline)}</span>` : ""}${(m.tags || []).filter((t) => t !== m.pipeline).slice(0, 4).map((t) => `<span class="cap">${esc(t)}</span>`).join("")}</div>` : ""}
        ${hf.open[m.id] ? `<div class="hf-files">${fl === "loading" || !fl ? `<div class="dim small row-load"><span class="spin"></span>Смотрю варианты…</div>`
          : fl.err ? `<div class="warn-t small">${esc(fl.err)}</div>`
          : !fl.length ? `<div class="dim small">В репозитории нет GGUF-файлов</div>`
          : fl.map((f) => {
            const full = `hf.co/${m.id}:${f.quant}`;
            const sz = f.size / 1073741824;
            const ft = fit(sz);
            return `<div class="hf-f"><span class="fitdot ${ft.k}" title="${esc(ft.t)}"></span><b class="mono">${esc(f.quant)}</b><span class="dim small">${gb(sz)} ГБ</span>
              <span class="grow"></span>${f.split ? `<span class="dim small" title="Файл разбит на части — Ollama такие не скачивает">частями</span>`
                : installed(full) ? `<span class="mk-have">${I.check}есть</span><button class="btn small" data-newagent="${esc(full)}">${I.plus}Агент</button>`
                : A.pulls[full] ? pullBar(full) : `<button class="btn small${f.quant === "Q4_K_M" ? " primary" : ""}" data-pull="${esc(full)}">${I.download}Установить</button>`}</div>`;
          }).join("")}
          <div class="row-btns"><a class="link" data-hflink="${esc(m.id)}">открыть на huggingface.co</a></div></div>` : ""}
      </div>`;
    }).join("")}</div>`;
  }

  function agentsHtml() {
    const tpl = A.catalog?.agents || [];
    const mine = A.agents;
    return `<div class="mk-sec-h">Мои агенты <button class="btn small" data-agnew>${I.plus}Создать своего</button></div>
      <div class="mk-grid ag">${mine.map((a) => `
        <div class="mk-card ag">
          <div class="mk-c-h">${agentIcon(a)}<div><b>${esc(a.name)}</b><div class="dim small mono">${esc(a.model || "модель не выбрана")}${a.model && a.provider !== "openai" && !installed(a.model) ? ` · <span class="warn-t">не скачана</span>` : ""}</div></div></div>
          <p class="mk-desc">${esc(a.desc || "")}</p>
          <div class="mk-tools">${(a.tools || []).length ? a.tools.map((t) => `<span class="tool-chip">${esc(toolTitle(t))}</span>`).join("") : `<span class="dim small">без инструментов — только чат</span>`}</div>
          <div class="mk-c-f"><button class="btn small primary" data-agchat="${esc(a.id)}">${I.sparkle}Открыть чат</button><button class="btn small" data-agedit="${esc(a.id)}">${I.gear}Настроить</button>
            ${a.model && a.provider !== "openai" && !installed(a.model) ? (A.pulls[a.model] ? pullBar(a.model) : `<button class="btn small" data-pull="${esc(a.model)}">${I.download}Скачать модель</button>`) : ""}</div>
        </div>`).join("") || `<div class="dim">Агентов пока нет — добавь из каталога ниже.</div>`}</div>
      <div class="mk-sec-h">Каталог агентов</div>
      <div class="mk-grid ag">${tpl.map((t) => `
        <div class="mk-card ag">
          <div class="mk-c-h">${agentIcon(t)}<div><b>${esc(t.name)}</b><div class="dim small mono">${esc(t.model)}${installed(t.model) ? ` · ${I.check}` : ""}</div></div></div>
          <p class="mk-desc">${esc(t.long || t.desc)}</p>
          <div class="mk-tools">${t.tools.length ? t.tools.map((x) => `<span class="tool-chip${A.catalog.tools.find((y) => y.name === x)?.danger ? " danger" : ""}">${esc(toolTitle(x))}</span>`).join("") : `<span class="dim small">без инструментов</span>`}</div>
          <div class="mk-c-f"><button class="btn small primary" data-addtpl="${esc(t.template)}">${I.plus}Добавить</button></div>
        </div>`).join("")}</div>`;
  }

  el.addEventListener("click", async (e) => {
    const t = (s) => e.target.closest(s);
    let x;
    if ((x = t("[data-sec]"))) { sec = x.dataset.sec; store.set("mk.sec", sec); return render(); }
    if ((x = t("[data-src]"))) { src = x.dataset.src; store.set("mk.src", src); return render(); }
    if ((x = t("[data-hfsort]"))) { hf.sort = x.dataset.hfsort; head(); return hfSearch(); }
    if ((x = t("[data-hflink]"))) return win.openURL("https://huggingface.co/" + x.dataset.hflink);
    if ((x = t("[data-hfopen]"))) { const id = x.dataset.hfopen; hf.open[id] = !hf.open[id]; if (hf.open[id] && !hf.files[id]) return hfLoadFiles(id); return renderBody(); }
    if ((x = t("[data-filter]"))) { filter = x.dataset.filter; store.set("mk.filter", filter); return render(); }
    if ((x = t("[data-size]"))) { const [id, tag] = x.dataset.size.split("|"); pick[id] = tag; return renderBody(); }
    if ((x = t("[data-pull]"))) return pull(x.dataset.pull);
    if ((x = t("[data-pullcancel]"))) return api.AIPullCancel(x.dataset.pullcancel);
    if ((x = t("[data-pullcustom]"))) { const v = $("[data-custom]", el).value.trim(); if (v) pull(v); return; }
    if ((x = t("[data-del]"))) return deleteModel(x.dataset.del);
    if ((x = t("[data-chatmodel]"))) return chatWithModel(x.dataset.chatmodel);
    if ((x = t("[data-newagent]"))) return agentForm({ model: x.dataset.newagent });
    if ((x = t("[data-lib]"))) return win.openURL("https://ollama.com/library/" + x.dataset.lib);
    if ((x = t("[data-agchat]"))) return app.openChat(x.dataset.agchat);
    if ((x = t("[data-agedit]"))) return agentForm(A.agents.find((a) => a.id === x.dataset.agedit));
    if (t("[data-agnew]")) return agentForm();
    if ((x = t("[data-addtpl]"))) return addTemplate(x.dataset.addtpl);
    if (t("[data-ostart]")) { try { await api.AIStartServer(); await loadAI(); render(); } catch (err) { toast(esc(errText(err)), "err"); } return; }
    if (t("[data-oinst]")) return app.openAI();
  });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.matches("[data-custom]")) $("[data-pullcustom]", el).click();
    if (e.key === "Enter" && e.target.matches("[data-hfq]")) { hf.q = e.target.value; hfSearch(); }
  });
  return tab;
}

async function addTemplate(id) {
  const t = A.catalog.agents.find((x) => x.template === id);
  // своя модель вместо рекомендованной, если рекомендованной нет, а подходящая с инструментами есть
  let model = t.model;
  if (!installed(model) && t.tools.length) {
    const toolModels = (A.catalog.models || []).filter((m) => m.caps.includes("tools")).flatMap((m) => m.variants.map((v) => `${m.id}:${v.tag}`));
    const have = (A.status?.models || []).map((m) => m.name).find((n) => toolModels.includes(n));
    if (have) model = have;
  }
  try {
    const a = await api.AgentFromTemplate(id, model === t.model ? "" : model);
    A.agents = await api.AgentList();
    refreshAIViews();
    if (!installed(a.model) && (A.status?.running || A.status?.installed)) {
      toast(`${I.download} Агент «${esc(a.name)}» добавлен, скачиваю модель ${esc(a.model)}…`);
      pull(a.model);
    } else toast(`${I.check} Агент «${esc(a.name)}» добавлен`);
    app.openChat(a.id);
  } catch (e) { toast(esc(errText(e)), "err"); }
}

// ============================================================
//  Форма агента
// ============================================================
const GROUPS = { servers: "Серверы", files: "Файлы на серверах", scripts: "Скрипты и хранилище", vpn: "VPN", labs: "Лабы", git: "Git", local: "Этот ПК", knowledge: "База знаний" };

export async function agentForm(src = {}) {
  if (!A.catalog) await loadAI();
  const isNew = !src.id;
  const a = { name: "", icon: "sparkle", color: COLORS[0], desc: "", provider: "ollama", model: "", system: "Ты — полезный ассистент для администрирования серверов. Отвечай по-русски.", tools: ["list_servers", "read_file", "list_dir", "search_knowledge"], approve: "danger", servers: [], temperature: 0.3, ...src };
  const models = (A.status?.models || []).map((m) => m.name);
  if (a.model && a.provider === "ollama" && !models.includes(a.model)) models.unshift(a.model);
  const tools = A.catalog.tools;
  const byGroup = {};
  tools.forEach((t) => (byGroup[t.group] ??= []).push(t));
  const body = h(`<div class="form ag-form">
    <div class="ag-top">
      <button type="button" class="ag-pick" data-iconpick>${agentIcon(a, "lg")}</button>
      <div class="form" style="flex:1;gap:8px">
        <input name="name" value="${esc(a.name)}" placeholder="Имя агента">
        <input name="desc" value="${esc(a.desc)}" placeholder="Коротко: что делает">
      </div>
    </div>
    <div class="form grid2">
      <label class="field"><span>Где модель</span><div class="seg wide" data-prov><button type="button" data-p="ollama" class="${a.provider !== "openai" ? "on" : ""}">Ollama</button><button type="button" data-p="openai" class="${a.provider === "openai" ? "on" : ""}">OpenAI-совместимый</button></div></label>
      <label class="field"><span>Модель</span><div class="model-pick"></div></label>
    </div>
    <label class="field"><span>Инструкция (системный промпт)</span><textarea name="system" rows="5" spellcheck="false">${esc(a.system)}</textarea></label>
    <div class="field"><span>Что агенту можно <span class="dim small">· ${I.warn.replace("<svg", '<svg class="inl"')} — меняет что-то, нужно подтверждение</span>
      <span class="ag-quick"><button type="button" class="link" data-tq="read">только чтение</button><button type="button" class="link" data-tq="all">всё</button><button type="button" class="link" data-tq="none">ничего</button></span></span>
      <div class="ag-tools">${Object.entries(byGroup).map(([g, list]) => `<div class="ag-tg"><div class="dim small">${GROUPS[g] || g}</div>${list.map((t) => `
        <label class="check" title="${esc(t.desc)}"><input type="checkbox" name="tool" value="${t.name}" ${a.tools.includes(t.name) ? "checked" : ""}>${esc(t.title)}${t.danger ? `<span class="danger-mark">${I.warn}</span>` : ""}</label>`).join("")}</div>`).join("")}</div></div>
    <div class="field"><span>Подтверждение действий</span>
      <div class="seg wide" data-approve>
        <button type="button" data-v="all" class="${a.approve === "all" ? "on" : ""}">Каждый шаг</button>
        <button type="button" data-v="danger" class="${a.approve === "danger" || !a.approve ? "on" : ""}">Только изменения</button>
        <button type="button" data-v="never" class="${a.approve === "never" ? "on" : ""}">Автопилот</button>
      </div>
      <div class="dim small appr-hint"></div></div>
    <div class="field"><span>Серверы</span>
      <div class="srv-scope"><label class="check"><input type="radio" name="scope" value="all" ${a.servers?.length ? "" : "checked"}>Все</label><label class="check"><input type="radio" name="scope" value="some" ${a.servers?.length ? "checked" : ""}>Только выбранные</label></div>
      <div class="srv-pick" ${a.servers?.length ? "" : "hidden"}>${S.snap.servers.map((s) => `<label class="check"><input type="checkbox" name="srv" value="${esc(s.id)}" ${a.servers?.includes(s.id) ? "checked" : ""}>${esc(s.id)}</label>`).join("") || `<span class="dim small">Серверов нет</span>`}</div></div>
    <label class="field inline"><span>Температура</span><input type="range" name="temp" min="0" max="1" step="0.1" value="${a.temperature ?? 0.3}" style="width:160px"><span class="dim small" data-tv>${a.temperature ?? 0.3}</span><span class="dim small">· ниже — точнее, выше — творческее</span></label>
  </div>`);
  let prov = a.provider === "openai" ? "openai" : "ollama", approve = a.approve || "danger";
  const modelBox = $(".model-pick", body);
  const renderModel = async () => {
    if (prov === "ollama") {
      modelBox.innerHTML = `<select name="model">${models.length ? "" : `<option value="">— нет скачанных моделей —</option>`}${models.map((m) => `<option ${m === a.model ? "selected" : ""}>${esc(m)}</option>`).join("")}</select><button type="button" class="link" data-tomarket>маркет</button>`;
    } else {
      modelBox.innerHTML = `<input name="model" list="oaimodels" value="${esc(a.model)}" placeholder="имя модели на сервере"><datalist id="oaimodels"></datalist>`;
      api.AIProviderModels().then((l) => { $("#oaimodels", body).innerHTML = l.map((m) => `<option value="${esc(m)}">`).join(""); }).catch(() => {});
    }
  };
  renderModel();
  const hint = () => ($(".appr-hint", body).innerHTML = {
    all: "Infra спросит перед каждым вызовом инструмента, даже читающим.",
    danger: "Чтение — сразу, команды и запись — после твоего «Разрешить». Рекомендуется.",
    never: `<span class="warn-t">${I.warn} Агент выполняет команды сам. Запрещённое политикой всё равно блокируется, а особо опасное (перезагрузка, удаление, фаервол) — спрашивается.</span>`,
  }[approve]);
  hint();
  body.addEventListener("click", (e) => {
    const t = (s) => e.target.closest(s);
    let x;
    if ((x = t("[data-p]"))) { prov = x.dataset.p; $$("[data-p]", body).forEach((b) => b.classList.toggle("on", b === x)); renderModel(); }
    if ((x = t("[data-v]"))) { approve = x.dataset.v; $$("[data-v]", body).forEach((b) => b.classList.toggle("on", b === x)); hint(); }
    if ((x = t("[data-tq]"))) $$("[name=tool]", body).forEach((c) => (c.checked = x.dataset.tq === "all" || (x.dataset.tq === "read" && !tools.find((t) => t.name === c.value).danger)));
    if (t("[data-tomarket]")) { dlg.close(); openMarket("models"); }
    if (t("[data-iconpick]")) iconPicker(t("[data-iconpick]"));
  });
  $$("[name=scope]", body).forEach((r) => (r.onchange = () => ($(".srv-pick", body).hidden = $("[name=scope]:checked", body).value === "all")));
  $("[name=temp]", body).oninput = (e) => ($("[data-tv]", body).textContent = e.target.value);
  function iconPicker(anchor) {
    const pop = h(`<div class="icon-pick"><div>${Object.keys(AGENT_ICONS).map((k) => `<button data-ic="${k}" class="${k === a.icon ? "on" : ""}">${AGENT_ICONS[k]}</button>`).join("")}</div><div>${COLORS.map((c) => `<button data-col="${c}" class="col${c === a.color ? " on" : ""}" style="background:${c}"></button>`).join("")}</div></div>`);
    pop.onclick = (e) => {
      const ic = e.target.closest("[data-ic]"), col = e.target.closest("[data-col]");
      if (ic) a.icon = ic.dataset.ic;
      if (col) a.color = col.dataset.col;
      $("[data-iconpick]", body).innerHTML = agentIcon(a, "lg");
      $$("[data-ic]", pop).forEach((b) => b.classList.toggle("on", b.dataset.ic === a.icon));
      $$("[data-col]", pop).forEach((b) => b.classList.toggle("on", b.dataset.col === a.color));
    };
    import("../ui.js").then(({ popover }) => { const p = popover(anchor, pop, { align: "left", width: 230 }); p.style.zIndex = 200; });
  }
  const dlg = modal({
    title: isNew ? "Новый агент" : `Агент: ${a.name}`, body, width: 640,
    buttons: [
      ...(isNew ? [{ label: "Отмена" }] : [{ label: `${I.trash}Удалить`, onClick: async () => {
        if (!(await confirmBox(`Удалить агента «${a.name}»?`, "История чатов останется."))) return false;
        await api.AgentDelete(a.id); A.agents = await api.AgentList(); refreshAIViews();
      } }]),
      { label: isNew ? "Создать" : "Сохранить", primary: true, onClick: async () => {
        const v = (n) => $(`[name=${n}]`, body)?.value ?? "";
        const out = { ...a, name: v("name").trim(), desc: v("desc").trim(), provider: prov, model: v("model").trim(), system: v("system"), approve,
          tools: $$("[name=tool]:checked", body).map((c) => c.value),
          servers: $("[name=scope]:checked", body).value === "all" ? [] : $$("[name=srv]:checked", body).map((c) => c.value),
          temperature: +v("temp") };
        if (!out.name) { toast("Укажи имя агента", "err"); return false; }
        try {
          const saved = await api.AgentSave(out);
          A.agents = await api.AgentList();
          refreshAIViews();
          toast(`${I.check} Агент «${esc(saved.name)}» сохранён`);
          if (isNew) app.openChat(saved.id);
        } catch (e) { toast(esc(errText(e)), "err"); return false; }
      } },
    ],
  });
  return dlg;
}

// ============================================================
//  Вкладка «Безопасность и MCP»
// ============================================================
export function aiHubTab(section = "mcp") {
  const tab = { type: "aihub", key: "aihub", title: "ИИ: безопасность и MCP", icon: I.shield };
  const el = h(`<div class="tabview aihub"><div class="hub"></div></div>`);
  tab.el = el;
  let sec = section, searchQ = "", hits = null, checkQ = "", verdict = null, prov = null, showTok = false;
  tab.onShow = async () => { await loadAI(true); prov = await api.AIProvider().catch(() => null); render(); };
  tab.refresh = () => render();
  tab.show = (s) => { sec = s; render(); };

  function render() {
    const hub = $(".hub", el);
    hub.innerHTML = `
      <div class="hub-nav">
        <button data-s="mcp" class="${sec === "mcp" ? "on" : ""}">${I.globe}MCP для других ИИ</button>
        <button data-s="knowledge" class="${sec === "knowledge" ? "on" : ""}">${I.shield}База знаний и безопасность</button>
        <button data-s="provider" class="${sec === "provider" ? "on" : ""}">${I.cpu}Модели и провайдеры</button>
      </div>
      <div class="hub-main">${sec === "mcp" ? mcpHtml() : sec === "knowledge" ? knowHtml() : provHtml()}</div>`;
  }

  function mcpHtml() {
    const m = A.mcp || {};
    return `<h2>MCP — Infra как инструмент для других ИИ</h2>
      <p class="muted">Claude Desktop, Claude Code, Cursor и другие клиенты MCP смогут видеть твои серверы, выполнять команды, читать файлы и искать в базе знаний.
      Всё, что меняет систему, проходит ту же проверку политикой и подтверждается здесь, в Infra.</p>
      <div class="hub-card row">
        <span class="dot ${m.running ? "ok" : ""}"></span><div style="flex:1"><b>${m.running ? "MCP-сервер работает" : "MCP-сервер выключен"}</b>
        <div class="dim small mono">${m.running ? esc(m.url) : "включи, чтобы подключить другие ИИ"}</div></div>
        <button class="switch${m.running ? " on" : ""}" data-mcp></button></div>
      <div class="hub-card row"><div style="flex:1"><b>Только чтение</b><div class="dim small">Внешние ИИ видят серверы и читают файлы, но ничего не меняют — опасные инструменты им даже не показываются.</div></div>
        <button class="switch${m.readOnly ? " on" : ""}" data-ro></button></div>
      ${m.running ? `
      <div class="sec-h">Подключение</div>
      ${(m.configs || []).map((c, i) => `<div class="hub-card"><div class="row"><b>${esc(c.client)}</b><span class="dim small" style="flex:1">${esc(c.where)}</span><button class="btn small" data-copy="${i}">${I.copy}Копировать</button></div>
        <pre class="code">${esc(c.text)}</pre></div>`).join("")}
      <div class="hub-card row"><div style="flex:1"><b>Токен для HTTP</b><div class="dim small mono">${showTok ? esc(m.token) : "•".repeat(24)}</div></div>
        <button class="btn small" data-tokshow>${I.eye}${showTok ? "Скрыть" : "Показать"}</button><button class="btn small" data-tokre>${I.refresh}Сменить</button></div>
      <div class="dim small">Через stdio (команда <span class="mono">Infra.exe mcp</span>) токен не нужен — мост сам найдёт запущенную Infra, а если она закрыта, откроет её.</div>` : ""}
      <div class="sec-h">Журнал <button class="link" data-resetallow>забыть «разрешать всегда»</button></div>
      <div class="hub-log">${(m.log || []).slice().reverse().map((e) => `<div><span class="dim mono small">${new Date(e.time * 1000).toLocaleTimeString("ru-RU")}</span> <b>${esc(e.client)}</b> ${esc(e.what === "подключение" ? "подключился" : toolTitle(e.what))} <span class="res ${e.result === "ок" ? "ok" : "bad"}">${esc(e.result)}</span></div>`).join("") || `<span class="dim">Пока пусто</span>`}</div>`;
  }

  function knowHtml() {
    const k = A.know;
    if (!k) return `<h2>База знаний</h2><p class="muted">Открой хранилище.</p>`;
    const embedHave = installed(k.embedModel);
    return `<h2>База знаний и безопасность</h2>
      <p class="muted">Агенты ищут здесь правила и ранбуки перед действиями, а найденные правила показываются в карточке подтверждения.
      Файлы — обычный Markdown в папке <span class="mono">knowledge/</span> хранилища.</p>
      ${!k.exists ? `<div class="hub-card row">${I.info}<div style="flex:1">Базы знаний ещё нет. Создать с примерами: политика безопасности, чек-лист аудита, ранбуки, правила для ИИ.</div><button class="btn primary" data-kinit>${I.plus}Создать</button></div>` : `
      <div class="hub-stats">
        <div><b>${k.files}</b><span>файлов</span></div><div><b>${k.chunks}</b><span>фрагментов</span></div>
        <div><b>${k.vectors ? "по смыслу" : "по словам"}</b><span>поиск</span></div>
        <div><b>${k.built ? new Date(k.built * 1000).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "—"}</b><span>индекс</span></div>
      </div>
      <div class="hub-card row">${k.embedReady ? I.check : I.info}<div style="flex:1"><b>Поиск по смыслу</b><div class="dim small">${k.embedReady ? `модель ${esc(k.embedModel)} — находит «отключить фаервол» по фразе «закрыть доступ снаружи»` : `скачай модель эмбеддингов ${esc(k.embedModel)} (270 МБ) — без неё ищется только по словам`}</div>
        ${k.error ? `<div class="warn-t small">${esc(k.error)}</div>` : ""}</div>
        ${k.embedReady ? `<button class="btn small" data-reindex>${I.refresh}Переиндексировать</button>` : A.pulls[k.embedModel] ? pullBar(k.embedModel) : `<button class="btn small primary" data-pull="${esc(k.embedModel)}"${embedHave ? " disabled" : ""}>${I.download}Скачать</button>`}</div>
      <div class="hub-card"><div class="row"><b>Проверить поиск</b></div>
        <div class="row"><input data-kq placeholder="например: можно ли перезапустить базу на prod?" value="${esc(searchQ)}"><button class="btn" data-ksearch>${I.search}Найти</button></div>
        ${hits ? hits.map((x) => `<div class="hit"><div class="row"><b>${esc(x.heading || x.file)}</b><span class="dim small mono" style="flex:1">${esc(x.file)}</span><span class="dim small">${x.vector ? "смысл " + x.vector.toFixed(2) + " · " : ""}слова ${x.words.toFixed(1)}</span><button class="icon-btn" data-openk="${esc(x.file)}" title="Открыть">${I.ext}</button></div><div class="hit-t">${esc(x.text)}</div></div>`).join("") || `<div class="dim">Ничего не найдено</div>` : ""}
      </div>`}
      <div class="sec-h">Защита при работе ИИ</div>
      <div class="hub-card"><ul class="guard-list">
        <li>${I.x}<span><b>Запрещено всегда:</b> rm -rf /, mkfs, dd на диск, fork-бомба, форматирование дисков Windows${k.hasRules ? " и правила deny из rules.yaml" : ""}.</span></li>
        <li>${I.warn}<span><b>Особая осторожность:</b> перезагрузка, сброс фаервола, остановка SSH, удаление пользователей и данных, curl | sh, системные файлы — всегда спрашивается, даже в автопилоте.</span></li>
        <li>${I.key}<span><b>Секреты скрываются:</b> пароли, токены GitHub/GitLab/AWS, приватные ключи, пароли в URL заменяются на [скрыто] до отправки модели.</span></li>
        <li>${I.shield}<span><b>Защита от инъекций:</b> вывод команд и файлов передаётся модели как данные; текст вида «игнорируй инструкции» помечается.</span></li>
        <li>${I.server}<span><b>Только чтение:</b> серверы из readonly_servers нельзя менять ни агентам, ни MCP.</span></li>
      </ul>
      <div class="row"><button class="btn small" data-openrules>${I.file}${k.hasRules ? "Открыть rules.yaml" : "Создать rules.yaml"}</button>${k.guardErrors?.length ? `<span class="warn-t small">${esc(k.guardErrors.join("; "))}</span>` : ""}</div></div>
      <div class="hub-card"><div class="row"><b>Проверить команду</b><span class="dim small">как её оценит политика</span></div>
        <div class="row"><input data-gq class="mono" placeholder="sudo systemctl restart postgresql" value="${esc(checkQ)}"><button class="btn" data-gcheck>${I.shield}Проверить</button></div>
        ${verdict ? `<div class="verdict ${verdict.level}">${{ allow: `${I.check}Обычная команда — подтверждение по настройке агента`, confirm: `${I.info}Нужно подтверждение`, strict: `${I.warn}Особо опасно — всегда спросит с предупреждением`, deny: `${I.x}Заблокировано` }[verdict.level]}${verdict.reasons?.length ? `<div class="small">${verdict.reasons.map(esc).join(" · ")}</div>` : ""}</div>` : ""}
      </div>`;
  }

  function provHtml() {
    const st = A.status || {};
    return `<h2>Модели и провайдеры</h2>
      <div class="hub-card row"><span class="dot ${st.running ? "ok" : ""}"></span><div style="flex:1"><b>Ollama</b><div class="dim small mono">${esc(st.host || "")}${st.version ? " · " + esc(st.version) : ""}</div></div>
        ${st.running ? `<button class="btn small" data-market>${I.download}Маркет моделей</button>` : st.installed ? `<button class="btn small" data-ostart>Запустить</button>` : `<button class="btn small primary" data-oinst>Установить</button>`}</div>
      <div class="hub-card"><div class="row"><b>OpenAI-совместимый сервер</b><span class="dim small">LM Studio, llama.cpp server, vLLM, Jan, OpenRouter…</span></div>
        <div class="form grid2" style="margin-top:8px">
          <label class="field"><span>Адрес</span><input data-ep value="${esc(prov?.endpoint || "")}" placeholder="http://localhost:1234/v1"></label>
          <label class="field"><span>Ключ API ${prov?.hasKey ? `<span class="dim small">· сохранён</span>` : `<span class="dim small">· если нужен</span>`}</span><input data-key type="password" placeholder="${prov?.hasKey ? "••••••• (оставь пустым, чтобы не менять)" : "sk-…"}"></label>
        </div>
        <div class="row" style="margin-top:8px"><button class="btn primary small" data-saveprov>Сохранить</button><button class="btn small" data-testprov>Проверить</button>${prov?.hasKey ? `<button class="link danger" data-delkey>удалить ключ</button>` : ""}<span class="dim small" data-provres></span></div>
        <div class="dim small" style="margin-top:6px">Ключ хранится в диспетчере учётных данных Windows. В агенте выбери «OpenAI-совместимый» и имя модели.</div></div>`;
  }

  el.addEventListener("click", async (e) => {
    const t = (s) => e.target.closest(s);
    let x;
    try {
      if ((x = t("[data-s]"))) { sec = x.dataset.s; store.set("hub.sec", sec); return render(); }
      if (t("[data-mcp]")) { A.mcp = await api.MCPSetEnabled(!A.mcp?.running).catch((err) => { toast(esc(errText(err)), "err"); return api.MCPStatus(); }); refreshAIViews(); app.renderStatus?.(); return; }
      if (t("[data-ro]")) { A.mcp = await api.MCPSetReadOnly(!A.mcp?.readOnly); return refreshAIViews(); }
      if ((x = t("[data-copy]"))) { await navigator.clipboard.writeText(A.mcp.configs[+x.dataset.copy].text); return toast(`${I.copy} Скопировано`); }
      if (t("[data-tokshow]")) { showTok = !showTok; return render(); }
      if (t("[data-tokre]")) { if (await confirmBox("Сменить токен?", "Клиенты, подключённые по HTTP с токеном, перестанут работать до обновления конфига. stdio-мост подхватит новый токен сам.", "Сменить")) { A.mcp = await api.MCPNewToken(); render(); } return; }
      if (t("[data-resetallow]")) { await api.MCPResetAllow(); return toast("Внешние ИИ снова будут спрашивать разрешение на каждое действие"); }
      if (t("[data-kinit]")) return knowInit();
      if (t("[data-reindex]")) { toast("Переиндексирую…"); await api.KnowledgeReindex(); A.know = await api.KnowledgeStatus(); render(); return toast(`${I.check} Индекс обновлён`); }
      if ((x = t("[data-pull]"))) return pull(x.dataset.pull);
      if ((x = t("[data-pullcancel]"))) return api.AIPullCancel(x.dataset.pullcancel);
      if (t("[data-ksearch]")) { searchQ = $("[data-kq]", el).value; hits = await api.KnowledgeSearch(searchQ); return render(); }
      if ((x = t("[data-openk]"))) return app.openFile("knowledge/" + x.dataset.openk);
      if (t("[data-openrules]")) { if (!A.know?.hasRules) { await api.KnowledgeInit(); A.know = await api.KnowledgeStatus(); } return app.openFile(A.know.rulesFile); }
      if (t("[data-gcheck]")) { checkQ = $("[data-gq]", el).value; verdict = checkQ.trim() ? await api.GuardCheck(checkQ, "") : null; return render(); }
      if (t("[data-market]")) return openMarket("models");
      if (t("[data-ostart]")) { await api.AIStartServer(); await loadAI(); return render(); }
      if (t("[data-oinst]")) return app.openAI();
      if (t("[data-saveprov]") || t("[data-delkey]")) {
        await api.AISetProvider($("[data-ep]", el).value, t("[data-delkey]") ? "-" : $("[data-key]", el).value);
        prov = await api.AIProvider(); render(); return toast(`${I.check} Сохранено`);
      }
      if (t("[data-testprov]")) {
        await api.AISetProvider($("[data-ep]", el).value, $("[data-key]", el).value);
        const res = $("[data-provres]", el);
        res.textContent = "проверяю…";
        try { const l = await api.AIProviderModels(); res.innerHTML = `${I.check} моделей: ${l.length}${l.length ? " — " + esc(l.slice(0, 4).join(", ")) : ""}`; }
        catch (err) { res.innerHTML = `<span class="warn-t">${esc(errText(err))}</span>`; }
      }
    } catch (err) { toast(esc(errText(err)), "err"); }
  });
  el.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    if (e.target.matches("[data-kq]")) $("[data-ksearch]", el).click();
    if (e.target.matches("[data-gq]")) $("[data-gcheck]", el).click();
  });
  return tab;
}

export { fmtDate };
