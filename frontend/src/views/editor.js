// Редактор файлов хранилища с подсветкой YAML / bash / PowerShell.
import { api, errText } from "../api.js";
import { S, app } from "../core.js";
import { h, esc, I, toast } from "../ui.js";

function hlYaml(line) {
  let l = esc(line), com = "";
  const ci = l.search(/(^|\s)#/);
  if (ci >= 0) { com = `<span class="y-com">${l.slice(ci)}</span>`; l = l.slice(0, ci); }
  l = l.replace(/^(\s*)(- )/, '$1<span class="y-dash">$2</span>')
    .replace(/^(\s*(?:<span class="y-dash">- <\/span>)?)([\w.\-]+)(:)(?=\s|$)/, '$1<span class="y-key">$2</span>$3')
    .replace(/(:\s+|- <\/span>)(true|false|yes|no|null)\s*$/, '$1<span class="y-bool">$2</span>')
    .replace(/(:\s+|- <\/span>|\[|, )(\d[\d.]*)(?=\s*$|,|\])/g, '$1<span class="y-num">$2</span>')
    .replace(/(&quot;.*?&quot;|&#39;.*?&#39;)/g, '<span class="y-str">$1</span>');
  return l + com;
}
function hlShell(line) {
  let l = esc(line), com = "";
  const ci = l.search(/(^|\s)#/);
  if (ci >= 0 && !l.startsWith("#!")) { com = `<span class="y-com">${l.slice(ci)}</span>`; l = l.slice(0, ci); }
  else if (l.startsWith("#!")) return `<span class="y-com">${l}</span>`;
  return l.replace(/(&quot;.*?&quot;|&#39;.*?&#39;)/g, '<span class="y-str">$1</span>')
    .replace(/(\$[\w{}]+)/g, '<span class="y-key">$1</span>')
    .replace(/\b(if|then|else|fi|for|do|done|while|function|return|echo|sudo|Write-Host|foreach|param)\b/g, '<span class="y-bool">$1</span>') + com;
}

export function editorTab(path) {
  const ext = path.split(".").pop().toLowerCase();
  const isYaml = ext === "yaml" || ext === "yml";
  const hl = isYaml ? hlYaml : hlShell;
  const tab = { type: "editor", key: "file:" + path, path, icon: I.file, dirty: false, get title() { return (this.dirty ? "● " : "") + path.split("/").pop(); } };
  const parts = path.split("/");
  const script = S.snap.scripts.find((s) => s.path === path);
  const lab = path.startsWith("labs/") ? S.snap.labs.find((l) => l.file === path) : null;
  const server = path.startsWith("servers/") ? S.snap.servers.find((s) => s.file === path) : null;
  const el = h(`<div class="tabview">
    <div class="view-head">
      <div class="crumbs">${parts.slice(0, -1).map((p) => `<span>${esc(p)}</span>/`).join("")}<b>${esc(parts.at(-1))}</b></div>
      <div class="spacer"></div>
      <span class="editor-status"></span>
      <span class="save-state dim small"></span>
      <button class="btn ghost" data-reveal title="Показать в проводнике">${I.folderOpen}</button>
      ${server ? `<button class="btn" data-connect>${I.term}Подключиться</button>` : ""}
      ${lab ? `<button class="btn" data-lab>${I.layers}План лабы</button>` : ""}
      ${script ? `<button class="btn primary" data-run>${I.play}Запустить…</button>` : ""}
    </div>
    <div class="editor">
      <div class="gutter"></div>
      <div class="code-wrap"><pre></pre><textarea spellcheck="false" wrap="off"></textarea></div>
    </div></div>`);
  tab.el = el;
  const ta = el.querySelector("textarea"), pre = el.querySelector("pre"), gut = el.querySelector(".gutter"), wrap = el.querySelector(".code-wrap");
  const status = el.querySelector(".editor-status"), saveState = el.querySelector(".save-state");

  const sync = () => {
    pre.innerHTML = ta.value.split("\n").map(hl).join("\n") + "\n";
    gut.innerHTML = Array.from({ length: ta.value.split("\n").length }, (_, i) => i + 1).join("<br>");
    ta.style.height = "auto"; ta.style.height = Math.max(ta.scrollHeight, wrap.clientHeight) + "px";
    ta.style.width = "auto"; ta.style.width = Math.max(wrap.clientWidth, ta.scrollWidth) + "px";
  };
  const setDirty = (d) => { if (tab.dirty !== d) { tab.dirty = d; app.renderTabs(); } saveState.textContent = d ? "не сохранено · Ctrl+S" : ""; };

  async function save() {
    try {
      const warn = await api.WriteFile(path, ta.value);
      setDirty(false);
      status.innerHTML = warn ? `<span class="err-badge" title="${esc(warn)}">${I.warn}${esc(warn.slice(0, 90))}</span>` : (isYaml ? `<span class="ok-badge">${I.check}YAML ок</span>` : "");
      if (warn) toast(`${I.warn} Сохранено, но в YAML ошибка: ${esc(warn)}`, "err");
      else toast(`${I.check} Сохранено: ${esc(path)}`);
      app.reload();
    } catch (e) { toast(esc(errText(e)), "err"); }
  }

  ta.oninput = () => { setDirty(true); sync(); };
  ta.onkeydown = (e) => {
    if (e.key === "Tab") { e.preventDefault(); document.execCommand("insertText", false, "  "); }
    if (e.ctrlKey && e.code === "KeyS") { e.preventDefault(); save(); }
  };
  wrap.onscroll = () => (gut.scrollTop = wrap.scrollTop);
  el.querySelector("[data-run]")?.addEventListener("click", () => app.openRunDialog(path));
  el.querySelector("[data-lab]")?.addEventListener("click", () => app.openLab(lab.id));
  el.querySelector("[data-connect]")?.addEventListener("click", () => app.openSSH(server.id));
  el.querySelector("[data-reveal]").onclick = () => api.Reveal(path);

  api.ReadFile(path).then((t) => { ta.value = t; sync(); }).catch((e) => { ta.value = ""; status.innerHTML = `<span class="err-badge">${esc(errText(e))}</span>`; });
  tab.onShow = () => { requestAnimationFrame(sync); setTimeout(() => ta.focus(), 30); };
  tab.beforeClose = () => !tab.dirty || confirm(`Файл ${path} не сохранён. Закрыть без сохранения?`);
  return tab;
}
