import { apiGet, apiPost } from "./client";
import type { LoadPresentationRequest, PresenterState, PresenterTarget } from "@/types";

export const presenterApi = {
  getState: () => apiGet<PresenterState>("/presenter/state"),
  load: (body: LoadPresentationRequest) => apiPost<PresenterState>("/presenter/load", body),
  next: (layer: PresenterTarget = "slides") => apiPost<PresenterState>(`/presenter/next?layer=${layer}`),
  previous: (layer: PresenterTarget = "slides") =>
    apiPost<PresenterState>(`/presenter/previous?layer=${layer}`),
  goto: (index: number, layer: PresenterTarget = "slides") =>
    apiPost<PresenterState>(`/presenter/goto?layer=${layer}`, { index }),
  clear: (layer: PresenterTarget = "slides") => apiPost<PresenterState>(`/presenter/clear?layer=${layer}`),
};
