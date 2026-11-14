import { useRef, useState } from "react";
import LookCanvas from "@/components/canvas/LookCanvas";
import { SAMPLE_BIBLE, SAMPLE_SLIDE } from "@/lib/scene/defaults";
import type { Design, Element, Theme, TimerView, Transform } from "@/types";

type Handle = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

interface Drag {
  handle: Handle;
  startX: number;
  startY: number;
  /** Starting transforms of every element being moved (one for resizing). */
  starts: Record<string, Transform>;
  moved: boolean;
}

interface Marquee {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  additive: boolean;
  base: string[];
}

const SNAP = 12;

interface StageProps {
  theme: Theme;
  design: Design;
  selected: string[];
  timers: TimerView[];
  onSelect: (ids: string[]) => void;
  /** Live update while dragging (no history entry). */
  onPreview: (transforms: Record<string, Transform>) => void;
  /** Called when the pointer is released after moving (one history entry). */
  onCommit: () => void;
}

const bounds = (ts: Transform[]) => {
  const x = Math.min(...ts.map((t) => t.x));
  const y = Math.min(...ts.map((t) => t.y));
  const r = Math.max(...ts.map((t) => t.x + t.width));
  const b = Math.max(...ts.map((t) => t.y + t.height));
  return { x, y, width: r - x, height: b - y, rotation: 0 };
};

const roundT = (t: Transform): Transform => ({ ...t, x: Math.round(t.x), y: Math.round(t.y), width: Math.round(t.width), height: Math.round(t.height) });

export default function Stage({ theme, design, selected, timers, onSelect, onPreview, onCommit }: StageProps) {
  const overlay = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });
  const W = theme.width;
  const H = theme.height;
  const single = selected.length === 1 ? selected[0] : null;

  const toTheme = (clientX: number, clientY: number) => {
    const rect = overlay.current!.getBoundingClientRect();
    return { x: ((clientX - rect.left) / rect.width) * W, y: ((clientY - rect.top) / rect.height) * H };
  };

  /** Snaps edges/centre of a box to the canvas edges and centre lines and to other elements. */
  const snap = (t: Transform, handle: Handle, exclude: Set<string>): Transform => {
    const next = { ...t };
    const xs = [0, W / 2, W];
    const ys = [0, H / 2, H];
    for (const el of design.elements) {
      if (exclude.has(el.id) || !el.visible) continue;
      const o = el.transform;
      xs.push(o.x, o.x + o.width / 2, o.x + o.width);
      ys.push(o.y, o.y + o.height / 2, o.y + o.height);
    }
    const hitX: number[] = [];
    const hitY: number[] = [];
    const tryAxis = (values: number[], targets: number[], apply: (delta: number) => void, hits: number[]) => {
      let best: { d: number; t: number } | null = null;
      for (const v of values)
        for (const target of targets) {
          const d = target - v;
          if (Math.abs(d) < SNAP && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, t: target };
        }
      if (best) {
        apply(best.d);
        hits.push(best.t);
      }
    };
    if (handle === "move") {
      tryAxis([next.x, next.x + next.width / 2, next.x + next.width], xs, (d) => (next.x += d), hitX);
      tryAxis([next.y, next.y + next.height / 2, next.y + next.height], ys, (d) => (next.y += d), hitY);
    } else {
      if (handle.includes("e")) tryAxis([next.x + next.width], xs, (d) => (next.width += d), hitX);
      if (handle.includes("w")) tryAxis([next.x], xs, (d) => ((next.x += d), (next.width -= d)), hitX);
      if (handle.includes("s")) tryAxis([next.y + next.height], ys, (d) => (next.height += d), hitY);
      if (handle.includes("n")) tryAxis([next.y], ys, (d) => ((next.y += d), (next.height -= d)), hitY);
    }
    setGuides({ x: hitX, y: hitY });
    return next;
  };

  const startDrag = (e: React.PointerEvent, ids: string[], handle: Handle) => {
    const movable = design.elements.filter((el) => ids.includes(el.id) && !el.locked);
    if (!movable.length) return;
    overlay.current?.setPointerCapture(e.pointerId);
    const p = toTheme(e.clientX, e.clientY);
    const starts: Record<string, Transform> = {};
    for (const el of movable) starts[el.id] = { ...el.transform };
    drag.current = { handle, startX: p.x, startY: p.y, starts, moved: false };
  };

  const onElementDown = (e: React.PointerEvent, el: Element) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const toggle = e.shiftKey || e.ctrlKey || e.metaKey;
    let next = selected;
    if (toggle) {
      next = selected.includes(el.id) ? selected.filter((id) => id !== el.id) : [...selected, el.id];
      onSelect(next);
      if (!next.includes(el.id)) return;
    } else if (!selected.includes(el.id)) {
      next = [el.id];
      onSelect(next);
    }
    startDrag(e, next, "move");
  };

  const onHandleDown = (e: React.PointerEvent, el: Element, handle: Handle) => {
    e.stopPropagation();
    if (el.locked) return;
    startDrag(e, [el.id], handle);
  };

  const move = (e: React.PointerEvent) => {
    if (marquee) {
      const p = toTheme(e.clientX, e.clientY);
      setMarquee({ ...marquee, x1: p.x, y1: p.y });
      return;
    }
    const d = drag.current;
    if (!d) return;
    const p = toTheme(e.clientX, e.clientY);
    let dx = p.x - d.startX;
    let dy = p.y - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < 2) return;
    d.moved = true;
    const ids = Object.keys(d.starts);

    if (d.handle === "move") {
      if (e.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      // Snap the bounding box of everything being moved, then move each element by the same amount.
      const box = bounds(ids.map((id) => d.starts[id]));
      const moved = { ...box, x: box.x + dx, y: box.y + dy };
      const snapped = e.altKey ? moved : snap(moved, "move", new Set(ids));
      const ox = Math.round(snapped.x - box.x);
      const oy = Math.round(snapped.y - box.y);
      const out: Record<string, Transform> = {};
      for (const id of ids) out[id] = { ...d.starts[id], x: d.starts[id].x + ox, y: d.starts[id].y + oy };
      onPreview(out);
      return;
    }

    const id = ids[0];
    const s = d.starts[id];
    const t: Transform = { ...s };
    if (d.handle.includes("e")) t.width = Math.max(4, s.width + dx);
    if (d.handle.includes("s")) t.height = Math.max(4, s.height + dy);
    if (d.handle.includes("w")) {
      t.width = Math.max(4, s.width - dx);
      t.x = s.x + s.width - t.width;
    }
    if (d.handle.includes("n")) {
      t.height = Math.max(4, s.height - dy);
      t.y = s.y + s.height - t.height;
    }
    if (e.shiftKey && d.handle.length === 2) {
      // Keep the proportions.
      const ratio = s.width / s.height;
      if (t.width / t.height > ratio) t.width = t.height * ratio;
      else t.height = t.width / ratio;
      if (d.handle.includes("w")) t.x = s.x + s.width - t.width;
      if (d.handle.includes("n")) t.y = s.y + s.height - t.height;
    }
    const snapped = e.altKey ? t : snap(t, d.handle, new Set([id]));
    onPreview({ [id]: roundT(snapped) });
  };

  const end = () => {
    if (marquee) {
      const x = Math.min(marquee.x0, marquee.x1);
      const y = Math.min(marquee.y0, marquee.y1);
      const r = Math.max(marquee.x0, marquee.x1);
      const b = Math.max(marquee.y0, marquee.y1);
      if (r - x < 3 && b - y < 3) {
        if (!marquee.additive) onSelect([]);
      } else {
        const hit = design.elements
          .filter((el) => el.visible)
          .filter((el) => {
            const t = el.transform;
            return t.x < r && t.x + t.width > x && t.y < b && t.y + t.height > y;
          })
          .map((el) => el.id);
        onSelect(marquee.additive ? [...new Set([...marquee.base, ...hit])] : hit);
      }
      setMarquee(null);
      return;
    }
    if (drag.current?.moved) onCommit();
    drag.current = null;
    setGuides({ x: [], y: [] });
  };

  const look = { theme: { id: theme.id, name: theme.name, width: W, height: H }, design };
  const pct = (v: number, total: number) => `${(v / total) * 100}%`;
  const selectionBox = selected.length > 1 ? bounds(design.elements.filter((el) => selected.includes(el.id)).map((el) => el.transform)) : null;

  return (
    <div className="ed-stage" style={{ aspectRatio: `${W} / ${H}`, ["--ar" as string]: W / H }}>
      <LookCanvas look={look} slide={SAMPLE_SLIDE} bible={SAMPLE_BIBLE} timers={timers} backdrop={theme.kind === "masks" ? "#3a3a46" : "#111118"} />
      <div
        ref={overlay}
        className="ed-overlay"
        onPointerDown={(e) => {
          if (e.target !== e.currentTarget || e.button !== 0) return;
          const p = toTheme(e.clientX, e.clientY);
          overlay.current?.setPointerCapture(e.pointerId);
          const additive = e.shiftKey || e.ctrlKey || e.metaKey;
          setMarquee({ x0: p.x, y0: p.y, x1: p.x, y1: p.y, additive, base: selected });
        }}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        {design.elements.map((el) => {
          const t = el.transform;
          const isSelected = selected.includes(el.id);
          if (!el.visible && !isSelected) return null;
          return (
            <div
              key={el.id}
              className={`ed-box${isSelected ? " selected" : ""}${el.locked ? " locked" : ""}`}
              style={{
                left: pct(t.x, W),
                top: pct(t.y, H),
                width: pct(t.width, W),
                height: pct(t.height, H),
                transform: t.rotation ? `rotate(${t.rotation}deg)` : undefined,
              }}
              onPointerDown={(e) => onElementDown(e, el)}
              title={el.name}
            >
              {el.id === single &&
                !el.locked &&
                (["n", "s", "e", "w", "ne", "nw", "se", "sw"] as Handle[]).map((h) => (
                  <span key={h} className={`ed-handle ${h}`} onPointerDown={(e) => onHandleDown(e, el, h)} />
                ))}
            </div>
          );
        })}
        {selectionBox && (
          <div
            className="ed-group-box"
            style={{ left: pct(selectionBox.x, W), top: pct(selectionBox.y, H), width: pct(selectionBox.width, W), height: pct(selectionBox.height, H) }}
          />
        )}
        {marquee && (
          <div
            className="ed-marquee"
            style={{
              left: pct(Math.min(marquee.x0, marquee.x1), W),
              top: pct(Math.min(marquee.y0, marquee.y1), H),
              width: pct(Math.abs(marquee.x1 - marquee.x0), W),
              height: pct(Math.abs(marquee.y1 - marquee.y0), H),
            }}
          />
        )}
        {guides.x.map((x, i) => (
          <div key={`gx${i}`} className="ed-guide v" style={{ left: pct(x, W) }} />
        ))}
        {guides.y.map((y, i) => (
          <div key={`gy${i}`} className="ed-guide h" style={{ top: pct(y, H) }} />
        ))}
      </div>
    </div>
  );
}
