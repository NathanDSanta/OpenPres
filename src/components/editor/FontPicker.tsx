import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { systemApi } from "@/api";
import { BUNDLED_FONTS, GENERIC_FONTS, cssFamily } from "@/lib/fonts";
import { normalize } from "@/lib/search";
import "@/components/ui/styles/Menu.css";

interface FontOption {
  name: string;
  group: string;
}

let systemFonts: Promise<string[]> | null = null;
function loadSystemFonts(): Promise<string[]> {
  systemFonts ??= systemApi
    .fonts()
    .then((r) => r.system)
    .catch(() => [] as string[]);
  return systemFonts;
}

/**
 * Font family field with autocompletion: fonts shipped with OpenPres (same look on every
 * computer), the fonts installed on this computer, and the generic families. Any name can
 * still be typed.
 */
export default function FontPicker({ value, onChange }: { value: string; onChange: (font: string) => void }) {
  const [system, setSystem] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value);
  const [filter, setFilter] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);

  useEffect(() => setText(value), [value]);
  useEffect(() => {
    let alive = true;
    void loadSystemFonts().then((f) => alive && setSystem(f));
    return () => {
      alive = false;
    };
  }, []);

  const all = useMemo<FontOption[]>(() => {
    const bundled = new Set(BUNDLED_FONTS.map((f) => f.name.toLowerCase()));
    return [
      ...BUNDLED_FONTS.map((f) => ({ name: f.name, group: `Included · ${f.category}` })),
      ...system.filter((f) => !bundled.has(f.toLowerCase())).map((name) => ({ name, group: "On this computer" })),
      ...GENERIC_FONTS.map((name) => ({ name, group: "Generic" })),
    ];
  }, [system]);

  const options = useMemo(() => {
    const q = normalize(filter.trim());
    if (!q) return all;
    const starts = all.filter((o) => normalize(o.name).startsWith(q));
    const contains = all.filter((o) => !normalize(o.name).startsWith(q) && normalize(o.name).includes(q));
    return [...starts, ...contains];
  }, [all, filter]);

  useLayoutEffect(() => {
    if (!open || !input.current) return;
    const r = input.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const up = below < 220 && above > below;
    const maxHeight = Math.min(340, up ? above : below);
    setPos({ left: r.left, top: up ? r.top - maxHeight - 4 : r.bottom + 4, width: Math.max(r.width, 240), maxHeight });
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !input.current?.parentElement?.contains(t)) close(true);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  });

  useEffect(() => {
    panel.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const choose = (name: string) => {
    setText(name);
    onChange(name);
    setOpen(false);
  };

  const close = (commit: boolean) => {
    setOpen(false);
    if (commit && text.trim() && text !== value) onChange(text.trim());
  };

  let lastGroup = "";
  return (
    <div className="font-picker">
      <input
        ref={input}
        className="input"
        value={text}
        style={{ fontFamily: cssFamily(text) }}
        placeholder="Font"
        spellCheck={false}
        onFocus={() => {
          setFilter("");
          setActive(Math.max(0, all.findIndex((o) => o.name.toLowerCase() === value.toLowerCase())));
          setOpen(true);
        }}
        onChange={(e) => {
          setText(e.target.value);
          setFilter(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onBlur={() => window.setTimeout(() => !panel.current?.contains(document.activeElement) && close(true), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(options.length - 1, a + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (open && options[active]) choose(options[active].name);
            else close(true);
            input.current?.blur();
          } else if (e.key === "Escape") {
            setText(value);
            setOpen(false);
          }
        }}
      />
      <button className="font-picker-toggle" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => (open ? setOpen(false) : input.current?.focus())}>
        <ChevronDown size={13} />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={panel}
            className="menu-panel select-panel"
            data-menu-panel
            style={{ left: pos.left, top: pos.top, width: pos.width, maxHeight: pos.maxHeight }}
            onMouseDown={(e) => e.preventDefault()}
          >
            <div className="menu-scroll">
            {options.length === 0 && <div className="menu-heading">No font matches. Press Enter to use “{text}”.</div>}
            {options.map((o, i) => {
              const head = o.group !== lastGroup && !filter.trim();
              lastGroup = o.group;
              return (
                <div key={`${o.group}-${o.name}`}>
                  {head && <div className="menu-heading">{o.group}</div>}
                  <button
                    data-index={i}
                    className={`menu-row${i === active ? " active" : ""}${o.name === value ? " selected" : ""}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(o.name)}
                  >
                    <span className="menu-label" style={{ fontFamily: cssFamily(o.name), fontSize: 14 }}>
                      {o.name}
                    </span>
                    {filter.trim() && <span className="menu-hint">{o.group.replace("Included · ", "")}</span>}
                  </button>
                </div>
              );
            })}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
