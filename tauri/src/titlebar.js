// OpenPres's window buttons (minimize, maximize, close) for the windows without the system
// frame: the manager and the server's setup window. Added by the program to every page
// they load (see titlebar.rs), so a server's interface of any version gets them.
//
// Where they go:
// - The page has a place for them (`[data-window-controls]`, the end of OpenPres's top
//   bar): they're drawn there, and the bar's empty space (`[data-window-drag]`) moves the
//   window. Nothing else is added.
// - The page asks for floating buttons (`<html data-window-chrome="overlay">`: the server
//   list, the setup window, the login): in the top corner, over the page, with an
//   invisible strip along the top to move the window.
// - Neither (an older server's pages): a slim bar in the page's colours above it.
//
// The window permissions are in capabilities/default.json and capabilities/manager-pages.json.
(() => {
  if (window.top !== window || window.__openpresTitleBar) return;
  window.__openpresTitleBar = true;

  const BAR = 30;
  const mac = /Macintosh|Mac OS X/.test(navigator.userAgent);

  const call = (command, args = {}) => {
    const ipc = window.__TAURI_INTERNALS__;
    if (!ipc) return Promise.reject(new Error("no window access"));
    const label = ipc.metadata?.currentWindow?.label;
    return ipc.invoke(`plugin:window|${command}`, { label, ...args });
  };

  const icon = {
    minimize: '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1 5.5h8"/></svg>',
    maximize: '<svg viewBox="0 0 10 10" aria-hidden="true"><rect x="1.5" y="1.5" width="7" height="7" rx="1.2"/></svg>',
    restore:
      '<svg viewBox="0 0 10 10" aria-hidden="true"><rect x="1.5" y="3" width="5.5" height="5.5" rx="1"/><path d="M3.5 3V2.2c0-.4.3-.7.7-.7h3.6c.4 0 .7.3.7.7v3.6c0 .4-.3.7-.7.7H7"/></svg>',
    close: '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7"/></svg>',
  };

  const css = `
    .opw-buttons { display: flex; align-items: stretch; flex: none; height: 100%; }
    .opw-buttons button {
      all: unset; box-sizing: border-box; width: 44px; height: 100%; min-height: 28px;
      display: grid; place-items: center; color: #8b8a99; cursor: default;
      transition: background 0.12s, color 0.12s;
    }
    .opw-buttons button svg { width: 10px; height: 10px; fill: none; stroke: currentColor; stroke-width: 1.1; }
    .opw-buttons button:hover { background: rgb(255 255 255 / 7%); color: #e4e4ec; }
    .opw-buttons button:active { background: rgb(255 255 255 / 11%); }
    .opw-buttons button.opw-close:hover { background: #e5484d; color: #fff; }
    .opw-buttons button.opw-close:active { background: #c63d42; color: #fff; }
    .opw-buttons button:focus-visible { outline: 2px solid #b49aff; outline-offset: -2px; }
    html.opw-blurred .opw-buttons button { color: #5f5e6c; }

    #opw-float { position: fixed; top: 0; right: 0; height: ${BAR}px; z-index: 2147483647; }
    #opw-strip { position: fixed; top: 0; left: 0; right: 132px; height: ${BAR - 6}px; z-index: 2147483646; }

    html.opw-bar { padding-top: ${BAR}px !important; }
    #opw-bar {
      position: fixed; top: 0; left: 0; right: 0; height: ${BAR}px; z-index: 2147483647;
      display: flex; justify-content: flex-end; background: inherit;
      background: var(--bg-sidebar, #15141b);
    }
    #opw-bar .opw-grow { flex: 1; }

    html.opw-fullscreen #opw-float, html.opw-fullscreen #opw-strip, html.opw-fullscreen #opw-bar,
    html.opw-fullscreen [data-window-controls] .opw-buttons { display: none; }
    html.opw-fullscreen.opw-bar { padding-top: 0 !important; }
  `;

  // ---- moving the window ----
  const interactive = "button, a, input, select, textarea, label, summary, [role=button], [role=tab], [contenteditable], .opw-buttons";
  const draggable = (target) => target instanceof Element && !target.closest(interactive) && !!target.closest("[data-window-drag], #opw-strip, #opw-bar");
  document.addEventListener(
    "mousedown",
    (e) => {
      if (e.button !== 0 || !draggable(e.target)) return;
      if (e.detail === 2) {
        e.preventDefault();
        void call("toggle_maximize").then(showMaximized, () => {});
      } else if (e.detail === 1) {
        void call("start_dragging").catch(() => {});
      }
    },
    true,
  );

  // ---- buttons ----
  const buttons = () => {
    const box = document.createElement("span");
    box.className = "opw-buttons";
    box.innerHTML = `
      <button type="button" class="opw-min" title="Minimize" aria-label="Minimize">${icon.minimize}</button>
      <button type="button" class="opw-max" title="Maximize" aria-label="Maximize">${icon.maximize}</button>
      <button type="button" class="opw-close" title="Close" aria-label="Close">${icon.close}</button>`;
    box.querySelector(".opw-min").addEventListener("click", () => void call("minimize").catch(() => {}));
    box.querySelector(".opw-max").addEventListener("click", () => void call("toggle_maximize").then(showMaximized, () => {}));
    box.querySelector(".opw-close").addEventListener("click", () => void call("close").catch(() => {}));
    return box;
  };

  let maximized = false;
  async function showMaximized() {
    try {
      const [max, full] = await Promise.all([call("is_maximized"), call("is_fullscreen")]);
      maximized = max;
      document.documentElement.classList.toggle("opw-fullscreen", full);
      paintMaximized();
    } catch {
      /* the window can't be asked: keep the buttons as they are */
    }
  }
  function paintMaximized() {
    for (const b of document.querySelectorAll(".opw-max")) {
      b.innerHTML = maximized ? icon.restore : icon.maximize;
      b.title = maximized ? "Restore" : "Maximize";
      b.setAttribute("aria-label", b.title);
    }
  }

  // ---- placing them ----
  let mode = null;
  let started = Date.now();
  const remove = (id) => document.getElementById(id)?.remove();

  function place() {
    if (mac) {
      // macOS keeps its own traffic lights (titlebar.rs); the page leaves room for them.
      document.documentElement.classList.add("opw-mac");
      return;
    }
    const html = document.documentElement;
    const slot = document.querySelector("[data-window-controls]");
    const wanted = slot ? "slot" : html.dataset.windowChrome === "overlay" ? "overlay" : Date.now() - started > 1500 ? "bar" : null;
    if (wanted === "slot" && !slot.querySelector(".opw-buttons")) {
      slot.appendChild(buttons());
      paintMaximized();
    }
    if (wanted === mode) return;
    mode = wanted;
    remove("opw-float");
    remove("opw-strip");
    remove("opw-bar");
    html.classList.toggle("opw-bar", mode === "bar");
    if (mode === "overlay") {
      const float = document.createElement("div");
      float.id = "opw-float";
      float.appendChild(buttons());
      const strip = document.createElement("div");
      strip.id = "opw-strip";
      document.body.append(strip, float);
    } else if (mode === "bar") {
      const bar = document.createElement("div");
      bar.id = "opw-bar";
      bar.innerHTML = '<span class="opw-grow"></span>';
      bar.appendChild(buttons());
      document.body.appendChild(bar);
    }
    paintMaximized();
  }

  const start = () => {
    const style = document.createElement("style");
    style.id = "opw-style";
    style.textContent = css;
    document.head.appendChild(style);
    place();
    new MutationObserver(place).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-window-chrome"] });
    // Older pages never say where the buttons go: the bar comes after a moment.
    setTimeout(place, 1600);
    let pending = 0;
    window.addEventListener("resize", () => {
      clearTimeout(pending);
      pending = setTimeout(showMaximized, 80);
    });
    window.addEventListener("focus", () => document.documentElement.classList.remove("opw-blurred"));
    window.addEventListener("blur", () => document.documentElement.classList.add("opw-blurred"));
    if (!document.hasFocus()) document.documentElement.classList.add("opw-blurred");
    void showMaximized();
  };

  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
})();
