(() => {
  "use strict";

  const STORAGE_KEY = "pellosy-theme";
  const DEFAULT_THEME = "glass";
  const names = {
    glass: "流体玻璃",
    night: "午夜实验室",
    paper: "暖纸工作室"
  };

  const palettes = {
    glass: {
      "--paper": "#e8eef5",
      "--ink": "#131923",
      "--muted": "#6b7786",
      "--line": "rgba(19, 25, 35, 0.14)",
      "--line-strong": "rgba(19, 25, 35, 0.24)",
      "--yellow": "#f26f4a",
      "--white": "#f7f9fc",
      "--silver": "#aab6c5",
      "--danger": "#b7352d",
      "--success": "#3c7d51",
      "--cobalt": "#3868ed",
      "--cobalt-light": "#c7d7ff",
      "--signal": "#3868ed",
      "--red": "#b7352d",
      "--bg": "#e8eef5",
      "--panel": "rgba(255, 255, 255, 0.58)",
      "--panel-2": "rgba(241, 246, 252, 0.7)",
      "--panel-3": "rgba(19, 25, 35, 0.075)",
      "--editor": "#f6f8fb",
      "--text": "#131923",
      "--text-soft": "#425064",
      "--accent": "#f26f4a",
      "--accent-rgb": "242, 111, 74",
      "--accent-ink": "#ffffff",
      "--blue": "#3868ed",
      "--orange": "#d55b32",
      "--green": "#3c7d51",
      "--preview-bg": "#ffffff",
      "--console-bg": "#edf2f8",
      "--console-text": "#26303d",
      "--console-line": "rgba(19, 25, 35, 0.08)",
      "--console-time": "#768293",
      "--overlay": "rgba(24, 34, 47, 0.34)",
      "--dialog-shadow": "rgba(31, 49, 73, 0.24)",
      "--floating-shadow": "rgba(31, 49, 73, 0.16)",
      "--theme-meta": "#e8eef5",
      "--color-scheme": "light",
      "--ambient-line": "rgba(19, 25, 35, 0.12)",
      "--glass-card": "rgba(255, 255, 255, 0.62)",
      "--glass-input": "rgba(255, 255, 255, 0.56)",
      "--glass-input-focus": "rgba(255, 255, 255, 0.82)",
      "--float-ink": "rgba(19, 25, 35, 0.18)"
    },
    night: {
      "--paper": "#0b1118",
      "--ink": "#f3f7fb",
      "--muted": "#8190a1",
      "--line": "rgba(255, 255, 255, 0.18)",
      "--line-strong": "rgba(255, 255, 255, 0.36)",
      "--yellow": "#ff8664",
      "--white": "#141c26",
      "--silver": "#566475",
      "--danger": "#ff8178",
      "--success": "#8bdcad",
      "--cobalt": "#82a9ff",
      "--cobalt-light": "#304e83",
      "--signal": "#82a9ff",
      "--red": "#ff8178",
      "--bg": "#0b1118",
      "--panel": "rgba(16, 24, 34, 0.78)",
      "--panel-2": "rgba(25, 35, 47, 0.82)",
      "--panel-3": "rgba(255, 255, 255, 0.08)",
      "--editor": "#0f171f",
      "--text": "#f3f7fb",
      "--text-soft": "#c0ccda",
      "--accent": "#ff8664",
      "--accent-rgb": "255, 134, 100",
      "--accent-ink": "#1b0e09",
      "--blue": "#82a9ff",
      "--orange": "#ff9d72",
      "--green": "#8bdcad",
      "--preview-bg": "#101820",
      "--console-bg": "#070d13",
      "--console-text": "#d5dde7",
      "--console-line": "rgba(255, 255, 255, 0.07)",
      "--console-time": "#68788a",
      "--overlay": "rgba(0, 0, 0, 0.62)",
      "--dialog-shadow": "rgba(0, 0, 0, 0.52)",
      "--floating-shadow": "rgba(0, 0, 0, 0.38)",
      "--theme-meta": "#0b1118",
      "--color-scheme": "dark",
      "--ambient-line": "rgba(255, 255, 255, 0.09)",
      "--glass-card": "rgba(16, 24, 34, 0.78)",
      "--glass-input": "rgba(255, 255, 255, 0.065)",
      "--glass-input-focus": "rgba(255, 255, 255, 0.1)",
      "--float-ink": "rgba(255, 255, 255, 0.16)"
    },
    paper: {
      "--paper": "#e9dfcf",
      "--ink": "#251e18",
      "--muted": "#817264",
      "--line": "rgba(54, 38, 24, 0.18)",
      "--line-strong": "rgba(54, 38, 24, 0.3)",
      "--yellow": "#d75e37",
      "--white": "#f7f0e6",
      "--silver": "#c8bba9",
      "--danger": "#a9362d",
      "--success": "#527237",
      "--cobalt": "#4264b2",
      "--cobalt-light": "#d7e0fa",
      "--signal": "#4264b2",
      "--red": "#a9362d",
      "--bg": "#e9dfcf",
      "--panel": "rgba(255, 250, 242, 0.62)",
      "--panel-2": "rgba(247, 240, 230, 0.72)",
      "--panel-3": "rgba(54, 38, 24, 0.07)",
      "--editor": "#f4eee4",
      "--text": "#251e18",
      "--text-soft": "#574a3e",
      "--accent": "#d75e37",
      "--accent-rgb": "215, 94, 55",
      "--accent-ink": "#fffaf2",
      "--blue": "#4264b2",
      "--orange": "#ba542b",
      "--green": "#527237",
      "--preview-bg": "#fbf6ee",
      "--console-bg": "#e8dece",
      "--console-text": "#342a22",
      "--console-line": "rgba(54, 38, 24, 0.09)",
      "--console-time": "#8a7969",
      "--overlay": "rgba(49, 36, 24, 0.34)",
      "--dialog-shadow": "rgba(74, 53, 35, 0.24)",
      "--floating-shadow": "rgba(74, 53, 35, 0.16)",
      "--theme-meta": "#e9dfcf",
      "--color-scheme": "light",
      "--ambient-line": "rgba(54, 38, 24, 0.12)",
      "--glass-card": "rgba(255, 250, 242, 0.66)",
      "--glass-input": "rgba(255, 252, 246, 0.6)",
      "--glass-input-focus": "rgba(255, 252, 246, 0.88)",
      "--float-ink": "rgba(54, 38, 24, 0.19)"
    }
  };

  function readTheme() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return palettes[stored] ? stored : DEFAULT_THEME;
    } catch {
      return DEFAULT_THEME;
    }
  }

  function apply(theme, persist = false) {
    const next = palettes[theme] ? theme : DEFAULT_THEME;
    const root = document.documentElement;
    root.dataset.theme = next;
    Object.entries(palettes[next]).forEach(([property, value]) => {
      if (!property.startsWith("--color-scheme") && !property.startsWith("--theme-meta")) {
        root.style.setProperty(property, value);
      }
    });
    root.style.colorScheme = palettes[next]["--color-scheme"];
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", palettes[next]["--theme-meta"]);
    if (persist) {
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Theme still applies for the current page.
      }
    }
    window.dispatchEvent(new CustomEvent("pellosy:theme-change", {
      detail: { theme: next, name: names[next] }
    }));
    return next;
  }

  const api = {
    names,
    palettes,
    get: () => document.documentElement.dataset.theme || readTheme(),
    set: (theme) => apply(theme, true),
    cycle: () => {
      const order = ["glass", "night", "paper"];
      const current = api.get();
      return apply(order[(order.indexOf(current) + 1) % order.length], true);
    },
    applyInitial: () => apply(readTheme(), false)
  };

  window.PellosyTheme = api;
  api.applyInitial();

  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) apply(event.newValue, false);
  });
  window.addEventListener("pageshow", () => {
    const stored = readTheme();
    if (stored !== api.get()) apply(stored, false);
  });
})();
