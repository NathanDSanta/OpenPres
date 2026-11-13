import type { UUID } from "./common";
import type { Design } from "./themes";
import type { VirtualScreen } from "./screens";
import type { MediaItem, SlotState } from "./media";
import type { TimerView } from "./timers";

export interface LiveSlide {
  index: number;
  group: string;
  text: string;
}

export interface LivePresentationState {
  presentation_id: UUID;
  title: string;
  arrangement: string;
  /** Zero-based index. */
  slide_index: number;
  total_slides: number;
  current: LiveSlide | null;
  previous: LiveSlide | null;
  next: LiveSlide | null;
}

export interface PresenterState {
  slides: LivePresentationState | null;
  announcements: LivePresentationState | null;
}

export type PresenterTarget = "slides" | "announcements" | "all";

export interface LoadPresentationRequest {
  presentation_id: UUID;
  arrangement?: string;
  index?: number;
}

/** A design together with the size of the theme it belongs to. */
export interface Look {
  theme: { id: UUID; name: string; width: number; height: number };
  design: Design;
}

export interface RenderedPresentation {
  slide: LivePresentationState;
  /** null = no theme: drawn with the built-in default look. */
  look: Look | null;
}

export interface RenderScene {
  screen: VirtualScreen;
  now_ms: number;
  layers: {
    video_input: { device_id: string } | null;
    media: { state: SlotState; item: MediaItem | null } | null;
    slides: RenderedPresentation | null;
    announcements: RenderedPresentation | null;
    complements: Look[];
    props: Look[];
  };
  mask: Look | null;
  timers: TimerView[];
}
