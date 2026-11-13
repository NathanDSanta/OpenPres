import type { TextStyle } from "@/types";

export interface TextLayout {
  fontSize: number;
  lines: string[];
  lineHeight: number;
  widths: number[];
}

export function fontString(style: TextStyle, size: number): string {
  const family = /[\s,]/.test(style.font_family) && !/["']/.test(style.font_family) && !style.font_family.includes(",")
    ? `"${style.font_family}"`
    : style.font_family;
  return `${style.italic ? "italic " : ""}${style.bold ? "bold " : ""}${size}px ${family}, sans-serif`;
}

function applyFont(ctx: CanvasRenderingContext2D, style: TextStyle, size: number) {
  ctx.font = fontString(style, size);
  if ("letterSpacing" in ctx) {
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${style.letter_spacing * (size / style.font_size || 1)}px`;
  }
}

/** Greedy word wrap; words longer than a line are broken. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): { lines: string[]; widths: number[] } {
  const lines: string[] = [];
  const widths: number[] = [];
  const push = (line: string) => {
    lines.push(line);
    widths.push(ctx.measureText(line).width);
  };
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/ +/);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth || !line) {
        if (!line && ctx.measureText(word).width > maxWidth) {
          // Break a very long word.
          let part = "";
          for (const ch of word) {
            if (ctx.measureText(part + ch).width > maxWidth && part) {
              push(part);
              part = ch;
            } else {
              part += ch;
            }
          }
          line = part;
        } else {
          line = candidate;
        }
      } else {
        push(line);
        line = word;
      }
    }
    push(line);
  }
  return { lines, widths };
}

const cache = new Map<string, TextLayout>();

function fits(ctx: CanvasRenderingContext2D, text: string, style: TextStyle, size: number, w: number, h: number) {
  applyFont(ctx, style, size);
  const { lines, widths } = wrap(ctx, text, w);
  const height = lines.length * size * style.line_height;
  const widest = Math.max(0, ...widths);
  return { ok: height <= h + 0.5 && widest <= w + 0.5, lines, widths };
}

/**
 * Lays out text in a w x h box (theme pixels) applying the dynamic scaling mode:
 * fixed, shrink (only down), grow (only up) or fit (both).
 */
export function layoutText(
  ctx: CanvasRenderingContext2D,
  rawText: string,
  style: TextStyle,
  w: number,
  h: number,
): TextLayout {
  const text = style.uppercase ? rawText.toUpperCase() : rawText;
  const key = `${text}\u0000${JSON.stringify(style)}\u0000${Math.round(w)}x${Math.round(h)}`;
  const hit = cache.get(key);
  if (hit) {
    applyFont(ctx, style, hit.fontSize);
    return hit;
  }

  const base = style.font_size;
  let size = base;
  const minSize = Math.min(style.min_font_size, base);
  const maxSize = Math.max(style.max_font_size, base);
  const search = (lo: number, hi: number) => {
    // Largest size in [lo, hi] that fits.
    if (!fits(ctx, text, style, lo, w, h).ok) return lo;
    while (hi - lo > 0.5) {
      const mid = (lo + hi) / 2;
      if (fits(ctx, text, style, mid, w, h).ok) lo = mid;
      else hi = mid;
    }
    return Math.floor(lo * 2) / 2;
  };
  if (text.trim() && w > 1 && h > 1) {
    switch (style.scaling) {
      case "shrink":
        size = fits(ctx, text, style, base, w, h).ok ? base : search(minSize, base);
        break;
      case "grow":
        size = fits(ctx, text, style, base, w, h).ok ? search(base, maxSize) : base;
        break;
      case "fit":
        size = search(minSize, maxSize);
        break;
      default:
        size = base;
    }
  }
  applyFont(ctx, style, size);
  const { lines, widths } = wrap(ctx, text, Math.max(1, w));
  const layout = { fontSize: size, lines, lineHeight: size * style.line_height, widths };
  if (cache.size > 600) cache.clear();
  cache.set(key, layout);
  return layout;
}

export function drawTextLayout(
  ctx: CanvasRenderingContext2D,
  layout: TextLayout,
  style: TextStyle,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const total = layout.lines.length * layout.lineHeight;
  let top = y;
  if (style.v_align === "middle") top = y + (h - total) / 2;
  else if (style.v_align === "bottom") top = y + h - total;
  ctx.textBaseline = "middle";
  layout.lines.forEach((line, i) => {
    const lineWidth = layout.widths[i];
    let left = x;
    if (style.h_align === "center") left = x + (w - lineWidth) / 2;
    else if (style.h_align === "right") left = x + w - lineWidth;
    const cy = top + i * layout.lineHeight + layout.lineHeight / 2;
    const justify = style.h_align === "justify" && i < layout.lines.length - 1 && line.includes(" ");
    const draw = (text: string, px: number) => {
      if (style.outline_width > 0) {
        ctx.save();
        ctx.lineJoin = "round";
        ctx.lineWidth = style.outline_width * 2 * (layout.fontSize / (style.font_size || 1));
        ctx.strokeStyle = style.outline_color;
        ctx.shadowColor = "transparent";
        ctx.strokeText(text, px, cy);
        ctx.restore();
      }
      ctx.fillText(text, px, cy);
    };
    if (justify) {
      const words = line.split(" ");
      const wordsWidth = words.reduce((sum, word) => sum + ctx.measureText(word).width, 0);
      const gap = (w - wordsWidth) / (words.length - 1);
      let px = x;
      for (const word of words) {
        draw(word, px);
        px += ctx.measureText(word).width + gap;
      }
    } else {
      draw(line, left);
    }
    if (style.underline) {
      const thickness = Math.max(1, layout.fontSize / 16);
      const width = justify ? w : lineWidth;
      ctx.fillRect(justify ? x : left, cy + layout.fontSize * 0.42, width, thickness);
    }
  });
}
