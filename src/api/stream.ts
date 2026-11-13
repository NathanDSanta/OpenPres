import { apiGet, apiPost, apiPut } from "./client";
import type { StreamSettings, StreamStatus } from "@/types";

export const streamApi = {
  settings: () => apiGet<StreamSettings>("/stream/settings"),
  saveSettings: (s: StreamSettings) => apiPut<StreamSettings>("/stream/settings", s),
  status: () => apiGet<StreamStatus>("/stream/status"),
  start: () => apiPost<StreamStatus>("/stream/start"),
  stop: () => apiPost<StreamStatus>("/stream/stop"),
};
