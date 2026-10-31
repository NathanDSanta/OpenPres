
import type {
  Element,
  LivePresentationState,
  Theme,
  TextStyle,
} from "@/types";
import type { CSSProperties } from "react";

interface ThemeElementProps {
  element: Element;
  state: LivePresentationState;
  theme: Theme;
}

const defaultTextStyle: TextStyle = {
  font_family: "sans-serif",
  font_size: 48,
  color: "#FFFFFF",
  bold: false,
  italic: false,
  underline: false,
  h_align: "center",
  v_align: "middle",
  line_height: 1.2,
  margin: { top: 0, right: 0, bottom: 0, left: 0 },
};

function resolveValue(
  element: Element,
  state: LivePresentationState,
): string {
  if (element.kind.type !== "value") return "";

  const slide =
    element.kind.scope === "previous"
      ? state.previous
      : element.kind.scope === "next"
        ? state.next
        : state.current;

  switch (element.kind.field) {
    case "text":
      return slide?.text ?? "";

    case "slide_index":
      return slide ? String(slide.index) : "";

    case "total_slides":
      return String(state.total_slides);

    case "group_name":
      return slide?.group ?? "";

    case "presentation_title":
      return state.title;

    default:
      return "";
  }
}

function getTextStyle(style: Partial<TextStyle> | undefined, canvasWidth: number): CSSProperties {
  const merged = { ...defaultTextStyle, ...style };
  const unit = canvasWidth / 100;

  const verticalAlignment =
    merged.v_align === "middle"
      ? "center"
      : merged.v_align === "bottom"
        ? "flex-end"
        : "flex-start";

  return {
    display: "flex",
    alignItems: verticalAlignment,
    justifyContent:
      merged.h_align === "center"
        ? "center"
        : merged.h_align === "right"
          ? "flex-end"
          : "flex-start",
    textAlign: merged.h_align,
    fontFamily: merged.font_family,
    fontSize: `${merged.font_size / unit}cqw`,
    color: merged.color,
    fontWeight: merged.bold ? "bold" : "normal",
    fontStyle: merged.italic ? "italic" : "normal",
    textDecoration: merged.underline ? "underline" : "none",
    lineHeight: merged.line_height,
    padding: `${merged.margin.top / unit}cqw ${merged.margin.right / unit}cqw ${merged.margin.bottom / unit}cqw ${merged.margin.left / unit}cqw`,
    whiteSpace: "pre-wrap",
    overflow: "hidden",
  };
}

export function ThemeElement({
  element,
  state,
  theme,
}: ThemeElementProps) {
  if (!element.visible) return null;

  const { transform, kind } = element;

  const style: CSSProperties = {
    position: "absolute",
    left: `${(transform.x / theme.width) * 100}%`,
    top: `${(transform.y / theme.height) * 100}%`,
    width: `${(transform.width / theme.width) * 100}%`,
    height: `${(transform.height / theme.height) * 100}%`,
    transform: `rotate(${transform.rotation}deg)`,
    opacity: element.opacity,
    background:
      element.background.type === "color"
        ? element.background.color
        : "transparent",
    border:
      element.border.width > 0
        ? `${element.border.width / (theme.width / 100)}cqw solid ${element.border.color}`
        : "none",
    borderRadius: `${element.border.radius / (theme.width / 100)}cqw`,
    boxSizing: "border-box",
    overflow: "hidden",
    padding: `${element.padding.top / (theme.width / 100)}cqw ${element.padding.right / (theme.width / 100)}cqw ${element.padding.bottom / (theme.width / 100)}cqw ${element.padding.left / (theme.width / 100)}cqw`,
  };

  if (kind.type === "shape") {
    return (
      <div
        style={{
          ...style,
          borderRadius:
            kind.shape === "ellipse"
              ? "50%"
              : `${element.border.radius / (theme.width / 100)}cqw`,
        }}
      />
    );
  }

  if (kind.type === "text") {
    return (
      <div style={{ ...style, ...getTextStyle(kind.style, theme.width) }}>
        {kind.content}
      </div>
    );
  }

  if (kind.type === "value") {
    return (
      <div style={{ ...style, ...getTextStyle(kind.style, theme.width) }}>
        {resolveValue(element, state)}
      </div>
    );
  }

  if (kind.type === "media") {
    return (
      <div style={style} className="theme-media-placeholder">
        Media: {kind.path}
      </div>
    );
  }

  // Actions are not visual elements.
  return null;
}

