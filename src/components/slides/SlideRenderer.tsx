import type { LivePresentationState, Theme } from "@/types";
import { DefaultSlide } from "./DefaultSlide";
import { ThemeElement } from "./ThemeElement";
import "./styles/SlideRenderer.css";

interface SlideRendererProps {
  state: LivePresentationState;
  theme: Theme | null;
  className?: string;
}

export function SlideRenderer({
  state,
  theme,
  className = "",
}: SlideRendererProps) {
  if (!state.current) {
    return (
      <div className={`slide-renderer ${className}`}>
        <div className="slide-empty">No slide selected</div>
      </div>
    );
  }

  if (!theme || theme.width <= 0 || theme.height <= 0) {
    return (
      <div className={`slide-renderer ${className}`}>
        <DefaultSlide state={state} />
      </div>
    );
  }

  return (
    <div className={`slide-renderer ${className}`}>
      <div
        className="slide-canvas"
        style={{
          aspectRatio: `${theme.width} / ${theme.height}`,
          background:
            theme.background.type === "color"
              ? theme.background.color
              : "transparent",
        }}
      >
        {theme.elements.map((element) => (
          <ThemeElement
            key={element.id}
            element={element}
            state={state}
            theme={theme}
          />
        ))}
      </div>
    </div>
  );
}

