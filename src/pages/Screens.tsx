import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  BookOpen,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Layers,
  Megaphone,
  Monitor,
  MonitorPlay,
  Plus,
  Presentation,
  RefreshCw,
  Settings2,
  Shapes,
  Trash2,
  Unlink,
  Video,
} from "lucide-react";
import { screensApi } from "@/api/screens";
import { mediaApi } from "@/api/media";
import { presentationWindowsApi, type WindowAssignment } from "@/api/presentationWindows";
import { isTauri } from "@/api/transport";
import { markChanged, useLive, useRevision } from "@/api/events";
import SceneCanvas from "@/components/canvas/SceneCanvas";
import Modal from "@/components/ui/Modal";
import Select from "@/components/ui/Select";
import { ToggleRow } from "@/components/ui/Toggle";
import { DesignPicker, MediaSelect } from "@/components/pickers/pickers";
import { useAutosave, saveLabel } from "@/hooks/useAutosave";
import { useScene } from "@/hooks/useScene";
import { notifyError, useDialogs } from "@/state/Dialogs";
import { LAYER_KINDS, LAYER_LABELS, type LayerKind, type LayerToggles, type MediaFit, type PhysicalDisplay, type ScreenBackground, type ScreenInput, type ScreenView } from "@/types";
import "@/styles/Screens.css";

const SCREEN_DRAG_TYPE = "application/x-openpres-virtual-screen";

const LAYER_ICONS: Record<LayerKind, typeof Video> = {
  video_input: Video,
  media: ImageIcon,
  slides: Presentation,
  bible: BookOpen,
  announcements: Megaphone,
  complements: Layers,
  props: Shapes,
};

/** Screens that should currently have a native window. */
function windowAssignments(screens: ScreenView[]): WindowAssignment[] {
  return screens.filter((screen) => screen.display_id && screen.display_connected).map((screen) => ({ screen_id: screen.id, display_id: screen.display_id! }));
}

const allLayers = (): LayerToggles => Object.fromEntries(LAYER_KINDS.map((k) => [k, true])) as LayerToggles;

function newScreen(index: number): ScreenInput {
  return {
    name: `Screen ${index}`,
    kind: "audience",
    width: 1920,
    height: 1080,
    slides_design: null,
    bible_design: null,
    theme_id: null,
    announcements_theme_id: null,
    background: { type: "color", color: "#000000" },
    enabled_layers: allLayers(),
    mask: null,
  };
}

const toInput = ({ id: _id, display_id: _d, display_connected: _c, ...rest }: ScreenView): ScreenInput => ({
  ...rest,
  slides_design: rest.slides_design ?? null,
  bible_design: rest.bible_design ?? null,
  enabled_layers: { ...allLayers(), ...rest.enabled_layers },
});

const RESOLUTIONS: [number, number][] = [
  [1920, 1080],
  [1280, 720],
  [3840, 2160],
  [1024, 768],
  [1080, 1920],
];

const FIT_OPTIONS: { value: MediaFit; label: string }[] = [
  { value: "cover", label: "Fill (crop)" },
  { value: "contain", label: "Fit (letterbox)" },
  { value: "stretch", label: "Stretch" },
];

function BackgroundEditor({ value, onChange }: { value: ScreenBackground; onChange: (bg: ScreenBackground) => void }) {
  const { data: folders } = useLive(() => mediaApi.playlists());
  const visualFolders = (folders ?? []).filter((f) => f.kind !== "audio");
  const type = value.type;
  return (
    <div className="form-stack">
      <div className="field-row">
        <div className="field">
          <label>Background</label>
          <Select
            value={type}
            options={[
              { value: "color", label: "Colour" },
              { value: "media", label: "Picture or video" },
              { value: "folder", label: "Folder (cycle pictures / play videos)" },
            ]}
            onChange={(t) =>
              onChange(
                t === "color"
                  ? { type: "color", color: "#000000" }
                  : t === "media"
                    ? { type: "media", media_id: "", fit: "cover" }
                    : { type: "folder", folder_id: visualFolders[0]?.id ?? "", fit: "cover", seconds: 10 },
              )
            }
          />
        </div>
        {value.type === "color" && (
          <div className="field">
            <label>Colour</label>
            <input className="input color-input" type="color" value={value.color.slice(0, 7)} onChange={(e) => onChange({ type: "color", color: e.target.value.toUpperCase() })} />
          </div>
        )}
        {value.type !== "color" && (
          <div className="field">
            <label>Fit</label>
            <Select value={value.fit} options={FIT_OPTIONS} onChange={(fit) => onChange({ ...value, fit })} />
          </div>
        )}
      </div>
      {value.type === "media" && (
        <div className="field">
          <label>Picture or video</label>
          <MediaSelect kind={["image", "video"]} value={value.media_id || null} noneLabel="Choose…" allowNone={false} onChange={(id) => onChange({ ...value, media_id: id ?? "" })} />
        </div>
      )}
      {value.type === "folder" && (
        <div className="field-row">
          <div className="field">
            <label>Folder</label>
            <Select
              value={value.folder_id}
              placeholder="Choose a picture or video folder"
              options={visualFolders.map((f) => ({ value: f.id, label: f.name, hint: `${f.items.length} ${f.kind === "video" ? "videos" : "pictures"}` }))}
              onChange={(folder_id) => onChange({ ...value, folder_id })}
            />
          </div>
          {visualFolders.find((f) => f.id === value.folder_id)?.kind !== "video" && (
            <div className="field">
              <label>Seconds per picture</label>
              <input className="input" type="number" min={1} value={value.seconds} onChange={(e) => onChange({ ...value, seconds: Math.max(1, Number(e.target.value) || 1) })} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ScreenSettings({ screen, onClose, onDeleted }: { screen: ScreenView; onClose: () => void; onDeleted: () => void }) {
  const { confirm } = useDialogs();
  const [draft, setDraft] = useState<ScreenInput>(toInput(screen));
  const { scene, offset } = useScene(screen.id);
  const set = (patch: Partial<ScreenInput>) => setDraft((d) => ({ ...d, ...patch }));
  const state = useAutosave(screen.id, draft, async (d) => {
    await screensApi.update(screen.id, d);
    markChanged();
  });

  const remove = async () => {
    if (!(await confirm({ title: `Delete “${screen.name}”?`, message: "Its monitor window closes.", confirmLabel: "Delete", danger: true }))) return;
    try {
      await screensApi.remove(screen.id);
      if (isTauri()) {
        const remaining = (await screensApi.list()).filter((s) => s.id !== screen.id);
        await presentationWindowsApi.refresh(windowAssignments(remaining));
      }
      markChanged();
      onDeleted();
    } catch (e) {
      notifyError(e);
    }
  };

  const resolution = `${draft.width}x${draft.height}`;
  return (
    <Modal
      title={draft.name || "Screen"}
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-danger" onClick={() => void remove()}>
            <Trash2 size={14} /> Delete screen
          </button>
          <span className={`save-state${state.status === "error" ? " error" : ""}`}>{saveLabel(state)}</span>
          <span style={{ flex: 1 }} />
          <button className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <div className="dialog-split screen-settings">
        <div className="dialog-preview">
          <div className="screen-settings-preview">{scene ? <SceneCanvas scene={scene} offset={offset} /> : <div className="empty">Loading preview…</div>}</div>
          <div className="section-title">
            <span>Layers</span>
            <span className="muted small" style={{ textTransform: "none", fontWeight: 400 }}>
              bottom to top
            </span>
          </div>
          <div className="toggle-list">
            {LAYER_KINDS.map((kind) => {
              const Icon = LAYER_ICONS[kind];
              return (
                <ToggleRow
                  key={kind}
                  icon={<Icon size={16} />}
                  label={LAYER_LABELS[kind]}
                  checked={draft.enabled_layers[kind]}
                  onChange={(on) => set({ enabled_layers: { ...draft.enabled_layers, [kind]: on } })}
                />
              );
            })}
          </div>
        </div>
        <div className="form-stack">
          <div className="field-row">
            <div className="field">
              <label>Name</label>
              <input className="input" value={draft.name} onChange={(e) => set({ name: e.target.value })} />
            </div>
            <div className="field">
              <label>Type</label>
              <Select
                value={draft.kind}
                options={[
                  { value: "audience", label: "Audience" },
                  { value: "stage", label: "Stage" },
                ]}
                onChange={(kind) => set({ kind })}
              />
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label>Resolution</label>
              <Select
                value={RESOLUTIONS.some(([w, h]) => `${w}x${h}` === resolution) ? resolution : "custom"}
                options={[...RESOLUTIONS.map(([w, h]) => ({ value: `${w}x${h}`, label: `${w} × ${h}` })), { value: "custom", label: "Custom" }]}
                onChange={(v) => {
                  if (v === "custom") return;
                  const [w, h] = v.split("x").map(Number);
                  set({ width: w, height: h });
                }}
              />
            </div>
            <div className="field">
              <label>Width</label>
              <input className="input" type="number" min={1} value={draft.width} onChange={(e) => set({ width: Number(e.target.value) })} />
            </div>
            <div className="field">
              <label>Height</label>
              <input className="input" type="number" min={1} value={draft.height} onChange={(e) => set({ height: Number(e.target.value) })} />
            </div>
          </div>

          <div className="section-title">
            <span>Default background</span>
          </div>
          <BackgroundEditor value={draft.background} onChange={(background) => set({ background })} />

          <div className="section-title">
            <span>Designs</span>
          </div>
          <div className="field">
            <label>Slides</label>
            <DesignPicker kind="slides" value={draft.slides_design} noneLabel="The presentation's own design" onChange={(slides_design) => set({ slides_design, theme_id: null })} />
            {draft.theme_id && !draft.slides_design && <span className="muted small">Uses an older theme override; pick a design to replace it.</span>}
          </div>
          <div className="field">
            <label>Bible</label>
            <DesignPicker kind="slides" value={draft.bible_design} noneLabel="The Bible settings' design" onChange={(bible_design) => set({ bible_design })} />
          </div>
          <div className="field">
            <label>Mask</label>
            <DesignPicker kind="masks" value={draft.mask} noneLabel="No mask" onChange={(mask) => set({ mask })} />
            <span className="muted small">Masks are drawn on top of everything. Create and edit them in Themes → Masks.</span>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** A virtual screen as a live preview card (drag it onto a monitor). */
function ScreenCard({ screen, displays, selected, onSettings, onUnassign }: { screen: ScreenView; displays: PhysicalDisplay[]; selected: boolean; onSettings: () => void; onUnassign: () => void }) {
  const { scene, offset } = useScene(screen.id);
  const display = displays.find((d) => d.id === screen.display_id);
  const where = screen.display_id ? (screen.display_connected ? display?.name ?? "Monitor" : "Disconnected") : "Virtual";
  return (
    <article
      className={`screen-card${selected ? " selected" : ""}`}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(SCREEN_DRAG_TYPE, screen.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      onDoubleClick={onSettings}
      title="Drag onto a monitor; double-click for settings"
    >
      <div className="screen-card-preview">
        {scene ? <SceneCanvas scene={scene} offset={offset} /> : null}
        <button
          className="screen-card-settings icon-btn"
          onClick={(e) => {
            e.stopPropagation();
            onSettings();
          }}
          title="Settings"
        >
          <Settings2 size={15} />
        </button>
      </div>
      <footer>
        <strong title={screen.name}>{screen.name}</strong>
        <span className={screen.display_id && !screen.display_connected ? "warn" : ""}>{where}</span>
        {screen.display_id && (
          <button
            className="icon-btn"
            title="Unassign from the monitor"
            onClick={(e) => {
              e.stopPropagation();
              onUnassign();
            }}
          >
            <Unlink size={13} />
          </button>
        )}
      </footer>
    </article>
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
          if (!cancelled) setHiddenDisplays(new Set(visibility.filter((item) => !item.visible).map((item) => item.display_id)));
        }
      } catch (err) {
        if (!cancelled) notifyError(err);
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
    try {
      await screensApi.setBinding(screenId, { display_id: displayId });
      if (isTauri()) await presentationWindowsApi.assign(screenId, displayId);
      setHiddenDisplays((current) => {
        const next = new Set(current);
        next.delete(displayId);
        return next;
      });
      await loadData();
    } catch (err) {
      notifyError(err);
      await loadData().catch(() => undefined);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      setDisplays(await screensApi.refreshDisplays());
      const nextScreens = await screensApi.list();
      setScreens(nextScreens);
      if (isTauri()) await presentationWindowsApi.refresh(windowAssignments(nextScreens));
    } catch (err) {
      notifyError(err);
    } finally {
      setRefreshing(false);
    }
  };

  const handleVisibility = async (displayId: string) => {
    const nextVisible = hiddenDisplays.has(displayId);
    try {
      await presentationWindowsApi.setVisible(displayId, nextVisible);
      setHiddenDisplays((current) => {
        const next = new Set(current);
        if (nextVisible) next.delete(displayId);
        else next.add(displayId);
        return next;
      });
    } catch (err) {
      notifyError(err);
    }
  };

  const handleUnassign = async (screenId: string) => {
    try {
      await screensApi.clearBinding(screenId);
      const nextScreens = await screensApi.list();
      setScreens(nextScreens);
      if (isTauri()) await presentationWindowsApi.refresh(windowAssignments(nextScreens));
    } catch (err) {
      notifyError(err);
    }
  };

  const createScreen = async () => {
    try {
      const created = await screensApi.create(newScreen(screens.length + 1));
      await loadData();
      select(created.id);
    } catch (err) {
      notifyError(err);
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
      {!isTauri() && <div className="screens-message screens-warning">Monitor windows can only be created from the desktop app; screen settings work everywhere.</div>}

      <div className="screens-workspace">
        <section className="screens-monitor-section">
          <div className="screens-section-heading">
            <div>
              <h2>Physical displays</h2>
              <span>{displays.length} detected</span>
            </div>
            <button className="btn btn-small" onClick={() => void handleRefresh()} disabled={refreshing}>
              <RefreshCw size={14} className={refreshing ? "spin" : ""} />
              {refreshing ? "Refreshing…" : "Refresh displays"}
            </button>
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
                          <button className="screens-monitor-visibility" title={hidden ? "Show presentation window" : "Hide presentation window"} onClick={() => void handleVisibility(display.id)}>
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

        <aside className="panel screens-virtual">
          <header className="panel-header">
            <h2>Virtual screens</h2>
            <button className="btn btn-small" onClick={() => void createScreen()}>
              <Plus size={14} /> New
            </button>
          </header>
          <div className="panel-body screens-cards">
            {screens.length === 0 && (
              <div className="empty">
                <strong>No virtual screens</strong>
                <span>Create one with New.</span>
              </div>
            )}
            {screens.map((screen) => (
              <ScreenCard
                key={screen.id}
                screen={screen}
                displays={displays}
                selected={screen.id === editing}
                onSettings={() => select(screen.id)}
                onUnassign={() => void handleUnassign(screen.id)}
              />
            ))}
          </div>
        </aside>
      </div>
      {editingScreen && <ScreenSettings key={editingScreen.id} screen={editingScreen} onClose={() => select(null)} onDeleted={() => select(null)} />}
    </section>
  );
}
