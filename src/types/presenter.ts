import type { UUID } from "./common";
import type { VirtualScreen } from "./screens";
import type { Theme } from "./themes";
import type { PresentationLayer } from "./library";

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

export interface LoadPresentationRequest {
  presentation_id: UUID;
  arrangement?: string;
}

export interface GoToSlideRequest {
  index: number;
}
export interface LayerQuery {
  layer?: PresentationLayer;
}

export interface RenderedPresentation {
  slide: LivePresentationState;
  theme: Theme | null;
}

export interface ScreenRenderResponse {
  screen: VirtualScreen;
  presentations: {
    slides: RenderedPresentation | null;
    announcements: RenderedPresentation | null;
  };
}
