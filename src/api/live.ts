import { apiGet, apiPost, apiPut } from "./client";
import type { LiveLayers, PropsLayer } from "@/types";

export const liveApi = {
  get: () => apiGet<LiveLayers>("/live"),
  setVideoInput: (device_id: string | null) => apiPut<LiveLayers>("/live/video_input", { device_id }),
  setProp: (layer: PropsLayer, theme_id: string, design_id: string, active?: boolean) =>
    apiPost<LiveLayers>("/live/props", { layer, theme_id, design_id, active }),
  clearProps: (layer?: PropsLayer) => apiPost<LiveLayers>("/live/props/clear", { layer: layer ?? null }),
  /** "all" = every visual layer; "everything" = also audio playback. */
  clear: (scope: "all" | "everything") => apiPost("/live/clear", { scope }),
};
