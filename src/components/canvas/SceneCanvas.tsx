import { useId } from "react";
import type { RenderScene } from "@/types";
import { drawScene, sceneMotion } from "@/lib/scene/draw";
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
    sceneMotion(scene),
    [scene, offset],
  );
  if (fit === "fill") return <canvas ref={ref} className={`scene-canvas ${className}`} style={{ width: "100%", height: "100%" }} />;
  // The canvas's drawing size follows its displayed size, so it cannot size itself from its
  // content: a box takes the space available and the canvas is sized from that box.
  return (
    <div className="canvas-fit" style={{ ["--ar" as string]: width / height }}>
      <canvas ref={ref} className={`scene-canvas ${className}`} style={{ aspectRatio: `${width} / ${height}` }} />
    </div>
  );
}
