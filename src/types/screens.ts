import type { UUID } from "./common";
import type { DesignRef, MediaFit } from "./themes";

/** "audience": a screen showing its layers; monitor: other screens' outputs side by side (for a monitoring display). */
export type ScreenKind = "audience" | "monitor";

export const LAYER_KINDS = [
  "video_input",
  "media",
  "slides",
  "bible",
  "announcements",
  "props",
] as const;
export type LayerKind = (typeof LAYER_KINDS)[number];

export const LAYER_LABELS: Record<LayerKind, string> = {
  video_input: "Video input",
  media: "Media",
  slides: "Slides",
  bible: "Bible",
  announcements: "Announcements",
  props: "Props",
};

/** Who a props collection is for: the room (the Stage operator's screens) or the stream. */
export type PropsSide = "stage" | "livestream";
/** Which props a screen's Props layer shows. */
export type PropsShown = PropsSide | "both";
export const PROPS_SHOWN_LABELS: Record<PropsShown, string> = { stage: "Stage props", livestream: "Livestream props", both: "Stage and Livestream props" };

export type LayerToggles = Record<LayerKind, boolean> & { props_shown?: PropsShown };

export type ScreenBackground =
  | { type: "color"; color: string }
  | { type: "media"; media_id: UUID; fit: MediaFit }
  | { type: "folder"; folder_id: UUID; fit: MediaFit; seconds: number };

export interface PhysicalDisplay {
  id: string;
  name: string;
  width: number;
  height: number;
  /** Desktop coordinate [x, y], including potentially negative values. */
  position: [number, number];
}

export interface VirtualScreen {
  id: UUID;
  name: string;
  kind: ScreenKind;
  width: number;
  height: number;
  /** Every slide on this screen uses this design (e.g. a stage layout). */
  slides_design: DesignRef | null;
  /** Bible passages on this screen use this design (default: the Bible settings). */
  bible_design: DesignRef | null;
  /** Older override (a whole theme); replaced by slides_design. */
  theme_id: UUID | null;
  announcements_theme_id: UUID | null;
  background: ScreenBackground;
  enabled_layers: LayerToggles;
  mask: DesignRef | null;
  /** Monitor screens: the screens shown, in order. */
  monitor_screens?: UUID[];
}

export type ScreenInput = Omit<VirtualScreen, "id">;

/** GET /screens and successful create/update/bind responses. */
export interface ScreenView extends VirtualScreen {
  display_id: string | null;
  display_connected: boolean;
}

export interface BindDisplayRequest {
  display_id: string;
}

/** The designs a screen preset can set: missing = the screen keeps its own, null = the default. */
export const PRESET_DESIGNS = ["slides_design", "bible_design", "mask"] as const;
export type PresetDesign = (typeof PRESET_DESIGNS)[number];

/** A named set of layers, and the designs that go with them, that screens can be switched to (defined by the admin). */
export interface ScreenPreset {
  id: UUID;
  name: string;
  layers: LayerToggles;
  slides_design?: DesignRef | null;
  bible_design?: DesignRef | null;
  mask?: DesignRef | null;
}

export interface ScreenPresetsFile {
  presets: ScreenPreset[];
}

const sameDesign = (a: DesignRef | null | undefined, b: DesignRef | null | undefined) => (a?.theme_id ?? null) === (b?.theme_id ?? null) && (a?.design_id ?? null) === (b?.design_id ?? null);

/** Whether a screen is as a preset leaves it: exactly its layers (and which props), and the designs it sets. */
export const matchesPreset = (screen: Pick<VirtualScreen, "enabled_layers" | PresetDesign>, preset: ScreenPreset) =>
  LAYER_KINDS.every((k) => !!screen.enabled_layers[k] === !!preset.layers[k]) &&
  (!preset.layers.props || (screen.enabled_layers.props_shown ?? "both") === (preset.layers.props_shown ?? "both")) &&
  PRESET_DESIGNS.every((d) => preset[d] === undefined || sameDesign(screen[d], preset[d]));

/** What a preset changes on a screen (for a draft in the screen's settings). */
export const presetPatch = (preset: ScreenPreset): Partial<Pick<VirtualScreen, "enabled_layers" | PresetDesign>> => ({
  enabled_layers: { ...preset.layers },
  ...Object.fromEntries(PRESET_DESIGNS.filter((d) => preset[d] !== undefined).map((d) => [d, preset[d] ?? null])),
});

/** While identifying: what each output shows (GET /displays/identify). */
export interface IdentifyStatus {
  remaining_ms: number;
  /** The server is on standby: the windows only show the label. */
  standby?: boolean;
  outputs: { number: number; display_id: string; display_name: string; width: number; height: number; screen_id: UUID; screen_name: string }[];
}
