import {
  AlignCenter,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceAround,
  AlignJustify,
  AlignLeft,
  AlignRight,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceAround,
  Bold,
  Italic,
  Underline,
} from "lucide-react";
import { timersApi, useLive } from "@/api";
import { DEFAULT_TEXT_STYLE, textBlock } from "@/lib/scene/defaults";
import type { BibleField, Design, Edges, Element, Shape, TextSource, TextStyle, Theme } from "@/types";
import Select from "@/components/ui/Select";
import FontPicker from "./FontPicker";
import { ColorField, FillEditor, NumberField, Section, Toggle } from "./fields";

function EdgesField({ label, value, onChange }: { label: string; value: Edges; onChange: (e: Edges) => void }) {
  return (
    <div className="ed-edges">
      <span className="ed-label">{label}</span>
      <div className="ed-grid4">
        {(["top", "right", "bottom", "left"] as const).map((side) => (
          <NumberField key={side} label={side[0].toUpperCase()} value={value[side]} min={0} onChange={(v) => onChange({ ...value, [side]: v })} />
        ))}
      </div>
    </div>
  );
}

const SOURCE_OPTIONS = (kind: Theme["kind"]) => [
  { value: "static" as const, label: "Fixed text" },
  { value: "slide" as const, label: kind === "slides" ? "Linked to the presentation" : "Linked to the live slide" },
  { value: "bible" as const, label: "Linked to the Bible passage" },
  { value: "clock" as const, label: "Linked to the clock" },
  { value: "timer" as const, label: "Linked to a timer" },
];

function TextSourceEditor({ source, onChange, kind }: { source: TextSource; onChange: (s: TextSource) => void; kind: Theme["kind"] }) {
  const { data: timers } = useLive(() => timersApi.list());
  return (
    <div className="ed-stack">
      <Select
        value={source.type}
        options={SOURCE_OPTIONS(kind)}
        onChange={(type) => {
          if (type === source.type) return;
          if (type === "static") onChange({ type: "static", text: "Text" });
          if (type === "slide") onChange({ type: "slide", scope: "current", field: "text" });
          if (type === "bible") onChange({ type: "bible", slot: 0, field: "text" });
          if (type === "clock") onChange({ type: "clock", format: "HH:mm" });
          if (type === "timer") onChange({ type: "timer", timer_id: timers?.[0]?.id ?? null, format: "mm:ss" });
        }}
      />
      {source.type === "static" && (
        <textarea className="textarea" rows={3} value={source.text} onChange={(e) => onChange({ ...source, text: e.target.value })} />
      )}
      {source.type === "slide" && (
        <div className="ed-row">
          <Select
            small
            value={source.scope}
            onChange={(scope) => onChange({ ...source, scope })}
            options={[
              { value: "current", label: "Current slide" },
              { value: "next", label: "Next slide" },
              { value: "previous", label: "Previous slide" },
            ]}
          />
          <Select
            small
            value={source.field}
            onChange={(field) => onChange({ ...source, field })}
            options={[
              { value: "text", label: "Text" },
              { value: "number", label: "Number" },
              { value: "total", label: "Total slides" },
              { value: "group", label: "Group name" },
              { value: "title", label: "Presentation title" },
            ]}
          />
        </div>
      )}
      {source.type === "bible" && (
        <>
          <div className="ed-row">
            <Select
              small
              value={String(source.slot)}
              onChange={(slot) => onChange({ ...source, slot: Number(slot) })}
              options={[0, 1, 2, 3].map((i) => ({ value: String(i), label: i === 0 ? "First version" : `Version ${i + 1}` }))}
            />
            <Select<BibleField>
              small
              value={source.field}
              onChange={(field) => onChange({ ...source, field })}
              options={[
                { value: "text", label: "Verse text" },
                { value: "reference", label: "Reference" },
                { value: "version", label: "Version name" },
                { value: "attribution", label: "Copyright line" },
              ]}
            />
          </div>
          <span className="ed-small">When several versions are shown at once, version 2 is the second one chosen, and so on.</span>
        </>
      )}
      {source.type === "clock" && (
        <>
          <input className="input" value={source.format} onChange={(e) => onChange({ ...source, format: e.target.value })} list="clock-formats" />
          <datalist id="clock-formats">
            {["HH:mm", "HH:mm:ss", "h:mm a", "h:mm:ss A", "H:mm"].map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
          <span className="ed-small">HH/H hours, hh/h 12-hour, mm minutes, ss seconds, a/A am-pm</span>
        </>
      )}
      {source.type === "timer" && (
        <>
          <Select
            value={source.timer_id ?? ""}
            placeholder="Choose a timer…"
            onChange={(id) => onChange({ ...source, timer_id: id || null })}
            options={(timers ?? []).map((t) => ({ value: t.id, label: t.name }))}
          />
          <input className="input" value={source.format} onChange={(e) => onChange({ ...source, format: e.target.value })} list="timer-formats" />
          <datalist id="timer-formats">
            {["mm:ss", "H:mm:ss", "m:ss", "HH:mm:ss"].map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
          <span className="ed-small">Create timers in the Timers tab.</span>
        </>
      )}
    </div>
  );
}

const JOIN_OPTIONS = [
  { value: "1", label: "Keep every line break" },
  { value: "2", label: "Join lines in pairs", hint: "removes every other break" },
  { value: "3", label: "Join lines in threes" },
  { value: "4", label: "Join lines in fours" },
  { value: "0", label: "Join everything", hint: "one paragraph" },
];

function TextStyleEditor({ style, onChange }: { style: TextStyle; onChange: (s: TextStyle) => void }) {
  const set = (patch: Partial<TextStyle>) => onChange({ ...style, ...patch });
  const toggle = (key: "bold" | "italic" | "underline", Icon: typeof Bold) => (
    <button className={`btn btn-icon btn-small${style[key] ? " btn-active" : ""}`} onClick={() => set({ [key]: !style[key] })} title={key}>
      <Icon size={14} />
    </button>
  );
  return (
    <div className="ed-stack">
      <FontPicker value={style.font_family} onChange={(font_family) => set({ font_family })} />
      <div className="ed-row">
        <NumberField label="Size" value={style.font_size} min={1} onChange={(font_size) => set({ font_size })} />
        <ColorField value={style.color} onChange={(color) => set({ color })} />
      </div>
      <div className="ed-row">
        {toggle("bold", Bold)}
        {toggle("italic", Italic)}
        {toggle("underline", Underline)}
        <button className={`btn btn-small${style.uppercase ? " btn-active" : ""}`} onClick={() => set({ uppercase: !style.uppercase })} title="All caps">
          AA
        </button>
        <span className="ed-spacer" />
        {(
          [
            ["left", AlignLeft],
            ["center", AlignCenter],
            ["right", AlignRight],
            ["justify", AlignJustify],
          ] as const
        ).map(([align, Icon]) => (
          <button key={align} className={`btn btn-icon btn-small${style.h_align === align ? " btn-active" : ""}`} onClick={() => set({ h_align: align })} title={align}>
            <Icon size={14} />
          </button>
        ))}
      </div>
      <div className="btn-group">
        {(["top", "middle", "bottom"] as const).map((v) => (
          <button key={v} className={`btn btn-small${style.v_align === v ? " btn-active" : ""}`} onClick={() => set({ v_align: v })}>
            {v[0].toUpperCase() + v.slice(1)}
          </button>
        ))}
      </div>
      <div className="ed-row">
        <NumberField label="Line height" step={0.05} min={0.5} value={style.line_height} onChange={(line_height) => set({ line_height })} />
        <NumberField label="Spacing" value={style.letter_spacing} onChange={(letter_spacing) => set({ letter_spacing })} />
      </div>
      <div className="field">
        <span className="ed-label">Dynamic scaling</span>
        <Select<TextStyle["scaling"]>
          value={style.scaling}
          onChange={(scaling) => set({ scaling })}
          options={[
            { value: "fixed", label: "Off (always this size)" },
            { value: "shrink", label: "Only shrink to fit" },
            { value: "grow", label: "Only grow to fill" },
            { value: "fit", label: "Grow or shrink to fill" },
          ]}
        />
      </div>
      <div className="field">
        <span className="ed-label">Line breaks</span>
        <Select value={String(style.join_lines ?? 1)} options={JOIN_OPTIONS} onChange={(v) => set({ join_lines: Number(v) })} />
        <span className="ed-small">Useful for lower thirds: two short lyric lines become one long line.</span>
      </div>
      {style.scaling !== "fixed" && (
        <div className="ed-row">
          {style.scaling !== "grow" && <NumberField label="Min size" min={1} value={style.min_font_size} onChange={(min_font_size) => set({ min_font_size })} />}
          {style.scaling !== "shrink" && <NumberField label="Max size" min={1} value={style.max_font_size} onChange={(max_font_size) => set({ max_font_size })} />}
        </div>
      )}
      <div className="ed-row">
        <NumberField label="Outline" min={0} value={style.outline_width} onChange={(outline_width) => set({ outline_width })} />
        {style.outline_width > 0 && <ColorField value={style.outline_color} onChange={(outline_color) => set({ outline_color })} />}
      </div>
      <EdgesField label="Text margins" value={style.margin} onChange={(margin) => set({ margin })} />
    </div>
  );
}

function ShapeEditor({ element, onChange }: { element: Element; onChange: (e: Partial<Element>) => void }) {
  const shape = element.shape;
  return (
    <div className="ed-stack">
      <Select<Shape["type"]>
        value={shape.type}
        onChange={(type) => {
          if (type === shape.type) return;
          const next: Shape =
            type === "star" ? { type, points: 5, inner_ratio: 0.5 } : type === "polygon" ? { type, sides: 6 } : ({ type } as Shape);
          onChange({ shape: next });
        }}
        options={[
          { value: "rectangle", label: "Rectangle" },
          { value: "ellipse", label: "Circle / ellipse" },
          { value: "triangle", label: "Triangle" },
          { value: "star", label: "Star" },
          { value: "polygon", label: "Polygon" },
        ]}
      />
      {shape.type === "rectangle" && <NumberField label="Rounded corners" min={0} value={element.corner_radius} onChange={(corner_radius) => onChange({ corner_radius })} />}
      {shape.type === "star" && (
        <div className="ed-row">
          <NumberField label="Points" min={3} max={24} value={shape.points} onChange={(points) => onChange({ shape: { ...shape, points: Math.round(points) } })} />
          <NumberField label="Inner" step={0.05} min={0.1} max={0.95} value={shape.inner_ratio} onChange={(inner_ratio) => onChange({ shape: { ...shape, inner_ratio } })} />
        </div>
      )}
      {shape.type === "polygon" && <NumberField label="Sides" min={3} max={24} value={shape.sides} onChange={(sides) => onChange({ shape: { ...shape, sides: Math.round(sides) } })} />}
    </div>
  );
}

export function ElementInspector({ element, kind, canvas, onChange }: { element: Element; kind: Theme["kind"]; canvas: { width: number; height: number }; onChange: (patch: Partial<Element>) => void }) {
  const t = element.transform;
  const setT = (patch: Partial<Element["transform"]>) => onChange({ transform: { ...t, ...patch } });
  return (
    <div className="ed-inspector-body">
      <Section title="Element">
        <input className="input" value={element.name} onChange={(e) => onChange({ name: e.target.value })} />
        <div className="ed-row">
          <Toggle label="Visible" checked={element.visible} onChange={(visible) => onChange({ visible })} />
          <Toggle label="Locked" checked={element.locked} onChange={(locked) => onChange({ locked })} />
        </div>
      </Section>
      <Section title="Position & size">
        <div className="ed-grid2">
          <NumberField label="X" value={t.x} onChange={(x) => setT({ x })} />
          <NumberField label="Y" value={t.y} onChange={(y) => setT({ y })} />
          <NumberField label="W" min={0} value={t.width} onChange={(width) => setT({ width })} />
          <NumberField label="H" min={0} value={t.height} onChange={(height) => setT({ height })} />
          <NumberField label="Rotate" value={t.rotation} suffix="°" onChange={(rotation) => setT({ rotation })} />
          <NumberField label="Opacity" step={0.05} min={0} max={1} value={element.opacity} onChange={(opacity) => onChange({ opacity })} />
        </div>
        <AlignTools elements={[element]} canvas={canvas} onTransforms={(ts) => ts[element.id] && onChange({ transform: ts[element.id] })} />
      </Section>
      <Section title="Shape">
        <ShapeEditor element={element} onChange={onChange} />
      </Section>
      <Section title="Background">
        <FillEditor fill={element.fill} onChange={(fill) => onChange({ fill })} />
      </Section>
      <Section title="Border" right={<Toggle label="On" checked={element.border.enabled} onChange={(enabled) => onChange({ border: { ...element.border, enabled } })} />}>
        {element.border.enabled && (
          <div className="ed-row">
            <NumberField label="Width" min={0} value={element.border.width} onChange={(width) => onChange({ border: { ...element.border, width } })} />
            <ColorField value={element.border.color} onChange={(color) => onChange({ border: { ...element.border, color } })} />
          </div>
        )}
      </Section>
      <Section title="Shadow" right={<Toggle label="On" checked={element.shadow.enabled} onChange={(enabled) => onChange({ shadow: { ...element.shadow, enabled } })} />}>
        {element.shadow.enabled && (
          <>
            <ColorField value={element.shadow.color} onChange={(color) => onChange({ shadow: { ...element.shadow, color } })} />
            <div className="ed-grid3">
              <NumberField label="Blur" min={0} value={element.shadow.blur} onChange={(blur) => onChange({ shadow: { ...element.shadow, blur } })} />
              <NumberField label="X" value={element.shadow.x} onChange={(x) => onChange({ shadow: { ...element.shadow, x } })} />
              <NumberField label="Y" value={element.shadow.y} onChange={(y) => onChange({ shadow: { ...element.shadow, y } })} />
            </div>
          </>
        )}
      </Section>
      <Section title="Padding">
        <EdgesField label="Inside the background" value={element.padding} onChange={(padding) => onChange({ padding })} />
      </Section>
      <Section
        title="Text"
        right={
          <Toggle
            label="On"
            checked={!!element.text}
            onChange={(on) => onChange({ text: on ? textBlock({ type: "static", text: "Text" }) : null })}
          />
        }
      >
        {element.text && (
          <>
            <TextSourceEditor source={element.text.source} kind={kind} onChange={(source) => onChange({ text: { ...element.text!, source } })} />
            <TextStyleEditor
              style={{ ...DEFAULT_TEXT_STYLE, ...element.text.style }}
              onChange={(style) => onChange({ text: { ...element.text!, style } })}
            />
          </>
        )}
      </Section>
    </div>
  );
}

export function DesignInspector({
  theme,
  design,
  onTheme,
  onDesign,
}: {
  theme: Theme;
  design: Design;
  onTheme: (patch: Partial<Theme>) => void;
  onDesign: (patch: Partial<Design>) => void;
}) {
  return (
    <div className="ed-inspector-body">
      <Section title="Design">
        <input className="input" value={design.name} onChange={(e) => onDesign({ name: e.target.value })} />
        <span className="ed-label">Background</span>
        <FillEditor fill={design.background} onChange={(background) => onDesign({ background })} />
      </Section>
      <Section title={theme.kind === "slides" ? "Theme" : "Collection"}>
        <input className="input" value={theme.name} onChange={(e) => onTheme({ name: e.target.value })} />
        <div className="ed-grid2">
          <NumberField label="Width" min={1} value={theme.width} onChange={(width) => onTheme({ width: Math.round(width) })} />
          <NumberField label="Height" min={1} value={theme.height} onChange={(height) => onTheme({ height: Math.round(height) })} />
        </div>
        <span className="ed-small">Elements are placed in this pixel space and scaled to every screen.</span>
      </Section>
      <p className="ed-small" style={{ padding: "0 14px" }}>
        Click an element on the canvas to edit it. Add elements with the toolbar.
      </p>
    </div>
  );
}

type AlignOp = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom" | "hdist" | "vdist";

/** Moves the elements so their edges/centres line up, or spaces them evenly. */
export function alignElements(elements: Element[], op: AlignOp, canvas: { width: number; height: number }): Record<string, Element["transform"]> {
  const out: Record<string, Element["transform"]> = {};
  const movable = elements.filter((e) => !e.locked);
  if (!movable.length) return out;
  // A single element aligns to the canvas.
  const box =
    elements.length === 1
      ? { x: 0, y: 0, r: canvas.width, b: canvas.height }
      : {
          x: Math.min(...elements.map((e) => e.transform.x)),
          y: Math.min(...elements.map((e) => e.transform.y)),
          r: Math.max(...elements.map((e) => e.transform.x + e.transform.width)),
          b: Math.max(...elements.map((e) => e.transform.y + e.transform.height)),
        };
  if (op === "hdist" || op === "vdist") {
    const horizontal = op === "hdist";
    const sorted = [...movable].sort((a, b) => (horizontal ? a.transform.x - b.transform.x : a.transform.y - b.transform.y));
    if (sorted.length < 3) return out;
    const size = sorted.reduce((sum, e) => sum + (horizontal ? e.transform.width : e.transform.height), 0);
    const span = horizontal ? box.r - box.x : box.b - box.y;
    const gap = (span - size) / (sorted.length - 1);
    let pos = horizontal ? box.x : box.y;
    for (const e of sorted) {
      out[e.id] = horizontal ? { ...e.transform, x: Math.round(pos) } : { ...e.transform, y: Math.round(pos) };
      pos += (horizontal ? e.transform.width : e.transform.height) + gap;
    }
    return out;
  }
  for (const e of movable) {
    const t = e.transform;
    const n = { ...t };
    if (op === "left") n.x = box.x;
    if (op === "right") n.x = box.r - t.width;
    if (op === "hcenter") n.x = (box.x + box.r) / 2 - t.width / 2;
    if (op === "top") n.y = box.y;
    if (op === "bottom") n.y = box.b - t.height;
    if (op === "vcenter") n.y = (box.y + box.b) / 2 - t.height / 2;
    out[e.id] = { ...n, x: Math.round(n.x), y: Math.round(n.y) };
  }
  return out;
}

const ALIGN_BUTTONS: { op: AlignOp; label: string; Icon: typeof AlignLeft }[] = [
  { op: "left", label: "Align left edges", Icon: AlignStartVertical },
  { op: "hcenter", label: "Align centres horizontally", Icon: AlignCenterVertical },
  { op: "right", label: "Align right edges", Icon: AlignEndVertical },
  { op: "hdist", label: "Space evenly horizontally", Icon: AlignHorizontalSpaceAround },
  { op: "top", label: "Align top edges", Icon: AlignStartHorizontal },
  { op: "vcenter", label: "Align centres vertically", Icon: AlignCenterHorizontal },
  { op: "bottom", label: "Align bottom edges", Icon: AlignEndHorizontal },
  { op: "vdist", label: "Space evenly vertically", Icon: AlignVerticalSpaceAround },
];

export function AlignTools({ elements, canvas, onTransforms }: { elements: Element[]; canvas: { width: number; height: number }; onTransforms: (t: Record<string, Element["transform"]>) => void }) {
  return (
    <div className="ed-align-grid">
      {ALIGN_BUTTONS.map(({ op, label, Icon }) => (
        <button
          key={op}
          className="btn btn-icon btn-small"
          title={elements.length === 1 && !op.endsWith("dist") ? `${label} (to the canvas)` : label}
          disabled={op.endsWith("dist") && elements.length < 3}
          onClick={() => onTransforms(alignElements(elements, op, canvas))}
        >
          <Icon size={14} />
        </button>
      ))}
    </div>
  );
}

/** Shown when several elements are selected. */
export function MultiInspector({
  elements,
  canvas,
  onTransforms,
  onPatchAll,
  onDelete,
  onDuplicate,
  onCopy,
}: {
  elements: Element[];
  canvas: { width: number; height: number };
  onTransforms: (t: Record<string, Element["transform"]>) => void;
  onPatchAll: (patch: Partial<Element>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onCopy: () => void;
}) {
  const allVisible = elements.every((e) => e.visible);
  const allLocked = elements.every((e) => e.locked);
  const opacity = elements[0]?.opacity ?? 1;
  return (
    <div className="ed-inspector-body">
      <Section title={`${elements.length} elements selected`}>
        <div className="ed-row">
          <Toggle label="Visible" checked={allVisible} onChange={(visible) => onPatchAll({ visible })} />
          <Toggle label="Locked" checked={allLocked} onChange={(locked) => onPatchAll({ locked })} />
        </div>
        <NumberField label="Opacity" step={0.05} min={0} max={1} value={opacity} onChange={(o) => onPatchAll({ opacity: o })} />
        <div className="ed-row">
          <button className="btn btn-small" onClick={onCopy}>
            Copy
          </button>
          <button className="btn btn-small" onClick={onDuplicate}>
            Duplicate
          </button>
          <span className="ed-spacer" />
          <button className="btn btn-small btn-danger" onClick={onDelete}>
            Delete {elements.length}
          </button>
        </div>
      </Section>
      <Section title="Align & distribute">
        <AlignTools elements={elements} canvas={canvas} onTransforms={onTransforms} />
      </Section>
      <p className="ed-small" style={{ padding: "0 14px" }}>
        Shift- or Ctrl-click elements (on the canvas or in the list) to add or remove them. Drag on an empty spot to select an area.
      </p>
    </div>
  );
}
