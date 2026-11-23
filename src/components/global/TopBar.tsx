import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ChevronDown, FileUp, ImagePlus, LayoutGrid, Lock, LogOut, Moon, Power, Radio, Repeat, Server } from "lucide-react";
import { streamApi } from "@/api/stream";
import { useLive } from "@/api/events";
import { formatDuration } from "@/lib/format";
import { useApp } from "@/state/AppContext";
import { notifyError } from "@/state/Dialogs";
import { NAVIGATION } from "./Sidebar";
import { divider, heading, useMenu, type MenuEntry } from "@/components/ui/Menu";
import { useManager } from "@/state/Manager";
import { MODES, can, modeInfo } from "@/lib/manager";
import { switchServer } from "@/lib/manager";
import { systemApi } from "@/api/system";
import type { Power as PowerState } from "@/types";
import "./styles/TopBar.css";

/** Page title, imports and the stream button. The command bar opens with its shortcut. */
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
  const running = !!status?.running;
  const page =
    pathname === "/settings" ? "Settings" : NAVIGATION.find((n) => (n.path === "/" ? pathname === "/" : pathname.startsWith(n.path)))?.name ?? "";

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

  const ModeIcon = modeInfo(mode).icon;
  const openModeMenu = (anchor: HTMLElement) => {
    const entries: MenuEntry[] = [
      heading("server", manager.server.name),
      ...MODES.map((m) => ({
        key: m.id,
        label: m.name,
        icon: <m.icon size={14} />,
        hint: m.id === "admin" && !manager.admin ? <Lock size={12} /> : undefined,
        checked: m.id === mode,
        onSelect: () => manager.switchMode(m.id),
      })),
      divider("d1"),
    ];
    if (manager.admin) {
      entries.push({
        key: "lock",
        label: "Leave admin",
        icon: <Lock size={14} />,
        onSelect: () => {
          void systemApi.logout("admin").then(() => manager.switchMode(mode === "admin" ? "all" : mode));
        },
      });
    }
    if (manager.canSwitchServer) entries.push({ key: "switch", label: "Switch server", icon: <Repeat size={14} />, onSelect: switchServer });
    entries.push({ key: "logout", label: "Log out of this device", icon: <LogOut size={14} />, onSelect: () => void manager.logout() });
    menu.open(anchor, entries, 220);
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
    <header className="topbar" data-window-drag>
      <h1 className="topbar-title">{page}</h1>
      {pathname === "/" && (
        <button className="icon-btn topbar-page-action" onClick={() => window.dispatchEvent(new Event("openpres:edit-home"))} title="Edit the layout of this page">
          <LayoutGrid size={15} />
        </button>
      )}
      <div className="topbar-actions">
        {manager.power === "standby" && (
          <span className="topbar-standby" title="Nothing is shown or streamed until the server is active again">
            Standby
          </span>
        )}
        {stage && (
          <>
            <button className="btn btn-small" onClick={() => setImportOpen(true)} title="Import a song from a text file or the clipboard">
              <FileUp size={14} /> Import song
            </button>
            <button className="btn btn-small" onClick={requestMediaImport} title="Import pictures, videos or audio">
              <ImagePlus size={14} /> Import media
            </button>
          </>
        )}
        {streams && <button
          className={`btn btn-small ${running ? "btn-live" : ""}`}
          onClick={() => void toggleStream()}
          disabled={busy}
          title={running ? "Stop the stream" : "Start the stream (settings in the Live tab)"}
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
        <button className="btn btn-small topbar-mode" onClick={(e) => openModeMenu(e.currentTarget)} title={`${manager.server.name}: switch mode or server`}>
          <ModeIcon size={14} /> {modeInfo(mode).name}
          <span className="topbar-server">
            <Server size={11} /> {manager.server.name}
          </span>
          <ChevronDown size={13} />
        </button>
      </div>
      {/* The desktop manager puts its window buttons here (tauri/src/titlebar.js). */}
      <div className="topbar-window" data-window-controls />
      {menu.element}
    </header>
  );
}
