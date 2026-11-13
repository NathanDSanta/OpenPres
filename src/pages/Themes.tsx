import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Lock,
  Plus,
  Redo2,
  Save,
  Trash2,
  Undo2,
} from "lucide-react";
import { liveApi, markChanged, mediaApi, themesApi, timersApi, useLive } from "@/api";
import Tabs from "@/components/ui/Tabs";
import Modal from "@/components/ui/Modal";
import LookCanvas from "@/components/canvas/LookCanvas";
import Stage from "@/components/editor/Stage";
import { DesignInspector, ElementInspector } from "@/components/editor/Inspector";
import { ELEMENT_PRESETS, SAMPLE_SLIDE, mediaElement, newDesign, newElement, newId, textBlock } from "@/lib/scene/defaults";
import type { Design, Element, Theme, ThemeKind, Transform } from "@/types";
import "@/styles/Themes.css";

function newTheme(kind: ThemeKind): Theme {
  const design = newDesign(kind === "slides" ? "Lyrics" : "Prop");
  if (kind === "slides") {
    design.elements.push(
      newElement({
        name: "Slide text",
        transform: { x: 160, y: 140, width: 1600, height: 800, rotation: 0 },
        shadow: { enabled: true, color: "#000000CC", blur: 16, x: 0, y: 4 },
        text: textBlock({ type: "slide", scope: "current", field: "text" }, { font_size: 84, bold: true, scaling: "fit", min_font_size: 30, max_font_size: 120 }),
      }),
    );
  }
  return { id: "", name: kind === "slides" ? "New theme" : "New props", kind, width: 1920, height: 1080, designs: [design] };
}

function cloneDesign(d: Design): Design {
  return { ...structuredClone(d), id: newId(), name: `${d.name} copy`, elements: d.elements.map((e) => ({ ...structuredClone(e), id: newId() })) };
}

function MediaPickerDialog({ onPick, onClose }: { onPick: (id: string) => void; onClose: () => void }) {
  const { data } = useLive(() => mediaApi.list());
  const items = (data ?? []).filter((m) => m.kind !== "audio");
  return (
    <Modal title="Add imported media" onClose={onClose}>
      {items.length === 0 ? (
        <div className="empty">Import pictures or videos first (Import media at the top).</div>
      ) : (
        <div className="list">
          {items.map((m) => (
            <button key={m.id} className="list-row" onClick={() => onPick(m.id)}>
              <ImageIcon size={15} />
              <span className="grow">{m.name}</span>
              <span className="muted small">{m.kind}</span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

export default function Themes() {
  const [kind, setKind] = useState<ThemeKind>("slides");
  const { data: summaries, reload } = useLive(() => themesApi.list(kind), [kind]);
  const { data: timers } = useLive(() => timersApi.list());
  const { data: live } = useLive(() => liveApi.get());
  const [themeId, setThemeId] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme | null>(null);
  const [saved, setSaved] = useState<string>("");
  const [designId, setDesignId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mediaPicker, setMediaPicker] = useState(false);
  const history = useRef<{ past: Theme[]; future: Theme[]; lastPush: number }>({ past: [], future: [], lastPush: 0 });
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const dragRecorded = useRef(false);

  // Pick the first theme of the tab.
  useEffect(() => {
    if (!summaries) return;
    if (!themeId || !summaries.some((s) => s.id === themeId)) setThemeId(summaries[0]?.id ?? null);
  }, [summaries, themeId]);

  // Load the chosen theme (unless there are unsaved edits).
  useEffect(() => {
    if (!themeId) {
      setTheme(null);
      return;
    }
    let cancelled = false;
    void themesApi.get(themeId).then((t) => {
      if (cancelled) return;
      setTheme(t);
      setSaved(JSON.stringify(t));
      setDesignId((d) => (t.designs.some((x) => x.id === d) ? d : t.designs[0]?.id ?? null));
      setSelected(null);
      history.current = { past: [], future: [], lastPush: 0 };
    });
    return () => {
      cancelled = true;
    };
  }, [themeId]);

  const dirty = !!theme && JSON.stringify(theme) !== saved;
  const design = theme?.designs.find((d) => d.id === designId) ?? theme?.designs[0] ?? null;
  const element = design?.elements.find((e) => e.id === selected) ?? null;

  /** Applies a change; `group` merges quick successive edits (typing) into one undo step. */
  const change = useCallback((fn: (t: Theme) => Theme, group = true) => {
    const current = themeRef.current;
    if (!current) return;
    const now = performance.now();
    if (!group || now - history.current.lastPush > 600) {
      history.current.past.push(current);
      if (history.current.past.length > 80) history.current.past.shift();
      history.current.future = [];
    }
    history.current.lastPush = now;
    setTheme(fn(current));
  }, []);

  const updateDesign = (patch: Partial<Design> | ((d: Design) => Design), group = true) =>
    change((t) => ({
      ...t,
      designs: t.designs.map((d) => (d.id === design?.id ? (typeof patch === "function" ? patch(d) : { ...d, ...patch }) : d)),
    }), group);

  const updateElement = (id: string, patch: Partial<Element>, group = true) =>
    updateDesign((d) => ({ ...d, elements: d.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)) }), group);

  const undo = () => {
    const h = history.current;
    const prev = h.past.pop();
    if (prev && themeRef.current) {
      h.future.push(themeRef.current);
      setTheme(prev);
    }
  };
  const redo = () => {
    const h = history.current;
    const next = h.future.pop();
    if (next && themeRef.current) {
      h.past.push(themeRef.current);
      setTheme(next);
    }
  };

  const addElement = (el: Element) => {
    updateDesign((d) => ({ ...d, elements: [...d.elements, el] }), false);
    setSelected(el.id);
  };

  const duplicate = () => {
    if (!element) return;
    const copy = { ...structuredClone(element), id: newId(), name: `${element.name} copy` };
    copy.transform = { ...copy.transform, x: copy.transform.x + 30, y: copy.transform.y + 30 };
    addElement(copy);
  };

  const removeElement = () => {
    if (!element) return;
    updateDesign((d) => ({ ...d, elements: d.elements.filter((e) => e.id !== element.id) }), false);
    setSelected(null);
  };

  const reorder = (delta: number) => {
    if (!element || !design) return;
    const i = design.elements.findIndex((e) => e.id === element.id);
    const j = Math.max(0, Math.min(design.elements.length - 1, i + delta));
    if (i === j) return;
    updateDesign((d) => {
      const elements = [...d.elements];
      const [moved] = elements.splice(i, 1);
      elements.splice(j, 0, moved);
      return { ...d, elements };
    }, false);
  };

  const save = async () => {
    if (!theme) return;
    setError(null);
    try {
      const result = theme.id ? await themesApi.update(theme.id, theme) : await themesApi.create(theme);
      setTheme(result);
      setSaved(JSON.stringify(result));
      if (!theme.id) setThemeId(result.id);
      reload();
      markChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const createTheme = async () => {
    if (dirty && !confirm("Discard unsaved changes?")) return;
    try {
      const created = await themesApi.create(newTheme(kind));
      reload();
      setThemeId(created.id);
      markChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const deleteTheme = async () => {
    if (!theme?.id || !confirm(`Delete “${theme.name}”? Presentations using it will show the default look.`)) return;
    await themesApi.remove(theme.id);
    setThemeId(null);
    reload();
    markChanged();
  };

  const duplicateTheme = async () => {
    if (!theme) return;
    const copy = await themesApi.create({ ...structuredClone(theme), id: "", name: `${theme.name} copy`, designs: theme.designs.map(cloneDesign).map((d, i) => ({ ...d, name: theme.designs[i].name })) });
    reload();
    setThemeId(copy.id);
  };

  // Keyboard shortcuts.
  const handlers = useRef({ save, undo, redo, duplicate, removeElement, element, updateElement });
  handlers.current = { save, undo, redo, duplicate, removeElement, element, updateElement };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = /INPUT|TEXTAREA|SELECT/.test(target.tagName);
      const mod = e.ctrlKey || e.metaKey;
      const h = handlers.current;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void h.save();
      } else if (typing) {
        return;
      } else if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) h.redo();
        else h.undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        h.redo();
      } else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        h.duplicate();
      } else if ((e.key === "Delete" || e.key === "Backspace") && h.element) {
        e.preventDefault();
        h.removeElement();
      } else if (h.element && e.key.startsWith("Arrow") && !h.element.locked) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const t = h.element.transform;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        h.updateElement(h.element.id, { transform: { ...t, x: t.x + dx, y: t.y + dy } });
      } else if (e.key === "Escape") {
        setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const lookOf = useMemo(
    () => (d: Design) => (theme ? { theme: { id: theme.id, name: theme.name, width: theme.width, height: theme.height }, design: d } : null),
    [theme],
  );

  const isActive = (layer: "props" | "complements", d: Design) =>
    !!theme && (live?.[layer] ?? []).some((r) => r.theme_id === theme.id && r.design_id === d.id);

  return (
    <section className="page themes-page">
      <header className="page-header">
        <div>
          <h1>Themes</h1>
          <p>Slide themes are sets of designs used by presentations. Props collections hold props, complements and screen masks.</p>
        </div>
        <Tabs<ThemeKind>
          value={kind}
          onChange={(k) => {
            if (dirty && !confirm("Discard unsaved changes?")) return;
            setKind(k);
            setThemeId(null);
          }}
          tabs={[
            { id: "slides", label: "Slide themes" },
            { id: "props", label: "Props & complements" },
          ]}
        />
      </header>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="ed-layout">
        <aside className="ed-sidebar">
          <div className="ed-panel">
            <div className="ed-panel-head">
              <span>{kind === "slides" ? "Themes" : "Collections"}</span>
              <button className="btn btn-icon btn-small" onClick={() => void createTheme()} title="New">
                <Plus size={14} />
              </button>
            </div>
            <div className="list">
              {(summaries ?? []).map((s) => (
                <button
                  key={s.id}
                  className={`list-row${s.id === themeId ? " active" : ""}`}
                  onClick={() => {
                    if (s.id !== themeId && dirty && !confirm("Discard unsaved changes?")) return;
                    setThemeId(s.id);
                  }}
                >
                  <span className="grow">{s.name}</span>
                  <span className="muted small">{s.designs.length}</span>
                </button>
              ))}
              {summaries?.length === 0 && <div className="empty">None yet. Click +.</div>}
            </div>
          </div>

          {theme && (
            <div className="ed-panel ed-designs">
              <div className="ed-panel-head">
                <span>{kind === "slides" ? "Designs" : "Props"}</span>
                <button
                  className="btn btn-icon btn-small"
                  title="Add design"
                  onClick={() => {
                    const d = newDesign(kind === "slides" ? `Design ${theme.designs.length + 1}` : `Prop ${theme.designs.length + 1}`);
                    change((t) => ({ ...t, designs: [...t.designs, d] }), false);
                    setDesignId(d.id);
                    setSelected(null);
                  }}
                >
                  <Plus size={14} />
                </button>
              </div>
              <div className="ed-design-list">
                {theme.designs.map((d, i) => (
                  <div
                    key={d.id}
                    className={`ed-design${d.id === design?.id ? " active" : ""}`}
                    onClick={() => {
                      setDesignId(d.id);
                      setSelected(null);
                    }}
                  >
                    <LookCanvas look={lookOf(d)} slide={SAMPLE_SLIDE} timers={timers ?? []} backdrop="#111118" animate={false} />
                    <div className="ed-design-name">
                      <span>{d.name}</span>
                      <div className="ed-design-actions" onClick={(e) => e.stopPropagation()}>
                        <button className="btn btn-icon btn-small" disabled={i === 0} title="Move up" onClick={() => change((t) => { const ds = [...t.designs]; ds.splice(i - 1, 0, ds.splice(i, 1)[0]); return { ...t, designs: ds }; }, false)}>
                          <ArrowUp size={12} />
                        </button>
                        <button className="btn btn-icon btn-small" title="Duplicate" onClick={() => { const c = cloneDesign(d); change((t) => ({ ...t, designs: [...t.designs.slice(0, i + 1), c, ...t.designs.slice(i + 1)] }), false); setDesignId(c.id); }}>
                          <Copy size={12} />
                        </button>
                        <button className="btn btn-icon btn-small" disabled={theme.designs.length <= 1} title="Delete" onClick={() => confirm(`Delete the design “${d.name}”?`) && change((t) => ({ ...t, designs: t.designs.filter((x) => x.id !== d.id) }), false)}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                    {kind === "props" && theme.id && (
                      <div className="ed-design-live" onClick={(e) => e.stopPropagation()}>
                        {(["props", "complements"] as const).map((layer) => (
                          <button
                            key={layer}
                            className={`btn btn-small${isActive(layer, d) ? " btn-live" : ""}`}
                            disabled={dirty}
                            title={dirty ? "Save first" : `Show/hide on the ${layer} layer`}
                            onClick={() => void liveApi.setProp(layer, theme.id, d.id).then(markChanged)}
                          >
                            {layer === "props" ? "Prop" : "Complement"}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {design && (
            <div className="ed-panel ed-elements">
              <div className="ed-panel-head">
                <span>Elements</span>
              </div>
              <div className="list">
                {[...design.elements].reverse().map((el) => (
                  <div key={el.id} className={`list-row ed-element-row${el.id === selected ? " active" : ""}`} onClick={() => setSelected(el.id)}>
                    <span className="grow">{el.name || "Element"}</span>
                    {el.locked && <Lock size={12} className="muted" />}
                    <button
                      className="btn btn-icon btn-small"
                      title={el.visible ? "Hide" : "Show"}
                      onClick={(e) => {
                        e.stopPropagation();
                        updateElement(el.id, { visible: !el.visible }, false);
                      }}
                    >
                      {el.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                    </button>
                  </div>
                ))}
                {design.elements.length === 0 && <div className="muted small" style={{ padding: 8 }}>Empty design.</div>}
              </div>
            </div>
          )}
        </aside>

        <main className="ed-main">
          {theme && design ? (
            <>
              <div className="ed-toolbar">
                <div className="ed-tool-group">
                  {ELEMENT_PRESETS.map((preset) => (
                    <button key={preset.key} className="btn btn-small" onClick={() => addElement(preset.make(theme.width, theme.height))}>
                      {preset.label}
                    </button>
                  ))}
                  <button className="btn btn-small" onClick={() => setMediaPicker(true)}>
                    <ImageIcon size={13} /> Media
                  </button>
                </div>
                <div className="ed-tool-group">
                  <button className="btn btn-icon btn-small" onClick={undo} disabled={!history.current.past.length} title="Undo (Ctrl+Z)">
                    <Undo2 size={14} />
                  </button>
                  <button className="btn btn-icon btn-small" onClick={redo} disabled={!history.current.future.length} title="Redo (Ctrl+Shift+Z)">
                    <Redo2 size={14} />
                  </button>
                  <button className="btn btn-icon btn-small" onClick={() => reorder(1)} disabled={!element} title="Bring forward">
                    <ArrowUp size={14} />
                  </button>
                  <button className="btn btn-icon btn-small" onClick={() => reorder(-1)} disabled={!element} title="Send backward">
                    <ArrowDown size={14} />
                  </button>
                  <button className="btn btn-icon btn-small" onClick={duplicate} disabled={!element} title="Duplicate (Ctrl+D)">
                    <Copy size={14} />
                  </button>
                  <button className="btn btn-icon btn-small" onClick={removeElement} disabled={!element} title="Delete (Del)">
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="ed-tool-group">
                  <button className="btn btn-small" onClick={() => void duplicateTheme()} disabled={!theme.id}>
                    Duplicate
                  </button>
                  <button className="btn btn-small btn-danger" onClick={() => void deleteTheme()} disabled={!theme.id}>
                    Delete
                  </button>
                  <button className="btn btn-small btn-primary" onClick={() => void save()} disabled={!dirty}>
                    <Save size={14} /> {dirty ? "Save" : "Saved"}
                  </button>
                </div>
              </div>
              <div className="ed-stage-wrap">
                <Stage
                  theme={theme}
                  design={design}
                  selected={selected}
                  timers={timers ?? []}
                  onSelect={setSelected}
                  onPreview={(id, transform: Transform) => {
                    // One undo step per drag: record the state before the first move.
                    if (!dragRecorded.current && themeRef.current) {
                      history.current.past.push(themeRef.current);
                      history.current.future = [];
                      dragRecorded.current = true;
                    }
                    setTheme((t) =>
                      t && {
                        ...t,
                        designs: t.designs.map((d) =>
                          d.id === design.id ? { ...d, elements: d.elements.map((e) => (e.id === id ? { ...e, transform } : e)) } : d,
                        ),
                      },
                    );
                  }}
                  onCommit={() => {
                    dragRecorded.current = false;
                    history.current.lastPush = 0;
                  }}
                />
              </div>
              <p className="ed-hint muted small">
                Drag to move, handles to resize (Shift keeps proportions, Alt disables snapping). Arrows nudge, Ctrl+Z undo, Ctrl+S save.
              </p>
            </>
          ) : (
            <div className="card empty">Create a {kind === "slides" ? "theme" : "props collection"} with + on the left.</div>
          )}
        </main>

        <aside className="ed-inspector">
          {theme && design && element ? (
            <ElementInspector key={element.id} element={element} kind={theme.kind} onChange={(patch) => updateElement(element.id, patch)} />
          ) : theme && design ? (
            <DesignInspector
              theme={theme}
              design={design}
              onTheme={(patch) => change((t) => ({ ...t, ...patch }))}
              onDesign={(patch) => updateDesign(patch)}
            />
          ) : null}
        </aside>
      </div>

      {mediaPicker && theme && (
        <MediaPickerDialog
          onClose={() => setMediaPicker(false)}
          onPick={(id) => {
            setMediaPicker(false);
            addElement(mediaElement(id, theme.width, theme.height));
          }}
        />
      )}
    </section>
  );
}
