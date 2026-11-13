import { useEffect, useRef } from "react";
import { onAssetChange } from "@/lib/scene/assets";

/**
 * Sizes a canvas to its element (in device pixels) and calls `paint` with a context scaled
 * so that `logicalWidth` x `logicalHeight` covers the canvas. Repaints when inputs change,
 * when assets load, on resize, and continuously while `animate` is true.
 */
export function useCanvasPainter(
  paint: (ctx: CanvasRenderingContext2D) => void,
  logicalWidth: number,
  logicalHeight: number,
  animate: boolean,
  deps: unknown[],
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const paintRef = useRef(paint);
  paintRef.current = paint;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let frame = 0;
    let disposed = false;

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
      frame = requestAnimationFrame(loop);
    };
    if (animate) loop();
    else draw();

    const unsubscribe = onAssetChange(() => !animate && draw());
    const observer = new ResizeObserver(() => !animate && draw());
    observer.observe(canvas);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      unsubscribe();
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logicalWidth, logicalHeight, animate, ...deps]);

  return canvasRef;
}
