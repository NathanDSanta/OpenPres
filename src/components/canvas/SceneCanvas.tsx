import { useId } from "react";
import type { RenderScene } from "@/types";
import { drawScene, sceneAnimates } from "@/lib/scene/draw";
import { useCanvasPainter } from "./useCanvasPainter";

interface SceneCanvasProps {
  scene: RenderScene;
  /** Server clock minus local clock, in ms. */
  offset?: number;
  className?: string;
  /** Fill the parent keeping the screen's aspect ratio (default) or stretch. */
  fit?: "contain" | "fill";
}

/** Draws one virtual screen exactly as its presentation window shows it. */
export default function SceneCanvas({ scene, offset = 0, className = "", fit = "contain" }: SceneCanvasProps) {
  const scope = useId();
  const { width, height } = scene.screen;
  const ref = useCanvasPainter(
    (ctx) => drawScene(ctx, scene, width, height, Date.now() + offset, scope),
    width,
    height,
    sceneAnimates(scene),
    [scene, offset],
  );
  return (
    <canvas
      ref={ref}
      className={`scene-canvas ${className}`}
      style={fit === "contain" ? { aspectRatio: `${width} / ${height}`, maxWidth: "100%", maxHeight: "100%" } : { width: "100%", height: "100%" }}
    />
  );
}
