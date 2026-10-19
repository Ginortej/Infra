// Git: аккаунты GitHub/GitLab, список репозиториев и вкладка репозитория.
import { api, errText, win } from "../api.js";
import { S, app } from "../core.js";
import { h, esc, I, menu, modal, toast, confirmBox, store, $ } from "../ui.js";

export const G = { accounts: [], repos: [], info: null, loaded: false };

export async function loadGit() {
  const [acc, repos, info] = await Promise.all([api.GitAccounts(), api.GitRepos(), G.info ? G.info : api.GitInfo()]);
  G.accounts = acc || [];
  G.repos = repos || [];
  G.info = info;
  G.loaded = true;
}

const accById = (id) => G.accounts.find((a) => a.id === id);
// "https://git.x.ru/gitlab/-/profile" → "git.x.ru/gitlab"
export const normHost = (h) => (h || "").trim().replace(/^https?:?\/\//i, "").replace(/\/-\/.*$/, "").replace(/\/{2,}/g, "/").replace(/^\/+|\/+$/g, "");
const domainOf = (h) => (h || "").split("/")[0].toLowerCase();
const provIcon = (p) => (p === "gitlab" ? I.gitlab : I.github);
const shortPath = (p) => p.replace(/^([A-Za-z]:\\Users\\[^\\]+)/, "~");
const relTime = (t) => {
  const d = (Date.now() / 1000 - t) | 0;
  if (d < 60) return "только что";
  if (d < 3600) return `${(d / 60) | 0} мин назад`;
  if (d < 86400) return `${(d / 3600) | 0} ч назад`;
  if (d < 86400 * 30) return `${(d / 86400) | 0} дн назад`;
  return new Date(t * 1000).toLocaleDateString("ru-RU");
};

export function accountChipHtml(id) {
  const a = accById(id);
  if (!a) return `<span class="acc-chip none">${I.user}без аккаунта</span>`;
  return `<span class="acc-chip ${a.provider}">${provIcon(a.provider)}${esc(a.label || a.username)}</span>`;
}

// ---------- Быстрое переключение аккаунта (кнопка в статус-баре) ----------
export function gitStatusHtml(tab) {
  const inRepo = tab?.type === "git" && tab.isRepo;
  const id = inRepo ? tab.account : S.state?.settings?.gitDefault;
  const a = accById(id);
  const title = inRepo ? `Git-аккаунт репозитория ${tab.title}` : "Git-аккаунт по умолчанию (новые терминалы и репозитории без аккаунта)";
  return `<button class="sb git-sb" data-gitacc title="${esc(title)}">${a ? `<span class="prov ${a.provider}">${provIcon(a.provider)}</span>${esc(a.label || a.username)}` : `${I.branch}<span class="dim">git: нет аккаунта</span>`}</button>`;
}

export async function quickAccountMenu(anchor, tab) {
  if (!G.loaded) await loadGit();
  const inRepo = tab?.type === "git" && tab.isRepo;
  const cur = inRepo ? tab.account : S.state?.settings?.gitDefault;
  const setDefault = async (id) => {
    await api.GitSetDefault(id);
    S.state = await api.GetState();
    app.renderStatus();
    S.tabs.forEach((t) => t.type === "term" && t.renderHead?.());
    const a = accById(id);
    toast(a ? `${I.check} По умолчанию: <b>${esc(a.label)}</b>. Новые терминалы будут работать от него` : "Аккаунт по умолчанию снят");
  };
  const setRepo = async (id) => {
    await api.GitSetAccount(tab.repo, id);
    await loadGit(); app.renderSidebar();
    tab.refresh();
    const a = accById(id);
    toast(a ? `${I.check} ${esc(tab.title)} → <b>${esc(a.label)}</b>` : "Аккаунт репозитория снят");
  };
  const pick = inRepo ? setRepo : setDefault;
  menu(anchor, [
    { header: inRepo ? `Репозиторий ${tab.title}` : "Аккаунт по умолчанию" },
    ...G.accounts.map((a) => ({ icon: provIcon(a.provider), label: a.label || a.username, meta: `${a.username}@${a.host}`, checked: a.id === cur, onClick: () => pick(a.id) })),
    { icon: I.user, label: inRepo ? "Без аккаунта" : "Не использовать", checked: !cur, onClick: () => pick("") },
    { sep: true },
    ...(inRepo ? [{ icon: I.check, label: "Сделать его аккаунтом по умолчанию", disabled: !cur, onClick: () => setDefault(cur) }] : []),
    { icon: I.plus, label: "Добавить аккаунт…", onClick: () => accountForm() },
    { icon: I.branch, label: "Открыть раздел Git", onClick: () => app.showPanel("git") },
  ], { width: 320 });
}

// ---------- Боковая панель ----------
export function gitSideHtml(match, act) {
  if (!G.loaded) return `<div class="side-empty"><span class="spin"></span></div>`;
  let html = "";
  if (G.info && !G.info.path) html += `<div class="notice err small-notice">${I.warn}<div>Git не найден. Установи <b>Git for Windows</b> и перезапусти Infra.</div></div>`;
  const accs = G.accounts.filter((a) => match(a.label + a.username + a.host));
  html += `<div class="group" data-group="git-acc"><div class="group-label">${I.chev}<span>Аккаунты</span><span class="cnt">${G.accounts.length}</span></div><div class="group-items">
    ${accs.map((a) => `<div class="item acc-item" data-acc="${esc(a.id)}" title="${esc(a.username + "@" + a.host)}">
      <span class="prov ${a.provider}">${provIcon(a.provider)}</span><span class="name">${esc(a.label || a.username)}</span>
      <span class="meta">${a.gitAuth === "ssh" ? "ssh" : a.hasToken ? "token" : "—"}</span>
      <span class="hover-acts"><button class="icon-btn" data-acc-edit="${esc(a.id)}" title="Изменить">${I.gear}</button></span></div>`).join("")
      || `<div class="side-empty small">GitHub, GitLab или свой GitLab<br><button class="btn small" data-acc-add>${I.plus}Добавить аккаунт</button></div>`}
  </div></div>`;
  const repos = G.repos.filter((r) => match(r.name + r.path + r.remote));
  html += `<div class="group" data-group="git-repos"><div class="group-label">${I.chev}<span>Репозитории</span><span class="cnt">${G.repos.length}</span></div><div class="group-items">
    ${repos.map((r) => {
      const a = accById(r.account);
      return `<div class="item repo-item${act?.repo === r.path ? " active" : ""}" data-repo="${esc(r.path)}" title="${esc(r.path)}">
        ${I.branch}<div class="repo-txt"><div class="name">${esc(r.name)}${r.vault ? ` <span class="tag">хранилище</span>` : ""}</div>
        <div class="sub mono">${r.error ? `<span class="err-t">${esc(r.error)}</span>` : !r.isRepo ? "не git-репозиторий" : `${esc(r.branch || "")}${r.changes ? ` · ${r.changes} изм.` : ""}${r.ahead ? ` · ↑${r.ahead}` : ""}${r.behind ? ` · ↓${r.behind}` : ""}`}</div></div>
        ${a ? `<span class="prov ${a.provider}" title="${esc(a.label)}">${provIcon(a.provider)}</span>` : ""}
      </div>`;
    }).join("") || `<div class="side-empty small">Папка, клон или новый репозиторий<br><button class="btn small" data-repo-add>${I.plus}Добавить репозиторий</button></div>`}
  </div></div>`;
  return html;
}

export function gitSideClick(e, anchorForAdd) {
  const t = (s) => e.target.closest(s);
  let x;
  if ((x = t("[data-acc-edit]"))) { accountForm(accById(x.dataset.accEdit)); return true; }
  if ((x = t("[data-acc-add]"))) { accountForm(); return true; }
  if ((x = t("[data-acc]"))) { accountMenu(x, accById(x.dataset.acc)); return true; }
  if ((x = t("[data-repo-add]"))) { addRepoMenu(x); return true; }
  if ((x = t("[data-repo]"))) { app.addTab(gitTab(x.dataset.repo)); return true; }
  return false;
}

function accountMenu(anchor, a) {
  if (!a) return;
  const links = () => api.GitLinks(a);
  menu(anchor, [
    { header: `${a.username || a.label} @ ${a.host}` },
    { icon: I.gear, label: "Изменить…", onClick: () => accountForm(a) },
    { icon: I.ext, label: "Открыть профиль", onClick: () => win.openURL(`https://${a.host}/${a.username}`) },
    ...(a.hasToken ? [{ icon: I.download, label: "Клонировать репозиторий…", onClick: () => cloneDialog(a.id) }] : []),
    { icon: I.key, label: a.gitAuth === "ssh" ? "Страница SSH-ключей" : "Создать новый токен", onClick: async () => { const l = await links(); win.openURL(a.gitAuth === "ssh" ? l.keys : l.token); } },
    { sep: true },
    { icon: I.trash, label: "Удалить аккаунт", onClick: async () => {
      if (!(await confirmBox(`Удалить аккаунт ${esc(a.label)}?`, "Токен будет удалён из диспетчера учётных данных. SSH-ключ на диске останется."))) return;
      await api.GitDeleteAccount(a.id); await loadGit(); app.renderSidebar();
    } },
  ], { align: "right", width: 260 });
}

export function addRepoMenu(anchor) {
  menu(anchor, [
    { icon: I.folderOpen, label: "Добавить папку с репозиторием…", onClick: async () => {
      const p = await api.PickFolder("Папка с git-репозиторием", "");
      if (!p) return;
      try { await api.GitAddRepo(p); await loadGit(); app.renderSidebar(); app.addTab(gitTab(p)); } catch (e) { toast(esc(errText(e)), "err"); }
    } },
    { icon: I.download, label: "Клонировать…", onClick: () => cloneDialog() },
    { icon: I.plus, label: "Новый репозиторий в папке…", onClick: async () => {
      const p = await api.PickFolder("Папка для нового репозитория", "");
      if (!p) return;
      try { await api.GitInit(p); await loadGit(); app.renderSidebar(); app.addTab(gitTab(p)); } catch (e) { toast(esc(errText(e)), "err"); }
    } },
  ], { width: 280 });
}

// ---------- Диалог аккаунта ----------
export function accountForm(existing) {
  const a = existing ? { ...existing } : { provider: "github", host: "", label: "", username: "", name: "", email: "", gitAuth: "token", sshKey: "" };
  const custom = a.host && a.host !== "github.com" && a.host !== "gitlab.com";
  const body = h(`<div class="form acc-form">
    <div class="prov-pick">
      <button type="button" data-p="github" class="${a.provider === "github" && !custom ? "on" : ""}">${I.github}GitHub</button>
      <button type="button" data-p="gitlab" class="${a.provider === "gitlab" && !custom ? "on" : ""}">${I.gitlab}GitLab</button>
      <button type="button" data-p="gitlab-self" class="${custom ? "on" : ""}">${I.gitlab}Свой GitLab</button>
    </div>
    <label class="field host-row" ${custom ? "" : "hidden"}><span>Адрес сервера <span class="dim small">· как в браузере, можно с подпапкой</span></span><input name="host" value="${esc(custom ? a.host : "")}" placeholder="git.company.ru  или  company.ru/gitlab"></label>
    <div class="grid2 form">
      <label class="field"><span>Название</span><input name="label" value="${esc(a.label)}" placeholder="Работа / Личный"></label>
      <label class="field"><span>Вход в git</span>
        <div class="seg wide"><button type="button" data-auth="token" class="${a.gitAuth !== "ssh" ? "on" : ""}">Токен (HTTPS)</button><button type="button" data-auth="ssh" class="${a.gitAuth === "ssh" ? "on" : ""}">SSH-ключ</button></div></label>
    </div>
    <div class="field">
      <span>Токен доступа ${a.hasToken ? `<span class="ok-t small">${I.check} сохранён</span>` : ""} <span class="dim small">· нужен для API: проверка, список репо, создание репо${a.gitAuth === "ssh" ? " (для SSH — по желанию)" : ""}</span></span>
      <div class="path-input"><input name="token" type="password" placeholder="${a.hasToken ? "оставь пустым, чтобы не менять" : "ghp_… / glpat-…"}" autocomplete="off">
      <button type="button" class="btn" data-mktoken>${I.ext}Создать токен</button><button type="button" class="btn" data-verify>${I.check}Проверить</button></div>
    </div>
    <div class="field ssh-row" ${a.gitAuth === "ssh" ? "" : "hidden"}>
      <span>SSH-ключ (приватный)</span>
      <div class="path-input"><input name="sshKey" value="${esc(a.sshKey)}" placeholder="C:\\Users\\…\\.ssh\\id_ed25519">
      <button type="button" class="btn" data-browse>${I.folderOpen}Обзор…</button><button type="button" class="btn" data-genkey>${I.key}Создать ключ</button></div>
      <div class="pubkey" hidden><div class="dim small">Публичный ключ — добавь его на сайте:</div><pre class="mono"></pre>
        <div class="row-btns"><button type="button" class="btn small" data-copypub>${I.copy}Копировать</button><button type="button" class="btn small" data-openkeys>${I.ext}Открыть страницу ключей</button><button type="button" class="btn small" data-upload>${I.upload}Добавить через API</button><button type="button" class="btn small" data-testssh>${I.check}Проверить вход</button></div></div>
    </div>
    <div class="sec-h">Автор коммитов</div>
    <div class="grid2 form">
      <label class="field"><span>Логин</span><input name="username" value="${esc(a.username)}"></label>
      <label class="field"><span>Имя</span><input name="name" value="${esc(a.name)}"></label>
      <label class="field span2"><span>Почта</span><input name="email" value="${esc(a.email)}" placeholder="заполнится после «Проверить»"></label>
    </div>
    <div class="verify-res small"></div>
  </div>`);
  const f = (n) => body.querySelector(`[name=${n}]`);
  const res = body.querySelector(".verify-res");
  const cur = () => {
    const pb = body.querySelector(".prov-pick .on")?.dataset.p || "github";
    return {
      ...a, provider: pb === "github" ? "github" : "gitlab",
      host: pb === "gitlab-self" ? normHost(f("host").value) : pb === "github" ? "github.com" : "gitlab.com",
      label: f("label").value.trim(), username: f("username").value.trim(), name: f("name").value.trim(), email: f("email").value.trim(),
      gitAuth: body.querySelector("[data-auth].on").dataset.auth, sshKey: f("sshKey").value.trim(),
    };
  };
  const showPub = async () => {
    const k = f("sshKey").value.trim();
    const box = body.querySelector(".pubkey");
    if (!k) return (box.hidden = true);
    try { box.querySelector("pre").textContent = await api.GitPublicKey(k); box.hidden = false; } catch { box.hidden = true; }
  };
  body.addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.p) {
      body.querySelectorAll("[data-p]").forEach((x) => x.classList.toggle("on", x === b));
      body.querySelector(".host-row").hidden = b.dataset.p !== "gitlab-self";
    }
    if (b.dataset.auth) {
      body.querySelectorAll("[data-auth]").forEach((x) => x.classList.toggle("on", x === b));
      body.querySelector(".ssh-row").hidden = b.dataset.auth !== "ssh";
      if (b.dataset.auth === "ssh") showPub();
    }
    if (b.dataset.mktoken !== undefined) win.openURL((await api.GitLinks(cur())).token);
    if (b.dataset.openkeys !== undefined) win.openURL((await api.GitLinks(cur())).keys);
    if (b.dataset.browse !== undefined) { const p = await api.PickFile("Приватный SSH-ключ", ""); if (p) { f("sshKey").value = p.replace(/\.pub$/, ""); showPub(); } }
    if (b.dataset.genkey !== undefined) {
      const c = cur();
      try {
        const k = await api.GitGenerateKey(`${c.provider}-${c.label || c.username || "key"}`, `${c.email || c.username || "infra"}`);
        f("sshKey").value = k.path; await showPub();
        toast(`${I.key} Ключ создан: ${esc(k.path)}`);
      } catch (err) { toast(esc(errText(err)), "err"); }
    }
    if (b.dataset.copypub !== undefined) { navigator.clipboard.writeText(body.querySelector(".pubkey pre").textContent); toast(`${I.copy} Публичный ключ скопирован`); }
    if (b.dataset.upload !== undefined) {
      if (!a.id) return toast("Сначала сохрани аккаунт с токеном", "err");
      try { await api.GitSaveAccount(cur(), f("token").value.trim()); await api.GitUploadKey(a.id); toast(`${I.check} Ключ добавлен в аккаунт`); } catch (err) { toast(esc(errText(err)), "err"); }
    }
    if (b.dataset.testssh !== undefined) {
      res.innerHTML = `<span class="spin"></span> проверяю SSH…`;
      try { const m = await api.GitTestSSH(cur()); res.innerHTML = `<span class="ok-t">${I.check} ${esc(m)}</span>`; } catch (err) { res.innerHTML = `<span class="err-t">${I.warn} ${esc(errText(err))}</span>`; }
    }
    if (b.dataset.verify !== undefined) {
      res.innerHTML = `<span class="spin"></span> проверяю токен…`;
      try {
        const p = await api.GitVerify(cur(), f("token").value.trim());
        if (!f("username").value) f("username").value = p.username;
        if (!f("name").value) f("name").value = p.name;
        if (!f("email").value) f("email").value = p.email;
        if (!f("label").value) f("label").value = p.username;
        res.innerHTML = `<span class="ok-t">${I.check} Вход выполнен: <b>${esc(p.username)}</b> (${esc(p.name)})</span>`;
      } catch (err) { res.innerHTML = `<span class="err-t">${I.warn} ${esc(errText(err))}</span>`; }
    }
  });
  if (a.gitAuth === "ssh") showPub();
  modal({
    title: existing ? `Аккаунт · ${a.label || a.username}` : "Новый git-аккаунт", body, width: 620,
    buttons: [{ label: "Отмена" }, { label: existing ? "Сохранить" : "Добавить", primary: true, onClick: async () => {
      const c = cur();
      if (c.provider === "gitlab" && !c.host) { toast("Укажи адрес своего GitLab", "err"); return false; }
      if (c.gitAuth === "ssh" && !c.sshKey) { toast("Укажи или создай SSH-ключ", "err"); return false; }
      if (c.gitAuth === "token" && !f("token").value.trim() && !a.hasToken) { toast("Вставь токен доступа", "err"); return false; }
      if (!c.label) c.label = c.username || c.host;
      try {
        await api.GitSaveAccount(c, f("token").value.trim());
        await loadGit(); app.renderSidebar();
        toast(`${I.check} Аккаунт сохранён`);
        S.tabs.forEach((t) => t.type === "git" && t.refresh?.());
      } catch (err) { toast(esc(errText(err)), "err"); return false; }
    } }],
  });
}

// ---------- Клонирование ----------
export function cloneDialog(accountId) {
  const accs = G.accounts;
  let list = [];
  const body = h(`<div class="form">
    <label class="field"><span>Аккаунт</span><select name="acc"><option value="">— без аккаунта (публичный репозиторий) —</option>
      ${accs.map((a) => `<option value="${esc(a.id)}" ${a.id === (accountId || accs[0]?.id) ? "selected" : ""}>${esc(a.label)} · ${esc(a.username)}@${esc(a.host)}</option>`).join("")}</select></label>
    <div class="clone-list"></div>
    <label class="field"><span>Адрес репозитория</span><input name="url" placeholder="https://github.com/owner/repo.git или git@…"></label>
    <label class="field"><span>Куда</span><div class="path-input"><input name="dir" value="${esc(store.get("git.cloneDir", ""))}" placeholder="C:\\Users\\…\\Projects"><button type="button" class="btn" data-browse>${I.folderOpen}Обзор…</button></div></label>
  </div>`);
  const f = (n) => body.querySelector(`[name=${n}]`);
  const box = body.querySelector(".clone-list");
  const loadList = async () => {
    const id = f("acc").value;
    const a = accById(id);
    if (!a || !a.hasToken) { box.innerHTML = a ? `<div class="dim small">У аккаунта нет токена — вставь адрес вручную.</div>` : ""; return; }
    box.innerHTML = `<div class="dim small"><span class="spin"></span> загружаю репозитории…</div>`;
    try {
      list = await api.GitListRemote(id);
      const draw = (q = "") => {
        const items = list.filter((r) => r.fullName.toLowerCase().includes(q.toLowerCase())).slice(0, 80);
        box.querySelector(".cl-items").innerHTML = items.map((r) => `<div class="cl-item" data-url="${esc(a.gitAuth === "ssh" ? r.ssh : r.https)}">
          ${provIcon(a.provider)}<b>${esc(r.fullName)}</b>${r.private ? `<span class="tag">private</span>` : ""}<span class="dim small">${esc(r.desc || "")}</span></div>`).join("") || `<div class="dim small pad">Ничего не найдено</div>`;
      };
      box.innerHTML = `<div class="side-filter in-dlg">${I.search}<input placeholder="Поиск по ${list.length} репозиториям"></div><div class="cl-items"></div>`;
      box.querySelector("input").oninput = (e) => draw(e.target.value);
      draw();
    } catch (e) { box.innerHTML = `<div class="err-t small">${esc(errText(e))}</div>`; }
  };
  box.addEventListener("click", (e) => {
    const it = e.target.closest("[data-url]");
    if (!it) return;
    box.querySelectorAll(".cl-item").forEach((x) => x.classList.toggle("on", x === it));
    f("url").value = it.dataset.url;
  });
  f("acc").onchange = loadList;
  body.querySelector("[data-browse]").onclick = async () => { const p = await api.PickFolder("Куда клонировать", f("dir").value); if (p) f("dir").value = p; };
  loadList();
  modal({
    title: "Клонировать репозиторий", body, width: 620,
    buttons: [{ label: "Отмена" }, { label: "Клонировать", primary: true, onClick: async () => {
      const url = f("url").value.trim(), dir = f("dir").value.trim();
      if (!url || !dir) { toast("Укажи адрес и папку", "err"); return false; }
      store.set("git.cloneDir", dir);
      try {
        const job = await api.GitClone(f("acc").value, url, dir, "");
        app.watchJob(job, async () => { await loadGit(); app.renderSidebar(); });
        toast(`${I.download} Клонирую — прогресс внизу`);
      } catch (e) { toast(esc(errText(e)), "err"); return false; }
    } }],
  });
}

// ---------- Создание репозитория на сайте ----------
function createRemoteDialog(path, st, onDone) {
  const withToken = G.accounts.filter((a) => a.hasToken);
  if (!withToken.length) { toast("Нужен аккаунт с токеном — добавь его на панели Git", "err"); return accountForm(); }
  const name = path.split(/[\\/]/).pop();
  const body = h(`<div class="form">
    <label class="field"><span>Где создать</span><select name="acc">${withToken.map((a) => `<option value="${esc(a.id)}" ${a.id === st.account ? "selected" : ""}>${esc(a.label)} · ${esc(a.username)}@${esc(a.host)}</option>`).join("")}</select></label>
    <label class="field"><span>Имя репозитория</span><input name="name" value="${esc(name)}"></label>
    <label class="field"><span>Описание</span><input name="desc" placeholder="необязательно"></label>
    <label class="check"><input type="checkbox" name="private" checked> Приватный</label>
    <p class="dim small">Будет создан пустой репозиторий, прописан как <span class="mono">origin</span>, и текущая ветка опубликуется${st.empty ? " (после первого коммита)" : ""}.</p>
  </div>`);
  const f = (n) => body.querySelector(`[name=${n}]`);
  modal({
    title: "Создать репозиторий на GitHub / GitLab", body, width: 520,
    buttons: [{ label: "Отмена" }, { label: "Создать", primary: true, onClick: async () => {
      try {
        const job = await api.GitCreateRemote(path, f("acc").value, f("name").value.trim(), f("desc").value.trim(), f("private").checked);
        app.watchJob(job, onDone);
      } catch (e) { toast(esc(errText(e)), "err"); return false; }
    } }],
  });
}

// ---------- Вкладка репозитория ----------
const STAT = { M: ["M", "mod", "изменён"], A: ["A", "add", "добавлен"], D: ["D", "del", "удалён"], R: ["R", "ren", "переименован"], C: ["C", "ren", "скопирован"], U: ["U", "conf", "конфликт"], T: ["T", "mod", "тип изменён"], "?": ["U", "add", "новый"] };

export function gitTab(path) {
  const name = path.split(/[\\/]/).pop();
  const tab = { type: "git", key: "git:" + path, repo: path, icon: I.branch, title: name };
  const el = h(`<div class="tabview git-view"><div class="view-head git-head"></div><div class="git-banner"></div>
    <div class="git-body"><div class="git-left"></div><div class="git-right"><div class="diff-head"></div><div class="diff"></div></div></div></div>`);
  tab.el = el;
  const head = el.querySelector(".git-head"), banner = el.querySelector(".git-banner"), left = el.querySelector(".git-left");
  const dHead = el.querySelector(".diff-head"), dBody = el.querySelector(".diff");
  let st = null, mode = "changes", sel = null, log = null, busy = false;

  async function refresh() {
    try { st = await api.GitStatus(path); } catch (e) { st = { error: errText(e) }; }
    if (!G.loaded) await loadGit();
    tab.account = st?.account || "";
    tab.isRepo = !!st?.isRepo;
    if (S.active === tab.id) app.renderStatus();
    renderHead(); renderBanner(); renderLeft();
    if (sel?.file && !st.files?.some((f) => f.path === sel.file)) { sel = null; renderDiff(); }
    if (!sel) renderDiff();
    if (mode === "history") loadLog();
  }
  tab.refresh = refresh;

  function renderHead() {
    if (!st?.isRepo) { head.innerHTML = `<div class="crumbs">${I.branch}<b>${esc(name)}</b><span class="dim mono">${esc(shortPath(path))}</span></div>`; return; }
    const origin = st.remotes?.find((r) => r.name === "origin") || st.remotes?.[0];
    const acc = accById(st.account);
    const mismatch = acc && origin && origin.host && domainOf(acc.host) !== origin.host;
    head.innerHTML = `
      <div class="crumbs">${I.branch}<b>${esc(name)}</b><span class="dim mono" title="${esc(path)}">${esc(shortPath(path))}</span></div>
      <div class="spacer"></div>
      <button class="chip" data-h="acc" title="От чьего имени коммиты и push">${accountChipHtml(st.account)}${mismatch ? `<span class="warn-t" title="Аккаунт для ${esc(acc.host)}, а remote на ${esc(origin.host)}">${I.warn}</span>` : ""} ${I.chev}</button>
      <button class="chip" data-h="branch">${I.branch}${esc(st.detached ? "detached" : st.branch || "—")} ${I.chev}</button>
      <button class="chip" data-h="remote" title="${esc(origin?.url || "")}">${origin ? `${provIcon(origin.host.includes("gitlab") ? "gitlab" : "github")}${esc(origin.path)}` : `<span class="warn-t">нет remote</span>`} ${I.chev}</button>
      <span class="head-sep"></span>
      <button class="icon-btn" data-h="fetch" title="Fetch — обновить сведения с сервера">${I.refresh}</button>
      <button class="btn small" data-h="pull" ${origin ? "" : "disabled"} title="Забрать изменения">${I.download}Pull${st.behind ? ` <b>${st.behind}</b>` : ""}</button>
      <button class="btn small ${st.ahead || (!st.upstream && !st.empty && origin) ? "primary" : ""}" data-h="push" ${origin && !st.empty ? "" : "disabled"}>${I.upload}${st.upstream ? `Push${st.ahead ? ` <b>${st.ahead}</b>` : ""}` : "Опубликовать"}</button>
      <button class="icon-btn" data-h="more" title="Ещё">${I.dots}</button>`;
    head.querySelectorAll("[data-h]").forEach((b) => (b.onclick = () => headAction(b.dataset.h, b)));
  }

  function renderBanner() {
    let html = "";
    if (st?.error) html = `<div class="notice err">${I.warn}<div>${esc(st.error)}</div></div>`;
    else if (st && !st.isRepo) html = `<div class="git-empty">${I.branch}<h3>Это не git-репозиторий</h3><p class="dim">${esc(path)}</p><button class="btn primary" data-b="init">${I.plus}Инициализировать репозиторий</button></div>`;
    else if (st && !st.remotes?.length) html = `<div class="notice info">${I.info}<div>У репозитория нет удалённого адреса. <button class="link" data-b="create">Создать репозиторий на GitHub / GitLab</button> или <button class="link" data-b="seturl">указать адрес</button>.</div></div>`;
    else if (st && !st.account) html = `<div class="notice info">${I.user}<div>Аккаунт не выбран — git возьмёт системные настройки. <button class="link" data-b="acc">Выбрать аккаунт</button></div></div>`;
    banner.innerHTML = html;
    banner.hidden = !html;
    el.classList.toggle("not-repo", !!st && !st.isRepo);
    banner.querySelectorAll("[data-b]").forEach((b) => (b.onclick = () => {
      const a = b.dataset.b;
      if (a === "init") api.GitInit(path).then(async () => { await loadGit(); app.renderSidebar(); refresh(); }).catch((e) => toast(esc(errText(e)), "err"));
      if (a === "create") createRemoteDialog(path, st, refresh);
      if (a === "seturl") setUrl();
      if (a === "acc") headAction("acc", head.querySelector('[data-h="acc"]') || b);
    }));
  }

  async function setUrl() {
    const cur = st.remotes?.find((r) => r.name === "origin")?.url || "";
    const u = prompt("Адрес репозитория (origin)", cur);
    if (!u || u === cur) return;
    try { await api.GitSetRemote(path, u); refresh(); } catch (e) { toast(esc(errText(e)), "err"); }
  }

  async function headAction(a, anchor) {
    if (a === "acc") {
      return menu(anchor, [
        { header: "Коммиты и push от имени" },
        ...G.accounts.map((x) => ({ icon: provIcon(x.provider), label: x.label || x.username, meta: `${x.username}@${x.host}`, checked: x.id === st.account, onClick: async () => {
          try { await api.GitSetAccount(path, x.id); toast(`${I.check} Репозиторий теперь работает от ${esc(x.label)}`); await loadGit(); app.renderSidebar(); refresh(); } catch (e) { toast(esc(errText(e)), "err"); }
        } })),
        { icon: I.user, label: "Без аккаунта (системный git)", checked: !st.account, onClick: async () => { await api.GitSetAccount(path, ""); refresh(); } },
        { sep: true }, { icon: I.plus, label: "Добавить аккаунт…", onClick: () => accountForm() },
      ], { align: "right", width: 300 });
    }
    if (a === "branch") {
      let br = [];
      try { br = (await api.GitBranches(path)) || []; } catch (e) { return toast(esc(errText(e)), "err"); }
      const local = br.filter((b) => !b.remote), localNames = new Set(local.map((b) => b.name));
      const remote = br.filter((b) => b.remote && !localNames.has(b.name.replace(/^[^/]+\//, "")));
      return menu(anchor, [
        { header: "Локальные ветки" },
        ...local.map((b) => ({ icon: I.branch, label: b.name, meta: b.upstream || "", checked: b.current, onClick: () => b.current || checkout(b.name, false) })),
        ...(remote.length ? [{ sep: true }, { header: "Только на сервере" }, ...remote.map((b) => ({ icon: I.download, label: b.name, onClick: () => checkout(b.name, true) }))] : []),
        { sep: true },
        { icon: I.plus, label: "Новая ветка…", onClick: async () => {
          const n = prompt("Имя новой ветки (от текущей)");
          if (n) { try { await api.GitCreateBranch(path, n.trim()); refresh(); } catch (e) { toast(esc(errText(e)), "err"); } }
        } },
      ], { align: "right", width: 280 });
    }
    if (a === "remote") {
      const origin = st.remotes?.find((r) => r.name === "origin") || st.remotes?.[0];
      return menu(anchor, [
        ...(origin ? [{ header: origin.url }, { icon: I.ext, label: "Открыть на сайте", onClick: () => win.openURL(origin.web) },
          { icon: I.copy, label: "Скопировать адрес", onClick: () => { navigator.clipboard.writeText(origin.url); toast(`${I.copy} Скопировано`); } }] : []),
        { icon: I.gear, label: origin ? "Изменить адрес origin…" : "Указать адрес…", onClick: setUrl },
        { icon: I.plus, label: "Создать репозиторий на GitHub / GitLab…", onClick: () => createRemoteDialog(path, st, refresh) },
      ], { align: "right", width: 320 });
    }
    if (a === "fetch") return run(api.GitFetch(path));
    if (a === "pull") return run(api.GitPull(path, false));
    if (a === "push") return run(api.GitPush(path, false));
    if (a === "more") {
      return menu(anchor, [
        { icon: I.download, label: "Pull с rebase", onClick: () => run(api.GitPull(path, true)) },
        { icon: I.upload, label: "Force push (with lease)", onClick: async () => { if (await confirmBox("Force push?", "Перезапишет ветку на сервере вашей версией (с проверкой, что там никто ничего не добавил).", "Отправить")) run(api.GitPush(path, true)); } },
        { sep: true },
        { icon: I.term, label: "Открыть терминал здесь", onClick: () => app.newTerminalAt?.(path) },
        { icon: I.folder, label: "Показать в проводнике", onClick: () => api.Reveal(path) },
        { icon: I.x, label: "Убрать из списка", onClick: async () => { await api.GitRemoveRepo(path); await loadGit(); app.renderSidebar(); app.closeTab(tab.id); } },
      ], { align: "right", width: 260 });
    }
  }

  async function run(p) {
    if (busy) return;
    try {
      const job = await p;
      busy = true;
      el.classList.add("busy");
      app.watchJob(job, () => { busy = false; el.classList.remove("busy"); refresh(); loadGit().then(() => app.renderSidebar()); });
    } catch (e) { toast(`${I.warn} ${esc(errText(e))}`, "err"); }
  }

  async function checkout(name, remote) {
    try { await api.GitCheckout(path, name, remote); toast(`${I.branch} Ветка ${esc(name)}`); refresh(); loadGit().then(() => app.renderSidebar()); } catch (e) { toast(esc(errText(e)), "err"); }
  }

  // ---------- левая колонка ----------
  function renderLeft() {
    if (!st?.isRepo) { left.innerHTML = ""; return; }
    const staged = st.files.filter((f) => f.index && !f.conflict);
    const unstaged = st.files.filter((f) => f.work || f.untracked || f.conflict);
    const draft = store.get("git.msg." + path, "");
    left.innerHTML = `
      <div class="git-tabs seg wide"><button data-m="changes" class="${mode === "changes" ? "on" : ""}">Изменения${st.files.length ? ` · ${st.files.length}` : ""}</button><button data-m="history" class="${mode === "history" ? "on" : ""}">История</button></div>
      ${mode === "changes" ? `
        <div class="commit-box">
          <textarea placeholder="Сообщение коммита (Ctrl+Enter)${staged.length ? "" : "\nНичего не отмечено — закоммитятся все изменения"}" spellcheck="false">${esc(draft)}</textarea>
          <div class="commit-row">
            <button class="btn primary" data-c="commit" ${st.files.length ? "" : "disabled"}>${I.check}Коммит${staged.length ? ` (${staged.length})` : st.files.length ? " всех" : ""}</button>
            <button class="btn" data-c="commitpush" ${st.files.length && st.remotes?.length ? "" : "disabled"} title="Коммит и сразу Push">${I.upload}и Push</button>
            <button class="icon-btn" data-c="menu" title="Ещё">${I.chev}</button>
          </div>
          <div class="commit-as dim small">от ${accById(st.account) ? `<b>${esc(accById(st.account).name || accById(st.account).username)}</b> &lt;${esc(accById(st.account).email || "")}&gt;` : "системного git"}</div>
        </div>
        <div class="changes">
          ${section("Подготовлено", staged, true)}
          ${section("Изменения", unstaged, false)}
          ${!st.files.length ? `<div class="git-clean">${I.check}<div>Рабочая папка чистая</div><div class="dim small">${st.ahead ? `${st.ahead} коммит(ов) ждут Push` : st.behind ? `${st.behind} коммит(ов) на сервере — сделай Pull` : st.upstream ? "Всё синхронизировано с " + esc(st.upstream) : ""}</div></div>` : ""}
        </div>` : `<div class="history"><div class="dim small pad"><span class="spin"></span></div></div>`}`;
    left.querySelectorAll("[data-m]").forEach((b) => (b.onclick = () => { mode = b.dataset.m; sel = null; renderLeft(); renderDiff(); if (mode === "history") loadLog(); }));
    const ta = left.querySelector("textarea");
    if (ta) {
      ta.oninput = () => store.set("git.msg." + path, ta.value);
      ta.onkeydown = (e) => { if (e.ctrlKey && e.key === "Enter") { e.preventDefault(); commit(false); } };
    }
    left.querySelectorAll("[data-c]").forEach((b) => (b.onclick = () => {
      if (b.dataset.c === "commit") commit(false);
      if (b.dataset.c === "commitpush") commit(true);
      if (b.dataset.c === "menu") menu(b, [
        { icon: I.undo, label: "Изменить последний коммит (amend)", onClick: () => commit(false, true) },
        { icon: I.plus, label: "Подготовить всё", onClick: () => act(api.GitStage(path, [])) },
        { icon: I.minus, label: "Снять всё с подготовки", onClick: () => act(api.GitUnstage(path, [])) },
      ], { width: 280 });
    }));
    left.querySelectorAll(".fsec-act").forEach((b) => (b.onclick = (e) => {
      e.stopPropagation();
      const list = b.dataset.staged === "1" ? staged : unstaged;
      if (b.dataset.a === "stage") act(api.GitStage(path, list.map((f) => f.path)));
      if (b.dataset.a === "unstage") act(api.GitUnstage(path, list.map((f) => f.path)));
      if (b.dataset.a === "discard") discard(list);
    }));
    left.querySelectorAll(".frow2").forEach((r) => {
      const f = st.files.find((x) => x.path === r.dataset.f);
      const isStaged = r.dataset.s === "1";
      r.onclick = (e) => {
        const b = e.target.closest("[data-fa]");
        if (b) {
          e.stopPropagation();
          if (b.dataset.fa === "stage") act(api.GitStage(path, [f.path]));
          if (b.dataset.fa === "unstage") act(api.GitUnstage(path, [f.path]));
          if (b.dataset.fa === "discard") discard([f]);
          return;
        }
        sel = { file: f.path, staged: isStaged, untracked: f.untracked };
        left.querySelectorAll(".frow2").forEach((x) => x.classList.toggle("sel", x === r));
        renderDiff();
      };
      r.ondblclick = () => (isStaged ? act(api.GitUnstage(path, [f.path])) : act(api.GitStage(path, [f.path])));
    });
  }

  function section(title, files, staged) {
    if (!files.length) return "";
    return `<div class="fsec"><div class="fsec-h"><span>${title}</span><span class="cnt">${files.length}</span><span class="spacer"></span>
      ${staged ? `<button class="icon-btn fsec-act" data-staged="1" data-a="unstage" title="Снять всё">${I.minus}</button>`
        : `<button class="icon-btn fsec-act" data-staged="0" data-a="discard" title="Отменить все изменения">${I.undo}</button><button class="icon-btn fsec-act" data-staged="0" data-a="stage" title="Подготовить всё">${I.plus}</button>`}</div>
      ${files.map((f) => {
        const code = staged ? f.index : f.conflict ? "U" : f.untracked ? "?" : f.work;
        const [letter, cls, hint] = STAT[code] || [code, "mod", ""];
        const parts = f.path.split("/");
        const isSel = sel && sel.file === f.path && sel.staged === staged;
        return `<div class="frow2${isSel ? " sel" : ""}" data-f="${esc(f.path)}" data-s="${staged ? 1 : 0}" title="${esc(f.path)} — ${hint}">
          <span class="fname">${esc(parts.pop())}</span><span class="fdir dim">${esc(parts.join("/"))}${f.orig ? ` ← ${esc(f.orig)}` : ""}</span>
          <span class="facts">${staged ? `<button class="icon-btn" data-fa="unstage" title="Снять">${I.minus}</button>`
            : `<button class="icon-btn" data-fa="discard" title="Отменить изменения">${I.undo}</button><button class="icon-btn" data-fa="stage" title="Подготовить">${I.plus}</button>`}</span>
          <span class="fstat ${cls}">${letter}</span></div>`;
      }).join("")}</div>`;
  }

  async function act(p) {
    try { await p; } catch (e) { toast(esc(errText(e)), "err"); }
    refresh();
  }

  async function discard(files) {
    const tracked = files.filter((f) => !f.untracked).map((f) => f.path);
    const untracked = files.filter((f) => f.untracked).map((f) => f.path);
    const what = files.length === 1 ? `<span class="mono">${esc(files[0].path)}</span>` : `${files.length} файл(ов)`;
    if (!(await confirmBox("Отменить изменения?", `Изменения в ${what} будут потеряны${untracked.length ? ", новые файлы — удалены" : ""}. Это нельзя вернуть.`, "Отменить изменения"))) return;
    act(api.GitDiscard(path, tracked, untracked));
  }

  async function commit(andPush, amend = false) {
    const ta = left.querySelector("textarea");
    const msg = ta?.value.trim() || "";
    if (!msg && !amend) { ta?.focus(); return toast("Напиши сообщение коммита", "err"); }
    try {
      if (!amend && !st.files.some((f) => f.index && !f.conflict)) await api.GitStage(path, []);
      await api.GitCommit(path, msg, amend);
      store.set("git.msg." + path, "");
      if (ta) ta.value = "";
      toast(`${I.check} Коммит создан`);
      sel = null;
      await refresh();
      if (andPush) run(api.GitPush(path, false));
      loadGit().then(() => app.renderSidebar());
    } catch (e) { toast(`${I.warn} ${esc(errText(e))}`, "err"); }
  }

  async function loadLog() {
    const box = left.querySelector(".history");
    if (!box) return;
    try { log = await api.GitLog(path); } catch (e) { box.innerHTML = `<div class="err-t small pad">${esc(errText(e))}</div>`; return; }
    box.innerHTML = log?.length ? log.map((c) => `<div class="crow${sel?.hash === c.hash ? " sel" : ""}" data-h="${c.hash}">
        <div class="csubj">${esc(c.subject)}</div>
        <div class="cmeta dim small"><span>${esc(c.author)}</span><span>${relTime(c.time)}</span><span class="mono">${c.short}</span>${c.refs ? `<span class="crefs">${esc(c.refs.replace("HEAD -> ", ""))}</span>` : ""}</div></div>`).join("")
      : `<div class="git-clean">${I.info}<div>Коммитов пока нет</div></div>`;
    box.querySelectorAll(".crow").forEach((r) => (r.onclick = () => {
      sel = { hash: r.dataset.h };
      box.querySelectorAll(".crow").forEach((x) => x.classList.toggle("sel", x === r));
      renderDiff();
    }));
  }

  // ---------- правая колонка: diff ----------
  async function renderDiff() {
    if (!sel) {
      dHead.innerHTML = "";
      dBody.innerHTML = st?.isRepo ? `<div class="diff-empty">${I.branch}<div>${mode === "history" ? "Выбери коммит" : st.files?.length ? "Выбери файл, чтобы увидеть изменения" : "Нет изменений"}</div>
        <div class="dim small">Двойной клик по файлу — подготовить / снять</div></div>` : "";
      return;
    }
    dBody.innerHTML = `<div class="diff-empty"><span class="spin"></span></div>`;
    let text = "";
    try {
      if (sel.hash) {
        text = await api.GitShow(path, sel.hash);
        const c = log?.find((x) => x.hash === sel.hash);
        dHead.innerHTML = `<b>${esc(c?.subject || sel.hash.slice(0, 8))}</b><span class="dim mono small">${sel.hash.slice(0, 10)}</span>`;
      } else {
        text = await api.GitDiff(path, sel.file, sel.staged, sel.untracked);
        dHead.innerHTML = `<b class="mono">${esc(sel.file)}</b><span class="dim small">${sel.staged ? "подготовлено" : sel.untracked ? "новый файл" : "не подготовлено"}</span>`;
      }
    } catch (e) { dBody.innerHTML = `<div class="err-t pad">${esc(errText(e))}</div>`; return; }
    dBody.innerHTML = diffHtml(text);
  }

  tab.onShow = () => refresh();
  return tab;
}

export function diffHtml(text) {
  if (!text.trim()) return `<div class="diff-empty dim">Нет текстовых изменений</div>`;
  let oldN = 0, newN = 0;
  const rows = text.replace(/\n$/, "").split("\n").slice(0, 6000).map((l) => {
    let cls = "", a = "", b = "";
    const m = l.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)/);
    if (m) { oldN = +m[1]; newN = +m[2]; cls = "hunk"; }
    else if (/^(diff --git|index |--- |\+\+\+ |new file|deleted file|similarity|rename |commit |Автор:|Дата:)/.test(l)) cls = "meta";
    else if (l.startsWith("@@")) cls = "hunk";
    else if (l.startsWith("+")) { cls = "add"; b = newN++; }
    else if (l.startsWith("-")) { cls = "del"; a = oldN++; }
    else if (oldN || newN) { a = oldN++; b = newN++; }
    return `<div class="dl ${cls}"><span class="ln">${a}</span><span class="ln">${b}</span><span class="dt">${esc(l) || " "}</span></div>`;
  });
  return `<div class="diff-lines mono">${rows.join("")}</div>`;
}
