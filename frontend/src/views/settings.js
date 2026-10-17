// Настройки: хранилище, оболочка по умолчанию, пути к программам.
import { api, errText } from "../api.js";
import { S, app } from "../core.js";
import { h, esc, I, toast, shellIcon } from "../ui.js";

export function settingsTab() {
  const tab = { type: "settings", key: "settings", icon: I.gear, title: "Настройки" };
  const el = h(`<div class="tabview"><div class="view-head"><div class="crumbs">${I.gear}<b>Настройки</b></div></div><div class="settings"></div></div>`);
  tab.el = el;
  const body = el.querySelector(".settings");

  async function render() {
    S.state = await api.GetState();
    const st = S.state.settings || {}, det = S.state.detected || {};
    const row = (key, label, hint, kind) => {
      const found = det[key];
      return `<div class="set-row">
        <div class="set-l"><div>${label}</div><div class="dim small">${hint}</div></div>
        <div class="set-r">
          <div class="path-input"><input data-k="${key}" value="${esc(st[key] || "")}" placeholder="${found ? "найдено: " + esc(found) : "не найдено — укажи путь"}">
          <button class="btn" data-pick="${key}" data-kind="${kind}">${I.folderOpen}Обзор…</button></div>
          <div class="small ${found ? "ok-t" : "warn-t"}">${found ? `${I.check} используется: <span class="mono">${esc(found)}</span>` : `${I.warn} не найдено`}</div>
        </div></div>`;
    };
    body.innerHTML = `
      <section>
        <h3>Хранилище</h3>
        <div class="set-row"><div class="set-l"><div>Папка хранилища</div><div class="dim small">Здесь лежат все YAML: серверы, VPN, лабы, скрипты</div></div>
          <div class="set-r"><div class="path-input"><input value="${esc(S.state.vault)}" readonly><button class="btn" data-vault>${I.folderOpen}Сменить…</button><button class="btn ghost" data-reveal title="Показать в проводнике">${I.folder}</button></div></div></div>
      </section>
      <section>
        <h3>Терминал</h3>
        <div class="set-row"><div class="set-l"><div>Оболочка по умолчанию</div><div class="dim small">Открывается по Ctrl+T и кнопке +. Найдено на этом ПК: ${S.shells.length}</div></div>
          <div class="set-r"><select data-k="defaultShell">${S.shells.map((s) => `<option value="${esc(s.id)}" ${s.id === st.defaultShell ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select>
          <div class="shell-list">${S.shells.map((s) => `<div>${shellIcon(s.kind)}<b>${esc(s.name)}</b><span class="mono dim small">${esc(s.path)}</span></div>`).join("")}</div>
          <button class="btn small" data-rescan>${I.refresh}Найти заново</button></div></div>
      </section>
      <section>
        <h3>Скрипты и Ansible</h3>
        <div class="set-row"><div class="set-l"><div>Дистрибутив WSL для Ansible</div><div class="dim small">Пусто — первый найденный</div></div>
          <div class="set-r"><input data-k="wslDistro" value="${esc(st.wslDistro || "")}" placeholder="${det.wslDistro ? "найден: " + esc(det.wslDistro) : "WSL не найден"}"></div></div>
        <div class="set-row"><div class="set-l"><div>Параллельно серверов</div><div class="dim small">Для bash-скриптов по умолчанию</div></div>
          <div class="set-r"><input type="number" min="1" max="200" data-k="parallel" value="${st.parallel || 10}"></div></div>
      </section>
      <section>
        <h3>Программы</h3>
        ${row("singbox", "sing-box", "Ядро для VPN-профилей (wireguard / vless / …)", "file")}
        ${row("vboxmanage", "VBoxManage", "VirtualBox — для лаб", "file")}
        ${row("vmrun", "vmrun", "VMware Workstation — для лаб", "file")}
        ${row("vmwareDir", "Папка VM VMware", "Куда VMware-лабы кладут машины", "folder")}
      </section>
      <div class="set-foot"><span class="dim small">Infra ${esc(S.state.version)}${api.isMock ? " · тестовый режим (браузер)" : ""}</span><span class="spacer"></span><button class="btn primary" data-save>Сохранить</button></div>`;

    body.querySelectorAll("[data-pick]").forEach((b) => (b.onclick = async () => {
      const input = body.querySelector(`[data-k="${b.dataset.pick}"]`);
      const p = b.dataset.kind === "folder" ? await api.PickFolder("Выбери папку", input.value) : await api.PickFile("Выбери программу", input.value);
      if (p) input.value = p;
    }));
    body.querySelector("[data-vault]").onclick = () => app.pickVault();
    body.querySelector("[data-reveal]").onclick = () => api.Reveal(S.state.vault);
    body.querySelector("[data-rescan]").onclick = async () => { S.shells = await api.RescanShells(); render(); };
    body.querySelector("[data-save]").onclick = async () => {
      const s = { ...st };
      body.querySelectorAll("[data-k]").forEach((i) => (s[i.dataset.k] = i.type === "number" ? +i.value : i.value.trim()));
      try { await api.SaveSettings(s); toast(`${I.check} Настройки сохранены`); render(); } catch (e) { toast(esc(errText(e)), "err"); }
    };
  }
  tab.onShow = render;
  return tab;
}
