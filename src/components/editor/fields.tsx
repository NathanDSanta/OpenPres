import { useEffect, useState, type ReactNode } from "react";
import { MediaSelect } from "@/components/pickers/pickers";
import Select from "@/components/ui/Select";
import type { Fill } from "@/types";

/** Colour with alpha (#RRGGBB or #RRGGBBAA). */
export function ColorField({ value, onChange, label }: { value: string; onChange: (c: string) => void; label?: string }) {
  const rgb = (value || "#000000").slice(0, 7);
  const alpha = value.length === 9 ? parseInt(value.slice(7, 9), 16) / 255 : 1;
  const compose = (color: string, a: number) => {
    const hex = Math.round(Math.max(0, Math.min(1, a)) * 255)
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();
    return a >= 0.999 ? color.toUpperCase() : `${color.toUpperCase()}${hex}`;
  };
  return (
    <div className="ed-color">
      {label && <span className="ed-label">{label}</span>}
      <input type="color" value={rgb} onChange={(e) => onChange(compose(e.target.value, alpha))} />
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(alpha * 100)}
        onChange={(e) => onChange(compose(rgb, Number(e.target.value) / 100))}
        title={`Opacity ${Math.round(alpha * 100)}%`}
      />
      <span className="ed-small">{Math.round(alpha * 100)}%</span>
    </div>
  );
}

/** Number input that only commits valid numbers (keeps typing smooth). */
export function NumberField({
  label,
  value,
  onChange,
  step = 1,
  min,
  max,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  const [text, setText] = useState(String(round(value)));
  useEffect(() => setText(String(round(value))), [value]);
  return (
    <label className="ed-number">
      <span className="ed-label">{label}</span>
      <input
        className="input"
        type="number"
        step={step}
        min={min}
        max={max}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const v = Number(e.target.value);
          if (e.target.value !== "" && Number.isFinite(v)) {
            onChange(Math.max(min ?? -Infinity, Math.min(max ?? Infinity, v)));
          }
        }}
      />
      {suffix && <span className="ed-small">{suffix}</span>}
    </label>
  );
}

const round = (v: number) => Math.round(v * 100) / 100;

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="ed-section">
      <header>
        <h3>{title}</h3>
        {right}
      </header>
      <div className="ed-section-body">{children}</div>
    </section>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="ed-toggle" title={label}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

/** None / colour / gradient / imported media. */
export function FillEditor({ fill, onChange, allowMedia = true }: { fill: Fill; onChange: (f: Fill) => void; allowMedia?: boolean }) {
  return (
    <div className="ed-stack">
      <div className="btn-group ed-fill-types">
        {(["none", "color", "gradient", ...(allowMedia ? ["media"] : [])] as Fill["type"][]).map((type) => (
          <button
            key={type}
            className={`btn btn-small${fill.type === type ? " btn-active" : ""}`}
            onClick={() => {
              if (type === fill.type) return;
              if (type === "none") onChange({ type: "none" });
              else if (type === "color") onChange({ type: "color", color: "#B49AFFFF" });
              else if (type === "gradient") onChange({ type: "gradient", from: "#4C1D95", to: "#1E1B4B", angle: 135 });
              else onChange({ type: "media", media_id: "", fit: "cover", loop: true });
            }}
          >
            {type === "none" ? "None" : type === "color" ? "Colour" : type === "gradient" ? "Gradient" : "Media"}
          </button>
        ))}
      </div>
      {fill.type === "color" && <ColorField value={fill.color} onChange={(color) => onChange({ type: "color", color })} />}
      {fill.type === "gradient" && (
        <>
          <ColorField label="From" value={fill.from} onChange={(from) => onChange({ ...fill, from })} />
          <ColorField label="To" value={fill.to} onChange={(to) => onChange({ ...fill, to })} />
          <NumberField label="Angle" value={fill.angle} suffix="°" onChange={(angle) => onChange({ ...fill, angle })} />
        </>
      )}
      {fill.type === "media" && (
        <>
          <MediaSelect kind={["image", "video"]} value={fill.media_id || null} noneLabel="Choose imported media…" onChange={(id) => onChange({ ...fill, media_id: id ?? "" })} />
          <Select<typeof fill.fit>
            value={fill.fit}
            onChange={(fit) => onChange({ ...fill, fit })}
            options={[
              { value: "cover", label: "Fill (crop)" },
              { value: "contain", label: "Fit" },
              { value: "stretch", label: "Stretch" },
            ]}
          />
          <Toggle label="Loop videos" checked={fill.loop} onChange={(loop) => onChange({ ...fill, loop })} />
        </>
      )}
    </div>
  );
}
