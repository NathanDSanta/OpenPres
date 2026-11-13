import { useRef, useState } from "react";
import LookCanvas from "@/components/canvas/LookCanvas";
import { SAMPLE_SLIDE } from "@/lib/scene/defaults";
import type { Design, Element, Theme, TimerView, Transform } from "@/types";

type Handle = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

interface Drag {
  id: string;
  handle: Handle;
  startX: number;
  startY: number;
  start: Transform;
  moved: boolean;
}

const SNAP = 12;

interface StageProps {
  theme: Theme;
  design: Design;
  selected: string | null;
  timers: TimerView[];
  onSelect: (id: string | null) => void;
  /** Live update while dragging (no history entry). */
  onPreview: (id: string, transform: Transform) => void;
  /** Final value when the pointer is released (one history entry). */
  onCommit: () => void;
}

export default function Stage({ theme, design, selected, timers, onSelect, onPreview, onCommit }: StageProps) {
  const overlay = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });
  const W = theme.width;
  const H = theme.height;

  const toTheme = (clientX: number, clientY: number) => {
    const rect = overlay.current!.getBoundingClientRect();
    return { x: ((clientX - rect.left) / rect.width) * W, y: ((clientY - rect.top) / rect.height) * H };
  };

  /** Snaps edges/centre of a box to the canvas edges and centre lines and to other elements. */
  const snap = (t: Transform, handle: Handle, self: string): Transform => {
    const next = { ...t };
    const xs = [0, W / 2, W];
    const ys = [0, H / 2, H];
    for (const el of design.elements) {
      if (el.id === self || !el.visible) continue;
      const o = el.transform;
      xs.push(o.x, o.x + o.width / 2, o.x + o.width);
      ys.push(o.y, o.y + o.height / 2, o.y + o.height);
    }
    const hitX: number[] = [];
    const hitY: number[] = [];
    const tryAxis = (values: number[], targets: number[], apply: (delta: number) => void, hits: number[]) => {
      let best: { d: number; t: number } | null = null;
      for (const v of values) for (const target of targets) {
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

  const begin = (e: React.PointerEvent, el: Element, handle: Handle) => {
    e.stopPropagation();
    onSelect(el.id);
    if (el.locked) return;
    (e.currentTarget as Element & HTMLElement).setPointerCapture(e.pointerId);
    const p = toTheme(e.clientX, e.clientY);
    drag.current = { id: el.id, handle, startX: p.x, startY: p.y, start: { ...el.transform }, moved: false };
  };

  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = toTheme(e.clientX, e.clientY);
    let dx = p.x - d.startX;
    let dy = p.y - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < 2) return;
    d.moved = true;
    const s = d.start;
    const t: Transform = { ...s };
    if (d.handle === "move") {
      if (e.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      t.x = s.x + dx;
      t.y = s.y + dy;
    } else {
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
    }
    const snapped = e.altKey ? t : snap(t, d.handle, d.id);
    onPreview(d.id, {
      ...snapped,
      x: Math.round(snapped.x),
      y: Math.round(snapped.y),
      width: Math.round(snapped.width),
      height: Math.round(snapped.height),
    });
  };

  const end = () => {
    if (drag.current?.moved) onCommit();
    drag.current = null;
    setGuides({ x: [], y: [] });
  };

  const look = { theme: { id: theme.id, name: theme.name, width: W, height: H }, design };
  const pct = (v: number, total: number) => `${(v / total) * 100}%`;

  return (
    <div className="ed-stage" style={{ aspectRatio: `${W} / ${H}`, ["--ar" as string]: W / H }}>
      <LookCanvas look={look} slide={SAMPLE_SLIDE} timers={timers} backdrop="#111118" />
      <div
        ref={overlay}
        className="ed-overlay"
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) onSelect(null);
        }}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        {design.elements.map((el) => {
          const t = el.transform;
          const isSelected = el.id === selected;
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
              onPointerDown={(e) => begin(e, el, "move")}
              title={el.name}
            >
              {isSelected &&
                !el.locked &&
                (["n", "s", "e", "w", "ne", "nw", "se", "sw"] as Handle[]).map((h) => (
                  <span key={h} className={`ed-handle ${h}`} onPointerDown={(e) => begin(e, el, h)} />
                ))}
            </div>
          );
        })}
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
