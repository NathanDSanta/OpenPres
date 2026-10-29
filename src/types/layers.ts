import type { UUID, PathBuf } from "./common";

export const LAYER_ORDER = [
  "video_input",
  "media",
  "slides",
  "announcements",
  "complements",
  "props",
  "audio",
] as const;

export type LayerKind = (typeof LAYER_ORDER)[number];

export type LayerContent =
  | { type: "empty" }
  | { type: "video_input"; device_id: string }
  | { type: "media"; path: PathBuf }
  | { type: "presentation"; presentation_id: UUID; slide_index: number }
  | { type: "component"; component: string; enabled: boolean }
  | { type: "audio_routing" };

export interface Layer {
  kind: LayerKind;
  visible: boolean;
  content: LayerContent;
}

/** Backend returns all seven layers in its fixed bottom-to-top order. */
export interface LayerStack {
  layers: Layer[];
}

/** PUT /screens/:id/layers/:kind. Either field may be omitted. */
export interface LayerUpdateRequest {
  visible?: boolean;
  content?: LayerContent;
}
