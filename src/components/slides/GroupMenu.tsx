import { chipColors, groupNames, parseGroupName } from "@/lib/groups";
import { useMenu, divider, heading, type MenuEntry } from "@/components/ui/Menu";
import { useApp } from "@/state/AppContext";

interface GroupMenuProps {
  current: string;
  /** Groups already in this presentation (shown first). */
  existing: string[];
  disabled?: boolean;
  canUsePrevious: boolean;
  onPick: (group: string | null) => void;
}

/**
 * Group picker. Numbered classes (Verse 1..8) open a submenu next to the menu (it is
 * never clipped); clicking the class row itself picks the plain name ("Verse").
 */
export default function GroupMenu({ current, existing, disabled, canUsePrevious, onPick }: GroupMenuProps) {
  const { groups } = useApp();
  const menu = useMenu();
  const colors = chipColors(current, groups);

  const chip = (name: string) => {
    const c = chipColors(name, groups);
    return (
      <span className="group-menu-chip" style={{ background: c.background, borderColor: c.border, color: c.text }}>
        {name}
      </span>
    );
  };
  const pick = (g: string | null) => {
    if (g !== current) onPick(g);
  };

  const entries = (): MenuEntry[] => {
    const known = new Set(groups.flatMap(groupNames).map((n) => n.toLowerCase()));
    const extra = existing.filter((g) => !known.has(g.toLowerCase()));
    const out: MenuEntry[] = [];
    if (extra.length) {
      out.push(heading("in-song", "In this song"));
      for (const g of extra) out.push({ key: `x:${g}`, label: chip(g), checked: g === current, onSelect: () => pick(g) });
      out.push(divider("d1"));
    }
    for (const cls of groups) {
      out.push({
        key: cls.name,
        label: chip(cls.name),
        checked: cls.name === current,
        onSelect: () => pick(cls.name),
        children: cls.numbered
          ? groupNames(cls)
              .slice(1)
              .map((name) => ({ key: name, label: chip(name), checked: name === current, onSelect: () => pick(name) }))
          : undefined,
      });
    }
    out.push(divider("d2"), { key: "previous", label: "Join previous group", disabled: !canUsePrevious, onSelect: () => onPick(null) });
    return out;
  };

  return (
    <div className="group-menu" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <button
        className="slide-card-group group-menu-trigger"
        style={{ background: colors.background, borderColor: colors.border, color: colors.text }}
        disabled={disabled}
        onClick={(e) => menu.open(e.currentTarget, entries())}
      >
        {current}
      </button>
      {menu.element}
    </div>
  );
}

export { parseGroupName };
