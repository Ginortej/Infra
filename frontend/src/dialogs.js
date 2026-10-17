// Диалоги: пароль, добавление/изменение сервера.
import { api, errText } from "./api.js";
import { S, app, serverById } from "./core.js";
import { h, esc, I, modal, toast, $ } from "./ui.js";

export function askPassword(serverId) {
  const s = serverById(serverId);
  const isKey = s?.auth === "key";
  return new Promise((resolve) => {
    let ok = false;
    const body = h(`<div class="form">
      <p class="muted">${isKey ? `Ключ <b>${esc(s.key)}</b> защищён паролем.` : `Пароль для <b>${esc(s?.user)}@${esc(s?.host)}</b>`}</p>
      <label class="field"><span>${isKey ? "Пароль ключа" : "Пароль"}</span><input type="password" name="pw" autocomplete="off"></label>
      <label class="check"><input type="checkbox" name="remember" checked> Сохранить в диспетчере учётных данных Windows</label>
    </div>`);
    modal({
      title: `Подключение · ${serverId}`, body, width: 420, onClose: () => resolve(ok),
      buttons: [{ label: "Отмена" }, { label: "Подключиться", primary: true, onClick: async () => {
        const pw = $("[name=pw]", body).value;
        if (!pw) return false;
        await api.SetPassword(serverId, pw, $("[name=remember]", body).checked);
        ok = true;
      } }],
    });
  });
}

// Форма сервера: создаёт YAML в servers/<группа>/<имя>.yaml
export function serverForm(existing) {
  const s = existing || { name: "", host: "", port: 22, user: "root", auth: "key", key: "~/.ssh/id_ed25519", group: "", vpn: "" };
  const groups = [...new Set(S.snap.servers.map((x) => x.group).filter((g) => !g.startsWith("lab:") && g !== "без группы"))];
  const body = h(`<div class="form grid2">
    <label class="field"><span>Имя</span><input name="name" value="${esc(s.name)}" placeholder="prod-web-01"></label>
    <label class="field"><span>Группа</span><input name="group" value="${esc(s.group === "без группы" ? "" : s.group)}" list="grp" placeholder="prod"><datalist id="grp">${groups.map((g) => `<option value="${esc(g)}">`).join("")}</datalist></label>
    <label class="field"><span>Адрес</span><input name="host" value="${esc(s.host)}" placeholder="10.0.5.12 или host.example.com"></label>
    <label class="field"><span>Порт</span><input name="port" type="number" value="${s.port || 22}"></label>
    <label class="field"><span>Пользователь</span><input name="user" value="${esc(s.user)}"></label>
    <label class="field"><span>Вход</span><select name="auth"><option value="key">По ключу</option><option value="password">По паролю</option></select></label>
    <label class="field span2 keyrow"><span>Приватный ключ</span><div class="path-input"><input name="key" value="${esc(s.key || "")}"><button class="btn" type="button" data-browse>${I.folderOpen}Обзор…</button></div></label>
    <label class="field span2"><span>Подключаться через VPN</span><select name="vpn"><option value="">Напрямую</option>${S.snap.vpns.map((v) => `<option ${v.id === s.vpn ? "selected" : ""}>${esc(v.id)}</option>`).join("")}</select></label>
    <p class="muted span2 small">Будет сохранено в <span class="mono" data-path></span>. Пароли сюда не пишутся — их спросят при подключении.</p>
  </div>`);
  const f = (n) => $(`[name=${n}]`, body);
  f("auth").value = s.auth || "key";
  const sync = () => {
    $(".keyrow", body).style.display = f("auth").value === "key" ? "" : "none";
    const g = f("group").value.trim();
    $("[data-path]", body).textContent = s.file || `servers/${g ? g + "/" : ""}${f("name").value.trim() || "имя"}.yaml`;
  };
  body.addEventListener("input", sync);
  f("auth").onchange = sync;
  $("[data-browse]", body).onclick = async () => {
    const p = await api.PickFile("Выбери приватный SSH-ключ", "");
    if (p) f("key").value = p;
  };
  sync();
  modal({
    title: existing ? `Сервер · ${s.name}` : "Новый сервер", body, width: 560,
    buttons: [{ label: "Отмена" }, { label: existing ? "Сохранить" : "Добавить", primary: true, onClick: async () => {
      const data = { ...s, name: f("name").value.trim(), host: f("host").value.trim(), port: +f("port").value || 22, user: f("user").value.trim(),
        auth: f("auth").value, key: f("auth").value === "key" ? f("key").value.trim() : "", group: f("group").value.trim(), vpn: f("vpn").value };
      if (!data.name || !data.host) { toast("Нужны имя и адрес", "err"); return false; }
      try {
        const rel = await api.SaveServer(data);
        await app.reload();
        toast(`${I.check} Сохранено: ${esc(rel)}`);
      } catch (e) { toast(esc(errText(e)), "err"); return false; }
    } }],
  });
}
