import { apiGet, apiPost, apiPut } from "./client";
import type { ClearGroupsFile, ClearLayer, LiveLayers } from "@/types";

export const liveApi = {
  get: () => apiGet<LiveLayers>("/live"),
  setVideoInput: (device_id: string | null) => apiPut<LiveLayers>("/live/video_input", { device_id }),
  /** Turns a prop on or off (absent `active`: toggles). */
  setProp: (theme_id: string, design_id: string, active?: boolean) => apiPost<LiveLayers>("/live/props", { theme_id, design_id, active }),
  clearProps: () => apiPost<LiveLayers>("/live/props/clear"),
  /** "all" = every visual layer; "everything" = also audio playback. */
  clear: (scope: "all" | "everything") => apiPost("/live/clear", { scope }),
  clearLayers: (layers: ClearLayer[]) => apiPost("/live/clear-layers", { layers }),
  clearGroups: () => apiGet<ClearGroupsFile>("/clear-groups"),
  /** Admin only. */
  saveClearGroups: (file: ClearGroupsFile) => apiPut<ClearGroupsFile>("/clear-groups", file),
  runClearGroup: (id: string) => apiPost(`/clear-groups/${id}/run`),
};
