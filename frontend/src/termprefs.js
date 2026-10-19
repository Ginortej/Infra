// Оформление терминала: цветовые темы, шрифт, курсор, отступы.
// Настройки общие для всех вкладок и применяются сразу.
import { store, h, esc, I } from "./ui.js";

const ansi = (a) => {
  const k = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white", "brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan", "brightWhite"];
  return Object.fromEntries(k.map((n, i) => [n, a[i]]));
};

export const THEMES = {
  infra: {
    name: "Infra", dark: true,
    background: "#141517", foreground: "#d7d8dc", cursor: "#8b9cf4", selectionBackground: "#8b9cf455",
    ...ansi(["#2a2c31", "#e57373", "#6cc59a", "#e0b45e", "#8b9cf4", "#d895d0", "#6cc7c9", "#c8cad0",
      "#5d6068", "#f28b8b", "#86d8af", "#eccb83", "#a9b6fa", "#e6addf", "#8ad9da", "#ffffff"]),
  },
  midnight: {
    name: "Полночь", dark: true,
    background: "#0d1220", foreground: "#c9d4ee", cursor: "#5ccfe6", selectionBackground: "#3b4f8a66",
    ...ansi(["#1c2438", "#ff6b81", "#7ee0a1", "#ffd479", "#6aa6ff", "#c792ea", "#5ccfe6", "#c9d4ee",
      "#4a5675", "#ff8a9b", "#a2f0bf", "#ffe2a0", "#91beff", "#dab4f5", "#8ae2f2", "#ffffff"]),
  },
  graphite: {
    name: "Графит", dark: true,
    background: "#1e1e1e", foreground: "#e4e4e4", cursor: "#ffffff", selectionBackground: "#ffffff33",
    ...ansi(["#2e2e2e", "#f0524f", "#5cd17b", "#e5c04c", "#4fa6ff", "#d276e6", "#3fc9d4", "#d4d4d4",
      "#6e6e6e", "#ff7370", "#7fe598", "#f2d67a", "#78bcff", "#e59bf2", "#6fdbe3", "#ffffff"]),
  },
  ember: {
    name: "Угли", dark: true,
    background: "#1d1a16", foreground: "#e8dcc4", cursor: "#f2a65a", selectionBackground: "#f2a65a44",
    ...ansi(["#2e2924", "#e4685d", "#a8c26a", "#f2b54a", "#7fa8c9", "#d08cb1", "#79bfa7", "#d9cdb5",
      "#6b6157", "#f08a7e", "#c2d98a", "#f7cb73", "#a3c2dc", "#e2a9c9", "#9ad4c0", "#fbf3e2"]),
  },
  forest: {
    name: "Лес", dark: true,
    background: "#121a16", foreground: "#cfe3d6", cursor: "#7ddc9c", selectionBackground: "#7ddc9c33",
    ...ansi(["#1f2b25", "#e07a6a", "#7ddc9c", "#d9c56a", "#6fb3d2", "#c49ad6", "#6fd1c2", "#c3d8ca",
      "#4f6358", "#ee9a8c", "#9fe9b8", "#e6d68e", "#93c8e0", "#d6b6e3", "#93e0d4", "#f0faf3"]),
  },
  neon: {
    name: "Неон", dark: true,
    background: "#0b0b12", foreground: "#e6e6ff", cursor: "#ff4fd8", selectionBackground: "#ff4fd844",
    ...ansi(["#1a1a2a", "#ff3864", "#3cff9e", "#ffe14d", "#3d9bff", "#ff4fd8", "#2ef2ff", "#d8d8f0",
      "#4c4c6a", "#ff6688", "#7affbf", "#fff07a", "#70b6ff", "#ff85e4", "#7af7ff", "#ffffff"]),
  },
  amber: {
    name: "Ретро", dark: true,
    background: "#120d05", foreground: "#ffb547", cursor: "#ffcf73", selectionBackground: "#ffb54733",
    ...ansi(["#2a1e0c", "#ff7a3d", "#ffc35c", "#ffd98a", "#e0a040", "#ff9e6b", "#ffcf73", "#ffb547",
      "#6b4e22", "#ff9a66", "#ffd38a", "#ffe6b0", "#f0b866", "#ffbb94", "#ffe0a3", "#fff0d6"]),
  },
  paper: {
    name: "Бумага", dark: false,
    background: "#f7f6f2", foreground: "#2b2d33", cursor: "#4b5bd6", selectionBackground: "#4b5bd633",
    ...ansi(["#2b2d33", "#c6383f", "#2f8a4f", "#a8770a", "#3b55c9", "#9a3fa8", "#1f8a92", "#bfbfbf",
      "#7a7d86", "#de4b52", "#3aa361", "#c48f12", "#5269dd", "#b155c0", "#26a3ad", "#ffffff"]),
  },
};

const FONTS = [
  ['"Cascadia Code", Consolas, monospace', "Cascadia Code"],
  ['"Cascadia Mono", Consolas, monospace', "Cascadia Mono"],
  ['"JetBrains Mono", "Cascadia Mono", Consolas, monospace', "JetBrains Mono"],
  ['Consolas, monospace', "Consolas"],
  ['"Lucida Console", monospace', "Lucida Console"],
];
const PADS = { compact: [8, 10], normal: [14, 18], wide: [22, 28] };

const DEFAULTS = { theme: "infra", fontSize: 14, lineHeight: 1.25, font: FONTS[0][0], cursorStyle: "bar", cursorBlink: true, padding: "normal" };
let prefs = { ...DEFAULTS, ...store.get("term", {}) };
if (!THEMES[prefs.theme]) prefs.theme = "infra";
const listeners = new Set();

export const getPrefs = () => prefs;
export const currentTheme = () => THEMES[prefs.theme];
export function setPrefs(patch) {
  prefs = { ...prefs, ...patch };
  prefs.fontSize = Math.max(9, Math.min(28, prefs.fontSize));
  store.set("term", prefs);
  applyCssVars();
  listeners.forEach((fn) => fn(prefs));
}
export function onPrefs(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export const zoom = (d) => setPrefs({ fontSize: d === 0 ? DEFAULTS.fontSize : prefs.fontSize + d });

export function xtermOptions() {
  const t = currentTheme();
  return {
    theme: { ...t, cursorAccent: t.background, scrollbarSliderBackground: t.foreground + "22", scrollbarSliderHoverBackground: t.foreground + "40" },
    fontFamily: prefs.font, fontSize: prefs.fontSize, lineHeight: prefs.lineHeight,
    cursorStyle: prefs.cursorStyle, cursorBlink: prefs.cursorBlink, cursorInactiveStyle: "outline",
  };
}

// фон рамки терминала и отступы задаются через CSS-переменные
export function applyCssVars() {
  const t = currentTheme();
  const [py, px] = PADS[prefs.padding] || PADS.normal;
  const r = document.documentElement.style;
  r.setProperty("--term-bg", t.background);
  r.setProperty("--term-fg", t.foreground);
  r.setProperty("--term-accent", t.cursor);
  r.setProperty("--term-pad-y", py + "px");
  r.setProperty("--term-pad-x", px + "px");
  document.documentElement.classList.toggle("term-light", !t.dark);
}
applyCssVars();

// ---------- Панель «Оформление» ----------
function themeCard(id, t, active) {
  const c = (k) => t[k];
  return `<button class="theme-card${active ? " active" : ""}" data-theme="${id}" style="--bg:${t.background};--fg:${t.foreground}">
    <div class="tc-prev mono">
      <div><span style="color:${c("green")}">user@infra</span><span style="color:${c("brightBlack")}">:</span><span style="color:${c("blue")}">~</span><span style="color:${c("brightBlack")}">$</span> ls</div>
      <div><span style="color:${c("blue")}">app</span> <span style="color:${c("cyan")}">logs</span> <span style="color:${c("yellow")}">run.sh</span></div>
      <div class="tc-sw">${["red", "green", "yellow", "blue", "magenta", "cyan"].map((k) => `<i style="background:${c(k)}"></i>`).join("")}</div>
    </div>
    <div class="tc-name">${esc(t.name)}${active ? I.check : ""}</div>
  </button>`;
}

export function appearancePanel() {
  const el = h(`<div class="appearance"></div>`);
  const render = () => {
    const p = prefs;
    el.innerHTML = `
      <div class="ap-sec">Цветовая тема</div>
      <div class="theme-grid">${Object.entries(THEMES).map(([id, t]) => themeCard(id, t, id === p.theme)).join("")}</div>
      <div class="ap-row"><span>Размер шрифта</span>
        <div class="stepper"><button data-fs="-1">−</button><b>${p.fontSize}</b><button data-fs="1">+</button></div></div>
      <div class="ap-row"><span>Шрифт</span>
        <select data-k="font">${FONTS.map(([v, n]) => `<option value='${esc(v)}' ${v === p.font ? "selected" : ""}>${n}</option>`).join("")}</select></div>
      <div class="ap-row"><span>Межстрочный</span>
        <div class="seg">${[[1.1, "плотно"], [1.25, "обычно"], [1.45, "свободно"]].map(([v, n]) => `<button data-lh="${v}" class="${p.lineHeight === v ? "on" : ""}">${n}</button>`).join("")}</div></div>
      <div class="ap-row"><span>Отступы</span>
        <div class="seg">${[["compact", "малые"], ["normal", "обычные"], ["wide", "большие"]].map(([v, n]) => `<button data-pad="${v}" class="${p.padding === v ? "on" : ""}">${n}</button>`).join("")}</div></div>
      <div class="ap-row"><span>Курсор</span>
        <div class="seg">${[["bar", "▏ черта"], ["block", "█ блок"], ["underline", "▁ линия"]].map(([v, n]) => `<button data-cur="${v}" class="${p.cursorStyle === v ? "on" : ""}">${n}</button>`).join("")}</div></div>
      <label class="ap-row check"><span>Мигающий курсор</span><input type="checkbox" data-blink ${p.cursorBlink ? "checked" : ""}></label>
      <div class="ap-foot dim small">Ctrl + колесо / Ctrl+= / Ctrl+− — размер шрифта, Ctrl+0 — сбросить</div>`;
  };
  el.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.theme) setPrefs({ theme: b.dataset.theme });
    if (b.dataset.fs) setPrefs({ fontSize: prefs.fontSize + +b.dataset.fs });
    if (b.dataset.lh) setPrefs({ lineHeight: +b.dataset.lh });
    if (b.dataset.pad) setPrefs({ padding: b.dataset.pad });
    if (b.dataset.cur) setPrefs({ cursorStyle: b.dataset.cur });
    render();
  });
  el.addEventListener("change", (e) => {
    if (e.target.dataset.k === "font") setPrefs({ font: e.target.value });
    if (e.target.dataset.blink !== undefined) setPrefs({ cursorBlink: e.target.checked });
    render();
  });
  render();
  return el;
}
