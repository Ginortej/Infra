// Общее состояние приложения и реестр функций, которые заполняет main.js.
export const S = {
  state: null,        // GetState(): настройки, недавние хранилища
  snap: { servers: [], vpns: [], labs: [], scripts: [], tree: [], errors: [] },
  shells: [],
  vpn: {},            // id -> статус VPN
  srv: {},            // id -> ok | err | off
  tabs: [],
  active: null,
  jobs: {},
  panel: "servers",
};

// Заполняется в main.js: openTab, closeTab, activate, renderTabs, renderSidebar, renderStatus, reload, setTitle,
// openRunDialog, openServerForm, newTerminal, palette
export const app = {};

export const serverById = (id) => S.snap.servers.find((s) => s.id === id);
export const vpnRunning = (id) => !!S.vpn[id]?.running;
