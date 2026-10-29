import { apiGet, apiPut } from "./client";
import type { HealthResponse, ConfigResponse, ConfigUpdate } from "@/types";

export const systemApi = {
  health: () => apiGet<HealthResponse>("/health"),
  getConfig: () => apiGet<ConfigResponse>("/config"),
  updateConfig: (body: ConfigUpdate) => apiPut<ConfigResponse>("/config", body),
};
