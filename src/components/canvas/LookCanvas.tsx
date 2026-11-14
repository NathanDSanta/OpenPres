import { useId } from "react";
import type { LiveBible, LivePresentationState, Look, Service, TimerView } from "@/types";
import { drawLook, lookAnimates } from "@/lib/scene/draw";
import { DEFAULT_LOOK } from "@/lib/scene/defaults";
import { useCanvasPainter } from "./useCanvasPainter";

interface LookCanvasProps {
  look: Look | null;
  slide?: LivePresentationState | null;
  bible?: LiveBible | null;
  timers?: TimerView[];
  services?: Service[];
  /** Background behind transparent designs (thumbnails look like the screen). */
  backdrop?: string;
  className?: string;
  animate?: boolean;
}

/** Draws one design (slide thumbnails, design previews). */
export default function LookCanvas({ look, slide = null, bible = null, timers = [], services = [], backdrop = "#000000", className = "", animate }: LookCanvasProps) {
  const scope = useId();
  const resolved = look ?? DEFAULT_LOOK;
  const { width, height } = resolved.theme;
  const ref = useCanvasPainter(
    (ctx) => {
      ctx.fillStyle = backdrop;
      ctx.fillRect(0, 0, width, height);
      drawLook(ctx, resolved, 0, 0, width, height, { now: Date.now(), timers, services, slide, bible, videoScope: scope });
    },
    width,
    height,
    animate ?? lookAnimates(resolved),
    [resolved, slide, bible, timers, services, backdrop],
  );
  return <canvas ref={ref} className={`look-canvas ${className}`} style={{ aspectRatio: `${width} / ${height}` }} />;
}
