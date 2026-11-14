import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Clipboard,
  Clock,
  Copy,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Lock,
  MoreHorizontal,
  Plus,
  Redo2,
  Shapes,
  Square,
  Trash2,
  Type,
  Undo2,
} from "lucide-react";
import { liveApi, markChanged, mediaApi, themesApi, timersApi, useLive } from "@/api";
import Tabs from "@/components/ui/Tabs";
import Modal from "@/components/ui/Modal";
import { useMenu, type MenuEntry } from "@/components/ui/Menu";
import LookCanvas from "@/components/canvas/LookCanvas";
import Stage from "@/components/editor/Stage";
import { DesignInspector, ElementInspector, MultiInspector } from "@/components/editor/Inspector";
import { ELEMENT_PRESETS, SAMPLE_BIBLE, SAMPLE_SLIDE, mediaElement, newDesign, newElement, newId, textBlock, type PresetCategory } from "@/lib/scene/defaults";
import { saveLabel, useAutosave } from "@/hooks/useAutosave";
import { useDialogs } from "@/state/Dialogs";
import type { Design, Element, Theme, ThemeKind, Transform } from "@/types";
import "@/styles/Themes.css";

const KIND_INFO: Record<ThemeKind, { tab: string; list: string; designs: string; item: string; newName: string; help: string }> = {
  slides: {
    tab: "Slide themes",
    list: "Themes",
    designs: "Designs",
    item: "Design",
    newName: "New theme",
    help: "Sets of designs for presentations and Bible passages. Each presentation (or screen) picks a design.",
  },
  props: {
    tab: "Props & complements",
    list: "Collections",
    designs: "Props",
    item: "Prop",
    newName: "New props",
    help: "Graphics shown on their own layer on top of the slides (logos, lower thirds, clocks…).",
  },
  masks: {
    tab: "Masks",
    list: "Collections",
    designs: "Masks",
    item: "Mask",
    newName: "New masks",
    help: "Drawn on top of everything on a screen, e.g. to hide parts of a projector image. Choose one per screen in Screens.",
  },
};

function newTheme(kind: ThemeKind): Theme {
  const info = KIND_INFO[kind];
  const design = newDesign(kind === "slides" ? "Lyrics" : `${info.item} 1`);
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
  return { id: "", name: info.newName, kind, width: 1920, height: 1080, designs: [design] };
}

function cloneDesign(d: Design): Design {
  return { ...structuredClone(d), id: newId(), name: `${d.name} copy`, elements: d.elements.map((e) => ({ ...structuredClone(e), id: newId() })) };
}

// ---- Clipboard (shared by every theme kind, kept while the app runs) ----

const CLIPBOARD_KEY = "openpres.editor.clipboard";
let clipboard: Element[] | null = null;

function writeClipboard(elements: Element[]) {
  clipboard = structuredClone(elements);
  try {
    localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(clipboard));
  } catch {
    /* storage unavailable */
  }
}

function readClipboard(): Element[] | null {
  if (clipboard) return clipboard;
  try {
    const raw = localStorage.getItem(CLIPBOARD_KEY);
    if (raw) clipboard = JSON.parse(raw) as Element[];
  } catch {
    /* storage unavailable */
  }
  return clipboard;
}

const CATEGORY_ICON: Record<PresetCategory | "Media", typeof Type> = {
  Text: Type,
  Bible: BookOpen,
  Shapes: Shapes,
  Time: Clock,
  Media: ImageIcon,
};

function elementIcon(el: Element) {
  if (el.fill.type === "media") return <ImageIcon size={12} />;
  if (el.text?.source.type === "bible") return <BookOpen size={12} />;
  if (el.text?.source.type === "clock" || el.text?.source.type === "timer") return <Clock size={12} />;
  if (el.text) return <Type size={12} />;
  return <Square size={12} />;
}

function MediaPickerDialog({ onPick, onClose }: { onPick: (id: string) => void; onClose: () => void }) {
  const { data } = useLive(() => mediaApi.list());
  const items = (data ?? []).filter((m) => m.kind !== "audio");
  return (
    <Modal title="Add imported media" onClose={onClose}>
      {items.length === 0 ? (
        <div className="empty">Import pictures or videos in the Media tab first.</div>
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
  const { confirm, notify } = useDialogs();
  const [kind, setKind] = useState<ThemeKind>("slides");
  const { data: summaries, reload } = useLive(() => themesApi.list(kind), [kind]);
  const { data: timers } = useLive(() => timersApi.list());
  const { data: live } = useLive(() => liveApi.get());
  const [themeId, setThemeId] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme | null>(null);
  const [designId, setDesignId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const anchor = useRef<string | null>(null);
  const [mediaPicker, setMediaPicker] = useState(false);
  const [, setTick] = useState(0); // re-render after undo/redo stacks change
  const history = useRef<{ past: Theme[]; future: Theme[]; lastPush: number }>({ past: [], future: [], lastPush: 0 });
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const dragRecorded = useRef(false);
  const addMenu = useMenu();
  const info = KIND_INFO[kind];

  // Pick the first theme of the tab.
  useEffect(() => {
    if (!summaries) return;
    if (!themeId || !summaries.some((s) => s.id === themeId)) setThemeId(summaries[0]?.id ?? null);
  }, [summaries, themeId]);

  // Load the chosen theme.
  useEffect(() => {
    if (!themeId) {
      setTheme(null);
      return;
    }
    let cancelled = false;
    void themesApi.get(themeId).then((t) => {
      if (cancelled) return;
      setTheme(t);
      setDesignId((d) => (t.designs.some((x) => x.id === d) ? d : t.designs[0]?.id ?? null));
      setSelected([]);
      history.current = { past: [], future: [], lastPush: 0 };
    });
    return () => {
      cancelled = true;
    };
  }, [themeId]);

  // Every change is saved automatically.
  const saveState = useAutosave(theme?.id || null, theme?.id ? theme : null, async (t: Theme) => {
    await themesApi.update(t.id, t);
    reload();
    markChanged();
  });

  const design = theme?.designs.find((d) => d.id === designId) ?? theme?.designs[0] ?? null;
  const selectedElements = useMemo(() => design?.elements.filter((e) => selected.includes(e.id)) ?? [], [design, selected]);
  const element = selectedElements.length === 1 ? selectedElements[0] : null;

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
    const next = fn(current);
    themeRef.current = next;
    setTheme(next);
  }, []);

  const updateDesign = (patch: Partial<Design> | ((d: Design) => Design), group = true) => {
    const id = design?.id;
    change(
      (t) => ({
        ...t,
        designs: t.designs.map((d) => (d.id === id ? (typeof patch === "function" ? patch(d) : { ...d, ...patch }) : d)),
      }),
      group,
    );
  };

  const updateElements = (patches: Record<string, Partial<Element>>, group = true) =>
    updateDesign((d) => ({ ...d, elements: d.elements.map((e) => (patches[e.id] ? { ...e, ...patches[e.id] } : e)) }), group);

  const updateElement = (id: string, patch: Partial<Element>, group = true) => updateElements({ [id]: patch }, group);

  const setTransforms = (ts: Record<string, Transform>, group = false) =>
    updateElements(Object.fromEntries(Object.entries(ts).map(([id, transform]) => [id, { transform }])), group);

  const undo = () => {
    const h = history.current;
    const prev = h.past.pop();
    if (prev && themeRef.current) {
      h.future.push(themeRef.current);
      themeRef.current = prev;
      setTheme(prev);
      setTick((n) => n + 1);
    }
  };
  const redo = () => {
    const h = history.current;
    const next = h.future.pop();
    if (next && themeRef.current) {
      h.past.push(themeRef.current);
      themeRef.current = next;
      setTheme(next);
      setTick((n) => n + 1);
    }
  };

  const addElements = (els: Element[]) => {
    if (!els.length) return;
    updateDesign((d) => ({ ...d, elements: [...d.elements, ...els] }), false);
    setSelected(els.map((e) => e.id));
  };

  /** Copies of elements with new ids, moved a little when they would cover the originals. */
  const copiesOf = (els: Element[], suffix = "") => {
    const taken = new Set(design?.elements.map((e) => `${e.transform.x},${e.transform.y}`) ?? []);
    const overlap = els.some((e) => taken.has(`${e.transform.x},${e.transform.y}`));
    return els.map((e) => {
      const copy = { ...structuredClone(e), id: newId(), name: `${e.name}${suffix}` };
      if (overlap) copy.transform = { ...copy.transform, x: copy.transform.x + 30, y: copy.transform.y + 30 };
      return copy;
    });
  };

  const duplicate = () => addElements(copiesOf(selectedElements, " copy"));

  const removeSelected = () => {
    if (!selectedElements.length) return;
    const ids = new Set(selected);
    updateDesign((d) => ({ ...d, elements: d.elements.filter((e) => !ids.has(e.id)) }), false);
    setSelected([]);
  };

  const copy = () => {
    if (!selectedElements.length) return;
    writeClipboard(selectedElements);
    notify(`Copied ${selectedElements.length === 1 ? `“${selectedElements[0].name}”` : `${selectedElements.length} elements`}. Paste them into any theme, prop or mask with Ctrl+V.`, "info");
  };

  const cut = () => {
    if (!selectedElements.length) return;
    writeClipboard(selectedElements);
    removeSelected();
  };

  const paste = () => {
    const els = readClipboard();
    if (!els?.length || !design) return;
    addElements(copiesOf(els));
  };

  /** Moves the selected elements up (towards the front) or down the stacking order. */
  const reorder = (delta: number) => {
    if (!design || !selected.length) return;
    updateDesign((d) => {
      const elements = [...d.elements];
      const indices = elements.map((e, i) => (selected.includes(e.id) ? i : -1)).filter((i) => i >= 0);
      const order = delta > 0 ? [...indices].reverse() : indices;
      for (const i of order) {
        const j = i + delta;
        if (j < 0 || j >= elements.length || selected.includes(elements[j].id)) continue;
        [elements[i], elements[j]] = [elements[j], elements[i]];
      }
      return { ...d, elements };
    }, false);
  };

  const createTheme = async () => {
    try {
      const created = await themesApi.create(newTheme(kind));
      reload();
      setThemeId(created.id);
      markChanged();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err));
    }
  };

  const deleteTheme = async () => {
    if (!theme?.id) return;
    const ok = await confirm({
      title: `Delete “${theme.name}”?`,
      message: kind === "slides" ? "Presentations using it will show the default look." : "Screens and layers using it stop showing it.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    await themesApi.remove(theme.id);
    setThemeId(null);
    setTheme(null);
    reload();
    markChanged();
  };

  const duplicateTheme = async () => {
    if (!theme) return;
    const copyTheme = await themesApi.create({
      ...structuredClone(theme),
      id: "",
      name: `${theme.name} copy`,
      designs: theme.designs.map(cloneDesign).map((d, i) => ({ ...d, name: theme.designs[i].name })),
    });
    reload();
    setThemeId(copyTheme.id);
  };

  /** Click in the element list: plain = only this one, Ctrl = toggle, Shift = range. */
  const clickRow = (e: React.MouseEvent, id: string, ordered: Element[]) => {
    if (e.shiftKey && anchor.current) {
      const a = ordered.findIndex((el) => el.id === anchor.current);
      const b = ordered.findIndex((el) => el.id === id);
      if (a >= 0 && b >= 0) {
        const [from, to] = a < b ? [a, b] : [b, a];
        setSelected(ordered.slice(from, to + 1).map((el) => el.id));
        return;
      }
    }
    anchor.current = id;
    if (e.ctrlKey || e.metaKey) setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
    else setSelected([id]);
  };

  // Keyboard shortcuts. Registered in the capture phase so they win over the global
  // presentation shortcuts (arrow keys) while an element is selected.
  const handlers = useRef({ undo, redo, duplicate, removeSelected, copy, cut, paste, selectedElements, setTransforms, design });
  handlers.current = { undo, redo, duplicate, removeSelected, copy, cut, paste, selectedElements, setTransforms, design };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (/INPUT|TEXTAREA|SELECT/.test(target.tagName) || target.isContentEditable) return;
      if (document.querySelector(".modal-backdrop, .cmd-backdrop, [data-menu-panel]")) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const h = handlers.current;
      const has = h.selectedElements.length > 0;
      const stop = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (mod && key === "z") {
        stop();
        if (e.shiftKey) h.redo();
        else h.undo();
      } else if (mod && key === "y") {
        stop();
        h.redo();
      } else if (mod && key === "d" && has) {
        stop();
        h.duplicate();
      } else if (mod && key === "c" && has && !window.getSelection()?.toString()) {
        stop();
        h.copy();
      } else if (mod && key === "x" && has) {
        stop();
        h.cut();
      } else if (mod && key === "v") {
        stop();
        h.paste();
      } else if (mod && key === "a" && h.design) {
        stop();
        setSelected(h.design.elements.filter((el) => el.visible).map((el) => el.id));
      } else if ((e.key === "Delete" || e.key === "Backspace") && has) {
        stop();
        h.removeSelected();
      } else if (has && e.key.startsWith("Arrow") && !mod) {
        stop();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        const ts: Record<string, Transform> = {};
        for (const el of h.selectedElements) if (!el.locked) ts[el.id] = { ...el.transform, x: el.transform.x + dx, y: el.transform.y + dy };
        h.setTransforms(ts, true);
      } else if (e.key === "Escape" && has) {
        stop();
        setSelected([]);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const lookOf = useMemo(
    () => (d: Design) => (theme ? { theme: { id: theme.id, name: theme.name, width: theme.width, height: theme.height }, design: d } : null),
    [theme],
  );

  const isActive = (layer: "props" | "complements", d: Design) =>
    !!theme && (live?.[layer] ?? []).some((r) => r.theme_id === theme.id && r.design_id === d.id);

  const openAdd = (category: PresetCategory, anchorEl: HTMLElement) => {
    if (!theme) return;
    const entries: MenuEntry[] = ELEMENT_PRESETS.filter((p) => p.category === category).map((p) => ({
      key: p.key,
      label: p.label,
      onSelect: () => addElements([p.make(theme.width, theme.height)]),
    }));
    addMenu.open(anchorEl, entries, 200);
  };

  const ordered = design ? [...design.elements].reverse() : [];
  const canPaste = !!readClipboard()?.length;

  return (
    <section className="page themes-page">
      <header className="page-header">
        <div>
          <h1>Themes</h1>
          <p>{info.help}</p>
        </div>
        <Tabs<ThemeKind>
          value={kind}
          onChange={(k) => {
            setKind(k);
            setThemeId(null);
            setTheme(null);
          }}
          tabs={(Object.keys(KIND_INFO) as ThemeKind[]).map((k) => ({ id: k, label: KIND_INFO[k].tab }))}
        />
      </header>

      <div className="ed-layout">
        <aside className="ed-sidebar">
          <div className="ed-panel">
            <div className="ed-panel-head">
              <span>{info.list}</span>
              <button className="btn btn-icon btn-small" onClick={() => void createTheme()} title="New">
                <Plus size={14} />
              </button>
            </div>
            <div className="list">
              {(summaries ?? []).map((s) => (
                <button key={s.id} className={`list-row${s.id === themeId ? " active" : ""}`} onClick={() => setThemeId(s.id)}>
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
                <span>{info.designs}</span>
                <button
                  className="btn btn-icon btn-small"
                  title={`Add ${info.item.toLowerCase()}`}
                  onClick={() => {
                    const d = newDesign(`${info.item} ${theme.designs.length + 1}`);
                    change((t) => ({ ...t, designs: [...t.designs, d] }), false);
                    setDesignId(d.id);
                    setSelected([]);
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
                      setSelected([]);
                    }}
                  >
                    <LookCanvas look={lookOf(d)} slide={SAMPLE_SLIDE} bible={SAMPLE_BIBLE} timers={timers ?? []} backdrop={kind === "masks" ? "#3a3a46" : "#111118"} animate={false} />
                    <div className="ed-design-name">
                      <span>{d.name}</span>
                      <div className="ed-design-actions" onClick={(e) => e.stopPropagation()}>
                        <button
                          className="btn btn-icon btn-small"
                          disabled={i === 0}
                          title="Move up"
                          onClick={() =>
                            change((t) => {
                              const ds = [...t.designs];
                              ds.splice(i - 1, 0, ds.splice(i, 1)[0]);
                              return { ...t, designs: ds };
                            }, false)
                          }
                        >
                          <ArrowUp size={12} />
                        </button>
                        <button
                          className="btn btn-icon btn-small"
                          title="Duplicate"
                          onClick={() => {
                            const c = cloneDesign(d);
                            change((t) => ({ ...t, designs: [...t.designs.slice(0, i + 1), c, ...t.designs.slice(i + 1)] }), false);
                            setDesignId(c.id);
                          }}
                        >
                          <Copy size={12} />
                        </button>
                        <button
                          className="btn btn-icon btn-small"
                          disabled={theme.designs.length <= 1}
                          title="Delete"
                          onClick={() =>
                            void confirm({ title: `Delete “${d.name}”?`, confirmLabel: "Delete", danger: true }).then(
                              (ok) => ok && change((t) => ({ ...t, designs: t.designs.filter((x) => x.id !== d.id) }), false),
                            )
                          }
                        >
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
                            title={`Show/hide on the ${layer} layer`}
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
                {selected.length > 1 && <span className="muted">{selected.length} selected</span>}
              </div>
              <div className="list">
                {ordered.map((el) => (
                  <div
                    key={el.id}
                    className={`list-row ed-element-row${selected.includes(el.id) ? " active" : ""}`}
                    onClick={(e) => clickRow(e, el.id, ordered)}
                  >
                    <span className="ed-element-kind">{elementIcon(el)}</span>
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
                {design.elements.length === 0 && (
                  <div className="muted small" style={{ padding: 8 }}>
                    Empty. Add elements with the toolbar.
                  </div>
                )}
              </div>
            </div>
          )}
        </aside>

        <main className="ed-main">
          {theme && design ? (
            <>
              <div className="ed-toolbar">
                <div className="ed-tool-group">
                  {(["Text", "Bible", "Shapes", "Time"] as PresetCategory[]).map((category) => {
                    const Icon = CATEGORY_ICON[category];
                    return (
                      <button key={category} className="btn btn-small" onClick={(e) => openAdd(category, e.currentTarget)}>
                        <Icon size={13} /> {category}
                      </button>
                    );
                  })}
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
                  <button className="btn btn-icon btn-small" onClick={() => reorder(1)} disabled={!selected.length} title="Bring forward">
                    <ArrowUp size={14} />
                  </button>
                  <button className="btn btn-icon btn-small" onClick={() => reorder(-1)} disabled={!selected.length} title="Send backward">
                    <ArrowDown size={14} />
                  </button>
                  <button className="btn btn-icon btn-small" onClick={copy} disabled={!selected.length} title="Copy (Ctrl+C)">
                    <Copy size={14} />
                  </button>
                  <button className="btn btn-icon btn-small" onClick={paste} disabled={!canPaste} title="Paste (Ctrl+V), also into other themes, props and masks">
                    <Clipboard size={14} />
                  </button>
                  <button className="btn btn-icon btn-small" onClick={removeSelected} disabled={!selected.length} title="Delete (Del)">
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="ed-tool-group">
                  <span className={`ed-save-state${saveState.status === "error" ? " error" : ""}`} title={saveState.error}>
                    {saveLabel(saveState) || "Saved"}
                  </span>
                  <button
                    className="btn btn-icon btn-small"
                    title="More"
                    onClick={(e) =>
                      addMenu.open(e.currentTarget, [
                        { key: "dup", label: `Duplicate “${theme.name}”`, icon: <Copy size={13} />, onSelect: () => void duplicateTheme() },
                        { key: "del", label: `Delete “${theme.name}”…`, icon: <Trash2 size={13} />, danger: true, onSelect: () => void deleteTheme() },
                      ])
                    }
                  >
                    <MoreHorizontal size={14} />
                  </button>
                </div>
              </div>
              <div className="ed-stage-wrap">
                <Stage
                  theme={theme}
                  design={design}
                  selected={selected}
                  timers={timers ?? []}
                  onSelect={(ids) => {
                    setSelected(ids);
                    anchor.current = ids[ids.length - 1] ?? null;
                  }}
                  onPreview={(transforms) => {
                    // One undo step per drag: record the state before the first move.
                    if (!dragRecorded.current && themeRef.current) {
                      history.current.past.push(themeRef.current);
                      history.current.future = [];
                      dragRecorded.current = true;
                    }
                    setTheme((t) => {
                      if (!t) return t;
                      const next = {
                        ...t,
                        designs: t.designs.map((d) =>
                          d.id === design.id ? { ...d, elements: d.elements.map((e) => (transforms[e.id] ? { ...e, transform: transforms[e.id] } : e)) } : d,
                        ),
                      };
                      themeRef.current = next;
                      return next;
                    });
                  }}
                  onCommit={() => {
                    dragRecorded.current = false;
                    history.current.lastPush = 0;
                    setTick((n) => n + 1);
                  }}
                />
              </div>
              <p className="ed-hint muted small">
                Drag to move, handles to resize (Shift keeps proportions, Alt disables snapping). Shift/Ctrl-click or drag an area to select several. Arrows nudge · Ctrl+C / Ctrl+V copy and paste
                between themes, props and masks · Ctrl+Z undo. Changes are saved automatically.
              </p>
            </>
          ) : (
            <div className="card empty">Create one with + on the left.</div>
          )}
        </main>

        <aside className="ed-inspector">
          {theme && design && selectedElements.length > 1 ? (
            <MultiInspector
              elements={selectedElements}
              canvas={theme}
              onTransforms={(ts) => setTransforms(ts)}
              onPatchAll={(patch) => updateElements(Object.fromEntries(selectedElements.map((e) => [e.id, patch])))}
              onDelete={removeSelected}
              onDuplicate={duplicate}
              onCopy={copy}
            />
          ) : theme && design && element ? (
            <ElementInspector key={element.id} element={element} kind={theme.kind} canvas={theme} onChange={(patch) => updateElement(element.id, patch)} />
          ) : theme && design ? (
            <DesignInspector theme={theme} design={design} onTheme={(patch) => change((t) => ({ ...t, ...patch }))} onDesign={(patch) => updateDesign(patch)} />
          ) : null}
        </aside>
      </div>

      {addMenu.element}
      {mediaPicker && theme && (
        <MediaPickerDialog
          onClose={() => setMediaPicker(false)}
          onPick={(id) => {
            setMediaPicker(false);
            addElements([mediaElement(id, theme.width, theme.height)]);
          }}
        />
      )}
    </section>
  );
}
