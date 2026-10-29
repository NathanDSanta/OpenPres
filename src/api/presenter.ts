import { apiGet, apiPost } from "./client";
import type {
  PresenterState,
  LoadPresentationRequest,
  GoToSlideRequest,
  PresentationLayer,
} from "@/types";

export const presenterApi = {
  getState: () => apiGet<PresenterState>("/presenter/state"),

  load: (body: LoadPresentationRequest) =>
    apiPost<PresenterState>("/presenter/load", body),

  next: (layer: PresentationLayer = "slides") =>
    apiPost<PresenterState>(`/presenter/next?layer=${layer}`),
  previous: (layer: PresentationLayer = "slides") =>
    apiPost<PresenterState>(`/presenter/previous?layer=${layer}`),
  goto: (body: GoToSlideRequest, layer: PresentationLayer = "slides") =>
    apiPost<PresenterState>(`/presenter/goto?layer=${layer}`, body),
  clear: (layer: PresentationLayer = "slides") =>
    apiPost<PresenterState>(`/presenter/clear?layer=${layer}`),
};
