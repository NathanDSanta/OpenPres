import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { chipColors, groupNames, parseGroupName } from "@/lib/groups";
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
 * Group picker. Numbered classes (Verse 1..8) open a submenu; clicking the class row itself
 * picks the plain name ("Verse").
 */
export default function GroupMenu({ current, existing, disabled, canUsePrevious, onPick }: GroupMenuProps) {
  const { groups } = useApp();
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const colors = chipColors(current, groups);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const pick = (g: string | null) => {
    setOpen(false);
    setSub(null);
    if (g !== current) onPick(g);
  };

  const known = new Set(groups.flatMap(groupNames).map((n) => n.toLowerCase()));
  const extra = existing.filter((g) => !known.has(g.toLowerCase()));

  const chip = (name: string) => {
    const c = chipColors(name, groups);
    return (
      <span className="group-menu-chip" style={{ background: c.background, borderColor: c.border, color: c.text }}>
        {name}
      </span>
    );
  };

  return (
    <div className="group-menu" ref={ref} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <button
        className="slide-card-group group-menu-trigger"
        style={{ background: colors.background, borderColor: colors.border, color: colors.text }}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        {current}
      </button>
      {open && (
        <div className="group-menu-popup">
          {extra.length > 0 && (
            <>
              <div className="group-menu-heading">In this song</div>
              {extra.map((g) => (
                <button key={g} className="group-menu-item" onClick={() => pick(g)} disabled={g === current}>
                  {chip(g)}
                </button>
              ))}
              <div className="group-menu-divider" />
            </>
          )}
          {groups.map((cls) =>
            cls.numbered ? (
              <div
                key={cls.name}
                className="group-menu-class"
                onMouseEnter={() => setSub(cls.name)}
                onMouseLeave={() => setSub((s) => (s === cls.name ? null : s))}
              >
                <button className="group-menu-item" onClick={() => pick(cls.name)} title={`${cls.name} (hover for ${cls.name} 1-${cls.count})`}>
                  {chip(cls.name)}
                  <ChevronRight size={14} className="group-menu-arrow" />
                </button>
                {sub === cls.name && (
                  <div className="group-menu-sub">
                    {groupNames(cls).slice(1).map((name) => (
                      <button key={name} className="group-menu-item" onClick={() => pick(name)} disabled={name === current}>
                        {chip(name)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <button key={cls.name} className="group-menu-item" onClick={() => pick(cls.name)} disabled={cls.name === current}>
                {chip(cls.name)}
              </button>
            ),
          )}
          <div className="group-menu-divider" />
          <button className="group-menu-item group-menu-previous" disabled={!canUsePrevious} onClick={() => pick(null)}>
            Join previous group
          </button>
        </div>
      )}
    </div>
  );
}

export { parseGroupName };
