import type { DesignRef } from "./themes";

export interface LiveLayers {
  video_input: string | null;
  /** The props that are on (each collection is for the Stage or the Livestream). */
  props: DesignRef[];
}

/** Layers that can be cleared, top first as they stack on a screen, then the audio. */
export type ClearLayer = "audio" | "props" | "announcements" | "bible" | "slides" | "media" | "video_input";

/** A button that clears several layers at once (set up by the admin). */
export interface ClearGroup {
  id: string;
  name: string;
  icon: string;
  color: string;
  layers: ClearLayer[];
}

export interface ClearGroupsFile {
  groups: ClearGroup[];
}
