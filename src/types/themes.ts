import type { UUID } from "./common";

export type Color = string; // backend validates #RRGGBB or #RRGGBBAA
export type Background = { type: "none" } | { type: "color"; color: Color };
export type ShapeKind = "rectangle" | "ellipse";
export type ValueScope = "current" | "previous" | "next";
export type ValueField =
  "text" | "slide_index" | "total_slides" | "group_name" | "presentation_title";
export type HorizontalAlign = "left" | "center" | "right" | "justify";
export type VerticalAlign = "top" | "middle" | "bottom";

export interface Transform {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export interface Edges {
  top: number;
  right: number;
  bottom: number;
  left: number;
}
export interface Border {
  width: number;
  color: Color;
  radius: number;
}

export interface TextStyle {
  font_family: string;
  font_size: number;
  color: Color;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  h_align: HorizontalAlign;
  v_align: VerticalAlign;
  line_height: number;
  margin: Edges;
}

export type ElementKind =
  | { type: "text"; content: string; style?: Partial<TextStyle> }
  | { type: "shape"; shape: ShapeKind }
  | { type: "media"; path: string }
  | {
      type: "value";
      scope: ValueScope;
      field: ValueField;
      style?: Partial<TextStyle>;
    }
  | { type: "action"; actions?: unknown[] };

export interface Element {
  id: UUID;
  name: string;
  visible: boolean;
  transform: Transform;
  background: Background;
  border: Border;
  padding: Edges;
  opacity: number;
  kind: ElementKind;
}

export interface Theme {
  id: UUID;
  name: string;
  width: number;
  height: number;
  background: Background;
  elements: Element[];
}

export interface ThemeSummary {
  id: UUID;
  name: string;
  width: number;
  height: number;
  /** Number of elements, not the elements themselves. */
  elements: number;
}
