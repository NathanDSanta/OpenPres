import { mediaApi, themesApi, useLive } from "@/api";
import type { DesignRef, MediaKind, ThemeKind } from "@/types";

/** A <select> of imported media of one kind. */
export function MediaSelect({
  kind,
  value,
  onChange,
  allowNone = true,
  noneLabel = "None",
}: {
  kind?: MediaKind | MediaKind[];
  value: string | null;
  onChange: (id: string | null) => void;
  allowNone?: boolean;
  noneLabel?: string;
}) {
  const { data } = useLive(() => mediaApi.list());
  const kinds = kind ? (Array.isArray(kind) ? kind : [kind]) : null;
  const items = (data ?? []).filter((m) => !kinds || kinds.includes(m.kind));
  return (
    <select className="select" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      {allowNone && <option value="">{noneLabel}</option>}
      {items.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name} ({m.kind})
        </option>
      ))}
      {items.length === 0 && <option disabled>Import media first (Import media button)</option>}
    </select>
  );
}

/** A <select> of themes of one kind. */
export function ThemeSelect({
  kind,
  value,
  onChange,
  noneLabel = "None",
}: {
  kind: ThemeKind;
  value: string | null;
  onChange: (id: string | null) => void;
  noneLabel?: string;
}) {
  const { data } = useLive(() => themesApi.list(kind), [kind]);
  return (
    <select className="select" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{noneLabel}</option>
      {(data ?? []).map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </select>
  );
}

/** Picks one design of a props collection (masks, props). */
export function DesignSelect({
  value,
  onChange,
  kind = "props",
  noneLabel = "None",
}: {
  value: DesignRef | null;
  onChange: (ref: DesignRef | null) => void;
  kind?: ThemeKind;
  noneLabel?: string;
}) {
  const { data } = useLive(() => themesApi.list(kind), [kind]);
  const encoded = value ? `${value.theme_id}|${value.design_id}` : "";
  return (
    <select
      className="select"
      value={encoded}
      onChange={(e) => {
        const [theme_id, design_id] = e.target.value.split("|");
        onChange(e.target.value ? { theme_id, design_id } : null);
      }}
    >
      <option value="">{noneLabel}</option>
      {(data ?? []).map((t) => (
        <optgroup key={t.id} label={t.name}>
          {t.designs.map((d) => (
            <option key={d.id} value={`${t.id}|${d.id}`}>
              {d.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
