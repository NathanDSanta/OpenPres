import { useCallback, useEffect, useRef, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { Laptop, Loader2, Moon, Play, Plug, Power, Server } from "lucide-react";
import type { FoundServer, LocalServerStatus } from "@/types";
import UpdateDialog, { type UpdatePhase } from "@/components/UpdateDialog";
import "@/styles/Launcher.css";

const LAST_KEY = "openpres.lastServer";
/** "Remind me later": not again until OpenPres is opened again. */
const LATER_KEY = "openpres.updateLater";

interface FoundUpdate {
  version: string;
  current: string;
  notes: string;
  date: string | null;
}

type InstallProgress = { event: "downloading"; done: number; total: number | null } | { event: "installing" };

function remindedLater(version: string) {
  try {
    return sessionStorage.getItem(LATER_KEY) === version;
  } catch {
    return false;
  }
}

interface Choice {
  id: string;
  name: string;
  /** Where the manager connects. */
  url: string;
  detail: string;
  power: string;
  local: boolean;
}

/** Opens a server's interface in this window; "Switch server" there comes back here. */
function open(choice: Choice) {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify({ id: choice.id, url: choice.url }));
  } catch {
    /* ignore */
  }
  window.location.href = `${choice.url}/?shell=${encodeURIComponent(window.location.origin)}`;
}

function lastServer(): { id: string; url: string } | null {
  try {
    return JSON.parse(localStorage.getItem(LAST_KEY) ?? "null");
  } catch {
    return null;
  }
}

const hostPart = (address: string) => (address.includes(":") ? `[${address}]` : address);

/**
 * The desktop manager's first page: the OpenPres servers on the network (and on this
 * computer). The last one used opens on its own.
 */
export default function Launcher() {
  const [local, setLocal] = useState<LocalServerStatus | null>(null);
  const [found, setFound] = useState<FoundServer[]>([]);
  const [starting, setStarting] = useState(false);
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const autoOpened = useRef(new URLSearchParams(window.location.search).has("switch"));
  const autoStarted = useRef(false);
  // A newer version is asked for first; the last server opens after the answer.
  const [update, setUpdate] = useState<FoundUpdate | null>(null);
  const [checking, setChecking] = useState(true);
  const [phase, setPhase] = useState<UpdatePhase>({ step: "ready" });
  const [updateError, setUpdateError] = useState<string | null>(null);

  useEffect(() => {
    let waiting = true;
    const done = () => {
      if (waiting) {
        waiting = false;
        setChecking(false);
      }
    };
    // Offline or slow: the server list doesn't wait long for it.
    const timer = setTimeout(done, 4000);
    invoke<FoundUpdate | null>("check_update")
      .then((u) => {
        if (u && !remindedLater(u.version)) setUpdate(u);
      })
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(timer);
        done();
      });
  }, []);

  const remindLater = () => {
    try {
      if (update) sessionStorage.setItem(LATER_KEY, update.version);
    } catch {
      /* ignore */
    }
    setUpdate(null);
  };

  const installUpdate = async () => {
    setUpdateError(null);
    setPhase({ step: "downloading", done: 0, total: null });
    const onProgress = new Channel<InstallProgress>();
    onProgress.onmessage = (p) =>
      setPhase(p.event === "installing" ? { step: "installing" } : { step: "downloading", done: p.done, total: p.total });
    try {
      // Ends with OpenPres closing and the new version opening.
      await invoke("install_update", { onProgress });
    } catch (err) {
      setPhase({ step: "ready" });
      setUpdateError(String(err));
    }
  };

  const refresh = useCallback(async () => {
    const [l, f] = await Promise.all([
      invoke<LocalServerStatus>("local_server_status").catch(() => null),
      invoke<FoundServer[]>("discovered_servers").catch(() => []),
    ]);
    setLocal(l);
    setFound(f);
    if (l?.running) setStarting(false);
    // This computer is (or was, before servers) where OpenPres runs: start its server, but
    // only as the manager opens. A server stopped later ("Quit completely" in its tray)
    // stays stopped; the Start button is there for it.
    if (l && !autoStarted.current) {
      autoStarted.current = true;
      if (!l.running && l.has_data) {
        setStarting(true);
        void invoke("start_local_server").catch(() => setStarting(false));
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 1500);
    return () => clearInterval(id);
  }, [refresh]);

  const choices: Choice[] = [];
  if (local?.running && local.info) {
    choices.push({
      id: local.info.id,
      name: local.info.name,
      url: `http://127.0.0.1:${local.port}`,
      detail: "This computer",
      power: local.info.power,
      local: true,
    });
  }
  for (const s of found) {
    if (choices.some((c) => c.id === s.id)) continue;
    const ip = s.addresses[0];
    if (!ip) continue;
    choices.push({
      id: s.id,
      name: s.name || s.host,
      url: `http://${hostPart(ip)}:${s.port}`,
      detail: `${s.host} · ${ip}`,
      power: s.power,
      local: false,
    });
  }

  // The server used last opens by itself (not when coming back to switch, nor while
  // a new version is offered).
  useEffect(() => {
    if (autoOpened.current || checking || update) return;
    const last = lastServer();
    const match = last && choices.find((c) => c.id === last.id);
    if (match) {
      autoOpened.current = true;
      open(match);
    }
  });
  // A server that doesn't come up in a while isn't coming.
  useEffect(() => {
    if (!starting) return;
    const id = setTimeout(() => {
      setStarting(false);
      setError("The server didn't start. Another program may be using its port (8787).");
    }, 20000);
    return () => clearTimeout(id);
  }, [starting]);

  // Nothing found after a while: stop waiting for the last one.
  const waitingForLast = !checking && !update;
  useEffect(() => {
    if (!waitingForLast) return;
    const id = setTimeout(() => (autoOpened.current = true), 6000);
    return () => clearTimeout(id);
  }, [waitingForLast]);

  const startLocal = async () => {
    setError(null);
    setStarting(true);
    try {
      await invoke("start_local_server");
    } catch (err) {
      setStarting(false);
      setError(String(err));
    }
  };

  const connectTo = () => {
    const text = address.trim().replace(/\/+$/, "");
    if (!text) return;
    const withScheme = /^https?:\/\//.test(text) ? text : `http://${text}`;
    try {
      const url = new URL(withScheme);
      if (!url.port) url.port = String(local?.port ?? 8787);
      open({ id: "", name: text, url: url.origin, detail: "", power: "", local: false });
    } catch {
      setError("That isn't an address. Try something like 192.168.1.20 or studio-pc:8787.");
    }
  };

  return (
    <div className="launcher">
      <div className="launcher-card">
        <header className="launcher-head">
          <div className="launcher-logo">
            <Server size={22} />
          </div>
          <div>
            <h1>OpenPres</h1>
            <p>Choose the server to manage.</p>
          </div>
        </header>

        <div className="launcher-list">
          {choices.map((c) => (
            <button key={c.id} className="launcher-server" onClick={() => open(c)}>
              {c.local ? <Laptop size={18} /> : <Server size={18} />}
              <span className="launcher-server-text">
                <strong>{c.name}</strong>
                <small>{c.detail}</small>
              </span>
              <PowerBadge power={c.power} />
            </button>
          ))}
          {choices.length === 0 && (
            <div className="launcher-empty">
              <Loader2 size={16} className="spin" /> Looking for servers on the network…
            </div>
          )}
        </div>

        {local && !local.running && (
          <div className="launcher-local">
            <span>
              No server runs on this computer ({local.host}).
              <small>It keeps running in the background after you close this window.</small>
            </span>
            <button className="btn btn-primary" disabled={starting} onClick={() => void startLocal()}>
              {starting ? <Loader2 size={14} className="spin" /> : <Play size={14} />} {starting ? "Starting…" : "Start the server here"}
            </button>
          </div>
        )}

        <form
          className="launcher-address"
          onSubmit={(e) => {
            e.preventDefault();
            connectTo();
          }}
        >
          <input className="input" placeholder="Or type an address: 192.168.1.20:8787" value={address} onChange={(e) => setAddress(e.target.value)} />
          <button className="btn" disabled={!address.trim()}>
            <Plug size={14} /> Connect
          </button>
        </form>
        {error && <div className="alert alert-error">{error}</div>}
      </div>
      {update && (
        <UpdateDialog
          title={`OpenPres ${update.version} is available`}
          current={update.current}
          date={update.date}
          notes={update.notes}
          note={
            local?.running && navigator.userAgent.includes("Windows")
              ? "OpenPres closes and opens again. The server on this computer restarts too, so its screens go dark for a moment."
              : "OpenPres closes and opens again by itself."
          }
          phase={phase}
          error={updateError}
          onUpdate={() => void installUpdate()}
          onLater={remindLater}
        />
      )}
    </div>
  );
}

function PowerBadge({ power }: { power: string }) {
  if (power === "standby") return <span className="launcher-power standby"><Power size={12} /> Standby</span>;
  if (power === "sleep") return <span className="launcher-power sleep"><Moon size={12} /> Asleep</span>;
  if (power === "active") return <span className="launcher-power active">Active</span>;
  return null;
}
