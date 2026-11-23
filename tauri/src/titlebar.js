// OpenPres's own title bar, added by the program to every page its windows load: the
// manager's server list, a server's interface opened in it (from any version of the
// server) and the server's setup window. See titlebar.rs.
//
// It sits above the page, which keeps the rest of the window (html gets a top padding).
// The buttons talk to the window directly; the window permissions are in
// capabilities/default.json and capabilities/manager-pages.json.
(() => {
  if (window.top !== window || window.__openpresTitleBar) return;
  window.__openpresTitleBar = true;

  const HEIGHT = 34;
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
    logo:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/></svg>',
  };

  const css = `
    html { padding-top: ${HEIGHT}px !important; }
    #openpres-titlebar {
      position: fixed; top: 0; left: 0; right: 0; height: ${HEIGHT}px; z-index: 2147483647;
      display: flex; align-items: center; gap: 8px;
      padding-left: ${mac ? 78 : 10}px;
      background: #15141b; border-bottom: 1px solid #24232d;
      color: #a3a2b2; font: 500 12px/1 Inter, ui-sans-serif, system-ui, "Segoe UI", sans-serif;
      letter-spacing: 0.01em; user-select: none; -webkit-user-select: none; cursor: default;
    }
    #openpres-titlebar.blurred { color: #5f5e6c; }
    #openpres-titlebar .op-logo {
      width: 20px; height: 20px; flex: none; display: grid; place-items: center;
      border-radius: 6px; background: rgb(180 154 255 / 16%); pointer-events: none;
    }
    #openpres-titlebar .op-logo svg { width: 13px; height: 13px; fill: none; stroke: #b49aff; stroke-width: 2; stroke-linecap: round; }
    #openpres-titlebar.blurred .op-logo { background: rgb(255 255 255 / 5%); }
    #openpres-titlebar.blurred .op-logo svg { stroke: #6f6e7c; }
    #openpres-titlebar .op-title {
      flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; pointer-events: none;
    }
    #openpres-titlebar .op-buttons { display: flex; height: 100%; flex: none; }
    #openpres-titlebar button {
      all: unset; box-sizing: border-box; width: 46px; height: 100%;
      display: grid; place-items: center; color: #a3a2b2; transition: background 0.12s, color 0.12s;
    }
    #openpres-titlebar button svg { width: 10px; height: 10px; fill: none; stroke: currentColor; stroke-width: 1.1; }
    #openpres-titlebar button:hover { background: #252530; color: #e4e4ec; }
    #openpres-titlebar button:active { background: #302f3c; }
    #openpres-titlebar button.op-close:hover { background: #e5484d; color: #fff; }
    #openpres-titlebar button.op-close:active { background: #c63d42; color: #fff; }
    #openpres-titlebar button:focus-visible { outline: 2px solid #b49aff; outline-offset: -2px; }
    #openpres-titlebar.fullscreen { display: none; }
    html.openpres-fullscreen { padding-top: 0 !important; }
  `;

  const build = () => {
    if (document.getElementById("openpres-titlebar")) return;
    const style = document.createElement("style");
    style.id = "openpres-titlebar-style";
    style.textContent = css;
    document.head.appendChild(style);

    const bar = document.createElement("div");
    bar.id = "openpres-titlebar";
    bar.setAttribute("data-tauri-drag-region", "");
    bar.innerHTML = `
      <span class="op-logo">${icon.logo}</span>
      <span class="op-title" data-tauri-drag-region></span>
      ${
        mac
          ? ""
          : `<span class="op-buttons">
               <button type="button" class="op-min" title="Minimize" aria-label="Minimize">${icon.minimize}</button>
               <button type="button" class="op-max" title="Maximize" aria-label="Maximize">${icon.maximize}</button>
               <button type="button" class="op-close" title="Close" aria-label="Close">${icon.close}</button>
             </span>`
      }`;
    document.body.appendChild(bar);

    const title = bar.querySelector(".op-title");
    const showTitle = () => {
      const text = (document.title || "").trim();
      title.textContent = text && text !== "OpenPres" ? `OpenPres — ${text}` : "OpenPres";
    };
    showTitle();
    const head = document.querySelector("title");
    if (head) new MutationObserver(showTitle).observe(head, { childList: true, characterData: true, subtree: true });

    if (!mac) {
      const max = bar.querySelector(".op-max");
      const showMaximized = async () => {
        try {
          const [maximized, fullscreen] = await Promise.all([call("is_maximized"), call("is_fullscreen")]);
          max.innerHTML = maximized ? icon.restore : icon.maximize;
          max.title = max.ariaLabel = maximized ? "Restore" : "Maximize";
          bar.classList.toggle("fullscreen", fullscreen);
          document.documentElement.classList.toggle("openpres-fullscreen", fullscreen);
        } catch {
          /* the window can't be asked: keep the buttons as they are */
        }
      };
      bar.querySelector(".op-min").addEventListener("click", () => void call("minimize").catch(() => {}));
      max.addEventListener("click", () => void call("toggle_maximize").then(showMaximized, () => {}));
      bar.querySelector(".op-close").addEventListener("click", () => void call("close").catch(() => {}));
      let pending = 0;
      window.addEventListener("resize", () => {
        clearTimeout(pending);
        pending = setTimeout(showMaximized, 80);
      });
      showMaximized();
    }

    window.addEventListener("focus", () => bar.classList.remove("blurred"));
    window.addEventListener("blur", () => bar.classList.add("blurred"));
    if (!document.hasFocus()) bar.classList.add("blurred");
  };

  if (document.body) build();
  else document.addEventListener("DOMContentLoaded", build, { once: true });
})();
