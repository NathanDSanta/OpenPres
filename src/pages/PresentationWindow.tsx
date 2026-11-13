import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { presentationWindowsApi } from "@/api/presentationWindows";
import SceneCanvas from "@/components/canvas/SceneCanvas";
import { useScene } from "@/hooks/useScene";
import { useMediaIndex } from "@/hooks/useMediaIndex";
import "@/styles/PresentationWindow.css";

/** A fullscreen output window: draws its virtual screen and nothing else. */
export default function PresentationWindow() {
  const { id } = useParams<{ id: string }>();
  useMediaIndex();
  const { scene, offset } = useScene(id);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      void presentationWindowsApi.hideCurrent();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const w = scene?.screen.width ?? 16;
  const h = scene?.screen.height ?? 9;
  return (
    <main className="presentation-window">
      {scene && (
        <div
          className="presentation-window-frame"
          style={{ width: `min(100vw, calc(100vh * ${w} / ${h}))`, height: `min(100vh, calc(100vw * ${h} / ${w}))` }}
        >
          <SceneCanvas scene={scene} offset={offset} fit="fill" />
        </div>
      )}
    </main>
  );
}
