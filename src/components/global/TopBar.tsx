import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { FileUp, ImagePlus, LayoutGrid, Moon, Power, Radio, Settings as SettingsIcon } from "lucide-react";
import { streamApi } from "@/api/stream";
import { useLive } from "@/api/events";
import { formatDuration } from "@/lib/format";
import { useApp } from "@/state/AppContext";
import { notifyError } from "@/state/Dialogs";
import { NAVIGATION } from "./navigation";
import { heading, useMenu } from "@/components/ui/Menu";
import ModeSwitcher from "./ModeSwitcher";
import { useManager } from "@/state/Manager";
import { can, canOpen } from "@/lib/manager";
import type { Power as PowerState } from "@/types";
import "./styles/TopBar.css";

/**
 * The one bar of the app: the logo (which switches modes and servers), the pages, the actions
 * (imports, stream, power, Settings) and, in the desktop manager, the window buttons. Its empty
 * space moves the window there.
 */
export default function TopBar() {
  const { setImportOpen, requestMediaImport } = useApp();
  const manager = useManager();
  const { mode } = manager;
  const menu = useMenu();
  const streams = can(mode, "stream");
  const stage = can(mode, "stage");
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { data: status } = useLive(() => (streams ? streamApi.status() : Promise.resolve(null)), [streams], ["stream"]);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  // Labels make way as the window narrows: first the actions', then those of the other
  // pages, then all (measured, since the modes and the server's name vary).
  const bar = useRef<HTMLElement>(null);
  const [compact, setCompact] = useState(0);
  const [, remeasure] = useState(0);
  useLayoutEffect(() => {
    const el = bar.current;
    const nav = el?.querySelector<HTMLElement>(".topbar-nav");
    const overflows = (e: HTMLElement | null | undefined) => !!e && e.scrollWidth > e.clientWidth + 1;
    if (el && compact < 3 && (overflows(el) || overflows(nav))) setCompact(compact + 1);
  });
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth !== width) {
        width = el.clientWidth;
        setCompact(0);
        remeasure((n) => n + 1);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const running = !!status?.running;

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [running]);

  const toggleStream = async () => {
    setBusy(true);
    try {
      if (running) await streamApi.stop();
      else await streamApi.start();
    } catch (err) {
      notifyError(err);
      navigate("/live");
    } finally {
      setBusy(false);
    }
  };

  const POWER: { id: PowerState; label: string; hint: string; icon: typeof Power }[] = [
    { id: "active", label: "Active", hint: "Everything works", icon: Power },
    { id: "standby", label: "Standby", hint: "Nothing shown or streamed; managing works", icon: Power },
    { id: "sleep", label: "Sleep", hint: "Everything stops until woken up", icon: Moon },
  ];
  const openPowerMenu = (anchor: HTMLElement) => {
    menu.open(
      anchor,
      [
        heading("power", "Server"),
        ...POWER.map((p) => ({
          key: p.id,
          label: p.label,
          hint: p.hint,
          icon: <p.icon size={14} />,
          checked: manager.power === p.id,
          onSelect: () => void manager.setPower(p.id).catch(notifyError),
        })),
      ],
      260,
    );
  };

  return (
    <header ref={bar} className={`topbar compact-${compact}`} data-window-drag>
      <ModeSwitcher />
      <nav className="topbar-nav" aria-label="Pages">
        {NAVIGATION.filter(({ path }) => canOpen(mode, path)).map(({ name, path, icon: Icon, hint, group }) => (
          <span key={path} className="topbar-nav-item">
            {group && <span className="topbar-nav-divider" />}
            <NavLink to={path} end={path === "/"} className={({ isActive }) => `topbar-link${isActive ? " active" : ""}`} title={`${name}: ${hint}`} aria-label={name}>
              <Icon size={16} strokeWidth={1.9} />
              <span className="topbar-link-label">{name}</span>
            </NavLink>
          </span>
        ))}
      </nav>
      <span className="topbar-grow" />
      <div className="topbar-tools">
        {pathname === "/" && (
          <button className="topbar-link" onClick={() => window.dispatchEvent(new Event("openpres:edit-home"))} title="Move, resize, add and remove widgets">
            <LayoutGrid size={16} strokeWidth={1.9} /> <span className="topbar-collapse">Edit layout</span>
          </button>
        )}
        {stage && (
          <>
            <button className="topbar-link" onClick={() => setImportOpen(true)} title="Import a song from a text file or the clipboard">
              <FileUp size={16} strokeWidth={1.9} /> <span className="topbar-collapse">Import song</span>
            </button>
            <button className="topbar-link" onClick={requestMediaImport} title="Import pictures, videos or audio">
              <ImagePlus size={16} strokeWidth={1.9} /> <span className="topbar-collapse">Import media</span>
            </button>
          </>
        )}
      </div>
      <div className="topbar-actions">
        {manager.power === "standby" && (
          <span className="topbar-standby" title="Nothing is shown or streamed until the server is active again">
            Standby
          </span>
        )}
        {streams && <button
          className={`btn btn-small ${running ? "btn-live" : ""}`}
          onClick={() => void toggleStream()}
          disabled={busy}
          title={running ? "Stop the stream" : "Start the stream (settings on the Stream page)"}
        >
          <Radio size={14} />
          {running && status?.started_at_ms ? (
            <>
              {status.streaming ? "LIVE" : "REC"} {formatDuration(now - status.started_at_ms, "H:mm:ss")}
            </>
          ) : (
            "Go live"
          )}
        </button>}
        {can(mode, "power") && (
          <button
            className={`icon-btn topbar-power ${manager.power}`}
            onClick={(e) => openPowerMenu(e.currentTarget)}
            title={`Server: ${manager.power}. Click to switch between active, standby and sleep.`}
          >
            <Power size={15} />
          </button>
        )}
        <NavLink to="/settings" className={({ isActive }) => `icon-btn topbar-settings${isActive ? " active" : ""}`} title="Settings" aria-label="Settings">
          <SettingsIcon size={16} />
        </NavLink>
      </div>
      {/* The desktop manager puts its window buttons here (tauri/src/titlebar.js). */}
      <div className="topbar-window" data-window-controls />
      {menu.element}
    </header>
  );
}
