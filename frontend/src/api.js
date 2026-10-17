// Мост к Go-бэкенду. В приложении (Wails) — window.go.main.App и window.runtime.
// В обычном браузере (npm run dev) — тестовая реализация из mock.js.
import { createMock } from "./mock.js";

const isWails = typeof window !== "undefined" && !!window.go?.main?.App;
const mock = isWails ? null : createMock();

export const api = new Proxy({}, {
  get(_, name) {
    if (name === "isMock") return !isWails;
    return (...args) => {
      if (isWails) return window.go.main.App[name](...args);
      const fn = mock.api[name];
      if (!fn) return Promise.reject(new Error("mock: нет метода " + name));
      try { return Promise.resolve(fn(...args)); } catch (e) { return Promise.reject(e); }
    };
  },
});

export function on(event, fn) {
  if (isWails) return window.runtime.EventsOn(event, fn);
  return mock.on(event, fn);
}

export const win = {
  minimise: () => isWails && window.runtime.WindowMinimise(),
  toggleMax: () => isWails && window.runtime.WindowToggleMaximise(),
  close: () => (isWails ? window.runtime.Quit() : null),
  openURL: (u) => (isWails ? window.runtime.BrowserOpenURL(u) : window.open(u)),
};

// Wails возвращает ошибки Go как строку
export const errText = (e) => (typeof e === "string" ? e : e?.message || String(e));
