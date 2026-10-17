// Запуск скриптов: окно «где и как выполнить» + вкладка с результатом по каждому серверу.
import { api, errText } from "../api.js";
import { S, app } from "../core.js";
import { h, esc, I, modal, toast, store, fmtDur, b64bytes, $ } from "../ui.js";
import { makeXterm, clipboardKeys } from "./terminal.js";

const KIND = {
  bash: {
    label: "bash-скрипт", where: "на серверах",
    how: "Скрипт передаётся на каждый выбранный сервер по SSH и выполняется там через <b>bash -s</b>. Ничего не копируется на диск сервера. Серверы обрабатываются параллельно, у каждого свой вывод и код выхода.",
  },
  ansible: {
    label: "Ansible playbook", where: "на серверах через Ansible",
    how: "Ansible работает внутри <b>WSL</b> на этом ПК. Из выбранных серверов собирается inventory (адреса, пользователи, ключи), затем запускается <b>ansible-playbook</b>. SSH-ключи копируются в WSL автоматически.",
  },
  powershell: {
    label: "PowerShell-скрипт", where: "на этом ПК",
    how: "Скрипт выполняется <b>локально на этом компьютере</b> в выбранной версии PowerShell, рабочая папка — папка скрипта.",
  },
  cmd: { label: "bat/cmd-скрипт", where: "на этом ПК", how: "Скрипт выполняется <b>локально на этом компьютере</b> в cmd.exe." },
};

export function openRunDialog(path) {
  const script = S.snap.scripts.find((s) => s.path === path);
  const kind = script?.kind || "bash";
  const K = KIND[kind];
  const remote = kind === "bash" || kind === "ansible";
  const saved = new Set(store.get("run.targets." + path, []));
  const groups = {};
  S.snap.servers.forEach((s) => (groups[s.group] ??= []).push(s));
  const psShells = S.shells.filter((s) => s.kind === "powershell");

  const body = h(`<div class="run-dlg">
    <div class="how">
      <div class="how-ico">${remote ? I.server : I.windows}</div>
      <div><div class="how-t">${K.label} · выполняется ${K.where}</div><div class="how-d">${K.how}</div></div>
    </div>
    ${remote ? `
      <div class="sec-h"><span>Где выполнить</span><span class="spacer"></span>
        <button class="link" data-all>все</button><button class="link" data-none>никто</button></div>
      <div class="side-filter in-dlg">${I.search}<input placeholder="Фильтр серверов…" data-filter></div>
      <div class="targets">${Object.entries(groups).map(([g, list]) => `
        <div class="tgroup" data-g="${esc(g)}">
          <label class="check tg-h"><input type="checkbox" data-group="${esc(g)}"><b>${esc(g)}</b><span class="dim small">${list.length}</span></label>
          ${list.map((s) => `<label class="check tg-i" data-name="${esc(s.id + " " + s.host)}"><input type="checkbox" data-srv="${esc(s.id)}" ${saved.has(s.id) ? "checked" : ""}>
            <span class="dot ${S.srv[s.id] || ""}"></span>${esc(s.id)}<span class="dim mono small">${esc(s.user)}@${esc(s.host)}</span>${s.vpn ? `<span class="tag">${esc(s.vpn)}</span>` : ""}</label>`).join("")}
        </div>`).join("") || `<div class="pane-empty">В хранилище нет серверов</div>`}
      </div>` : ""}
    ${kind === "bash" ? `
      <div class="opts">
        <label class="field inline"><span>Одновременно</span><input type="number" min="1" max="100" value="${store.get("run.parallel", S.state?.detected?.parallel || 10)}" data-par></label>
        <label class="check"><input type="checkbox" data-sudo ${store.get("run.sudo." + path, false) ? "checked" : ""}> через sudo <span class="dim small">(sudo -n, без пароля)</span></label>
      </div>` : ""}
    ${kind === "powershell" ? `
      <label class="field"><span>PowerShell</span><select data-shell>${psShells.map((s) => `<option value="${esc(s.path)}">${esc(s.name)}</option>`).join("") || `<option value="">powershell.exe</option>`}</select></label>` : ""}
    ${kind === "ansible" ? `<div class="ansible-state" data-ansible><span class="spin"></span>Проверяю Ansible в WSL…</div>
      <details class="inv"><summary>Inventory, который получит Ansible</summary><pre data-inv></pre></details>` : ""}
    <div class="cmd-preview mono" data-cmd></div>
  </div>`);

  const sel = () => [...body.querySelectorAll("[data-srv]:checked")].map((c) => c.dataset.srv);
  let ansibleOk = kind !== "ansible";

  const sync = () => {
    body.querySelectorAll("[data-group]").forEach((g) => {
      const items = [...body.querySelectorAll(`.tgroup[data-g="${CSS.escape(g.dataset.group)}"] [data-srv]`)];
      const n = items.filter((i) => i.checked).length;
      g.checked = n === items.length && n > 0;
      g.indeterminate = n > 0 && n < items.length;
    });
    const t = sel();
    const name = path.split("/").pop();
    const cmd = $("[data-cmd]", body);
    if (kind === "bash") cmd.textContent = t.length ? `ssh <сервер> '${$("[data-sudo]", body)?.checked ? "sudo -n " : ""}bash -s' < ${name}   × ${t.length}` : "Выбери хотя бы один сервер";
    else if (kind === "ansible") cmd.textContent = t.length ? `wsl -d ${S.state?.detected?.wslDistro || "<дистрибутив>"} -- ansible-playbook -i inventory.ini ${path}` : "Выбери хотя бы один сервер";
    else if (kind === "powershell") cmd.textContent = `${($("[data-shell]", body)?.selectedOptions[0]?.text) || "powershell"} -File ${path}`;
    else cmd.textContent = `cmd /c ${path}`;
    const btn = document.getElementById("run-go");
    if (btn) {
      btn.disabled = (remote && !t.length) || !ansibleOk;
      btn.innerHTML = `${I.play}Запустить${remote && t.length ? ` на ${t.length}` : ""}`;
    }
    if (kind === "ansible" && t.length) api.PreviewInventory(t).then((inv) => ($("[data-inv]", body).textContent = inv));
  };

  body.addEventListener("change", (e) => {
    if (e.target.dataset.group !== undefined) {
      body.querySelectorAll(`.tgroup[data-g="${CSS.escape(e.target.dataset.group)}"] [data-srv]`).forEach((c) => (c.checked = e.target.checked));
    }
    sync();
  });
  $("[data-all]", body)?.addEventListener("click", () => { body.querySelectorAll(".tg-i:not([hidden]) [data-srv]").forEach((c) => (c.checked = true)); sync(); });
  $("[data-none]", body)?.addEventListener("click", () => { body.querySelectorAll("[data-srv]").forEach((c) => (c.checked = false)); sync(); });
  $("[data-filter]", body)?.addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase();
    body.querySelectorAll(".tg-i").forEach((l) => (l.hidden = q && !l.dataset.name.toLowerCase().includes(q)));
  });

  if (kind === "ansible") {
    const box = $("[data-ansible]", body);
    const check = () => api.AnsibleInfo().then((a) => {
      ansibleOk = a.ansible;
      if (a.ansible) box.innerHTML = `${I.check}<span><b>${esc(a.version)}</b> · WSL ${esc(a.distro)}</span>`;
      else if (a.error) box.innerHTML = `${I.warn}<span>${esc(a.error)}</span>`;
      else {
        box.innerHTML = `${I.warn}<span>Ansible не установлен в WSL (${esc(a.distro)}).</span><button class="btn small" data-install>Установить Ansible</button>`;
        $("[data-install]", box).onclick = async () => {
          try {
            const run = await api.InstallAnsible();
            openRunTab(run, { title: "Установка Ansible", kind: "setup", hosts: ["local"], onDone: check });
            box.innerHTML = `<span class="spin"></span>Устанавливаю — смотри вкладку «Установка Ansible»…`;
          } catch (e) { toast(esc(errText(e)), "err"); }
        };
      }
      box.className = "ansible-state " + (a.ansible ? "ok" : "bad");
      sync();
    });
    check();
  }

  modal({
    title: "Запуск · " + path.split("/").pop(), body, width: 600,
    buttons: [
      { label: "Открыть файл", onClick: () => app.openFile(path) },
      { label: "Отмена" },
      { label: "Запустить", primary: true, id: "run-go", onClick: async () => {
        const targets = sel();
        const req = { script: path, targets, parallel: +($("[data-par]", body)?.value || 10), sudo: !!$("[data-sudo]", body)?.checked, shell: $("[data-shell]", body)?.value || "" };
        store.set("run.targets." + path, targets);
        if (kind === "bash") { store.set("run.parallel", req.parallel); store.set("run.sudo." + path, req.sudo); }
        try {
          const run = await api.RunScript(req);
          openRunTab(run, { title: path.split("/").pop(), kind, script: path, hosts: remote ? targets : ["local"], req });
        } catch (e) { toast(esc(errText(e)), "err"); return false; }
      } },
    ],
  });
  sync();
}

// ---------- Вкладка результата ----------
const runs = new Map(); // runId -> tab

// события могут прийти раньше, чем откроется вкладка — копим их
const early = new Map();
const deliver = (run, fn, args) => {
  const t = runs.get(run);
  if (t) t[fn](...args);
  else { if (!early.has(run)) early.set(run, []); early.get(run).push([fn, args]); if (early.size > 50) early.delete(early.keys().next().value); }
};
export function onRunOut(run, host, data) { deliver(run, "out", [host, data]); }
export function onRunHost(run, host, state, code, ms) { deliver(run, "hostState", [host, state, code, ms]); }
export function onRunDone(run) { deliver(run, "done", []); }
export function onRunOpened(run, script, targets, kind) { openRunTab(run, { title: script.split("/").pop(), kind, script, hosts: targets, auto: true }); }

const ST = { pending: ["", "ждёт"], running: ["run", "выполняется"], ok: ["ok", "успешно"], fail: ["err", "ошибка"], cancel: ["warn", "остановлено"] };

export function openRunTab(runId, o) {
  const tab = { type: "run", key: "run:" + runId, icon: I.play, title: o.title, run: runId };
  const hosts = new Map(o.hosts.map((h) => [h, { state: "pending", code: null, ms: 0, buf: [] }]));
  const combined = []; // для общего вида
  let current = "*";
  let finished = false;

  const el = h(`<div class="tabview">
    <div class="view-head">
      <div class="crumbs">${I.play}<b>${esc(o.title)}</b><span class="tag">${esc(KIND[o.kind]?.label || o.kind)}</span><span class="dim small" data-sum></span></div>
      <div class="spacer"></div>
      <button class="btn" data-stop>${I.stop}Остановить</button>
      ${o.req ? `<button class="btn" data-again>${I.refresh}Ещё раз</button>` : ""}
    </div>
    <div class="run-body">
      <div class="run-hosts"></div>
      <div class="term-host"></div>
    </div></div>`);
  tab.el = el;
  const list = el.querySelector(".run-hosts"), host = el.querySelector(".term-host");
  const xt = makeXterm({ cursorBlink: false, disableStdin: true, cursorStyle: "bar", cursorInactiveStyle: "none" });

  const renderHosts = () => {
    const vals = [...hosts.values()];
    const ok = vals.filter((x) => x.state === "ok").length, bad = vals.filter((x) => x.state === "fail").length;
    el.querySelector("[data-sum]").textContent = finished ? `· готово: ${ok} ок${bad ? `, ${bad} с ошибкой` : ""}` : `· выполняется… ${ok + bad}/${vals.length}`;
    el.querySelector("[data-stop]").hidden = finished;
    list.innerHTML = `
      <div class="rh${current === "*" ? " active" : ""}" data-h="*">${I.activity}<span class="name">${o.kind === "ansible" ? "Вывод ansible" : "Весь вывод"}</span></div>
      ${[...hosts].map(([n, x]) => `<div class="rh${current === n ? " active" : ""}" data-h="${esc(n)}">
        <span class="dot ${ST[x.state][0]}"></span><span class="name">${esc(n === "local" ? "этот ПК" : n)}</span>
        <span class="meta">${x.state === "running" ? "…" : x.state === "pending" ? "" : (x.code != null && x.code !== 0 ? "код " + x.code + " · " : "") + fmtDur(x.ms)}</span></div>`).join("")}`;
    list.querySelectorAll(o.kind === "ansible" ? '.rh[data-h="*"]' : ".rh").forEach((r) => (r.onclick = () => { current = r.dataset.h; redraw(); renderHosts(); }));
  };

  const redraw = () => {
    xt.term.reset();
    if (current === "*") combined.forEach((c) => xt.term.write(c));
    else hosts.get(current)?.buf.forEach((c) => xt.term.write(c));
  };

  const prefixColors = ["\x1b[36m", "\x1b[35m", "\x1b[34m", "\x1b[33m", "\x1b[32m"];
  const hostIdx = (n) => [...hosts.keys()].indexOf(n);
  tab.out = (hostName, data) => {
    const bytes = b64bytes(data);
    if (hostName && hosts.has(hostName)) hosts.get(hostName).buf.push(bytes);
    // в общем виде у bash-вывода префикс сервера
    if (hostName && hosts.size > 1) {
      const text = new TextDecoder().decode(bytes);
      const pre = `${prefixColors[hostIdx(hostName) % 5]}${hostName}\x1b[0m │ `;
      const chunk = text.replace(/\r\n(?!$)/g, "\r\n" + pre);
      const st = tab._lineStart?.[hostName] !== false ? pre : "";
      (tab._lineStart ??= {})[hostName] = text.endsWith("\n");
      combined.push(st + chunk);
      if (current === "*") xt.term.write(st + chunk);
    } else {
      combined.push(bytes);
      if (current === "*") xt.term.write(bytes);
    }
    if (current === hostName) xt.term.write(bytes);
  };
  tab.hostState = (n, state, code, ms) => {
    if (!hosts.has(n)) hosts.set(n, { state, code, ms, buf: [] });
    Object.assign(hosts.get(n), { state, code: state === "running" ? null : code, ms });
    renderHosts();
  };
  tab.done = () => {
    finished = true;
    renderHosts();
    runs.delete(runId);
    o.onDone?.();
    const bad = [...hosts.values()].filter((x) => x.state === "fail").length;
    if (!o.auto || bad) toast(bad ? `${I.warn} ${esc(o.title)}: ошибок — ${bad}` : `${I.check} ${esc(o.title)} — выполнено`, bad ? "err" : "");
  };

  el.querySelector("[data-stop]").onclick = () => api.CancelRun(runId);
  el.querySelector("[data-again]")?.addEventListener("click", async () => {
    try {
      const run = await api.RunScript(o.req);
      openRunTab(run, { ...o });
    } catch (e) { toast(esc(errText(e)), "err"); }
  });

  let opened = false;
  tab.onShow = () => {
    if (!opened) { opened = true; xt.term.open(host); clipboardKeys(xt.term, host); }
    requestAnimationFrame(() => { try { xt.fit.fit(); } catch {} });
  };
  new ResizeObserver(() => requestAnimationFrame(() => { if (el.offsetParent) try { xt.fit.fit(); } catch {} })).observe(host);
  tab.onClose = () => { if (!finished) api.CancelRun(runId); runs.delete(runId); xt.term.dispose(); };

  runs.set(runId, tab);
  renderHosts();
  app.addTab(tab);
  (early.get(runId) || []).forEach(([fn, args]) => tab[fn](...args));
  early.delete(runId);
}
