import type { UUID } from "./common";
import type { MediaFit } from "./themes";

export type MediaKind = "image" | "video" | "audio";
export type EndAction = "stop" | "repeat_one" | "next" | "loop_all";
export type PlaylistKind = "audio" | "visual";
export type PlayerSlot = "visual" | "audio";

export const END_ACTION_LABELS: Record<EndAction, string> = {
  stop: "Stop and clear",
  repeat_one: "Repeat this item",
  next: "Next, stop after the last",
  loop_all: "Next, loop the playlist",
};

export interface MediaItem {
  id: UUID;
  name: string;
  kind: MediaKind;
  file: string;
  size: number;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  imported_at: number;
}

export interface MediaPlaylist {
  id: UUID;
  name: string;
  kind: PlaylistKind;
  items: UUID[];
  end_action: EndAction;
  bus: number;
  mono: boolean;
  fit: MediaFit;
  image_seconds: number;
}

export interface SlotState {
  playlist_id: UUID | null;
  index: number;
  media_id: UUID;
  name: string;
  kind: MediaKind;
  playing: boolean;
  position_ms: number;
  anchor_ms: number;
  duration_ms: number | null;
  end_action: EndAction;
  bus: number;
  mono: boolean;
  fit: MediaFit;
  image_seconds: number;
  volume_db: number;
}

export interface PlayerView {
  visual: SlotState | null;
  audio: SlotState | null;
  volumes: [number, number];
  now_ms: number;
}
