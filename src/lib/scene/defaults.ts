import type { Design, Element, Fill, LivePresentationState, Look, Shape, TextBlock, TextSource, TextStyle } from "@/types";

export const DEFAULT_TEXT_STYLE: TextStyle = {
  font_family: "sans-serif",
  font_size: 72,
  color: "#FFFFFF",
  bold: false,
  italic: false,
  underline: false,
  uppercase: false,
  letter_spacing: 0,
  h_align: "center",
  v_align: "middle",
  line_height: 1.2,
  margin: { top: 0, right: 0, bottom: 0, left: 0 },
  scaling: "fixed",
  min_font_size: 20,
  max_font_size: 160,
  outline_width: 0,
  outline_color: "#000000",
};

const uuid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });

export const newId = uuid;

export function newElement(partial: Partial<Element> & { name: string }): Element {
  return {
    id: uuid(),
    visible: true,
    locked: false,
    transform: { x: 760, y: 440, width: 400, height: 200, rotation: 0 },
    opacity: 1,
    shape: { type: "rectangle" },
    corner_radius: 0,
    fill: { type: "none" },
    border: { enabled: false, width: 4, color: "#FFFFFF" },
    shadow: { enabled: false, color: "#000000AA", blur: 12, x: 0, y: 4 },
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    text: null,
    ...partial,
  };
}

export function textBlock(source: TextSource, style: Partial<TextStyle> = {}): TextBlock {
  return { source, style: { ...DEFAULT_TEXT_STYLE, ...style } };
}

/** Templates for the editor's "add" menu. */
export const ELEMENT_PRESETS: { key: string; label: string; make: (w: number, h: number) => Element }[] = [
  {
    key: "slide-text",
    label: "Slide text",
    make: (w, h) =>
      newElement({
        name: "Slide text",
        transform: { x: w * 0.08, y: h * 0.12, width: w * 0.84, height: h * 0.7, rotation: 0 },
        text: textBlock({ type: "slide", scope: "current", field: "text" }, { scaling: "fit", font_size: 80, bold: true }),
      }),
  },
  {
    key: "text",
    label: "Text",
    make: (w, h) =>
      newElement({
        name: "Text",
        transform: { x: w / 2 - 300, y: h / 2 - 60, width: 600, height: 120, rotation: 0 },
        text: textBlock({ type: "static", text: "Text" }, { font_size: 64 }),
      }),
  },
  {
    key: "slide-number",
    label: "Slide number",
    make: (w) =>
      newElement({
        name: "Slide number",
        transform: { x: w - 260, y: 40, width: 220, height: 80, rotation: 0 },
        text: textBlock({ type: "slide", scope: "current", field: "number" }, { font_size: 48, h_align: "right" }),
      }),
  },
  {
    key: "clock",
    label: "Clock",
    make: (w) =>
      newElement({
        name: "Clock",
        transform: { x: w - 340, y: 40, width: 300, height: 110, rotation: 0 },
        text: textBlock({ type: "clock", format: "HH:mm" }, { font_size: 72, bold: true }),
      }),
  },
  {
    key: "timer",
    label: "Timer",
    make: (w) =>
      newElement({
        name: "Timer",
        transform: { x: w - 340, y: 170, width: 300, height: 110, rotation: 0 },
        text: textBlock({ type: "timer", timer_id: null, format: "mm:ss" }, { font_size: 72, bold: true }),
      }),
  },
  { key: "rectangle", label: "Rectangle", make: () => shapeElement("Rectangle", { type: "rectangle" }, 12) },
  { key: "ellipse", label: "Circle", make: () => shapeElement("Circle", { type: "ellipse" }) },
  { key: "triangle", label: "Triangle", make: () => shapeElement("Triangle", { type: "triangle" }) },
  { key: "star", label: "Star", make: () => shapeElement("Star", { type: "star", points: 5, inner_ratio: 0.5 }) },
  { key: "polygon", label: "Polygon", make: () => shapeElement("Polygon", { type: "polygon", sides: 6 }) },
];

function shapeElement(name: string, shape: Shape, radius = 0): Element {
  const fill: Fill = { type: "color", color: "#B49AFFFF" };
  return newElement({
    name,
    shape,
    corner_radius: radius,
    fill,
    transform: { x: 760, y: 340, width: 400, height: 400, rotation: 0 },
  });
}

export function mediaElement(mediaId: string, w: number, h: number): Element {
  return newElement({
    name: "Media",
    fill: { type: "media", media_id: mediaId, fit: "cover", loop: true },
    transform: { x: w * 0.25, y: h * 0.25, width: w * 0.5, height: h * 0.5, rotation: 0 },
  });
}

export function newDesign(name: string): Design {
  return { id: uuid(), name, background: { type: "none" }, elements: [] };
}

/** Used for slides whose presentation has no theme. */
export const DEFAULT_LOOK: Look = {
  theme: { id: "default", name: "Default", width: 1920, height: 1080 },
  design: {
    id: "default",
    name: "Default",
    background: { type: "none" },
    elements: [
      newElement({
        name: "Slide text",
        transform: { x: 140, y: 120, width: 1640, height: 840, rotation: 0 },
        shadow: { enabled: true, color: "#000000CC", blur: 18, x: 0, y: 4 },
        text: textBlock(
          { type: "slide", scope: "current", field: "text" },
          { font_size: 84, bold: true, scaling: "fit", min_font_size: 30, max_font_size: 110, line_height: 1.25 },
        ),
      }),
    ],
  },
};

/** Sample slide used when previewing designs in the editor. */
export const SAMPLE_SLIDE: LivePresentationState = {
  presentation_id: "sample",
  title: "Amazing Grace",
  arrangement: "default",
  slide_index: 2,
  total_slides: 12,
  previous: { index: 1, group: "Verse 1", text: "Amazing grace! How sweet the sound\nThat saved a wretch like me!" },
  current: { index: 2, group: "Verse 1", text: "I once was lost, but now am found;\nWas blind, but now I see." },
  next: { index: 3, group: "Verse 2", text: "'Twas grace that taught my heart to fear,\nAnd grace my fears relieved;" },
};
