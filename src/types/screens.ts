import type { UUID } from "./common";
import type { DesignRef, MediaFit } from "./themes";

export type ScreenKind = "audience" | "stage";

export const LAYER_KINDS = [
  "video_input",
  "media",
  "slides",
  "announcements",
  "complements",
  "props",
] as const;
export type LayerKind = (typeof LAYER_KINDS)[number];

export const LAYER_LABELS: Record<LayerKind, string> = {
  video_input: "Video input",
  media: "Media",
  slides: "Slides",
  announcements: "Announcements",
  complements: "Complements",
  props: "Props",
};

export type LayerToggles = Record<LayerKind, boolean>;

export type ScreenBackground =
  | { type: "color"; color: string }
  | { type: "media"; media_id: UUID; fit: MediaFit };

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
