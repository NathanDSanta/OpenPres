import { apiGet, apiPost, apiPut } from "./client";
import type { EncoderList, StreamSettings, StreamStatus } from "@/types";

export const streamApi = {
  settings: () => apiGet<StreamSettings>("/stream/settings"),
  saveSettings: (s: StreamSettings) => apiPut<StreamSettings>("/stream/settings", s),
  status: () => apiGet<StreamStatus>("/stream/status"),
  start: () => apiPost<StreamStatus>("/stream/start"),
  stop: () => apiPost<StreamStatus>("/stream/stop"),
  /** Which encoders work on this computer (the first call tries them: a few seconds). */
  encoders: () => apiGet<EncoderList>("/stream/encoders"),
};
