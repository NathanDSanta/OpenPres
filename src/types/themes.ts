import type { UUID } from "./common";

export type Color = string; // #RRGGBB or #RRGGBBAA
export type MediaFit = "cover" | "contain" | "stretch";
export type ThemeKind = "slides" | "props" | "masks";

export type Fill =
  | { type: "none" }
  | { type: "color"; color: Color }
  | { type: "gradient"; from: Color; to: Color; angle: number }
  | { type: "media"; media_id: UUID; fit: MediaFit; loop: boolean };

export type Shape =
  | { type: "rectangle" }
  | { type: "ellipse" }
  | { type: "triangle" }
  | { type: "star"; points: number; inner_ratio: number }
  | { type: "polygon"; sides: number };

export type SlideScope = "current" | "previous" | "next";
export type SlideField = "text" | "number" | "total" | "group" | "title";

export type TextSource =
  | { type: "static"; text: string }
  | { type: "slide"; scope: SlideScope; field: SlideField }
  | { type: "clock"; format: string }
  | { type: "timer"; timer_id: UUID | null; format: string }
  | { type: "bible"; slot: number; field: BibleField };

export type BibleField = "text" | "reference" | "version" | "attribution";

export type HorizontalAlign = "left" | "center" | "right" | "justify";
export type VerticalAlign = "top" | "middle" | "bottom";
export type TextScaling = "fixed" | "shrink" | "grow" | "fit";

export interface Edges {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface TextStyle {
  font_family: string;
  font_size: number;
  color: Color;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  uppercase: boolean;
  letter_spacing: number;
  h_align: HorizontalAlign;
  v_align: VerticalAlign;
  line_height: number;
  margin: Edges;
  scaling: TextScaling;
  min_font_size: number;
  max_font_size: number;
  outline_width: number;
  outline_color: Color;
  /** 1 = keep line breaks, 2 = join lines in pairs, 3 = in threes..., 0 = one line. */
  join_lines: number;
}

export interface TextBlock {
  source: TextSource;
  style: TextStyle;
}

export interface Transform {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export interface Border {
  enabled: boolean;
  width: number;
  color: Color;
}

export interface Shadow {
  enabled: boolean;
  color: Color;
  blur: number;
  x: number;
  y: number;
}

export interface Element {
  id: UUID;
  name: string;
  visible: boolean;
  locked: boolean;
  transform: Transform;
  opacity: number;
  shape: Shape;
  corner_radius: number;
  fill: Fill;
  border: Border;
  shadow: Shadow;
  padding: Edges;
  text: TextBlock | null;
}

export interface Design {
  id: UUID;
  name: string;
  background: Fill;
  elements: Element[];
}

export interface Theme {
  id: UUID;
  name: string;
  kind: ThemeKind;
  width: number;
  height: number;
  designs: Design[];
}

export interface ThemeSummary {
  id: UUID;
  name: string;
  kind: ThemeKind;
  width: number;
  height: number;
  designs: { id: UUID; name: string }[];
}

export interface DesignRef {
  theme_id: UUID;
  design_id: UUID;
}
