import { useEffect, useRef } from "react";
import { onAssetChange } from "@/lib/scene/assets";
import type { Motion } from "@/lib/scene/draw";

/** Clocks and timers show seconds: ten pictures a second is plenty (instead of 60). */
const SLOW_MS = 100;

/**
 * Sizes a canvas to its element (in device pixels) and calls `paint` with a context scaled
 * so that `logicalWidth` x `logicalHeight` covers the canvas. Repaints when inputs change,
 * when assets load, on resize, and by itself while `animate` says the picture moves: every
 * frame for videos and cameras, ten times a second for clocks and timers.
 */
export function useCanvasPainter(
  paint: (ctx: CanvasRenderingContext2D) => void,
  logicalWidth: number,
  logicalHeight: number,
  animate: boolean | Motion,
  deps: unknown[],
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const paintRef = useRef(paint);
  paintRef.current = paint;

  const motion: Motion = animate === true ? "fast" : animate === false ? "none" : animate;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let frame = 0;
    let timer = 0;
    let disposed = false;
    const animated = motion !== "none";

    const draw = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      ctx.setTransform(width / logicalWidth, 0, 0, height / logicalHeight, 0, 0);
      ctx.clearRect(0, 0, logicalWidth, logicalHeight);
      paintRef.current(ctx);
    };

    const loop = () => {
      if (disposed) return;
      draw();
      if (motion === "fast") frame = requestAnimationFrame(loop);
      else timer = window.setTimeout(() => (frame = requestAnimationFrame(loop)), SLOW_MS);
    };
    if (animated) loop();
    else draw();

    const unsubscribe = onAssetChange(() => !animated && draw());
    const observer = new ResizeObserver(() => !animated && draw());
    observer.observe(canvas);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      unsubscribe();
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logicalWidth, logicalHeight, motion, ...deps]);

  return canvasRef;
}
