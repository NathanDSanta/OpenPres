import { apiGet, apiPost, apiPut } from "./client";
import type { MacrosFile, MacrosStatus } from "@/types";

/** Where a macro was started from (shown in its last runs). */
export type MacroSource = "button" | "shortcut" | "command" | "stream_deck";

export const macrosApi = {
  list: () => apiGet<MacrosFile>("/macros"),
  /** Admin only. */
  save: (file: MacrosFile) => apiPut<MacrosFile>("/macros", file),
  status: () => apiGet<MacrosStatus>("/macros/status"),
  run: (id: string, from: MacroSource = "button") => apiPost(`/macros/${id}/run`, { from }),
  stop: (id: string) => apiPost(`/macros/${id}/stop`),
};
