import { useCallback, useEffect, useLayoutEffect, useRef, useState, type SetStateAction } from "react";
import { Check, ChevronLeft, ChevronRight, CloudDownload, CloudUpload, LayoutDashboard, LayoutGrid, Minus, PencilLine, Plus, Settings2, Trash2 } from "lucide-react";
import Select from "@/components/ui/Select";
import { DASHBOARD_ICONS, DashboardPresetsContext, dashboardIcon, loadPresets, savePresets, single, type DashboardPreset, type DashboardPresets } from "@/components/home/dashboardPresets";
import { serverApi } from "@/api/serverApi";
import Modal from "@/components/ui/Modal";
import { Toggle } from "@/components/ui/Toggle";
import { WIDGETS, widgetDef } from "@/components/home/widgets";
import WidgetPalette from "@/components/home/WidgetPalette";
import { GAP, MAX_SPAN, cellSize, findSpot, fits, isFree, placeOver, shownWidgets, spanPx, upgrade, type Rect, type WidgetInstance, type Workspace } from "@/components/home/grid";
import { useAutosave } from "@/hooks/useAutosave";
import { contextEntries } from "@/components/global/ContextMenu";
import { newId } from "@/lib/scene/defaults";
import { notifyError, useDialogs } from "@/state/Dialogs";
import { useManager } from "@/state/Manager";
import { modeInfo, widgetAllowed, type Mode } from "@/lib/manager";
import "@/styles/Home.css";

const w = (type: string, x: number, y: number, wd: number, h: number, config: Record<string, unknown> = {}): WidgetInstance => ({
  id: newId(),
  type,
  x,
  y,
  w: wd,
  h,
  config,
});

/** The built-in dashboard of each mode (until the admin sets one on the server). */
export function defaultWorkspace(mode: Mode = "all"): Workspace {
  const base = { version: 2 as const, cols: 8, rows: 4, scroll: false };
  const big = { ...base, cols: 12, rows: 9 };
  if (mode === "livestream") {
    return {
      ...base,
      widgets: [
        w("preview", 0, 0, 4, 3, { follow: "stream" }),
        w("stream", 4, 0, 1, 1),
        w("clock", 5, 0, 1, 1),
        w("video-input", 4, 1, 1, 2),
        w("bus", 5, 1, 1, 3, { bus: 1 }),
        w("bus", 6, 1, 1, 3, { bus: 2 }),
      ],
    };
  }
  // Songs on the left, the picture and its controls in the middle, sound and the rest on
  // the right. 12×9 makes the 6×5 preview about 16:9 on a common 16:9 monitor.
  const widgets = [
    w("library", 0, 0, 3, 6),
    w("playlist", 0, 6, 3, 3),
    w("preview", 3, 0, 6, 5),
    w("presenter", 3, 5, 6, 4, { target: "all" }),
    w("bus", 9, 0, 1, 4, { bus: 1 }),
    w("bus", 10, 0, 1, 4, { bus: 2 }),
    w("bus", 11, 0, 1, 4, { bus: 3 }),
    w("props", 9, 4, 3, 2),
    w("video-input", 9, 6, 1, 3),
    w("timers", 10, 6, 2, 2),
    w("dashboards", 10, 8, 2, 1),
  ];
  return { ...big, widgets };
}

/** The server's default for the mode, or the built-in one. */
async function serverDashboard(mode: Mode): Promise<Workspace> {
  const ws = upgrade(await serverApi.defaultDashboard<unknown>(mode).catch(() => null));
  return ws && ws.widgets.length ? ws : defaultWorkspace(mode);
}

interface DragState {
  id: string;
  mode: "move" | "resize";
  startX: number;
  startY: number;
  start: Rect;
  target: Rect;
  valid: boolean;
}

export default function Home() {
  const { confirm, notify } = useDialogs();
  const { mode, admin } = useManager();
  const [store, setStore] = useState<DashboardPresets | null>(null);
  const active = store ? (store.presets.find((p) => p.id === store.active) ?? store.presets[0]) : null;
  const workspace = active?.workspace ?? null;
  /** Changes the dashboard being shown (the active preset). */
  const setWorkspace = useCallback((next: SetStateAction<Workspace | null>) => {
    setStore((s) => {
      if (!s) return s;
      const id = s.presets.some((p) => p.id === s.active) ? s.active : s.presets[0]?.id;
      return {
        ...s,
        presets: s.presets.map((p) => {
          if (p.id !== id) return p;
          const ws = typeof next === "function" ? next(p.workspace) : next;
          return ws ? { ...p, workspace: ws } : p;
        }),
      };
    });
  }, []);
  const switchTo = useCallback((id: string) => setStore((s) => (s && s.presets.some((p) => p.id === id) ? { ...s, active: id } : s)), []);
  const [presetDialog, setPresetDialog] = useState<"new" | "edit" | null>(null);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    const onEdit = () => setEditing((e) => !e);
    window.addEventListener("openpres:edit-home", onEdit);
    return () => window.removeEventListener("openpres:edit-home", onEdit);
  }, []);
  const [area, setArea] = useState({ width: 800, height: 600 });
  const [drag, setDrag] = useState<DragState | null>(null);
  const [palette, setPalette] = useState(false);
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const areaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setStore(null);
    const local = loadPresets(mode, newId);
    if (local) setStore(local);
    else void serverDashboard(mode).then((ws) => setStore(single(newId(), ws)));
  }, [mode]);

  const save = useAutosave(`dashboard-${mode}`, store, async (value) => {
    savePresets(mode, value);
    return value;
  }, 400);
  useEffect(() => {
    if (save.status === "error") notify(`The layout was not saved: ${save.error}`);
  }, [save.status, save.error, notify]);

  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const measure = () => setArea({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [workspace !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!store || !workspace || !active) return <section className="home-page" />;
  const index = store.presets.indexOf(active);
  const step = (d: number) => switchTo(store.presets[(index + d + store.presets.length) % store.presets.length].id);
  const ActiveIcon = dashboardIcon(active.icon);
  const savePreset = async (name: string, icon: string, start: "copy" | "default" | "empty") => {
    if (presetDialog === "edit") {
      setStore({ ...store, presets: store.presets.map((p) => (p.id === active.id ? { ...p, name, icon } : p)) });
    } else {
      const ws: Workspace =
        start === "copy" ? structuredClone(workspace) : start === "default" ? await serverDashboard(mode) : { ...workspace, widgets: [] };
      const id = newId();
      setStore({ active: id, presets: [...store.presets, { id, name, icon, workspace: ws }] });
    }
    setPresetDialog(null);
  };
  const deletePreset = () =>
    void confirm({ title: `Delete the "${active.name}" dashboard?`, message: "Its layout is removed from this machine.", confirmLabel: "Delete", danger: true }).then((ok) => {
      if (!ok) return;
      const presets = store.presets.filter((p) => p.id !== active.id);
      setStore({ active: presets[Math.min(index, presets.length - 1)].id, presets });
    });
  const { cols, rows, scroll } = workspace;
  // With scrolling the area has a scrollbar: keep a little room for it.
  const size = cellSize(scroll ? area.width - 12 : area.width, area.height, cols, rows, scroll);
  const cell = size.w;
  const stepX = size.w + GAP;
  const stepY = size.h + GAP;

  const update = (patch: Partial<Workspace>) => setWorkspace((ws) => (ws ? { ...ws, ...patch } : ws));
  const setWidgets = (widgets: WidgetInstance[]) => update({ widgets });

  /** Widget settings changed from inside a widget (e.g. which playlist it shows). */
  const setConfig = (id: string, patch: Record<string, unknown>) =>
    setWorkspace((ws) => ws && { ...ws, widgets: ws.widgets.map((x) => (x.id === id ? { ...x, config: { ...x.config, ...patch } } : x)) });

  // What's on the grid. Only these take up squares (shownWidgets).
  const visible = shownWidgets(workspace.widgets, cols, rows, (type) => widgetAllowed(mode, type));
  const shownIds = new Set(visible.map((x) => x.id));

  const addWidget = (type: string) => {
    const def = widgetDef(type);
    if (!def) return;
    const [dw, dh] = def.size;
    const spot = findSpot(dw, dh, visible, cols, rows) ?? findSpot(1, 1, visible, cols, rows);
    if (!spot) {
      notify(scroll ? "There is no free square: add a row first." : "There is no free square: add rows or columns, or make the page scrollable.");
      return;
    }
    const whole = isFree({ ...spot, w: dw, h: dh }, visible) && fits({ ...spot, w: dw, h: dh }, cols, rows);
    const added = w(type, spot.x, spot.y, whole ? dw : 1, whole ? dh : 1);
    setWidgets(placeOver([...workspace.widgets, added], added.id, shownIds));
    setPalette(false);
  };

  // ---- drag & resize (edit mode) ----
  const onPointerDown = (e: React.PointerEvent, widget: WidgetInstance, mode: DragState["mode"]) => {
    if (!editing) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const rect = { x: widget.x, y: widget.y, w: widget.w, h: widget.h };
    setDrag({ id: widget.id, mode, startX: e.clientX, startY: e.clientY, start: rect, target: rect, valid: true });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const dx = Math.round((e.clientX - drag.startX) / stepX);
    const dy = Math.round((e.clientY - drag.startY) / stepY);
    const s = drag.start;
    const def = widgetDef(workspace.widgets.find((x) => x.id === drag.id)?.type ?? "");
    const [minW, minH] = def?.min ?? [1, 1];
    const [maxW, maxH] = def?.max ?? [MAX_SPAN, MAX_SPAN];
    const target: Rect =
      drag.mode === "move"
        ? { ...s, x: s.x + dx, y: s.y + dy }
        : { ...s, w: Math.max(minW, Math.min(maxW, s.w + dx)), h: Math.max(minH, Math.min(maxH, s.h + dy)) };
    const valid = fits(target, cols, rows) && isFree(target, visible, drag.id);
    if (target.x !== drag.target.x || target.y !== drag.target.y || target.w !== drag.target.w || target.h !== drag.target.h || valid !== drag.valid) {
      setDrag({ ...drag, target, valid });
    }
  };
  const onPointerUp = () => {
    if (drag?.valid) setWidgets(placeOver(workspace.widgets.map((x) => (x.id === drag.id ? { ...x, ...drag.target } : x)), drag.id, shownIds));
    setDrag(null);
  };

  // A dashboard brought from another mode only shows what this mode works with.
  const hidden = workspace.widgets.filter((x) => widgetAllowed(mode, x.type) && !shownIds.has(x.id)).length;
  const pos = (r: Rect) => ({ left: r.x * stepX, top: r.y * stepY, width: spanPx(r.w, size.w), height: spanPx(r.h, size.h) });
  const settingsWidget = workspace.widgets.find((x) => x.id === settingsFor);
  const settingsDef = settingsWidget && widgetDef(settingsWidget.type);
  const usedCols = Math.max(1, ...workspace.widgets.map((x) => x.x + x.w));
  const usedRows = Math.max(1, ...workspace.widgets.map((x) => x.y + x.h));

  const stepper = (label: string, value: number, min: number, max: number, set: (v: number) => void, warn?: number) => (
    <span className="home-stepper" title={warn !== undefined && value <= warn ? "Widgets outside the grid are hidden, not deleted" : undefined}>
      <span className="muted small">{label}</span>
      <button className="icon-btn" disabled={value <= min} onClick={() => set(value - 1)} aria-label={`Fewer ${label.toLowerCase()}`}>
        <Minus size={13} />
      </button>
      <b>{value}</b>
      <button className="icon-btn" disabled={value >= max} onClick={() => set(value + 1)} aria-label={`More ${label.toLowerCase()}`}>
        <Plus size={13} />
      </button>
    </span>
  );

  return (
    <DashboardPresetsContext.Provider value={{ value: store, switchTo }}>
    <section className="home-page">
      {(editing || hidden > 0) && (
      <header className="home-toolbar">
        {editing ? (
          <>
            <div className="home-preset-switcher" title="Dashboards of this mode">
              <button className="icon-btn" onClick={() => step(-1)} disabled={store.presets.length < 2} aria-label="Previous dashboard">
                <ChevronLeft size={16} />
              </button>
              <div className="home-preset-name" key={active.id}>
                <ActiveIcon size={14} />
                <span>{active.name}</span>
                <small>
                  {index + 1}/{store.presets.length}
                </small>
              </div>
              <button className="icon-btn" onClick={() => step(1)} disabled={store.presets.length < 2} aria-label="Next dashboard">
                <ChevronRight size={16} />
              </button>
              <span className="home-preset-actions">
                <button className="icon-btn" onClick={() => setPresetDialog("new")} title="New dashboard">
                  <Plus size={14} />
                </button>
                <button className="icon-btn" onClick={() => setPresetDialog("edit")} title="Rename or change its icon">
                  <PencilLine size={14} />
                </button>
                <button className="icon-btn" onClick={deletePreset} disabled={store.presets.length < 2} title={store.presets.length < 2 ? "The only dashboard can't be deleted" : "Delete this dashboard"}>
                  <Trash2 size={14} />
                </button>
              </span>
            </div>
            <div className="home-toolbar-group">
              {stepper("Columns", cols, 2, 24, (v) => update({ cols: v }), usedCols)}
              {stepper("Rows", rows, 1, 40, (v) => update({ rows: v }), usedRows)}
              <label className="home-scroll-toggle" title="Squares keep their size and the page scrolls for more rows">
                <Toggle small checked={scroll} onChange={(v) => update({ scroll: v })} />
                <span className="small">Scrollable</span>
              </label>
            </div>
            <div className="home-toolbar-group">
              <button className="btn btn-small" onClick={() => setPalette(true)}>
                <Plus size={14} /> Add widget
              </button>
              <button
                className="btn btn-small"
                title="Replace this dashboard with the server's default for this mode"
                onClick={() =>
                  void confirm({
                    title: "Reset to the server's default?",
                    message: `This machine's "${active.name}" dashboard is replaced by the ${modeInfo(mode).name} one set on the server.`,
                    confirmLabel: "Reset",
                    danger: true,
                  }).then((ok) => ok && void serverDashboard(mode).then(setWorkspace))
                }
              >
                <CloudDownload size={14} /> Reset to default
              </button>
              {admin && (
                <button
                  className="btn btn-small"
                  title="Every machine that resets gets this dashboard for this mode"
                  onClick={() =>
                    void confirm({
                      title: `Make this the default ${modeInfo(mode).name} dashboard?`,
                      message: "It's saved on the server. Each machine keeps its own until someone resets it there.",
                      confirmLabel: "Save as default",
                    }).then((ok) => {
                      if (ok) void serverApi.setDefaultDashboard(mode, workspace).then(() => notify("Saved as the server's default.", "ok"), notifyError);
                    })
                  }
                >
                  <CloudUpload size={14} /> Save as default
                </button>
              )}
              <button className="btn btn-small btn-primary" onClick={() => setEditing(false)}>
                <Check size={14} /> Done
              </button>
            </div>
          </>
        ) : (
          <>
            <span className="muted small">{hidden > 0 ? `${hidden} widget${hidden === 1 ? " doesn't" : "s don't"} fit on the grid (edit the layout to show ${hidden === 1 ? "it" : "them"}).` : ""}</span>
            <button className="btn btn-small" onClick={() => setEditing(true)}>
              <LayoutGrid size={14} /> Edit layout
            </button>
          </>
        )}
      </header>
      )}
      <div className={`home-area${scroll ? " scroll" : ""}`} ref={areaRef}>
        <div
          className={`home-grid${editing ? " editing" : ""}`}
          style={{ width: spanPx(cols, size.w), height: spanPx(rows, size.h) }}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {editing &&
            Array.from({ length: cols * rows }, (_, i) => <div key={i} className="home-cell" style={pos({ x: i % cols, y: Math.floor(i / cols), w: 1, h: 1 })} />)}
          {editing && drag && <div className={`home-ghost${drag.valid ? "" : " invalid"}`} style={pos(drag.target)} />}
          {visible.map((widget) => {
            const def = widgetDef(widget.type);
            const Icon = def?.icon;
            // Layouts saved before a widget got a size limit draw it within the limit.
            const shown = { ...widget, w: Math.min(widget.w, def?.max?.[0] ?? widget.w), h: Math.min(widget.h, def?.max?.[1] ?? widget.h) };
            const props = { config: widget.config, setConfig: (p: Record<string, unknown>) => setConfig(widget.id, p), w: shown.w, h: shown.h, cell };
            return (
              <article
                key={widget.id}
                ref={(el) =>
                  contextEntries(el, () => [
                    { key: "w-title", label: def?.title ?? widget.type, disabled: true, icon: Icon ? <Icon size={13} /> : undefined },
                    ...(def?.settings ? [{ key: "w-settings", label: "Widget settings…", icon: <Settings2 size={13} />, onSelect: () => setSettingsFor(widget.id) }] : []),
                    { key: "w-edit", label: editing ? "Done editing" : "Edit layout", icon: editing ? <Check size={13} /> : <LayoutGrid size={13} />, onSelect: () => setEditing(!editing) },
                    ...(store.presets.length > 1
                      ? [{ key: "w-dashboards", label: "Switch dashboard", icon: <LayoutDashboard size={13} />, children: store.presets.map((p) => ({ key: p.id, label: p.name, checked: p.id === active.id, onSelect: () => switchTo(p.id) })) }]
                      : []),
                    { key: "w-add", label: "Add a widget…", icon: <Plus size={13} />, onSelect: () => setPalette(true) },
                    { key: "w-remove", label: "Remove this widget", icon: <Trash2 size={13} />, danger: true, onSelect: () => setWidgets(workspace.widgets.filter((x) => x.id !== widget.id)) },
                  ])
                }
                className={`home-widget${drag?.id === widget.id ? " dragging" : ""}${def?.bare ? " bare" : ""}`}
                style={pos(shown)}
                onPointerDown={(e) => editing && onPointerDown(e, widget, "move")}
              >
                {(!def?.bare || editing) && (
                  <header className="home-widget-head">
                    {Icon && <Icon size={13} />}
                    <span>{def?.title ?? widget.type}</span>
                    {editing && (
                      <div className="home-widget-tools" onPointerDown={(e) => e.stopPropagation()}>
                        {def?.settings && (
                          <button className="icon-btn" onClick={() => setSettingsFor(widget.id)} title="Settings">
                            <Settings2 size={13} />
                          </button>
                        )}
                        <button className="icon-btn" onClick={() => setWidgets(workspace.widgets.filter((x) => x.id !== widget.id))} title="Remove">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </header>
                )}
                <div className="home-widget-body">{def ? def.render(props) : <span className="muted small">Unknown widget</span>}</div>
                {editing && <div className="home-widget-shield" />}
                {editing && <span className="home-resize" onPointerDown={(e) => onPointerDown(e, widget, "resize")} title="Resize" />}
              </article>
            );
          })}
        </div>
      </div>

      {palette && (
        <WidgetPalette defs={WIDGETS.filter((d) => !d.hidden && widgetAllowed(mode, d.type))} cell={size} onAdd={addWidget} onClose={() => setPalette(false)} />
      )}
      {settingsWidget && settingsDef?.settings && (
        <Modal
          title={`${settingsDef.title} settings`}
          onClose={() => setSettingsFor(null)}
          footer={
            <button className="btn btn-primary" onClick={() => setSettingsFor(null)}>
              Done
            </button>
          }
        >
          {settingsDef.settings({ config: settingsWidget.config, setConfig: (p) => setConfig(settingsWidget.id, p), w: settingsWidget.w, h: settingsWidget.h, cell })}
        </Modal>
      )}
      {presetDialog && (
        <PresetDialog
          title={presetDialog === "new" ? "New dashboard" : "Edit dashboard"}
          initial={presetDialog === "edit" ? active : undefined}
          onSave={(name, icon, start) => void savePreset(name, icon, start)}
          onClose={() => setPresetDialog(null)}
        />
      )}
    </section>
    </DashboardPresetsContext.Provider>
  );
}

/** Name and icon of a dashboard; a new one also picks what it starts with. */
function PresetDialog({
  title,
  initial,
  onSave,
  onClose,
}: {
  title: string;
  initial?: DashboardPreset;
  onSave: (name: string, icon: string, start: "copy" | "default" | "empty") => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [icon, setIcon] = useState(initial?.icon ?? "dashboard");
  const [start, setStart] = useState<"copy" | "default" | "empty">("copy");
  const ok = name.trim().length > 0;
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!ok} onClick={() => onSave(name.trim(), icon, start)}>
            <Check size={14} /> {initial ? "Save" : "Create"}
          </button>
        </>
      }
    >
      <div className="form-stack">
        <div className="field">
          <label>Name</label>
          <input className="input" autoFocus value={name} maxLength={40} placeholder="Sunday service, Kids, Rehearsal…" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ok && onSave(name.trim(), icon, start)} />
        </div>
        <div className="field">
          <label>Icon</label>
          <div className="home-icon-grid" role="radiogroup" aria-label="Icon">
            {Object.entries(DASHBOARD_ICONS).map(([key, I]) => (
              <button key={key} className={`icon-btn${icon === key ? " active" : ""}`} onClick={() => setIcon(key)} role="radio" aria-checked={icon === key} title={key}>
                <I size={16} />
              </button>
            ))}
          </div>
        </div>
        {!initial && (
          <div className="field">
            <label>Start with</label>
            <Select
              value={start}
              options={[
                { value: "copy", label: "A copy of this dashboard" },
                { value: "default", label: "The default dashboard" },
                { value: "empty", label: "An empty grid" },
              ]}
              onChange={setStart}
            />
          </div>
        )}
      </div>
    </Modal>
  );
}
