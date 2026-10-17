// Обзор лабы: машины, план (YAML → текущее состояние), применить / остановить / удалить.
import { api, errText } from "../api.js";
import { S, app } from "../core.js";
import { h, esc, I, toast, confirmBox } from "../ui.js";

const stateTxt = { running: "работает", stopped: "выключена", absent: "не создана", unknown: "?" };
const stateDot = { running: "ok", stopped: "warn", absent: "", unknown: "" };

export function labTab(id) {
  const tab = { type: "lab", key: "lab:" + id, lab: id, icon: I.layers, title: id };
  const el = h(`<div class="tabview"><div class="view-head"></div><div class="lab"></div></div>`);
  tab.el = el;
  const head = el.querySelector(".view-head"), body = el.querySelector(".lab");
  let plan = null, busy = false;

  async function refresh() {
    try { plan = await api.LabPlan(id); } catch (e) { plan = { error: errText(e), vms: [] }; }
    render();
  }

  function render() {
    const lab = S.snap.labs.find((l) => l.id === id);
    head.innerHTML = `<div class="crumbs">${I.layers}<span>labs</span>/<b>${esc(id)}</b></div><div class="spacer"></div>
      <button class="btn ghost" data-refresh title="Обновить">${I.refresh}</button>
      ${lab ? `<button class="btn" data-yaml>${I.file}YAML</button>` : ""}`;
    head.querySelector("[data-refresh]").onclick = refresh;
    head.querySelector("[data-yaml]")?.addEventListener("click", () => app.openFile(lab.file));
    if (!plan) { body.innerHTML = `<div class="pane-empty">Загрузка…</div>`; return; }
    const changes = plan.vms.filter((v) => v.action !== "none");
    const running = plan.vms.filter((v) => v.state === "running").length;
    body.innerHTML = `
      <div class="lab-top">
        <div><h2>${esc(id)}</h2><div class="sub">${esc(plan.provider || lab?.provider || "")} · шаблон ${esc(plan.template || "—")} · сеть ${esc(plan.network || "—")}</div></div>
        <div class="acts">
          <button class="btn" data-act="snapshot" ${running || plan.vms.some((v) => v.state === "stopped") ? "" : "disabled"}>${I.camera}Снапшот</button>
          <button class="btn" data-act="stop" ${running ? "" : "disabled"}>${I.stop}Выключить</button>
          <button class="btn danger" data-act="destroy" ${plan.vms.some((v) => v.state !== "absent" && v.state !== "unknown") ? "" : "disabled"}>${I.trash}Удалить</button>
          <button class="btn primary" data-act="apply" ${changes.length && !plan.error ? "" : "disabled"}>${I.play}Применить</button>
        </div>
      </div>
      ${plan.error ? `<div class="notice err">${I.warn}<div>${esc(plan.error)}<div class="small dim">Пути к VBoxManage / vmrun задаются в Настройках.</div></div></div>` : ""}
      <div class="vm-grid">${plan.vms.map((m) => `
        <div class="vm">
          <div class="vm-h"><span class="dot ${stateDot[m.state]}"></span><span class="name">${esc(m.host)}</span><span class="tag">${stateTxt[m.state] || m.state}</span></div>
          <div class="vm-spec"><span>${m.cpu} vCPU</span><span>${m.ram >= 1024 ? m.ram / 1024 + " GB" : m.ram + " MB"}</span><span class="dim">${esc(m.name)}</span></div>
          <div class="vm-ip">${esc(m.ip)}</div>
          <div class="vm-acts">
            <button class="icon-btn" title="Терминал" data-ssh="${esc(m.name)}" ${m.state === "running" ? "" : "disabled"}>${I.term}</button>
            <button class="icon-btn" title="Файлы" data-sftp="${esc(m.name)}" ${m.state === "running" ? "" : "disabled"}>${I.folder}</button>
            ${m.state === "running" ? `<button class="icon-btn" title="Выключить" data-vm="stop" data-name="${esc(m.name)}">${I.stop}</button>`
              : m.state === "stopped" ? `<button class="icon-btn" title="Запустить" data-vm="start" data-name="${esc(m.name)}">${I.play}</button>` : ""}
          </div>
        </div>`).join("")}
      </div>
      <div class="plan">
        <div class="plan-h">${I.activity}План: что изменится при «Применить»</div>
        <pre>${changes.length
          ? plan.vms.map((m) => m.action === "create" ? `<span class="add">+ создать    ${esc(m.name)}  (${m.cpu} vCPU, ${m.ram} MB, ${esc(m.ip)})</span>`
            : m.action === "start" ? `<span class="chg">~ запустить  ${esc(m.name)}</span>` : `<span class="dim">  без изменений ${esc(m.name)}</span>`).join("\n")
            + (plan.playbook ? `\n\n<span class="chg">→ затем дождаться SSH и выполнить ansible-playbook ${esc(plan.playbook)}</span>` : "")
            + `\n<span class="dim">→ машины появятся в «Серверах» в группе lab: ${esc(id)}</span>`
          : `<span class="dim">${plan.error ? "План недоступен." : "Всё совпадает с конфигом — изменений нет."}</span>`}</pre>
      </div>`;

    body.querySelectorAll("[data-act]").forEach((b) => (b.onclick = () => act(b.dataset.act)));
    body.querySelectorAll("[data-ssh]").forEach((b) => (b.onclick = () => app.openSSH(b.dataset.ssh)));
    body.querySelectorAll("[data-sftp]").forEach((b) => (b.onclick = () => app.openSftp(b.dataset.sftp)));
    body.querySelectorAll("[data-vm]").forEach((b) => (b.onclick = async () => {
      b.disabled = true;
      try { await api.VMAction(id, b.dataset.name, b.dataset.vm); } catch (e) { toast(esc(errText(e)), "err"); }
      refresh();
    }));
  }

  async function act(a) {
    if (busy) return;
    try {
      if (a === "destroy" && !(await confirmBox(`Удалить лабу ${id}?`, "Все машины лабы будут выключены и удалены вместе с дисками. Файлы серверов лабы тоже удалятся."))) return;
      const fn = { apply: api.LabApply, stop: api.LabStop, destroy: api.LabDestroy, snapshot: (x) => api.LabSnapshot(x, "snap-" + new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")) }[a];
      const job = await fn(id);
      busy = true;
      app.watchJob(job, () => { busy = false; refresh(); });
      toast(`${I.activity} Запущено — прогресс внизу`);
    } catch (e) { toast(esc(errText(e)), "err"); }
  }

  tab.onShow = () => refresh();
  tab.refresh = refresh;
  return tab;
}
