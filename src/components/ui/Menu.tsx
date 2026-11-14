import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight } from "lucide-react";
import "./styles/Menu.css";

/** One row of a menu. Rows with `children` open a submenu (to the side, never clipped). */
export interface MenuItem {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  checked?: boolean;
  danger?: boolean;
  onSelect?: () => void;
  children?: MenuEntry[];
}
export type MenuEntry = MenuItem | { type: "divider"; key: string } | { type: "heading"; key: string; label: ReactNode };

export const divider = (key: string): MenuEntry => ({ type: "divider", key });
export const heading = (key: string, label: ReactNode): MenuEntry => ({ type: "heading", key, label });

const isItem = (e: MenuEntry): e is MenuItem => !("type" in e);

export type MenuAnchor = { x: number; y: number } | DOMRect | HTMLElement;

function anchorRect(anchor: MenuAnchor): { left: number; top: number; right: number; bottom: number } {
  if (anchor instanceof HTMLElement) return anchor.getBoundingClientRect();
  if ("x" in anchor && !("width" in anchor)) return { left: anchor.x, top: anchor.y, right: anchor.x, bottom: anchor.y };
  return anchor as DOMRect;
}

interface PanelProps {
  entries: MenuEntry[];
  anchor: { left: number; top: number; right: number; bottom: number };
  /** Submenus open beside their row; the root opens below its anchor. */
  side: "below" | "right";
  depth: number;
  onClose: () => void;
  minWidth?: number;
}

function Panel({ entries, anchor, side, depth, onClose, minWidth }: PanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number } | null>(null);
  const [openSub, setOpenSub] = useState<{ key: string; rect: DOMRect } | null>(null);
  const [active, setActive] = useState(-1);
  const items = entries.filter(isItem);
  const timer = useRef<number | undefined>(undefined);

  // Place inside the window: flip to the other side / upwards when there is no room.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left: number;
    let top: number;
    if (side === "below") {
      left = anchor.left;
      top = anchor.bottom + 4;
      if (left + w > vw - 8) left = Math.max(8, anchor.right - w);
      if (top + h > vh - 8) top = anchor.top - h - 4 >= 8 ? anchor.top - h - 4 : Math.max(8, vh - h - 8);
    } else {
      left = anchor.right + 2;
      top = anchor.top - 6;
      if (left + w > vw - 8) left = Math.max(8, anchor.left - w - 2);
      if (top + h > vh - 8) top = Math.max(8, vh - h - 8);
    }
    setPos({ left, top, maxHeight: vh - 16 });
  }, [anchor.left, anchor.top, anchor.right, anchor.bottom, side, entries]);

  const choose = (item: MenuItem) => {
    if (item.disabled) return;
    if (item.onSelect) {
      item.onSelect();
      onClose();
    }
  };

  const openChild = (item: MenuItem, row: HTMLElement | null, delay = 120) => {
    window.clearTimeout(timer.current);
    if (!item.children || item.disabled || !row) {
      timer.current = window.setTimeout(() => setOpenSub(null), delay);
      return;
    }
    const rect = row.getBoundingClientRect();
    timer.current = window.setTimeout(() => setOpenSub({ key: item.key, rect }), delay);
  };

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Keyboard: arrows move, Enter picks, Right opens a submenu, Left/Escape close.
  useEffect(() => {
    if (openSub) return;
    const onKey = (e: KeyboardEvent) => {
      const rows = ref.current?.querySelectorAll<HTMLElement>(":scope > .menu-scroll > .menu-row") ?? [];
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        const dir = e.key === "ArrowDown" ? 1 : -1;
        let next = active;
        for (let i = 0; i < items.length; i++) {
          next = (next + dir + items.length) % items.length;
          if (!items[next].disabled) break;
        }
        setActive(next);
        rows[next]?.scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter" && active >= 0) {
        e.preventDefault();
        e.stopPropagation();
        const item = items[active];
        if (item.children) openChild(item, rows[active], 0);
        else choose(item);
      } else if (e.key === "ArrowRight" && active >= 0 && items[active].children) {
        e.preventDefault();
        e.stopPropagation();
        openChild(items[active], rows[active], 0);
      } else if ((e.key === "ArrowLeft" && depth > 0) || e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  let itemIndex = -1;
  return (
    <>
      <div
        ref={ref}
        className="menu-panel"
        data-menu-panel
        role="menu"
        style={{
          left: pos?.left ?? -9999,
          top: pos?.top ?? -9999,
          maxHeight: pos?.maxHeight,
          minWidth,
          zIndex: 400 + depth,
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="menu-scroll">
          {entries.map((entry) => {
            if (!isItem(entry)) {
              return entry.type === "divider" ? (
                <div key={entry.key} className="menu-divider" />
              ) : (
                <div key={entry.key} className="menu-heading">
                  {entry.label}
                </div>
              );
            }
            itemIndex += 1;
            const index = itemIndex;
            const isOpen = openSub?.key === entry.key;
            return (
              <button
                key={entry.key}
                className={`menu-row${index === active ? " active" : ""}${isOpen ? " open" : ""}${entry.danger ? " danger" : ""}`}
                role="menuitem"
                disabled={entry.disabled}
                onMouseEnter={(e) => {
                  setActive(index);
                  openChild(entry, e.currentTarget);
                }}
                onClick={(e) => {
                  if (entry.children && !entry.onSelect) openChild(entry, e.currentTarget, 0);
                  else choose(entry);
                }}
              >
                <span className="menu-check">{entry.checked ? <Check size={13} /> : entry.icon}</span>
                <span className="menu-label">{entry.label}</span>
                {entry.hint && <span className="menu-hint">{entry.hint}</span>}
                {entry.children && <ChevronRight size={14} className="menu-arrow" />}
              </button>
            );
          })}
        </div>
      </div>
      {openSub &&
        (() => {
          const item = items.find((i) => i.key === openSub.key);
          if (!item?.children) return null;
          return (
            <Panel
              entries={item.children}
              anchor={openSub.rect}
              side="right"
              depth={depth + 1}
              onClose={() => setOpenSub(null)}
            />
          );
        })()}
    </>
  );
}

/** A menu shown at `anchor` (an element, a rectangle or a point) until `onClose`. */
export function Menu({
  anchor,
  entries,
  onClose,
  minWidth,
}: {
  anchor: MenuAnchor;
  entries: MenuEntry[];
  onClose: () => void;
  minWidth?: number;
}) {
  const rect = anchorRect(anchor);
  const isPoint = !(anchor instanceof HTMLElement) && "x" in anchor && !("width" in anchor);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest?.("[data-menu-panel]")) onClose();
    };
    const onBlur = () => onClose();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("blur", onBlur);
    window.addEventListener("resize", onBlur);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", onBlur);
    };
  }, [onClose]);
  return createPortal(
    <Panel
      entries={entries}
      anchor={isPoint ? { ...rect, bottom: rect.top - 4 } : rect}
      side="below"
      depth={0}
      onClose={onClose}
      minWidth={minWidth}
    />,
    document.body,
  );
}

/** `const menu = useMenu(); <button onClick={(e) => menu.open(e.currentTarget, entries)}>`; render `menu.element`. */
export function useMenu() {
  const [state, setState] = useState<{ anchor: MenuAnchor; entries: MenuEntry[]; minWidth?: number } | null>(null);
  const close = useCallback(() => setState(null), []);
  const open = useCallback((anchor: MenuAnchor, entries: MenuEntry[], minWidth?: number) => {
    setState({ anchor, entries, minWidth });
  }, []);
  const element = state ? <Menu anchor={state.anchor} entries={state.entries} onClose={close} minWidth={state.minWidth} /> : null;
  return { open, close, element, isOpen: !!state };
}
