import { useCallback, useEffect, useMemo, useState } from "react";
import { Monitor, RefreshCw, Eye, EyeOff, Unlink, MonitorPlay } from "lucide-react";
import { screensApi } from "@/api/screens";
import { presentationWindowsApi } from "@/api/presentationWindows";
import type { PhysicalDisplay, ScreenView } from "@/types";
import "@/styles/Screens.css";

const SCREEN_DRAG_TYPE = "application/x-openpres-virtual-screen";

function isTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export default function Screens() {
  const [displays, setDisplays] = useState<PhysicalDisplay[]>([]);
  const [screens, setScreens] = useState<ScreenView[]>([]);
  const [hiddenDisplays, setHiddenDisplays] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dragOverDisplay, setDragOverDisplay] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    const [nextDisplays, nextScreens] = await Promise.all([
      screensApi.listDisplays(),
      screensApi.list(),
    ]);
    setDisplays(nextDisplays);
    setScreens(nextScreens);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadData();
        if (isTauri()) {
          const visibility = await presentationWindowsApi.getVisibility();
          if (!cancelled) {
            setHiddenDisplays(new Set(visibility.filter((item) => !item.visible).map((item) => item.display_id)));
          }
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load screens.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [loadData]);

  const handleAssign = async (displayId: string, screenId: string) => {
    setError(null);
    setNotice(null);
    try {
      const updated = await screensApi.setBinding(screenId, { display_id: displayId });
      setScreens((current) => current.map((screen) => {
        if (screen.id === updated.id) return updated;
        if (screen.display_id === displayId || screen.display_id === updated.display_id) {
          return { ...screen, display_id: null, display_connected: false };
        }
        return screen;
      }));
      await presentationWindowsApi.assign(screenId, displayId);
      setHiddenDisplays((current) => {
        const next = new Set(current);
        next.delete(displayId);
        return next;
      });
      await loadData();
      setNotice("Presentation window assigned to monitor.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not assign the virtual screen.");
      // The binding may have been saved before native window creation failed.
      try { await loadData(); } catch { /* retain original error */ }
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setError(null);
    setNotice(null);
    try {
      const nextDisplays = await screensApi.refreshDisplays();
      setDisplays(nextDisplays);
      const nextScreens = await screensApi.list();
      setScreens(nextScreens);
      await presentationWindowsApi.refresh(
        nextScreens
          .filter((screen) => screen.display_id && screen.display_connected)
          .map((screen) => ({
            screen_id: screen.id,
            display_id: screen.display_id!,
          })),
      );
      setNotice("Displays detected and presentation windows realigned.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not refresh displays.");
    } finally {
      setRefreshing(false);
    }
  };

  const handleVisibility = async (displayId: string) => {
    const currentlyHidden = hiddenDisplays.has(displayId);
    const nextVisible = currentlyHidden;
    setError(null);
    try {
      await presentationWindowsApi.setVisible(displayId, nextVisible);
      setHiddenDisplays((current) => {
        const next = new Set(current);
        if (nextVisible) next.delete(displayId);
        else next.add(displayId);
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change window visibility.");
    }
  };

  const handleUnassign = async (screenId: string) => {
    setError(null);
    try {
      await screensApi.clearBinding(screenId);
      const nextScreens = await screensApi.list();
      setScreens(nextScreens);
      await presentationWindowsApi.refresh(
        nextScreens
          .filter((screen) => screen.display_id && screen.display_connected)
          .map((screen) => ({ screen_id: screen.id, display_id: screen.display_id! })),
      );
      setNotice("Virtual screen unassigned.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not unassign screen.");
    }
  };

  const desktop = useMemo(() => {
    if (!displays.length) return null;
    const minX = Math.min(...displays.map((display) => display.position[0]));
    const minY = Math.min(...displays.map((display) => display.position[1]));
    const maxX = Math.max(...displays.map((display) => display.position[0] + display.width));
    const maxY = Math.max(...displays.map((display) => display.position[1] + display.height));
    return { minX, minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
  }, [displays]);

  if (loading) {
    return <section className="screens-page"><div className="screens-loading">Loading displays…</div></section>;
  }

  return (
    <section className="screens-page">
      <header className="screens-header">
        <div>
          <h1>Screens</h1>
          <p>Assign audience and stage screens to your physical monitors.</p>
        </div>
        <button className="screens-refresh-button" onClick={handleRefresh} disabled={refreshing}>
          <RefreshCw size={16} className={refreshing ? "screens-spinning" : ""} />
          {refreshing ? "Refreshing…" : "Refresh displays"}
        </button>
      </header>

      {error && <div className="screens-message screens-error">{error}</div>}
      {notice && <div className="screens-message screens-notice">{notice}</div>}

      {!isTauri() && (
        <div className="screens-message screens-warning">
          Browser preview can display monitor information, but creating, moving and hiding native presentation windows requires the Tauri desktop app.
        </div>
      )}

      <div className="screens-workspace">
        <section className="screens-monitor-section">
          <div className="screens-section-heading">
            <div>
              <h2>Physical displays</h2>
              <span>{displays.length} detected</span>
            </div>
          </div>

          {displays.length === 0 ? (
            <div className="screens-empty">
              <Monitor size={30} />
              <strong>No displays detected</strong>
              <span>Use Refresh displays after connecting a monitor.</span>
            </div>
          ) : desktop && (
            <div
              className="screens-desktop-map"
              style={{ aspectRatio: `${desktop.width} / ${desktop.height}` }}
            >
              {displays.map((display) => {
                const assigned = screens.find((screen) => screen.display_id === display.id);
                const left = ((display.position[0] - desktop.minX) / desktop.width) * 100;
                const top = ((display.position[1] - desktop.minY) / desktop.height) * 100;
                const width = (display.width / desktop.width) * 100;
                const height = (display.height / desktop.height) * 100;
                const hidden = hiddenDisplays.has(display.id);

                return (
                  <div
                    key={display.id}
                    className={`screens-monitor ${dragOverDisplay === display.id ? "is-drag-over" : ""} ${assigned ? "is-assigned" : ""}`}
                    style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }}
                    onDragOver={(event) => {
                      if (event.dataTransfer.types.includes(SCREEN_DRAG_TYPE)) {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                        setDragOverDisplay(display.id);
                      }
                    }}
                    onDragLeave={() => setDragOverDisplay((current) => current === display.id ? null : current)}
                    onDrop={(event) => {
                      event.preventDefault();
                      setDragOverDisplay(null);
                      const screenId = event.dataTransfer.getData(SCREEN_DRAG_TYPE);
                      if (screenId) void handleAssign(display.id, screenId);
                    }}
                  >
                    <div className="screens-monitor-topline">
                      <span className="screens-monitor-index"><Monitor size={14} /> {display.name}</span>
                      {assigned && (
                        <button
                          className="screens-monitor-visibility"
                          title={hidden ? "Show presentation window" : "Hide presentation window"}
                          onClick={() => void handleVisibility(display.id)}
                        >
                          {hidden ? <Eye size={15} /> : <EyeOff size={15} />}
                        </button>
                      )}
                    </div>
                    <div className="screens-monitor-content">
                      {assigned ? (
                        <>
                          <MonitorPlay size={20} />
                          <strong>{assigned.name}</strong>
                          <span>{assigned.kind === "audience" ? "Audience screen" : "Stage screen"}</span>
                          {hidden && <em>Window hidden</em>}
                        </>
                      ) : (
                        <>
                          <Monitor size={20} />
                          <strong>Unassigned</strong>
                          <span>Drop a virtual screen here</span>
                        </>
                      )}
                    </div>
                    <div className="screens-monitor-resolution">
                      {display.width} × {display.height}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <p className="screens-map-hint">Monitor positions and relative sizes follow your desktop layout. Drag a virtual screen onto a monitor to assign it.</p>
        </section>

        <aside className="screens-virtual-section">
          <div className="screens-section-heading">
            <div>
              <h2>Virtual screens</h2>
              <span>{screens.length} configured</span>
            </div>
          </div>

          {screens.length === 0 ? (
            <div className="screens-empty screens-empty-compact">
              <strong>No virtual screens</strong>
              <span>Create audience and stage screens in your screen configuration first.</span>
            </div>
          ) : (
            <div className="screens-virtual-list">
              {screens.map((screen) => (
                <div
                  key={screen.id}
                  className="screens-virtual-card"
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData(SCREEN_DRAG_TYPE, screen.id);
                    event.dataTransfer.effectAllowed = "move";
                  }}
                >
                  <div className={`screens-kind-icon ${screen.kind}`}>
                    <Monitor size={18} />
                  </div>
                  <div className="screens-virtual-info">
                    <strong>{screen.name}</strong>
                    <span>{screen.kind === "audience" ? "Audience" : "Stage"} · {screen.width} × {screen.height}</span>
                    <small>
                      {screen.display_id
                        ? screen.display_connected
                          ? `Assigned: ${displays.find((display) => display.id === screen.display_id)?.name ?? "Monitor"}`
                          : "Assigned monitor disconnected"
                        : "Not assigned"}
                    </small>
                  </div>
                  {screen.display_id && (
                    <button
                      className="screens-unassign-button"
                      title="Unassign virtual screen"
                      onClick={() => void handleUnassign(screen.id)}
                    >
                      <Unlink size={15} />
                    </button>
                  )}
                  <span className="screens-drag-grip" aria-label="Drag to a monitor">⠿</span>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
