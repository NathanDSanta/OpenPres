/**
 * Fonts shipped with the app (Open Font License, from Fontsource), so themes look the
 * same on every computer. System fonts can be used too (the list comes from the server).
 */
import "@fontsource-variable/inter";
import "@fontsource-variable/montserrat";
import "@fontsource-variable/open-sans";
import "@fontsource-variable/roboto";
import "@fontsource-variable/oswald";
import "@fontsource-variable/raleway";
import "@fontsource-variable/nunito";
import "@fontsource-variable/playfair-display";
import "@fontsource-variable/lora";
import "@fontsource-variable/source-serif-4";
import "@fontsource-variable/dm-sans";
import "@fontsource-variable/caveat";
import "@fontsource-variable/josefin-sans";
import "@fontsource-variable/merriweather";
import "@fontsource/lato/400.css";
import "@fontsource/lato/700.css";
import "@fontsource/lato/400-italic.css";
import "@fontsource/lato/700-italic.css";
import "@fontsource/poppins/400.css";
import "@fontsource/poppins/600.css";
import "@fontsource/poppins/700.css";
import "@fontsource/poppins/400-italic.css";
import "@fontsource/bebas-neue/400.css";
import "@fontsource/anton/400.css";

export interface BundledFont {
  /** Name shown in the editor and saved in themes. */
  name: string;
  /** CSS family registered by the font package. */
  css: string;
  category: "Sans serif" | "Serif" | "Display" | "Handwriting";
}

export const BUNDLED_FONTS: BundledFont[] = [
  { name: "Inter", css: "Inter Variable", category: "Sans serif" },
  { name: "Montserrat", css: "Montserrat Variable", category: "Sans serif" },
  { name: "Open Sans", css: "Open Sans Variable", category: "Sans serif" },
  { name: "Roboto", css: "Roboto Variable", category: "Sans serif" },
  { name: "Lato", css: "Lato", category: "Sans serif" },
  { name: "Poppins", css: "Poppins", category: "Sans serif" },
  { name: "Nunito", css: "Nunito Variable", category: "Sans serif" },
  { name: "Raleway", css: "Raleway Variable", category: "Sans serif" },
  { name: "DM Sans", css: "DM Sans Variable", category: "Sans serif" },
  { name: "Josefin Sans", css: "Josefin Sans Variable", category: "Sans serif" },
  { name: "Oswald", css: "Oswald Variable", category: "Display" },
  { name: "Bebas Neue", css: "Bebas Neue", category: "Display" },
  { name: "Anton", css: "Anton", category: "Display" },
  { name: "Playfair Display", css: "Playfair Display Variable", category: "Serif" },
  { name: "Merriweather", css: "Merriweather Variable", category: "Serif" },
  { name: "Lora", css: "Lora Variable", category: "Serif" },
  { name: "Source Serif", css: "Source Serif 4 Variable", category: "Serif" },
  { name: "Caveat", css: "Caveat Variable", category: "Handwriting" },
];

export const GENERIC_FONTS = ["sans-serif", "serif", "monospace", "cursive", "system-ui"];

const quote = (name: string) => (GENERIC_FONTS.includes(name) ? name : `"${name.replace(/"/g, "")}"`);

/** CSS font-family list for a family name saved in a theme. */
export function cssFamily(name: string): string {
  const trimmed = (name || "sans-serif").trim();
  if (trimmed.includes(",")) return trimmed; // already a list
  const bundled = BUNDLED_FONTS.find((f) => f.name.toLowerCase() === trimmed.toLowerCase());
  return bundled ? `"${bundled.css}", ${quote(bundled.name)}, sans-serif` : `${quote(trimmed)}, sans-serif`;
}

const requested = new Set<string>();
let redraw: (() => void) | null = null;

/** Called by the asset loader so canvases redraw when a font arrives. */
export function onFontLoaded(fn: () => void) {
  redraw = fn;
}

/** Starts loading a font used on a canvas (canvases do not wait for web fonts). */
export function ensureFont(font: string) {
  if (typeof document === "undefined" || !document.fonts || requested.has(font)) return;
  requested.add(font);
  try {
    if (document.fonts.check(font)) return;
    void document.fonts.load(font).then(() => redraw?.());
  } catch {
    /* invalid font string */
  }
}
