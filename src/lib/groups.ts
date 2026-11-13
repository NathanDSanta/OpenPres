import type { GroupClass } from "@/types";

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
}

/** Colour of number `n` (1-based) of a numbered class. */
export function shadeOf(group: GroupClass, n: number): string {
  if (group.shading === "none" || n <= 1) return group.color.slice(0, 7);
  const step = Math.min(0.09, 0.55 / Math.max(1, group.count - 1));
  const amount = Math.min(0.7, (n - 1) * step);
  const rgb = hexToRgb(group.color);
  const target = group.shading === "darken" ? 0 : 255;
  return rgbToHex(rgb.map((v) => v + (target - v) * amount) as [number, number, number]);
}

/** Splits "Verse 3" into its class and number. */
export function parseGroupName(name: string): { base: string; number: number | null } {
  const match = /^(.*?)\s+(\d+)$/.exec(name.trim());
  return match ? { base: match[1], number: Number(match[2]) } : { base: name.trim(), number: null };
}

/** The colour configured for a group name, or null. */
export function groupColor(name: string, classes: GroupClass[]): string | null {
  const lower = name.trim().toLowerCase();
  const exact = classes.find((c) => c.name.toLowerCase() === lower);
  if (exact) return exact.color.slice(0, 7);
  const { base, number } = parseGroupName(name);
  if (number === null) return null;
  const cls = classes.find((c) => c.name.toLowerCase() === base.toLowerCase());
  return cls ? shadeOf(cls, number) : null;
}

export interface ChipColors {
  background: string;
  border: string;
  text: string;
}

export function chipColors(name: string, classes: GroupClass[]): ChipColors {
  const color = groupColor(name, classes);
  if (!color) {
    return { background: "transparent", border: "var(--border)", text: "var(--text-primary)" };
  }
  return {
    background: `color-mix(in srgb, ${color} 20%, transparent)`,
    border: color,
    text: `color-mix(in srgb, ${color} 75%, white)`,
  };
}

/** Every group name the classes provide, e.g. Verse, Verse 1..8, Chorus... */
export function groupNames(cls: GroupClass): string[] {
  if (!cls.numbered) return [cls.name];
  return [cls.name, ...Array.from({ length: cls.count }, (_, i) => `${cls.name} ${i + 1}`)];
}
