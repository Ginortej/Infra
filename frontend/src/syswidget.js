// Виджет в заголовке: CPU, RAM, GPU (+ видеопамять). Клик — подробности и модели ИИ в памяти.
import { api, errText } from "./api.js";
import { app } from "./core.js";
import { $, h, esc, I, popover, closeMenu, toast, store } from "./ui.js";

const HIST = 60; // точек истории (≈2 минуты при опросе раз в 2 с)
const hist = { cpu: [], ram: [], gpu: [], vram: [] };
let last = null, timer = null, open = null;

const GB = (b) => (b / 1073741824).toFixed(b >= 100 * 1073741824 ? 0 : 1);
const pct = (a, b) => (b ? (a / b) * 100 : 0);
const level = (p) => (p >= 85 ? "hi" : p >= 60 ? "mid" : "lo");
const push = (arr, v) => { arr.push(v); if (arr.length > HIST) arr.shift(); };

export function startSysWidget() {
  const el = $("#sysWidget");
  el.onclick = () => (open?.isConnected ? closeMenu() : details(el));
  const tick = async () => {
    if (document.visibilityState !== "visible") return;
    try {
      last = await api.SysStats();
      const g = last.gpus?.[0];
      push(hist.cpu, last.cpu);
      push(hist.ram, pct(last.ramUsed, last.ramTotal));
      push(hist.gpu, g ? g.util : 0);
      push(hist.vram, g && g.memTotal ? pct(g.memUsed, g.memTotal) : 0);
      render();
      if (open?.isConnected) open.querySelector(".sysd")?.replaceWith(detailsBody());
    } catch {}
  };
  tick();
  timer = setInterval(tick, 2000);
  document.addEventListener("visibilitychange", tick);
}

function meter(label, value, sub, p) {
  return `<span class="sw-m ${level(p)}"><span class="sw-l">${label}</span><b>${value}</b>${sub ? `<span class="sw-s">${sub}</span>` : ""}<span class="sw-bar"><i style="width:${Math.min(100, p).toFixed(0)}%"></i></span></span>`;
}

function render() {
  const el = $("#sysWidget");
  if (!last) return;
  if (store.get("sysw.hidden", false)) { el.innerHTML = I.gauge; el.classList.add("mini"); return; }
  el.classList.remove("mini");
  const g = last.gpus?.[0];
  const ramP = pct(last.ramUsed, last.ramTotal);
  el.innerHTML =
    meter("CPU", `${Math.round(last.cpu)}%`, "", last.cpu) +
    meter("RAM", GB(last.ramUsed), `/${GB(last.ramTotal)}G`, ramP) +
    (g ? meter("GPU", `${Math.round(g.util)}%`, g.memTotal ? `${GB(g.memUsed)}/${GB(g.memTotal)}G` : g.memUsed ? `${GB(g.memUsed)}G` : "", Math.max(g.util, g.memTotal ? pct(g.memUsed, g.memTotal) : 0)) : "");
}

function spark(arr, cls) {
  const w = 220, hgt = 38;
  if (arr.length < 2) return `<svg class="spark" viewBox="0 0 ${w} ${hgt}"></svg>`;
  const step = w / (HIST - 1), off = (HIST - arr.length) * step;
  const pts = arr.map((v, i) => `${(off + i * step).toFixed(1)},${(hgt - 2 - (Math.min(100, v) / 100) * (hgt - 4)).toFixed(1)}`);
  return `<svg class="spark ${cls}" viewBox="0 0 ${w} ${hgt}" preserveAspectRatio="none">
    <polygon points="${off.toFixed(1)},${hgt} ${pts.join(" ")} ${w},${hgt}" class="area"/><polyline points="${pts.join(" ")}" class="line"/></svg>`;
}

function row(title, value, sub, arr, p, cls) {
  return `<div class="sd-row"><div class="sd-h"><span>${title}</span><b class="${level(p)}">${value}</b><span class="dim small">${sub}</span></div>${spark(arr, cls)}</div>`;
}

function detailsBody() {
  const s = last;
  const box = h(`<div class="sysd"></div>`);
  if (!s) { box.innerHTML = `<div class="dim">Загрузка…</div>`; return box; }
  let html = row("Процессор", `${Math.round(s.cpu)}%`, `${s.cores} потоков`, hist.cpu, s.cpu, "c1") +
    row("Память", `${GB(s.ramUsed)} / ${GB(s.ramTotal)} GB`, `${Math.round(pct(s.ramUsed, s.ramTotal))}%`, hist.ram, pct(s.ramUsed, s.ramTotal), "c2");
  (s.gpus || []).forEach((g, i) => {
    html += row(`Видеокарта${s.gpus.length > 1 ? " " + (i + 1) : ""}`, `${Math.round(g.util)}%`, `${esc(g.name)}${g.temp ? ` · ${Math.round(g.temp)}°C` : ""}`, i === 0 ? hist.gpu : [], g.util, "c3");
    if (g.memUsed || g.memTotal) {
      const p = pct(g.memUsed, g.memTotal);
      html += `<div class="sd-row"><div class="sd-h"><span>Видеопамять</span><b class="${level(p)}">${GB(g.memUsed)}${g.memTotal ? ` / ${GB(g.memTotal)} GB` : " GB"}</b><span class="dim small">${g.memTotal ? Math.round(p) + "%" : ""}</span></div>
        ${g.memTotal ? `<div class="sd-bar ${level(p)}"><i style="width:${p.toFixed(0)}%"></i></div>` : ""}</div>`;
    }
  });
  if (!s.gpus?.length) html += `<div class="dim small">Видеокарта не определилась</div>`;
  box.innerHTML = html;
  return box;
}

async function details(anchor) {
  const wrap = h(`<div class="sys-pop"></div>`);
  wrap.append(detailsBody());
  const ai = h(`<div class="sd-ai"></div>`);
  wrap.append(ai);
  const hidden = store.get("sysw.hidden", false);
  wrap.append(h(`<div class="sd-foot"><button class="link" data-hide>${hidden ? "Показывать виджет" : "Свернуть виджет в значок"}</button></div>`));
  wrap.querySelector("[data-hide]").onclick = () => { store.set("sysw.hidden", !hidden); render(); closeMenu(); };
  open = popover(anchor, wrap, { align: "right", width: 300 });
  // модели, загруженные в память
  try {
    const st = await api.AIStatus();
    if (!st.running) { ai.innerHTML = ""; return; }
    ai.innerHTML = `<div class="sd-sec">ИИ-модели в памяти</div>` + (st.loaded.length ? st.loaded.map((m) => `
      <div class="sd-model">${I.sparkle}<span class="name">${esc(m.name)}</span><span class="dim small">${GB(m.size)} GB${m.sizeVram ? (m.sizeVram >= m.size ? " · GPU" : ` · GPU ${Math.round(pct(m.sizeVram, m.size))}%`) : " · CPU"}</span>
        <button class="icon-btn" data-unload="${esc(m.name)}" title="Выгрузить">${I.eject}</button></div>`).join("")
      : `<div class="dim small">Нет — память свободна</div>`) +
      `<button class="btn small" data-ai>${I.sparkle}Открыть ИИ-терминал</button>`;
    ai.onclick = async (e) => {
      const u = e.target.closest("[data-unload]");
      if (u) { try { await api.AIUnload(u.dataset.unload); toast(`${I.eject} ${esc(u.dataset.unload)} выгружена`); u.closest(".sd-model").remove(); } catch (err) { toast(esc(errText(err)), "err"); } }
      if (e.target.closest("[data-ai]")) { closeMenu(); app.openAI(); }
    };
  } catch {}
}
