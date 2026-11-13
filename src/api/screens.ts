import { apiGet, apiPost, apiPut, apiDelete } from "./client";
import type {
  BindDisplayRequest,
  LayerKind,
  PhysicalDisplay,
  RenderScene,
  ScreenInput,
  ScreenView,
} from "@/types";

export const screensApi = {
  list: () => apiGet<ScreenView[]>("/screens"),
  create: (input: ScreenInput) => apiPost<ScreenView>("/screens", input),
  update: (id: string, input: ScreenInput) => apiPut<ScreenView>(`/screens/${id}`, input),
  remove: (id: string) => apiDelete(`/screens/${id}`),
  setLayer: (id: string, kind: LayerKind, enabled: boolean) =>
    apiPut<ScreenView>(`/screens/${id}/layers/${kind}`, { enabled }),

  setBinding: (id: string, body: BindDisplayRequest) =>
    apiPut<ScreenView>(`/screens/${id}/binding`, body),
  clearBinding: (id: string) => apiDelete(`/screens/${id}/binding`),

  listDisplays: () => apiGet<PhysicalDisplay[]>("/displays"),
  refreshDisplays: () => apiPost<PhysicalDisplay[]>("/displays/refresh"),

  render: (id: string) => apiGet<RenderScene>(`/screens/${id}/render`),
};
