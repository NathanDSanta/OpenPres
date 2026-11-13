import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { LayoutGrid, Plus, RotateCcw, Save, Settings2, Trash2, X } from "lucide-react";
import { systemApi } from "@/api";
import Modal from "@/components/ui/Modal";
import { WIDGETS, widgetDef } from "@/components/home/widgets";
import {
  CELL,
  GAP,
  MAX_SPAN,
  cellsIn,
  findSpot,
  fits,
  isFree,
  spanPx,
  type Rect,
  type WidgetInstance,
  type Workspace,
} from "@/components/home/grid";
import { newId } from "@/lib/scene/defaults";
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
    version: 1,
    widgets: [
      w("presenter", 0, 0, 2, 2, { target: "all" }),
      w("preview", 2, 0, 3, 2),
      w("clear", 5, 0, 1, 2),
      w("clock", 6, 0, 1, 1),
      w("stream", 6, 1, 1, 1),
      w("playlist", 0, 2, 2, 2),
      w("library", 2, 2, 2, 2),
      w("media", 4, 2, 2, 1, { slot: "audio" }),
      w("timers", 4, 3, 2, 1),
      w("props", 6, 2, 1, 2),
    ],
  };
}

function isWorkspace(v: unknown): v is Workspace {
  return !!v && typeof v === "object" && Array.isArray((v as Workspace).widgets);
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
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [draft, setDraft] = useState<Workspace | null>(null);
  const [size, setSize] = useState({ cols: 1, rows: 1 });
  const [drag, setDrag] = useState<DragState | null>(null);
  const [palette, setPalette] = useState(false);
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const area = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editing = draft !== null;
  const current = draft ?? workspace;

  useEffect(() => {
    void systemApi
      .getWorkspace<unknown>()
      .then((ws) => setWorkspace(isWorkspace(ws) && ws.widgets.length ? ws : defaultWorkspace()))
      .catch(() => setWorkspace(defaultWorkspace()));
  }, []);

  // Columns and rows that fit; the grid is centred in the leftover space.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    const measure = () => setSize({ cols: cellsIn(el.clientWidth), rows: cellsIn(el.clientHeight) });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [workspace]);

  const persist = useCallback((ws: Workspace) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void systemApi.saveWorkspace(ws).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    }, 400);
  }, []);

  /** Widget settings changed from inside a widget (e.g. which playlist it shows). */
  const setConfig = (id: string, patch: Record<string, unknown>) => {
    const apply = (ws: Workspace) => ({ ...ws, widgets: ws.widgets.map((x) => (x.id === id ? { ...x, config: { ...x.config, ...patch } } : x)) });
    if (editing) setDraft((d) => d && apply(d));
    else
      setWorkspace((ws) => {
        if (!ws) return ws;
        const next = apply(ws);
        persist(next);
        return next;
      });
  };

  const startEdit = () => setDraft(structuredClone(workspace ?? defaultWorkspace()));
  const cancelEdit = () => setDraft(null);
  const saveEdit = async () => {
    if (!draft) return;
    try {
      await systemApi.saveWorkspace(draft);
      setWorkspace(draft);
      setDraft(null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const addWidget = (type: string) => {
    const def = widgetDef(type);
    if (!def || !draft) return;
    const [dw, dh] = def.size;
    const spot = findSpot(dw, dh, draft.widgets, size.cols, size.rows) ?? findSpot(1, 1, draft.widgets, size.cols, size.rows);
    if (!spot) {
      setError("There is no free space. Remove or shrink a widget first (or make the window bigger).");
      return;
    }
    const fitsDefault = isFree({ ...spot, w: dw, h: dh }, draft.widgets) && fits({ ...spot, w: dw, h: dh }, size.cols, size.rows);
    setDraft({ ...draft, widgets: [...draft.widgets, w(type, spot.x, spot.y, fitsDefault ? dw : 1, fitsDefault ? dh : 1)] });
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
    if (!drag || !draft) return;
    const step = CELL + GAP;
    const dx = Math.round((e.clientX - drag.startX) / step);
    const dy = Math.round((e.clientY - drag.startY) / step);
    const s = drag.start;
    const def = widgetDef(draft.widgets.find((x) => x.id === drag.id)?.type ?? "");
    const [minW, minH] = def?.min ?? [1, 1];
    const target: Rect =
      drag.mode === "move"
        ? { ...s, x: s.x + dx, y: s.y + dy }
        : { ...s, w: Math.max(minW, Math.min(MAX_SPAN, s.w + dx)), h: Math.max(minH, Math.min(MAX_SPAN, s.h + dy)) };
    const valid = fits(target, size.cols, size.rows) && isFree(target, draft.widgets, drag.id);
    if (target.x !== drag.target.x || target.y !== drag.target.y || target.w !== drag.target.w || target.h !== drag.target.h || valid !== drag.valid) {
      setDrag({ ...drag, target, valid });
    }
  };
  const onPointerUp = () => {
    if (drag && draft && drag.valid) {
      setDraft({ ...draft, widgets: draft.widgets.map((x) => (x.id === drag.id ? { ...x, ...drag.target } : x)) });
    }
    setDrag(null);
  };

  if (!current) return <section className="home-page" />;

  const visible = current.widgets.filter((x) => fits(x, size.cols, size.rows));
  const hidden = current.widgets.length - visible.length;
  const gridW = spanPx(size.cols);
  const gridH = spanPx(size.rows);
  const pos = (r: Rect) => ({
    left: r.x * (CELL + GAP),
    top: r.y * (CELL + GAP),
    width: spanPx(r.w),
    height: spanPx(r.h),
  });
  const settingsWidget = current.widgets.find((x) => x.id === settingsFor);
  const settingsDef = settingsWidget && widgetDef(settingsWidget.type);

  return (
    <section className="home-page">
      <header className="home-toolbar">
        {editing ? (
          <>
            <span className="muted small">Drag widgets to move them; drag the corner to resize (up to 4×4).</span>
            <div className="page-actions">
              <button className="btn btn-small" onClick={() => setPalette(true)}>
                <Plus size={14} /> Add widget
              </button>
              <button className="btn btn-small" onClick={() => confirm("Replace the layout with the default one?") && setDraft(defaultWorkspace())}>
                <RotateCcw size={14} /> Default
              </button>
              <button className="btn btn-small" onClick={cancelEdit}>
                Cancel
              </button>
              <button className="btn btn-small btn-primary" onClick={() => void saveEdit()}>
                <Save size={14} /> Save layout
              </button>
            </div>
          </>
        ) : (
          <>
            {hidden > 0 ? (
              <span className="muted small">
                {hidden} widget{hidden === 1 ? "" : "s"} hidden: the window is too small for them.
              </span>
            ) : (
              <span />
            )}
            <button className="btn btn-small" onClick={startEdit}>
              <LayoutGrid size={14} /> Edit layout
            </button>
          </>
        )}
      </header>
      {error && (
        <div className="alert alert-error" onClick={() => setError(null)}>
          {error}
        </div>
      )}
      <div className="home-area" ref={area}>
        <div
          className={`home-grid${editing ? " editing" : ""}`}
          style={{ width: gridW, height: gridH, ["--cell" as string]: `${CELL}px`, ["--gap" as string]: `${GAP}px` }}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {editing &&
            Array.from({ length: size.cols * size.rows }, (_, i) => (
              <div key={i} className="home-cell" style={pos({ x: i % size.cols, y: Math.floor(i / size.cols), w: 1, h: 1 })} />
            ))}
          {editing && drag && <div className={`home-ghost${drag.valid ? "" : " invalid"}`} style={pos(drag.target)} />}
          {visible.map((widget) => {
            const def = widgetDef(widget.type);
            const Icon = def?.icon;
            return (
              <article
                key={widget.id}
                className={`home-widget${drag?.id === widget.id ? " dragging" : ""}`}
                style={pos(widget)}
                onPointerDown={(e) => editing && onPointerDown(e, widget, "move")}
              >
                <header className="home-widget-head">
                  {Icon && <Icon size={13} />}
                  <span>{def?.title ?? widget.type}</span>
                  {editing && (
                    <div className="home-widget-tools" onPointerDown={(e) => e.stopPropagation()}>
                      {def?.settings && (
                        <button className="btn btn-icon btn-small" onClick={() => setSettingsFor(widget.id)} title="Settings">
                          <Settings2 size={12} />
                        </button>
                      )}
                      <button
                        className="btn btn-icon btn-small"
                        onClick={() => setDraft({ ...draft!, widgets: draft!.widgets.filter((x) => x.id !== widget.id) })}
                        title="Remove"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )}
                </header>
                <div className="home-widget-body">
                  {def ? def.render({ config: widget.config, setConfig: (p) => setConfig(widget.id, p), w: widget.w, h: widget.h }) : <span className="muted small">Unknown widget</span>}
                </div>
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
            {WIDGETS.map((def) => (
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
        <Modal title={`${settingsDef.title} settings`} onClose={() => setSettingsFor(null)} footer={<button className="btn btn-primary" onClick={() => setSettingsFor(null)}><X size={14} /> Done</button>}>
          {settingsDef.settings({ config: settingsWidget.config, setConfig: (p) => setConfig(settingsWidget.id, p), w: settingsWidget.w, h: settingsWidget.h })}
        </Modal>
      )}
    </section>
  );
}
