import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";
import { normalize as normalizeSearch } from "@/lib/search";
import "./styles/Menu.css";

export interface SelectOption<T extends string = string> {
  value: T;
  label: ReactNode;
  /** Text used for searching (defaults to the label when it is a string). */
  text?: string;
  hint?: ReactNode;
  /** Options with the same group are listed under a heading. */
  group?: string;
  disabled?: boolean;
}

interface SelectProps<T extends string> {
  value: T | null | undefined;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  placeholder?: ReactNode;
  disabled?: boolean;
  /** Shows a search box; on by default for long lists. */
  searchable?: boolean;
  small?: boolean;
  className?: string;
  title?: string;
  /** Rendered instead of the selected label (e.g. a colour swatch). */
  renderValue?: (option: SelectOption<T> | undefined) => ReactNode;
}

/**
 * Dropdown used everywhere instead of the native <select>, whose pop-up list cannot be
 * styled reliably in the desktop webviews (it came out white and unreadable).
 */
export default function Select<T extends string>({
  value,
  options,
  onChange,
  placeholder = "Choose…",
  disabled,
  searchable,
  small,
  className,
  title,
  renderValue,
}: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const selected = options.find((o) => o.value === value);
  const withSearch = searchable ?? options.length > 10;

  const filtered = useMemo(() => {
    const q = normalizeSearch(query.trim());
    if (!q) return options;
    return options.filter((o) => normalizeSearch(o.text ?? (typeof o.label === "string" ? o.label : String(o.value))).includes(q));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    const i = options.findIndex((o) => o.value === value);
    setActive(Math.max(0, i));
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !trigger.current?.contains(t)) setOpen(false);
    };
    const onBlur = () => setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("resize", onBlur);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", onBlur);
      window.removeEventListener("blur", onBlur);
    };
  }, [open, options, value]);

  useLayoutEffect(() => {
    if (!open || !trigger.current || !panel.current) return;
    const r = trigger.current.getBoundingClientRect();
    const h = panel.current.offsetHeight;
    const width = Math.max(r.width, 180);
    let left = r.left;
    if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8);
    const below = window.innerHeight - r.bottom - 8;
    const above = r.top - 8;
    const top = h <= below || below >= above ? r.bottom + 4 : Math.max(8, r.top - Math.min(h, above) - 4);
    setPos({ left, top, width, maxHeight: Math.max(160, h <= below || below >= above ? below : above) });
  }, [open, filtered.length]);

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector(".menu-row.active")?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const pick = (o: SelectOption<T>) => {
    if (o.disabled) return;
    setOpen(false);
    trigger.current?.focus();
    if (o.value !== value) onChange(o.value);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(filtered.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[active]) pick(filtered[active]);
    }
  };

  let lastGroup: string | undefined;
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`select-trigger${small ? " small" : ""}${open ? " open" : ""}${className ? ` ${className}` : ""}`}
        disabled={disabled}
        title={title}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKey}
      >
        <span className={`select-value${selected ? "" : " placeholder"}`}>
          {renderValue ? renderValue(selected) : selected ? selected.label : placeholder}
        </span>
        <ChevronDown size={small ? 13 : 15} className="select-chevron" />
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            className="menu-panel select-panel"
            data-menu-panel
            role="listbox"
            style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, width: pos?.width, maxHeight: pos?.maxHeight }}
            onKeyDown={onKey}
          >
            {withSearch && (
              <label className="select-search">
                <Search size={14} />
                <input
                  autoFocus
                  value={query}
                  placeholder="Search…"
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(0);
                  }}
                />
              </label>
            )}
            <div className="menu-scroll">
              {filtered.length === 0 && <div className="menu-heading">Nothing matches</div>}
              {filtered.map((o, i) => {
                const head = o.group !== undefined && o.group !== lastGroup;
                lastGroup = o.group;
                return (
                  <div key={`${o.group ?? ""}:${o.value}`} style={{ display: "contents" }}>
                    {head && <div className="menu-heading">{o.group}</div>}
                    <button
                      type="button"
                      className={`menu-row${i === active ? " active" : ""}${o.value === value ? " selected" : ""}`}
                      disabled={o.disabled}
                      role="option"
                      aria-selected={o.value === value}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => pick(o)}
                    >
                      <span className="menu-check">{o.value === value ? <Check size={13} /> : null}</span>
                      <span className="menu-label">{o.label}</span>
                      {o.hint && <span className="menu-hint">{o.hint}</span>}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
