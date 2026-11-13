import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Italic, Underline } from "lucide-react";
import { timersApi, useLive } from "@/api";
import { DEFAULT_TEXT_STYLE, textBlock } from "@/lib/scene/defaults";
import type { Design, Edges, Element, Shape, TextSource, TextStyle, Theme } from "@/types";
import { ColorField, FillEditor, NumberField, Section, Toggle } from "./fields";

const FONTS = [
  "sans-serif",
  "serif",
  "Inter",
  "Arial",
  "Helvetica",
  "Verdana",
  "Georgia",
  "Times New Roman",
  "Montserrat",
  "Open Sans",
  "Roboto",
  "Lato",
  "Oswald",
  "Bebas Neue",
  "Segoe UI",
  "Courier New",
  "monospace",
];

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

function TextSourceEditor({ source, onChange, kind }: { source: TextSource; onChange: (s: TextSource) => void; kind: Theme["kind"] }) {
  const { data: timers } = useLive(() => timersApi.list());
  return (
    <div className="ed-stack">
      <select
        className="select"
        value={source.type}
        onChange={(e) => {
          const type = e.target.value as TextSource["type"];
          if (type === "static") onChange({ type: "static", text: "Text" });
          if (type === "slide") onChange({ type: "slide", scope: "current", field: "text" });
          if (type === "clock") onChange({ type: "clock", format: "HH:mm" });
          if (type === "timer") onChange({ type: "timer", timer_id: timers?.[0]?.id ?? null, format: "mm:ss" });
        }}
      >
        <option value="static">Fixed text</option>
        <option value="slide">Linked to the presentation{kind === "props" ? " (live slide)" : ""}</option>
        <option value="clock">Linked to the clock</option>
        <option value="timer">Linked to a timer</option>
      </select>
      {source.type === "static" && (
        <textarea className="textarea" rows={3} value={source.text} onChange={(e) => onChange({ ...source, text: e.target.value })} />
      )}
      {source.type === "slide" && (
        <div className="ed-row">
          <select className="select" value={source.scope} onChange={(e) => onChange({ ...source, scope: e.target.value as typeof source.scope })}>
            <option value="current">Current slide</option>
            <option value="next">Next slide</option>
            <option value="previous">Previous slide</option>
          </select>
          <select className="select" value={source.field} onChange={(e) => onChange({ ...source, field: e.target.value as typeof source.field })}>
            <option value="text">Text</option>
            <option value="number">Number</option>
            <option value="total">Total slides</option>
            <option value="group">Group name</option>
            <option value="title">Presentation title</option>
          </select>
        </div>
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
          <select className="select" value={source.timer_id ?? ""} onChange={(e) => onChange({ ...source, timer_id: e.target.value || null })}>
            <option value="">Choose a timer…</option>
            {(timers ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <input className="input" value={source.format} onChange={(e) => onChange({ ...source, format: e.target.value })} list="timer-formats" />
          <datalist id="timer-formats">
            {["mm:ss", "H:mm:ss", "m:ss", "HH:mm:ss"].map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
          <span className="ed-small">Create timers in Settings → Timers.</span>
        </>
      )}
    </div>
  );
}

function TextStyleEditor({ style, onChange }: { style: TextStyle; onChange: (s: TextStyle) => void }) {
  const set = (patch: Partial<TextStyle>) => onChange({ ...style, ...patch });
  const toggle = (key: "bold" | "italic" | "underline", Icon: typeof Bold) => (
    <button className={`btn btn-icon btn-small${style[key] ? " btn-active" : ""}`} onClick={() => set({ [key]: !style[key] })} title={key}>
      <Icon size={14} />
    </button>
  );
  return (
    <div className="ed-stack">
      <input className="input" value={style.font_family} list="font-list" onChange={(e) => set({ font_family: e.target.value })} title="Font (any installed font)" />
      <datalist id="font-list">
        {FONTS.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
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
        <select className="select" value={style.scaling} onChange={(e) => set({ scaling: e.target.value as TextStyle["scaling"] })}>
          <option value="fixed">Off (always this size)</option>
          <option value="shrink">Only shrink to fit</option>
          <option value="grow">Only grow to fill</option>
          <option value="fit">Grow or shrink to fill</option>
        </select>
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
      <select
        className="select"
        value={shape.type}
        onChange={(e) => {
          const type = e.target.value as Shape["type"];
          const next: Shape =
            type === "star" ? { type, points: 5, inner_ratio: 0.5 } : type === "polygon" ? { type, sides: 6 } : ({ type } as Shape);
          onChange({ shape: next });
        }}
      >
        <option value="rectangle">Rectangle</option>
        <option value="ellipse">Circle / ellipse</option>
        <option value="triangle">Triangle</option>
        <option value="star">Star</option>
        <option value="polygon">Polygon</option>
      </select>
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

export function ElementInspector({ element, kind, onChange }: { element: Element; kind: Theme["kind"]; onChange: (patch: Partial<Element>) => void }) {
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
      <Section title={theme.kind === "props" ? "Collection" : "Theme"}>
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
