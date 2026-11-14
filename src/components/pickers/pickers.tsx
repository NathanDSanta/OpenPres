import { ChevronDown, Palette } from "lucide-react";
import { mediaApi, themesApi, useLive } from "@/api";
import Select from "@/components/ui/Select";
import { useMenu, divider, heading, type MenuEntry } from "@/components/ui/Menu";
import type { DesignRef, MediaKind, ThemeKind, ThemeSummary } from "@/types";

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

/**
 * Picks one design: the themes open as submenus with their designs (like the group
 * picker). Used for presentations, screens, masks and Bible passages.
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
  const { data } = useLive(() => themesApi.list(kind), [kind]);
  const menu = useMenu();
  const label = designLabel(data, value);
  return (
    <>
      <button
        type="button"
        className={`select-trigger${small ? " small" : ""}${menu.isOpen ? " open" : ""}`}
        disabled={disabled}
        onClick={(e) => menu.open(e.currentTarget, designMenuEntries(data ?? [], value, onChange, noneLabel), e.currentTarget.offsetWidth)}
      >
        <span className={`select-value${label ? "" : " placeholder"}`}>{label ?? noneLabel}</span>
        <ChevronDown size={small ? 13 : 15} className="select-chevron" />
      </button>
      {menu.element}
    </>
  );
}

/** Kept for older call sites: a design of a props collection. */
export function DesignSelect({ value, onChange, kind = "props", noneLabel = "None" }: { value: DesignRef | null; onChange: (ref: DesignRef | null) => void; kind?: ThemeKind; noneLabel?: string }) {
  return <DesignPicker value={value} onChange={onChange} kind={kind} noneLabel={noneLabel} />;
}
