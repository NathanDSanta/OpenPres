import { apiGet, apiPut, apiDelete } from "./client";
import type { Layer, LayerKind, LayerStack, LayerUpdateRequest } from "@/types";

export const layersApi = {
  list: (screenId: string) => apiGet<LayerStack>(`/screens/${screenId}/layers`),
  get: (screenId: string, kind: LayerKind) =>
    apiGet<Layer>(`/screens/${screenId}/layers/${kind}`),
  set: (screenId: string, kind: LayerKind, body: LayerUpdateRequest) =>
    apiPut<Layer>(`/screens/${screenId}/layers/${kind}`, body),
  clear: (screenId: string, kind: LayerKind) =>
    apiDelete<Layer>(`/screens/${screenId}/layers/${kind}`),
};
