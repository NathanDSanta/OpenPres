import type { UUID } from "./common";
import type { DesignRef, MediaFit } from "./themes";

export type ScreenKind = "audience" | "stage";

export const LAYER_KINDS = [
  "video_input",
  "media",
  "slides",
  "bible",
  "announcements",
  "complements",
  "props",
] as const;
export type LayerKind = (typeof LAYER_KINDS)[number];

export const LAYER_LABELS: Record<LayerKind, string> = {
  video_input: "Video input",
  media: "Media",
  slides: "Slides",
  bible: "Bible",
  announcements: "Announcements",
  complements: "Complements",
  props: "Props",
};

export type LayerToggles = Record<LayerKind, boolean>;

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
