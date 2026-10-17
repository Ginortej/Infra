// Файлы сервера: две панели (этот ПК ↔ сервер), выбор папки, загрузка/скачивание.
import { api, errText } from "../api.js";
import { serverById, app } from "../core.js";
import { h, esc, I, toast, fmtSize, fmtDate, store, confirmBox } from "../ui.js";
import { askPassword } from "../dialogs.js";

export function sftpTab(serverId) {
  const tab = { type: "sftp", key: "sftp:" + serverId, server: serverId, icon: I.folder, title: serverId + " · файлы" };
  const srv = serverById(serverId);
  const el = h(`<div class="tabview">
    <div class="view-head">
      <div class="crumbs">${I.folder}<b>${esc(serverId)}</b><span class="dim mono">${esc(srv ? srv.user + "@" + srv.host : "")}</span></div>
      <div class="spacer"></div>
      <button class="btn" data-term>${I.term}Терминал</button>
    </div>
    <div class="sftp">
      <div class="pane" data-side="local"></div>
      <div class="pane-mid">
        <button class="btn icon-only" data-up title="Загрузить выбранное на сервер">${I.right}</button>
        <button class="btn icon-only flip" data-down title="Скачать выбранное на этот ПК">${I.right}</button>
      </div>
      <div class="pane" data-side="remote"></div>
    </div></div>`);
  tab.el = el;

  const P = {
    local: { path: store.get("sftp.local." + serverId, ""), list: null, sel: new Set(), err: "" },
    remote: { path: store.get("sftp.remote." + serverId, ""), list: null, sel: new Set(), err: "" },
  };
  const sep = (side) => (side === "local" && /^[A-Za-z]:\\|\\/.test(P.local.path) ? "\\" : "/");
  const join = (side, a, b) => (a.endsWith(sep(side)) ? a + b : a + sep(side) + b);

  async function load(side, path) {
    const p = P[side];
    p.err = "";
    try {
      p.list = side === "local" ? await api.LocalList(path ?? p.path) : await api.RemoteList(serverId, path ?? p.path);
      p.path = p.list.path;
      p.sel.clear();
      store.set(`sftp.${side}.${serverId}`, p.path);
    } catch (e) {
      const m = errText(e);
      if (m === "NEED_PASSWORD" && side === "remote") {
        if (await askPassword(serverId)) return load(side, path);
        p.err = "Нужен пароль";
      } else p.err = m;
    }
    render(side);
  }

  function render(side) {
    const p = P[side];
    const pane = el.querySelector(`[data-side=${side}]`);
    const entries = p.list?.entries || [];
    pane.innerHTML = `
      <div class="pane-head">
        <b>${side === "local" ? "Этот ПК" : esc(serverId)}</b>
        <button class="icon-btn" data-parent title="Вверх" ${p.list?.parent ? "" : "disabled"}>${I.up}</button>
        <input class="path" value="${esc(p.path)}" spellcheck="false" title="Путь — можно вписать и нажать Enter">
        ${side === "local" ? `<button class="btn small" data-browse title="Выбрать папку в проводнике">${I.folderOpen}Обзор…</button>` : `<button class="icon-btn" data-mkdir title="Новая папка">${I.plus}</button>`}
        <button class="icon-btn" data-refresh title="Обновить">${I.refresh}</button>
      </div>
      <div class="files">
        <div class="frow head"><span class="fn">Имя</span><span>Размер</span><span>Изменён</span></div>
        ${p.err ? `<div class="pane-err">${I.warn}${esc(p.err)}</div>` : ""}
        ${entries.map((f, i) => `<div class="frow${f.dir ? " dir" : ""}${p.sel.has(f.name) ? " sel" : ""}" data-i="${i}">
          <span class="fn">${f.dir ? I.folder : I.file}${esc(f.name)}</span><span>${f.dir ? "" : fmtSize(f.size)}</span><span>${fmtDate(f.mtime)}</span></div>`).join("")}
        ${!p.err && p.list && !entries.length ? `<div class="pane-empty">Пусто</div>` : ""}
      </div>
      <div class="pane-foot">${p.sel.size ? `Выбрано: ${p.sel.size}` : `${entries.length} объектов`}${side === "remote" && p.sel.size ? ` · <button class="link danger" data-del>удалить</button>` : ""}</div>`;

    const input = pane.querySelector(".path");
    input.onkeydown = (e) => { if (e.key === "Enter") load(side, input.value.trim()); };
    pane.querySelector("[data-parent]").onclick = () => p.list?.parent && load(side, p.list.parent);
    pane.querySelector("[data-refresh]").onclick = () => load(side);
    pane.querySelector("[data-browse]")?.addEventListener("click", async () => {
      const d = await api.PickFolder("Выбери папку на этом ПК", p.path);
      if (d) load("local", d);
    });
    pane.querySelector("[data-mkdir]")?.addEventListener("click", async () => {
      const n = prompt("Имя новой папки");
      if (!n) return;
      try { await api.RemoteMkdir(serverId, join(side, p.path, n)); load(side); } catch (e) { toast(esc(errText(e)), "err"); }
    });
    pane.querySelector("[data-del]")?.addEventListener("click", async () => {
      if (!(await confirmBox("Удалить на сервере?", `Будет удалено: ${[...p.sel].map(esc).join(", ")}`))) return;
      for (const n of p.sel) { try { await api.RemoteDelete(serverId, join(side, p.path, n)); } catch (e) { toast(esc(errText(e)), "err"); } }
      load(side);
    });
    pane.querySelectorAll(".frow[data-i]").forEach((row) => {
      const f = entries[+row.dataset.i];
      row.onclick = (e) => {
        if (!e.ctrlKey && !e.shiftKey) p.sel.clear();
        p.sel.has(f.name) ? p.sel.delete(f.name) : p.sel.add(f.name);
        render(side);
      };
      row.ondblclick = () => { if (f.dir) load(side, join(side, p.path, f.name)); else transfer(side); };
    });
  }

  async function transfer(from) {
    const src = P[from];
    if (!src.sel.size) return toast("Сначала выбери файлы или папки");
    const paths = [...src.sel].map((n) => join(from, src.path, n));
    try {
      if (from === "local") await api.Upload(serverId, paths, P.remote.path);
      else await api.Download(serverId, paths, P.local.path);
      toast(`${I.activity} ${from === "local" ? "Загрузка" : "Скачивание"} началось — прогресс внизу`);
    } catch (e) { toast(esc(errText(e)), "err"); }
  }

  el.querySelector("[data-up]").onclick = () => transfer("local");
  el.querySelector("[data-down]").onclick = () => transfer("remote");
  el.querySelector("[data-term]").onclick = () => app.openSSH(serverId);

  let loaded = false;
  tab.onShow = () => { if (!loaded) { loaded = true; load("local"); load("remote"); } };
  tab.onFilesChanged = (who) => load(who === "local" ? "local" : "remote");
  return tab;
}
