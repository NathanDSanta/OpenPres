import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Laptop, Loader2, Moon, Play, Plug, Power, Server } from "lucide-react";
import type { FoundServer, LocalServerStatus } from "@/types";
import "@/styles/Launcher.css";

const LAST_KEY = "openpres.lastServer";

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

  const refresh = useCallback(async () => {
    const [l, f] = await Promise.all([
      invoke<LocalServerStatus>("local_server_status").catch(() => null),
      invoke<FoundServer[]>("discovered_servers").catch(() => []),
    ]);
    setLocal(l);
    setFound(f);
    if (l?.running) setStarting(false);
    // This computer is (or was, before servers) where OpenPres runs: start its server.
    if (l && !l.running && l.has_data && !autoStarted.current) {
      autoStarted.current = true;
      setStarting(true);
      void invoke("start_local_server").catch(() => setStarting(false));
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

  // The server used last opens by itself (not when coming back to switch).
  useEffect(() => {
    if (autoOpened.current) return;
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
  useEffect(() => {
    const id = setTimeout(() => (autoOpened.current = true), 6000);
    return () => clearTimeout(id);
  }, []);

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
    </div>
  );
}

function PowerBadge({ power }: { power: string }) {
  if (power === "standby") return <span className="launcher-power standby"><Power size={12} /> Standby</span>;
  if (power === "sleep") return <span className="launcher-power sleep"><Moon size={12} /> Asleep</span>;
  if (power === "active") return <span className="launcher-power active">Active</span>;
  return null;
}
