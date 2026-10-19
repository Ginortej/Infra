// Общие помощники интерфейса: DOM, иконки, меню, модальные окна, уведомления.
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const h = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const svg = (d) => `<svg viewBox="0 0 24 24">${d}</svg>`;
export const I = {
  server: svg('<rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M7 7.5h.01M7 16.5h.01"/>'),
  term: svg('<path d="m5 8 4 4-4 4M12 17h7"/>'),
  file: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>'),
  folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  folderOpen: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v1"/><path d="m3 19 2.5-8h16L19 19z"/>'),
  layers: svg('<path d="M12 3 3 7.5l9 4.5 9-4.5z"/><path d="m3 12 9 4.5 9-4.5"/><path d="m3 16.5 9 4.5 9-4.5"/>'),
  shield: svg('<path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z"/>'),
  code: svg('<path d="m8 9-4 3 4 3M16 9l4 3-4 3M14 5l-4 14"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  x: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  chev: svg('<path d="m6 9 6 6 6-6"/>'),
  right: svg('<path d="m9 6 6 6-6 6"/>'),
  up: svg('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  play: svg('<path d="M7 5v14l11-7z"/>'),
  stop: svg('<rect x="6" y="6" width="12" height="12" rx="1"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  camera: svg('<circle cx="12" cy="13" r="3.5"/><path d="M4 8h3l2-3h6l2 3h3v11H4z"/>'),
  upload: svg('<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>'),
  download: svg('<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>'),
  refresh: svg('<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>'),
  cpu: svg('<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>'),
  activity: svg('<path d="M3 12h4l3-8 4 16 3-8h4"/>'),
  globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3"/>'),
  check: svg('<path d="m5 12 5 5 9-10"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>'),
  key: svg('<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 9.2-9.2M17 6l3 3M14 9l2 2"/>'),
  windows: svg('<path d="M3 5.5 10 4.5v7H3zM12 4.2 21 3v8.5h-9zM3 12.5h7v7l-7-1zM12 12.5h9V21l-9-1.3z"/>'),
  linux: svg('<path d="M12 3c-2 0-3 1.8-3 4 0 1.6.4 2.6-.6 4.2C7 13.4 6 15 6.5 17.5 7 20 9.5 21 12 21s5-1 5.5-3.5c.5-2.5-.5-4.1-1.9-6.3-1-1.6-.6-2.6-.6-4.2 0-2.2-1-4-3-4z"/><path d="M10.5 7.5h.01M13.5 7.5h.01"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
  warn: svg('<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>'),
  vault: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M12 9V7M12 17v-2"/>'),
  dots: svg('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'),
  palette: svg('<path d="M12 3a9 9 0 1 0 0 18c1 0 1.6-.8 1.6-1.6 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5C21 6.6 17 3 12 3z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="14.5" cy="7" r="1"/>'),
  arrowDown: svg('<path d="M12 5v14M6 13l6 6 6-6"/>'),
  copy: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>'),
  eraser: svg('<path d="m7 21-4-4 10-10 8 8-6 6H7zM14 21h7"/>'),
  eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
};

export const shellIcon = (kind) => ({ powershell: I.term, cmd: I.windows, bash: I.code, wsl: I.linux }[kind] || I.term);

// ---------- Уведомления ----------
let toastT;
export function toast(html, kind = "") {
  const el = $("#toast");
  el.className = "toast " + kind;
  el.innerHTML = html;
  el.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => (el.hidden = true), kind === "err" ? 6000 : 2600);
}

// ---------- Выпадающее меню ----------
// items: [{icon, label, meta, onClick, header, sep, checked}]
export function menu(anchor, items, { align = "left", width = 240 } = {}) {
  closeMenu();
  const r = anchor.getBoundingClientRect();
  const m = h(`<div class="menu" style="min-width:${width}px"></div>`);
  items.forEach((it) => {
    if (it.sep) return m.append(h(`<div class="sep"></div>`));
    if (it.header) return m.append(h(`<div class="menu-h">${esc(it.header)}</div>`));
    const b = h(`<button>${it.icon || ""}<span class="lbl">${esc(it.label)}</span>${it.meta ? `<span class="meta">${esc(it.meta)}</span>` : ""}${it.checked ? I.check : ""}</button>`);
    if (it.disabled) b.disabled = true;
    b.onclick = (e) => { e.stopPropagation(); closeMenu(); it.onClick?.(); };
    m.append(b);
  });
  document.body.append(m);
  const mw = m.offsetWidth, mh = m.offsetHeight;
  let left = align === "right" ? r.right - mw : r.left;
  left = Math.max(8, Math.min(left, innerWidth - mw - 8));
  let top = r.bottom + 4;
  if (top + mh > innerHeight - 8) top = Math.max(8, r.top - mh - 4);
  m.style.left = left + "px";
  m.style.top = top + "px";
  setTimeout(() => document.addEventListener("mousedown", outside));
  function outside(e) { if (!m.contains(e.target)) closeMenu(); }
  m._off = () => document.removeEventListener("mousedown", outside);
  return m;
}
export function closeMenu() { $$(".menu, .popover-panel").forEach((m) => { m._off?.(); m.remove(); }); }

// ---------- Модальное окно ----------
// Возвращает {el, close}. body — HTML или элемент; buttons: [{label, primary, danger, onClick -> false чтобы не закрывать}]
export function modal({ title, body, buttons = [], width = 520, onClose }) {
  const bd = h(`<div class="modal-backdrop"><div class="modal" style="width:min(${width}px, 94vw)">
    <div class="modal-h"><span>${esc(title)}</span><button class="icon-btn" data-x>${I.x}</button></div>
    <div class="modal-b"></div><div class="modal-f"></div></div></div>`);
  const b = $(".modal-b", bd);
  typeof body === "string" ? (b.innerHTML = body) : b.append(body);
  const f = $(".modal-f", bd);
  const close = () => { bd.remove(); document.removeEventListener("keydown", key, true); onClose?.(); };
  buttons.forEach((btn) => {
    const el = h(`<button class="btn ${btn.primary ? "primary" : ""} ${btn.danger ? "danger-solid" : ""}">${btn.label}</button>`);
    if (btn.id) el.id = btn.id;
    el.onclick = async () => {
      if (!btn.onClick) return close();
      el.disabled = true;
      try { if ((await btn.onClick(bd)) !== false) close(); } finally { el.disabled = false; }
    };
    f.append(el);
  });
  if (!buttons.length) f.remove();
  $("[data-x]", bd).onclick = close;
  bd.addEventListener("mousedown", (e) => { if (e.target === bd) close(); });
  function key(e) {
    if (e.key === "Escape") { e.stopPropagation(); close(); }
    if (e.key === "Enter" && !e.shiftKey && e.target.tagName !== "TEXTAREA" && e.target.tagName !== "BUTTON") {
      const p = $(".modal-f .btn.primary", bd) || $(".modal-f .btn.danger-solid", bd);
      if (p) { e.preventDefault(); p.click(); }
    }
  }
  document.addEventListener("keydown", key, true);
  document.body.append(bd);
  setTimeout(() => $("input:not([type=checkbox]), select, textarea", bd)?.focus());
  return { el: bd, close };
}

export function confirmBox(title, text, okLabel = "Удалить") {
  return new Promise((res) => {
    let ok = false;
    modal({ title, body: `<p class="muted">${text}</p>`, width: 440, onClose: () => res(ok),
      buttons: [{ label: "Отмена" }, { label: okLabel, danger: true, onClick: () => { ok = true; } }] });
  });
}

export const fmtSize = (n) => { if (!n) return ""; const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0; while (n >= 1024 && i < 4) { n /= 1024; i++; } return (i ? n.toFixed(1) : n) + " " + u[i]; };
export const fmtDate = (t) => t ? new Date(t * 1000).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
export const fmtDur = (ms) => ms < 1000 ? ms + " мс" : (ms / 1000).toFixed(1) + " с";
export const b64bytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const store = {
  get(k, d) { try { const v = localStorage.getItem("infra." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("infra." + k, JSON.stringify(v)); } catch {} },
};

// ---------- Всплывающая панель (как меню, но с произвольным содержимым) ----------
export function popover(anchor, content, { align = "right", width = 360 } = {}) {
  closeMenu();
  const r = anchor.getBoundingClientRect();
  const m = h(`<div class="popover-panel" style="width:${width}px"></div>`);
  m.append(content);
  document.body.append(m);
  const mw = m.offsetWidth, mh = m.offsetHeight;
  let left = align === "right" ? r.right - mw : r.left;
  left = Math.max(8, Math.min(left, innerWidth - mw - 8));
  let top = r.bottom + 6;
  if (top + mh > innerHeight - 8) top = Math.max(8, innerHeight - mh - 8);
  m.style.left = left + "px";
  m.style.top = top + "px";
  setTimeout(() => document.addEventListener("mousedown", outside));
  function outside(e) { if (!m.contains(e.target) && !anchor.contains(e.target)) closeMenu(); }
  m._off = () => document.removeEventListener("mousedown", outside);
  return m;
}
