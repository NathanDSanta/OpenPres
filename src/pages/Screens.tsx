import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Eye, EyeOff, Monitor, MonitorPlay, Plus, RefreshCw, Save, Trash2, Unlink } from "lucide-react";
import { screensApi } from "@/api/screens";
import { presentationWindowsApi, type WindowAssignment } from "@/api/presentationWindows";
import { isTauri } from "@/api/transport";
import { markChanged, useRevision } from "@/api/events";
import SceneCanvas from "@/components/canvas/SceneCanvas";
import { DesignSelect, MediaSelect, ThemeSelect } from "@/components/pickers/pickers";
import { useScene } from "@/hooks/useScene";
import {
  LAYER_KINDS,
  LAYER_LABELS,
  type LayerToggles,
  type PhysicalDisplay,
  type ScreenInput,
  type ScreenView,
} from "@/types";
import "@/styles/Screens.css";

const SCREEN_DRAG_TYPE = "application/x-openpres-virtual-screen";

/** Screens that should currently have a native window. */
function windowAssignments(screens: ScreenView[]): WindowAssignment[] {
  return screens
    .filter((screen) => screen.display_id && screen.display_connected)
    .map((screen) => ({ screen_id: screen.id, display_id: screen.display_id! }));
}

const allLayers = (): LayerToggles =>
  Object.fromEntries(LAYER_KINDS.map((k) => [k, true])) as LayerToggles;

function newScreen(index: number): ScreenInput {
  return {
    name: `Screen ${index}`,
    kind: "audience",
    width: 1920,
    height: 1080,
    theme_id: null,
    announcements_theme_id: null,
    background: { type: "color", color: "#000000" },
    enabled_layers: allLayers(),
    mask: null,
  };
}

const toInput = ({ id: _id, display_id: _d, display_connected: _c, ...rest }: ScreenView): ScreenInput => rest;

const RESOLUTIONS: [number, number][] = [
  [1920, 1080],
  [1280, 720],
  [3840, 2160],
  [1024, 768],
  [1080, 1920],
];

function ScreenEditor({ screen, onSaved, onDeleted }: { screen: ScreenView; onSaved: () => void; onDeleted: () => void }) {
  const [draft, setDraft] = useState<ScreenInput>(toInput(screen));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { scene, offset } = useScene(screen.id);

  useEffect(() => setDraft(toInput(screen)), [screen]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(toInput(screen));
  const set = (patch: Partial<ScreenInput>) => setDraft((d) => ({ ...d, ...patch }));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await screensApi.update(screen.id, draft);
      markChanged();
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const toggleLayer = async (kind: keyof LayerToggles, on: boolean) => {
    // Layer switches apply immediately (handy during a service).
    set({ enabled_layers: { ...draft.enabled_layers, [kind]: on } });
    try {
      await screensApi.setLayer(screen.id, kind, on);
      markChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const remove = async () => {
    if (!confirm(`Delete the virtual screen “${screen.name}”?`)) return;
    await screensApi.remove(screen.id);
    if (isTauri()) {
      const remaining = (await screensApi.list()).filter((s) => s.id !== screen.id);
      await presentationWindowsApi.refresh(windowAssignments(remaining));
    }
    markChanged();
    onDeleted();
  };

  const resolution = `${draft.width}x${draft.height}`;
  return (
    <section className="card screen-editor">
      <div className="card-title">
        <span>Edit “{screen.name}”</span>
        <div className="page-actions">
          <button className="btn btn-small btn-danger" onClick={() => void remove()}>
            <Trash2 size={14} /> Delete
          </button>
          <button className="btn btn-small btn-primary" disabled={!dirty || saving} onClick={() => void save()}>
            <Save size={14} /> {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="screen-editor-preview">
        {scene ? <SceneCanvas scene={scene} offset={offset} /> : <div className="empty">Loading preview…</div>}
      </div>

      <div className="field-row">
        <div className="field">
          <label>Name</label>
          <input className="input" value={draft.name} onChange={(e) => set({ name: e.target.value })} />
        </div>
        <div className="field">
          <label>Type</label>
          <select className="select" value={draft.kind} onChange={(e) => set({ kind: e.target.value as ScreenInput["kind"] })}>
            <option value="audience">Audience</option>
            <option value="stage">Stage</option>
          </select>
        </div>
        <div className="field">
          <label>Resolution</label>
          <select
            className="select"
            value={RESOLUTIONS.some(([w, h]) => `${w}x${h}` === resolution) ? resolution : "custom"}
            onChange={(e) => {
              if (e.target.value === "custom") return;
              const [w, h] = e.target.value.split("x").map(Number);
              set({ width: w, height: h });
            }}
          >
            {RESOLUTIONS.map(([w, h]) => (
              <option key={`${w}x${h}`} value={`${w}x${h}`}>
                {w} × {h}
              </option>
            ))}
            <option value="custom">Custom</option>
          </select>
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label>Width</label>
          <input className="input" type="number" min={1} value={draft.width} onChange={(e) => set({ width: Number(e.target.value) })} />
        </div>
        <div className="field">
          <label>Height</label>
          <input className="input" type="number" min={1} value={draft.height} onChange={(e) => set({ height: Number(e.target.value) })} />
        </div>
      </div>

      <h3 className="screen-editor-heading">Default background</h3>
      <p className="muted small">What this screen shows when nothing covers it.</p>
      <div className="field-row">
        <div className="field">
          <label>Type</label>
          <select
            className="select"
            value={draft.background.type}
            onChange={(e) =>
              set({
                background:
                  e.target.value === "color"
                    ? { type: "color", color: "#000000" }
                    : { type: "media", media_id: "", fit: "cover" },
              })
            }
          >
            <option value="color">Colour</option>
            <option value="media">Picture</option>
          </select>
        </div>
        {draft.background.type === "color" ? (
          <div className="field">
            <label>Colour</label>
            <input
              className="input"
              type="color"
              value={draft.background.color.slice(0, 7)}
              onChange={(e) => set({ background: { type: "color", color: e.target.value.toUpperCase() } })}
            />
          </div>
        ) : (
          <>
            <div className="field">
              <label>Picture (imported)</label>
              <MediaSelect
                kind="image"
                value={draft.background.media_id || null}
                onChange={(id) => draft.background.type === "media" && set({ background: { ...draft.background, media_id: id ?? "" } })}
                noneLabel="Choose a picture…"
              />
            </div>
            <div className="field">
              <label>Fit</label>
              <select
                className="select"
                value={draft.background.fit}
                onChange={(e) =>
                  draft.background.type === "media" &&
                  set({ background: { ...draft.background, fit: e.target.value as "cover" } })
                }
              >
                <option value="cover">Fill (crop)</option>
                <option value="contain">Fit (letterbox)</option>
                <option value="stretch">Stretch</option>
              </select>
            </div>
          </>
        )}
      </div>

      <h3 className="screen-editor-heading">Layers</h3>
      <p className="muted small">Bottom to top. Turned-off layers never show on this screen. Changes apply immediately.</p>
      <div className="screen-layer-list">
        {LAYER_KINDS.map((kind, i) => (
          <label key={kind} className="check screen-layer">
            <input type="checkbox" checked={draft.enabled_layers[kind]} onChange={(e) => void toggleLayer(kind, e.target.checked)} />
            <span className="screen-layer-index">{i + 1}</span>
            {LAYER_LABELS[kind]}
          </label>
        ))}
        <div className="check screen-layer">
          <span className="screen-layer-index">7</span>
          Mask (always on top, set below)
        </div>
      </div>

      <h3 className="screen-editor-heading">Looks</h3>
      <div className="field-row">
        <div className="field">
          <label>Slides theme</label>
          <ThemeSelect kind="slides" value={draft.theme_id} onChange={(id) => set({ theme_id: id })} noneLabel="Presentation's own theme" />
        </div>
        <div className="field">
          <label>Announcements theme</label>
          <ThemeSelect
            kind="slides"
            value={draft.announcements_theme_id}
            onChange={(id) => set({ announcements_theme_id: id })}
            noneLabel="Presentation's own theme"
          />
        </div>
        <div className="field">
          <label>Mask</label>
          <DesignSelect value={draft.mask} onChange={(mask) => set({ mask })} noneLabel="No mask" />
        </div>
      </div>
    </section>
  );
}

export default function Screens() {
  const rev = useRevision();
  const [params, setParams] = useSearchParams();
  const [displays, setDisplays] = useState<PhysicalDisplay[]>([]);
  const [screens, setScreens] = useState<ScreenView[]>([]);
  const [hiddenDisplays, setHiddenDisplays] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dragOverDisplay, setDragOverDisplay] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const editing = params.get("edit");

  const loadData = useCallback(async () => {
    const [nextDisplays, nextScreens] = await Promise.all([screensApi.listDisplays(), screensApi.list()]);
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
    return () => {
      cancelled = true;
    };
  }, [loadData, rev]);

  const select = (id: string | null) => setParams(id ? { edit: id } : {});

  const handleAssign = async (displayId: string, screenId: string) => {
    setError(null);
    setNotice(null);
    try {
      await screensApi.setBinding(screenId, { display_id: displayId });
      if (isTauri()) await presentationWindowsApi.assign(screenId, displayId);
      setHiddenDisplays((current) => {
        const next = new Set(current);
        next.delete(displayId);
        return next;
      });
      await loadData();
      setNotice("Presentation window assigned to monitor.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not assign the virtual screen.");
      try {
        await loadData();
      } catch {
        /* retain original error */
      }
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setError(null);
    setNotice(null);
    try {
      setDisplays(await screensApi.refreshDisplays());
      const nextScreens = await screensApi.list();
      setScreens(nextScreens);
      if (isTauri()) await presentationWindowsApi.refresh(windowAssignments(nextScreens));
      setNotice("Displays detected and presentation windows realigned.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not refresh displays.");
    } finally {
      setRefreshing(false);
    }
  };

  const handleVisibility = async (displayId: string) => {
    const nextVisible = hiddenDisplays.has(displayId);
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
      if (isTauri()) await presentationWindowsApi.refresh(windowAssignments(nextScreens));
      setNotice("Virtual screen unassigned.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not unassign screen.");
    }
  };

  const createScreen = async () => {
    try {
      const created = await screensApi.create(newScreen(screens.length + 1));
      await loadData();
      select(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the screen.");
    }
  };

  const desktop = useMemo(() => {
    if (!displays.length) return null;
    const minX = Math.min(...displays.map((d) => d.position[0]));
    const minY = Math.min(...displays.map((d) => d.position[1]));
    const maxX = Math.max(...displays.map((d) => d.position[0] + d.width));
    const maxY = Math.max(...displays.map((d) => d.position[1] + d.height));
    return { minX, minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
  }, [displays]);

  const editingScreen = screens.find((s) => s.id === editing) ?? null;

  if (loading) {
    return (
      <section className="screens-page">
        <div className="screens-loading">Loading displays…</div>
      </section>
    );
  }

  return (
    <section className="screens-page">
      <header className="screens-header">
        <div>
          <h1>Screens</h1>
          <p>Create audience, stage and stream screens, choose what each shows, and assign them to monitors.</p>
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
          Monitor windows can only be created from the desktop app; screen settings work everywhere.
        </div>
      )}

      <div className="screens-workspace">
        <div className="screens-main-column">
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
            ) : (
              desktop && (
                <div className="screens-desktop-map" style={{ aspectRatio: `${desktop.width} / ${desktop.height}` }}>
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
                        onDragLeave={() => setDragOverDisplay((c) => (c === display.id ? null : c))}
                        onDrop={(event) => {
                          event.preventDefault();
                          setDragOverDisplay(null);
                          const screenId = event.dataTransfer.getData(SCREEN_DRAG_TYPE);
                          if (screenId) void handleAssign(display.id, screenId);
                        }}
                      >
                        <div className="screens-monitor-topline">
                          <span className="screens-monitor-index">
                            <Monitor size={14} /> {display.name}
                          </span>
                          {assigned && isTauri() && (
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
              )
            )}
            <p className="screens-map-hint">Drag a virtual screen onto a monitor to show it there.</p>
          </section>
          {editingScreen && (
            <ScreenEditor key={editingScreen.id} screen={editingScreen} onSaved={() => void loadData()} onDeleted={() => select(null)} />
          )}
        </div>

        <aside className="screens-virtual-section">
          <div className="screens-section-heading">
            <div>
              <h2>Virtual screens</h2>
              <span>{screens.length} configured</span>
            </div>
            <button className="btn btn-small" onClick={() => void createScreen()}>
              <Plus size={14} /> New
            </button>
          </div>

          {screens.length === 0 ? (
            <div className="screens-empty screens-empty-compact">
              <strong>No virtual screens</strong>
              <span>Create one with New.</span>
            </div>
          ) : (
            <div className="screens-virtual-list">
              {screens.map((screen) => (
                <div
                  key={screen.id}
                  className={`screens-virtual-card${screen.id === editing ? " is-selected" : ""}`}
                  draggable
                  onClick={() => select(screen.id)}
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
                    <span>
                      {screen.kind === "audience" ? "Audience" : "Stage"} · {screen.width} × {screen.height}
                    </span>
                    <small>
                      {screen.display_id
                        ? screen.display_connected
                          ? `Assigned: ${displays.find((d) => d.id === screen.display_id)?.name ?? "Monitor"}`
                          : "Assigned monitor disconnected"
                        : "Not assigned"}
                    </small>
                  </div>
                  {screen.display_id && (
                    <button
                      className="screens-unassign-button"
                      title="Unassign virtual screen"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleUnassign(screen.id);
                      }}
                    >
                      <Unlink size={15} />
                    </button>
                  )}
                  <span className="screens-drag-grip" aria-label="Drag to a monitor">
                    ⠿
                  </span>
                </div>
              ))}
            </div>
          )}
          <p className="screens-map-hint">Click a screen to edit it.</p>
        </aside>
      </div>
    </section>
  );
}
