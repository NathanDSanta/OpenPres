import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Palette } from "lucide-react";
import { mediaApi, themesApi, useLive } from "@/api";
import LookCanvas from "@/components/canvas/LookCanvas";
import Select from "@/components/ui/Select";
import { divider, heading, type MenuEntry } from "@/components/ui/Menu";
import { SAMPLE_BIBLE, SAMPLE_SLIDE } from "@/lib/scene/defaults";
import type { Design, DesignRef, MediaKind, Theme, ThemeKind, ThemeSummary } from "@/types";
import "./pickers.css";

/** Imported media of one kind. */
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
  const { data: folders } = useLive(() => mediaApi.playlists());
  const kinds = kind ? (Array.isArray(kind) ? kind : [kind]) : null;
  const folderOf = new Map((folders ?? []).flatMap((f) => f.items.map((id) => [id, f.name] as const)));
  const items = (data ?? []).filter((m) => !kinds || kinds.includes(m.kind));
  return (
    <Select
      value={value ?? ""}
      placeholder={items.length ? noneLabel : "Import media first"}
      options={[
        ...(allowNone ? [{ value: "", label: noneLabel }] : []),
        ...items.map((m) => ({ value: m.id, label: m.name, group: folderOf.get(m.id) ?? "Media", hint: m.kind })),
      ]}
      onChange={(v) => onChange(v || null)}
    />
  );
}

/** A theme of one kind. */
export function ThemeSelect({ kind, value, onChange, noneLabel = "None" }: { kind: ThemeKind; value: string | null; onChange: (id: string | null) => void; noneLabel?: string }) {
  const { data } = useLive(() => themesApi.list(kind), [kind]);
  return <Select value={value ?? ""} options={[{ value: "", label: noneLabel }, ...(data ?? []).map((t) => ({ value: t.id, label: t.name }))]} onChange={(v) => onChange(v || null)} />;
}

/** Menu entries: every theme as a submenu of its designs. */
export function designMenuEntries(themes: ThemeSummary[], value: DesignRef | null, onPick: (ref: DesignRef | null) => void, noneLabel?: string): MenuEntry[] {
  const entries: MenuEntry[] = [];
  if (noneLabel) {
    entries.push({ key: "none", label: noneLabel, checked: !value, onSelect: () => onPick(null) }, divider("d0"));
  }
  if (!themes.length) entries.push(heading("empty", "No themes yet (create them in Themes)"));
  for (const t of themes) {
    entries.push({
      key: t.id,
      label: t.name,
      checked: value?.theme_id === t.id,
      icon: value?.theme_id === t.id ? undefined : <Palette size={13} />,
      children: t.designs.map((d) => ({
        key: d.id,
        label: d.name,
        checked: value?.theme_id === t.id && value.design_id === d.id,
        onSelect: () => onPick({ theme_id: t.id, design_id: d.id }),
      })),
    });
  }
  return entries;
}

export function designLabel(themes: ThemeSummary[] | null | undefined, value: DesignRef | null): string | null {
  if (!value) return null;
  const t = themes?.find((x) => x.id === value.theme_id);
  const d = t?.designs.find((x) => x.id === value.design_id);
  return t && d ? `${t.name} · ${d.name}` : "Missing design";
}

/** A design drawn with sample words and a Bible passage, like the Themes page's list. */
function DesignThumb({ theme, design, kind }: { theme: Theme; design: Design; kind: ThemeKind }) {
  const look = useMemo(() => ({ theme: { id: theme.id, name: theme.name, width: theme.width, height: theme.height }, design }), [theme, design]);
  return <LookCanvas look={look} slide={SAMPLE_SLIDE} bible={SAMPLE_BIBLE} backdrop={kind === "masks" ? "#3a3a46" : "#111118"} animate={false} />;
}

/**
 * Picks one design, with previews: the button shows the chosen design small, and opens every
 * theme of the kind with its designs drawn. Used for presentations, screens, masks, Bible
 * passages and props.
 */
export function DesignPicker({
  value,
  onChange,
  kind = "slides",
  noneLabel = "None",
  small,
  disabled,
}: {
  value: DesignRef | null;
  onChange: (ref: DesignRef | null) => void;
  kind?: ThemeKind;
  noneLabel?: string;
  small?: boolean;
  disabled?: boolean;
}) {
  const { data: summaries } = useLive(() => themesApi.list(kind), [kind]);
  const { data: current } = useLive(() => (value ? themesApi.get(value.theme_id).catch(() => null) : Promise.resolve(null)), [value?.theme_id]);
  const label = designLabel(summaries, value);
  const chosen = current && value ? current.designs.find((d) => d.id === value.design_id) ?? null : null;
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState<DesignPanelPlace | null>(null);
  const toggle = () => {
    const r = trigger.current?.getBoundingClientRect();
    if (open || !r) return setOpen(null);
    const width = Math.min(520, window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    const below = window.innerHeight - r.bottom;
    setOpen(below >= 320 || below >= r.top ? { left, width, top: r.bottom + 6, maxHeight: below - 16 } : { left, width, bottom: window.innerHeight - r.top + 6, maxHeight: r.top - 16 });
  };
  return (
    <>
      <button ref={trigger} type="button" className={`select-trigger design-trigger${small ? " small" : ""}${open ? " open" : ""}`} disabled={disabled} onClick={toggle}>
        {chosen && current && (
          <span className="design-trigger-thumb">
            <DesignThumb theme={current} design={chosen} kind={kind} />
          </span>
        )}
        <span className={`select-value${label ? "" : " placeholder"}`}>{label ?? noneLabel}</span>
        <ChevronDown size={small ? 13 : 15} className="select-chevron" />
      </button>
      {open &&
        createPortal(
          <DesignPanel
            kind={kind}
            value={value}
            noneLabel={noneLabel}
            place={open}
            trigger={trigger}
            onPick={(ref) => {
              setOpen(null);
              onChange(ref);
            }}
            onClose={() => setOpen(null)}
          />,
          document.body,
        )}
    </>
  );
}

type DesignPanelPlace = { left: number; width: number; top?: number; bottom?: number; maxHeight: number };

/** The open picker: "none", then each theme with its designs drawn. */
function DesignPanel({
  kind,
  value,
  noneLabel,
  place,
  trigger,
  onPick,
  onClose,
}: {
  kind: ThemeKind;
  value: DesignRef | null;
  noneLabel: string;
  place: DesignPanelPlace;
  trigger: React.RefObject<HTMLButtonElement | null>;
  onPick: (ref: DesignRef | null) => void;
  onClose: () => void;
}) {
  const { data: themes } = useLive(() => themesApi.list(kind).then((list) => Promise.all(list.map((t) => themesApi.get(t.id)))), [kind]);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !trigger.current?.contains(t)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), onClose());
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose, trigger]);
  // The chosen design in view when it opens.
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>(".design-card.chosen")?.scrollIntoView({ block: "nearest" });
  }, [themes]);
  return (
    <div ref={panel} className="design-panel" role="listbox" style={{ left: place.left, width: place.width, top: place.top, bottom: place.bottom, maxHeight: place.maxHeight }}>
      <button className={`design-panel-none${value ? "" : " chosen"}`} onClick={() => onPick(null)}>
        {!value && <Check size={14} />} {noneLabel}
      </button>
      {!themes && <div className="design-panel-empty muted small">Loading designs…</div>}
      {themes && !themes.length && <div className="design-panel-empty muted small">No themes yet (create them in Themes).</div>}
      {themes?.map((t) => (
        <section key={t.id} className="design-panel-theme">
          <h4>
            <Palette size={12} /> {t.name}
          </h4>
          <div className="design-panel-grid">
            {t.designs.map((d) => {
              const chosen = value?.theme_id === t.id && value.design_id === d.id;
              return (
                <button key={d.id} className={`design-card${chosen ? " chosen" : ""}`} onClick={() => onPick({ theme_id: t.id, design_id: d.id })} title={`${t.name} · ${d.name}`}>
                  <DesignThumb theme={t} design={d} kind={kind} />
                  <span>{d.name}</span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

/** Kept for older call sites: a design of a props collection. */
export function DesignSelect({ value, onChange, kind = "props", noneLabel = "None" }: { value: DesignRef | null; onChange: (ref: DesignRef | null) => void; kind?: ThemeKind; noneLabel?: string }) {
  return <DesignPicker value={value} onChange={onChange} kind={kind} noneLabel={noneLabel} />;
}
