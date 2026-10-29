import type { UUID } from "./common";
import type { PresentationSummary } from "./library";

export interface Playlist {
  id: UUID;
  name: string;
  presentation_ids: UUID[];
}
export interface PlaylistWriteRequest {
  name: string;
  presentation_ids?: UUID[];
}
export type PlaylistItem =
  | { id: UUID; missing: false; summary: PresentationSummary }
  | { id: UUID; missing: true };
export interface PlaylistResponse {
  playlist: Playlist;
  items: PlaylistItem[];
}
