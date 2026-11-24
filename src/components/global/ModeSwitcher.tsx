import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Check, Lock, LogOut, Repeat, Server, Settings as SettingsIcon } from "lucide-react";
import { useManager } from "@/state/Manager";
import { MODES, modeInfo, switchServer, type ModeInfo } from "@/lib/manager";
import { systemApi } from "@/api/system";
import "./styles/ModeSwitcher.css";

/** A mode as a round badge, like a profile picture. */
export function ModeAvatar({ mode, size }: { mode: ModeInfo; size: number }) {
  const Icon = mode.icon;
  return (
    <span className="mode-avatar" style={{ ["--mode" as string]: mode.color, width: size, height: size }}>
      <Icon size={Math.round(size * 0.48)} strokeWidth={2.1} />
    </span>
  );
}

/**
 * The circle at the end of the top bar: the mode this device works in, opened like the
 * account switcher of other apps. Switch modes, open Settings, leave admin, change server.
 */
export default function ModeSwitcher() {
  const manager = useManager();
  const navigate = useNavigate();
  const current = modeInfo(manager.mode);
  // Where the panel opens: under the circle, right-aligned with it.
  const [open, setOpen] = useState<{ top: number; right: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const toggle = () => {
    const r = trigger.current?.getBoundingClientRect();
    setOpen(open || !r ? null : { top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) });
  };

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !trigger.current?.contains(t)) setOpen(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    // The current mode gets the focus, so arrows/Tab and Enter work straight away.
    panel.current?.querySelector<HTMLElement>(".mode-switcher-row.current")?.focus();
    const close = () => setOpen(null);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const act = (fn: () => void) => () => {
    setOpen(null);
    fn();
  };

  return (
    <div className="mode-switcher">
      <button
        ref={trigger}
        className={`mode-switcher-trigger${open ? " open" : ""}`}
        onClick={toggle}
        title={open ? undefined : `${current.name} on ${manager.server.name}: switch mode, settings`}
        aria-label={`Mode: ${current.name}. Switch mode or open settings`}
        aria-haspopup="dialog"
        aria-expanded={!!open}
      >
        <ModeAvatar mode={current} size={30} />
      </button>
      {open &&
        createPortal(
        <div ref={panel} className="mode-switcher-panel" role="dialog" aria-label="Mode and settings" style={{ top: open.top, right: open.right }}>
          <div className="mode-switcher-head">
            <ModeAvatar mode={current} size={46} />
            <div className="mode-switcher-who">
              <strong>{current.name}</strong>
              <span>
                <Server size={11} /> {manager.server.name}
              </span>
            </div>
          </div>
          <div className="mode-switcher-section">Switch mode</div>
          <div className="mode-switcher-modes">
            {MODES.map((m) => {
              const isCurrent = m.id === manager.mode;
              const locked = m.id === "admin" && !manager.admin;
              return (
                <button
                  key={m.id}
                  className={`mode-switcher-row${isCurrent ? " current" : ""}`}
                  onClick={act(() => manager.switchMode(m.id))}
                  aria-current={isCurrent}
                  title={locked ? `${m.name}: asks for the admin password` : m.description}
                >
                  <ModeAvatar mode={m} size={28} />
                  <span className="mode-switcher-text">
                    <span>{m.name}</span>
                    <small>{m.description}</small>
                  </span>
                  <span className="mode-switcher-mark">{isCurrent ? <Check size={15} /> : locked ? <Lock size={13} /> : null}</span>
                </button>
              );
            })}
          </div>
          <div className="mode-switcher-actions">
            <button className="mode-switcher-action" onClick={act(() => navigate("/settings"))}>
              <SettingsIcon size={15} /> Settings
            </button>
            {manager.admin && (
              <button
                className="mode-switcher-action"
                onClick={act(() => void systemApi.logout("admin").then(() => manager.switchMode(manager.mode === "admin" ? "all" : manager.mode)))}
              >
                <Lock size={15} /> Leave admin
              </button>
            )}
            {manager.canSwitchServer && (
              <button className="mode-switcher-action" onClick={act(switchServer)}>
                <Repeat size={15} /> Switch server
              </button>
            )}
            <button className="mode-switcher-action" onClick={act(() => void manager.logout())}>
              <LogOut size={15} /> Log out of this device
            </button>
          </div>
        </div>,
          document.body,
        )}
    </div>
  );
}
