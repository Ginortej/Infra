// Вкладка терминала: xterm.js + сессия Go (локальная оболочка через ConPTY или SSH).
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { api, errText } from "../api.js";
import { S, app, serverById, vpnRunning } from "../core.js";
import { h, esc, I, menu, shellIcon, b64bytes } from "../ui.js";
import { askPassword } from "../dialogs.js";

export const xtermTheme = {
  background: "#141517", foreground: "#d7d8dc", cursor: "#d7d8dc", cursorAccent: "#141517",
  selectionBackground: "rgba(139,156,244,.35)",
  black: "#1b1c1f", red: "#e57373", green: "#6cc59a", yellow: "#e0b45e", blue: "#8b9cf4", magenta: "#d895d0", cyan: "#6cc7c9", white: "#d7d8dc",
  brightBlack: "#63656d", brightRed: "#f28b8b", brightGreen: "#86d8af", brightYellow: "#eccb83", brightBlue: "#a9b6fa", brightMagenta: "#e6addf", brightCyan: "#8ad9da", brightWhite: "#ffffff",
};

export function makeXterm(opts = {}) {
  const term = new Terminal({
    fontFamily: '"Cascadia Code", "Cascadia Mono", "JetBrains Mono", Consolas, monospace',
    fontSize: 13, lineHeight: 1.2, cursorBlink: true, allowProposedApi: true, scrollback: 10000,
    theme: xtermTheme, ...opts,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  return { term, fit };
}

// Ctrl+C копирует при выделении, Ctrl+V вставляет, правая кнопка — копировать/вставить (как в Windows Terminal)
export function clipboardKeys(term, host) {
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== "keydown") return true;
    if (e.ctrlKey && !e.altKey && (e.code === "KeyC") && term.hasSelection()) {
      navigator.clipboard.writeText(term.getSelection()); term.clearSelection(); return false;
    }
    if (e.ctrlKey && !e.altKey && e.code === "KeyV") {
      e.preventDefault();
      navigator.clipboard.readText().then((t) => t && term.paste(t)); return false;
    }
    // эти сочетания обрабатывает приложение
    if (e.ctrlKey && ["KeyT", "KeyW", "KeyP", "Tab"].includes(e.code)) return false;
    return true;
  });
  host.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (term.hasSelection()) { navigator.clipboard.writeText(term.getSelection()); term.clearSelection(); }
    else navigator.clipboard.readText().then((t) => t && term.paste(t));
  });
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
  if (tab) tab.xt.term.write(b64bytes(data));
  else hold(id, ["data", data]);
}
export function onTermExit(id, msg) {
  const tab = sessions.get(id);
  if (!tab) return hold(id, ["exit", msg]);
  sessions.delete(id);
  tab.sid = null;
  tab.xt.term.write(`\r\n\x1b[90m── ${msg || "сессия завершена"}. Enter — подключиться заново\x1b[0m\r\n`);
  tab.dead = true;
  tab.renderHead();
}

// spec: {kind: "local", shell} | {kind: "ssh", server}; vpn: undefined = по конфигу, "" = напрямую, "id"
export function terminalTab(spec) {
  const tab = {
    type: "term", spec, vpn: spec.vpn, sid: null, dead: false,
    get title() {
      return spec.kind === "ssh" ? spec.server : (S.shells.find((s) => s.id === spec.shell)?.name || spec.shell);
    },
    icon: I.term,
  };
  const el = h(`<div class="tabview term-view"><div class="view-head"></div><div class="term-host"></div></div>`);
  tab.el = el;
  const head = el.querySelector(".view-head");
  const host = el.querySelector(".term-host");
  const xt = makeXterm();
  tab.xt = xt;
  let opened = false;

  const effectiveVpn = () => {
    if (spec.kind === "ssh" && tab.vpn === undefined) return serverById(spec.server)?.vpn || "";
    return tab.vpn || "";
  };

  tab.renderHead = () => {
    const v = effectiveVpn();
    const srv = spec.kind === "ssh" ? serverById(spec.server) : null;
    const sh = S.shells.find((s) => s.id === spec.shell);
    head.innerHTML = `
      <div class="crumbs">${spec.kind === "ssh"
        ? `${I.server}<span>${esc(srv?.group || "")}</span>/<b>${esc(spec.server)}</b><span class="dim mono">${esc(srv ? srv.user + "@" + srv.host : "")}</span>`
        : `<button class="chip" data-shell>${shellIcon(sh?.kind)}${esc(sh?.name || spec.shell)} ${I.chev}</button>`}</div>
      <div class="spacer"></div>
      ${tab.dead ? `<button class="btn" data-reconnect>${I.refresh}Переподключиться</button>` : ""}
      ${spec.kind === "ssh" ? `<button class="chip" data-sftp>${I.folder}Файлы</button>` : ""}
      <button class="chip" data-vpn title="Через какой VPN идёт трафик этой вкладки">
        <span class="dot ${v ? (vpnRunning(v) ? "ok" : "warn") : ""}"></span>${v ? esc(v) : "напрямую"} ${I.chev}
      </button>`;
    head.querySelector("[data-vpn]").onclick = (e) => vpnMenu(e.currentTarget);
    head.querySelector("[data-sftp]")?.addEventListener("click", () => app.openSftp(spec.server));
    head.querySelector("[data-reconnect]")?.addEventListener("click", () => connect(true));
    head.querySelector("[data-shell]")?.addEventListener("click", (e) => shellMenu(e.currentTarget));
  };

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

  async function switchVpn(v) {
    if (v && !vpnRunning(v)) {
      try { await api.VpnStart(v); } catch (e) { xt.term.write(`\r\n\x1b[31mVPN ${v}: ${errText(e)}\x1b[0m\r\n`); return; }
    }
    tab.vpn = v;
    connect(true, `── трафик вкладки: ${v ? "через " + v : "напрямую"}, переподключение…`);
  }

  async function connect(reopen = false, note = "") {
    if (tab.sid) { api.TermClose(tab.sid); sessions.delete(tab.sid); tab.sid = null; }
    if (note) xt.term.write(`\r\n\x1b[90m${note}\x1b[0m\r\n`);
    tab.dead = false;
    tab.renderHead();
    const { cols, rows } = xt.term;
    if (spec.kind === "ssh") {
      const srv = serverById(spec.server);
      if (!reopen) xt.term.write(`\x1b[90mПодключение к ${srv?.user}@${srv?.host}${effectiveVpn() ? " через " + effectiveVpn() : ""}…\x1b[0m\r\n`);
    }
    try {
      tab.sid = spec.kind === "ssh"
        ? await api.TermOpenSSH(spec.server, tab.vpn === undefined ? "@default" : tab.vpn, cols, rows)
        : await api.TermOpenLocal(spec.shell, tab.vpn || "", cols, rows);
      register(tab.sid, tab);
    } catch (e) {
      const m = errText(e);
      if (m === "NEED_PASSWORD") {
        const ok = await askPassword(spec.server);
        if (ok) return connect(true);
        xt.term.write("\x1b[33mПодключение отменено. Enter — попробовать снова\x1b[0m\r\n");
      } else {
        xt.term.write(`\x1b[31m${m}\x1b[0m\r\n\x1b[90mEnter — попробовать снова\x1b[0m\r\n`);
      }
      tab.dead = true;
      tab.renderHead();
    }
  }

  xt.term.onData((d) => {
    if (tab.sid) api.TermWrite(tab.sid, d);
    else if (tab.dead && d === "\r") connect(true);
  });

  const fitNow = () => {
    if (!el.isConnected || el.offsetParent === null) return;
    try { xt.fit.fit(); } catch {}
    if (tab.sid) api.TermResize(tab.sid, xt.term.cols, xt.term.rows);
    if (S.active === tab.id) app.renderStatus();
  };
  new ResizeObserver(() => requestAnimationFrame(fitNow)).observe(host);

  tab.onShow = () => {
    if (!opened) {
      opened = true;
      xt.term.open(host);
      clipboardKeys(xt.term, host);
      requestAnimationFrame(() => { fitNow(); connect(); });
    } else requestAnimationFrame(fitNow);
    setTimeout(() => xt.term.focus(), 30);
  };
  tab.onClose = () => { if (tab.sid) { api.TermClose(tab.sid); sessions.delete(tab.sid); } xt.term.dispose(); };
  tab.onVpnChange = () => tab.renderHead();
  tab.renderHead();
  return tab;
}
