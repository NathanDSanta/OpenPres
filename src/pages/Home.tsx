import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, LayoutGrid, Minus, Plus, RotateCcw, Settings2, Trash2 } from "lucide-react";
import { systemApi } from "@/api";
import Modal from "@/components/ui/Modal";
import { Toggle } from "@/components/ui/Toggle";
import { WIDGETS, widgetDef } from "@/components/home/widgets";
import { GAP, MAX_SPAN, cellSize, findSpot, fits, isFree, spanPx, upgrade, type Rect, type WidgetInstance, type Workspace } from "@/components/home/grid";
import { useAutosave } from "@/hooks/useAutosave";
import { newId } from "@/lib/scene/defaults";
import { useDialogs } from "@/state/Dialogs";
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

export function defaultWorkspace(): Workspace {
  return {
    version: 2,
    cols: 8,
    rows: 4,
    scroll: false,
    widgets: [
      w("presenter", 0, 0, 2, 2, { target: "all" }),
      w("preview", 2, 0, 3, 2),
      w("clear", 5, 0, 1, 2),
      w("clock", 6, 0, 1, 1),
      w("stream", 7, 0, 1, 1),
      w("bible", 6, 1, 2, 1),
      w("playlist", 0, 2, 2, 2),
      w("library", 2, 2, 2, 2),
      w("media", 4, 2, 2, 1, { slot: "audio" }),
      w("timers", 4, 3, 2, 1),
      w("props", 6, 2, 2, 2),
    ],
  };
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
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [editing, setEditing] = useState(false);
  const [area, setArea] = useState({ width: 800, height: 600 });
  const [drag, setDrag] = useState<DragState | null>(null);
  const [palette, setPalette] = useState(false);
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const areaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void systemApi
      .getWorkspace<unknown>()
      .then((raw) => {
        const ws = upgrade(raw);
        setWorkspace(ws && ws.widgets.length ? ws : defaultWorkspace());
      })
      .catch(() => setWorkspace(defaultWorkspace()));
  }, []);

  const save = useAutosave("workspace", workspace, (ws) => systemApi.saveWorkspace(ws), 400);
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

  if (!workspace) return <section className="home-page" />;
  const { cols, rows, scroll } = workspace;
  // With scrolling the area has a scrollbar: keep a little room for it.
  const cell = cellSize(scroll ? area.width - 12 : area.width, area.height, cols, rows, scroll);
  const step = cell + GAP;

  const update = (patch: Partial<Workspace>) => setWorkspace((ws) => (ws ? { ...ws, ...patch } : ws));
  const setWidgets = (widgets: WidgetInstance[]) => update({ widgets });

  /** Widget settings changed from inside a widget (e.g. which playlist it shows). */
  const setConfig = (id: string, patch: Record<string, unknown>) =>
    setWorkspace((ws) => ws && { ...ws, widgets: ws.widgets.map((x) => (x.id === id ? { ...x, config: { ...x.config, ...patch } } : x)) });

  const addWidget = (type: string) => {
    const def = widgetDef(type);
    if (!def) return;
    const [dw, dh] = def.size;
    const spot = findSpot(dw, dh, workspace.widgets, cols, rows) ?? findSpot(1, 1, workspace.widgets, cols, rows);
    if (!spot) {
      notify(scroll ? "There is no free square: add a row first." : "There is no free square: add rows or columns, or make the page scrollable.");
      return;
    }
    const whole = isFree({ ...spot, w: dw, h: dh }, workspace.widgets) && fits({ ...spot, w: dw, h: dh }, cols, rows);
    setWidgets([...workspace.widgets, w(type, spot.x, spot.y, whole ? dw : 1, whole ? dh : 1)]);
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
    const dx = Math.round((e.clientX - drag.startX) / step);
    const dy = Math.round((e.clientY - drag.startY) / step);
    const s = drag.start;
    const def = widgetDef(workspace.widgets.find((x) => x.id === drag.id)?.type ?? "");
    const [minW, minH] = def?.min ?? [1, 1];
    const target: Rect =
      drag.mode === "move"
        ? { ...s, x: s.x + dx, y: s.y + dy }
        : { ...s, w: Math.max(minW, Math.min(MAX_SPAN, s.w + dx)), h: Math.max(minH, Math.min(MAX_SPAN, s.h + dy)) };
    const valid = fits(target, cols, rows) && isFree(target, workspace.widgets, drag.id);
    if (target.x !== drag.target.x || target.y !== drag.target.y || target.w !== drag.target.w || target.h !== drag.target.h || valid !== drag.valid) {
      setDrag({ ...drag, target, valid });
    }
  };
  const onPointerUp = () => {
    if (drag?.valid) setWidgets(workspace.widgets.map((x) => (x.id === drag.id ? { ...x, ...drag.target } : x)));
    setDrag(null);
  };

  const visible = workspace.widgets.filter((x) => fits(x, cols, rows));
  const hidden = workspace.widgets.length - visible.length;
  const pos = (r: Rect) => ({ left: r.x * step, top: r.y * step, width: spanPx(r.w, cell), height: spanPx(r.h, cell) });
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
    <section className="home-page">
      <header className="home-toolbar">
        {editing ? (
          <>
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
                onClick={() =>
                  void confirm({ title: "Restore the default layout?", message: "Your widgets are replaced by the default ones.", confirmLabel: "Restore", danger: true }).then(
                    (ok) => ok && setWorkspace(defaultWorkspace()),
                  )
                }
              >
                <RotateCcw size={14} /> Default
              </button>
              <button className="btn btn-small btn-primary" onClick={() => setEditing(false)}>
                <Check size={14} /> Done
              </button>
            </div>
          </>
        ) : (
          <>
            <span className="muted small">{hidden > 0 ? `${hidden} widget${hidden === 1 ? " is" : "s are"} outside the grid (edit the layout to show ${hidden === 1 ? "it" : "them"}).` : ""}</span>
            <button className="icon-btn" onClick={() => setEditing(true)} title="Edit layout">
              <LayoutGrid size={15} />
            </button>
          </>
        )}
      </header>
      <div className={`home-area${scroll ? " scroll" : ""}`} ref={areaRef}>
        <div
          className={`home-grid${editing ? " editing" : ""}`}
          style={{ width: spanPx(cols, cell), height: spanPx(rows, cell) }}
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
            const props = { config: widget.config, setConfig: (p: Record<string, unknown>) => setConfig(widget.id, p), w: widget.w, h: widget.h, cell };
            return (
              <article
                key={widget.id}
                className={`home-widget${drag?.id === widget.id ? " dragging" : ""}${def?.bare ? " bare" : ""}`}
                style={pos(widget)}
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
        <Modal title="Add a widget" onClose={() => setPalette(false)}>
          <div className="home-palette">
            {WIDGETS.filter((d) => !d.hidden).map((def) => (
              <button key={def.type} className="home-palette-item" onClick={() => addWidget(def.type)}>
                <def.icon size={18} />
                <span>
                  <strong>{def.title}</strong>
                  <small>{def.description}</small>
                </span>
                <em>
                  {def.size[0]}×{def.size[1]}
                </em>
              </button>
            ))}
          </div>
        </Modal>
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
    </section>
  );
}
