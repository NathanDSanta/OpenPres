export const CELL = 140;
export const GAP = 12;
export const MAX_SPAN = 4;

export interface WidgetInstance {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  config: Record<string, unknown>;
}

export interface Workspace {
  version: 1;
  widgets: WidgetInstance[];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** How many whole cells fit in a width/height. */
export const cellsIn = (px: number) => Math.max(1, Math.floor((px + GAP) / (CELL + GAP)));
export const spanPx = (cells: number) => cells * CELL + Math.max(0, cells - 1) * GAP;

export const fits = (r: Rect, cols: number, rows: number) => r.x >= 0 && r.y >= 0 && r.x + r.w <= cols && r.y + r.h <= rows;

export function isFree(r: Rect, widgets: WidgetInstance[], ignore?: string) {
  return !widgets.some((w) => w.id !== ignore && overlaps(r, w));
}

/** First free position for a w x h widget inside the visible grid, or null. */
export function findSpot(w: number, h: number, widgets: WidgetInstance[], cols: number, rows: number): { x: number; y: number } | null {
  for (let y = 0; y + h <= rows; y++) {
    for (let x = 0; x + w <= cols; x++) {
      if (isFree({ x, y, w, h }, widgets)) return { x, y };
    }
  }
  return null;
}
