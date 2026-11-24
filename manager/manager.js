// The manager page: opens an OpenPres server's interface (http://…:8787) from openpres.local,
// a typed address, or one opened before (remembered in this browser only).
(() => {
  const KEY = "openpres.servers";
  const PORT = 8787;

  const load = () => {
    try {
      const list = JSON.parse(localStorage.getItem(KEY) || "[]");
      return Array.isArray(list) ? list.filter((s) => s && typeof s.address === "string") : [];
    } catch {
      return [];
    }
  };
  const save = (list) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(list.slice(0, 12)));
    } catch {
      // Private browsing: nothing is remembered.
    }
  };

  /** "192.168.1.20", "studio-pc:9000", "http://…" → "http://host:port", or null. */
  const normalize = (typed) => {
    let text = typed.trim().replace(/\/+$/, "");
    if (!text) return null;
    if (!/^https?:\/\//i.test(text)) text = `http://${text}`;
    try {
      const url = new URL(text);
      if (!url.hostname || /\s/.test(typed.trim())) return null;
      if (!url.port) url.port = String(PORT);
      return url.origin;
    } catch {
      return null;
    }
  };

  const open = (address, viewer) => {
    const list = load().filter((s) => s.address !== address);
    list.unshift({ address, at: Date.now() });
    save(list);
    window.location.href = `${address}/${viewer ? "viewer" : ""}`;
  };

  const show = () => {
    const list = load();
    const box = document.getElementById("remembered");
    const ul = document.getElementById("servers");
    box.hidden = list.length === 0;
    ul.replaceChildren(
      ...list.map((s) => {
        const li = document.createElement("li");
        const name = document.createElement("span");
        name.className = "server-name";
        name.textContent = s.address.replace(/^https?:\/\//, "");
        const when = document.createElement("small");
        when.textContent = s.at ? new Date(s.at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";
        const actions = document.createElement("span");
        actions.className = "server-actions";
        const go = Object.assign(document.createElement("a"), { className: "btn btn-primary", href: `${s.address}/`, textContent: "Open" });
        go.onclick = (e) => {
          e.preventDefault();
          open(s.address, false);
        };
        const watch = Object.assign(document.createElement("a"), { className: "btn", href: `${s.address}/viewer`, textContent: "Watch" });
        watch.onclick = (e) => {
          e.preventDefault();
          open(s.address, true);
        };
        const forget = Object.assign(document.createElement("button"), { className: "btn btn-quiet", type: "button", textContent: "Forget", title: "Forget this address" });
        forget.onclick = () => {
          save(load().filter((x) => x.address !== s.address));
          show();
        };
        actions.append(go, watch, forget);
        li.append(name, when, actions);
        return li;
      }),
    );
  };

  document.getElementById("open-local").onclick = (e) => {
    e.preventDefault();
    open(`http://openpres.local:${PORT}`, false);
  };
  document.getElementById("open-local-viewer").onclick = (e) => {
    e.preventDefault();
    open(`http://openpres.local:${PORT}`, true);
  };
  document.getElementById("typed").onsubmit = (e) => {
    e.preventDefault();
    const address = normalize(document.getElementById("address").value);
    document.getElementById("typed-error").hidden = !!address;
    if (address) open(address, document.getElementById("as-viewer").checked);
  };
  show();
})();
