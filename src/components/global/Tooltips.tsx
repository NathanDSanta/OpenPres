import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./styles/Tooltips.css";

const DELAY = 450;

/**
 * Hover hints in the app's style instead of the system's: any element with a `title`
 * gets one. While pointed at, its `title` moves to `data-tip` (so the system's doesn't show
 * too) and comes back after. "Name: longer explanation" shows the name in bold.
 */
export default function Tooltips() {
  const [tip, setTip] = useState<{ text: string; rect: DOMRect } | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let current: HTMLElement | null = null;
    let timer = 0;
    const restore = () => {
      window.clearTimeout(timer);
      if (current?.dataset.tip !== undefined) {
        current.setAttribute("title", current.dataset.tip);
        delete current.dataset.tip;
      }
      current = null;
      setTip(null);
    };
    const onOver = (e: MouseEvent) => {
      const el = e.target instanceof Element ? (e.target.closest("[title], [data-tip]") as HTMLElement | null) : null;
      if (el === current) return;
      restore();
      if (!el) return;
      const text = el.getAttribute("title") ?? el.dataset.tip ?? "";
      if (!text.trim()) return;
      current = el;
      el.dataset.tip = text;
      el.removeAttribute("title");
      timer = window.setTimeout(() => {
        // Not over what it opened (a menu or panel whose trigger it is).
        if (current === el && el.isConnected && el.getAttribute("aria-expanded") !== "true") setTip({ text, rect: el.getBoundingClientRect() });
      }, DELAY);
    };
    const hide = () => restore();
    document.addEventListener("mouseover", onOver);
    document.addEventListener("mousedown", hide, true);
    document.addEventListener("keydown", hide, true);
    window.addEventListener("blur", hide);
    window.addEventListener("scroll", hide, true);
    return () => {
      restore();
      document.removeEventListener("mouseover", onOver);
      document.removeEventListener("mousedown", hide, true);
      document.removeEventListener("keydown", hide, true);
      window.removeEventListener("blur", hide);
      window.removeEventListener("scroll", hide, true);
    };
  }, []);

  // Under the element, centred; above it (or moved in) when there's no room.
  useLayoutEffect(() => {
    const el = box.current;
    if (!tip || !el) return setPos(null);
    const { width, height } = el.getBoundingClientRect();
    const r = tip.rect;
    let left = r.left + r.width / 2 - width / 2;
    let top = r.bottom + 6;
    if (top + height > window.innerHeight - 6) top = r.top - height - 6;
    left = Math.max(6, Math.min(left, window.innerWidth - width - 6));
    setPos({ left, top: Math.max(6, top) });
  }, [tip]);

  if (!tip) return null;
  const split = tip.text.indexOf(": ");
  const name = split > 0 && split <= 32 && !tip.text.slice(0, split).includes(".") ? tip.text.slice(0, split) : null;
  return createPortal(
    <div ref={box} className={`app-tooltip${pos ? " shown" : ""}`} role="tooltip" style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}>
      {name ? (
        <>
          <strong>{name}</strong>
          <span>{tip.text.slice(split + 2)}</span>
        </>
      ) : (
        <span>{tip.text}</span>
      )}
    </div>,
    document.body,
  );
}
