import { apiGet, apiPost, apiPut, apiDelete } from "./client";
import type {
  ScreenView,
  ScreenInput,
  PhysicalDisplay,
  BindDisplayRequest,
  ScreenRenderResponse,
} from "@/types";

export const screensApi = {
  list: () => apiGet<ScreenView[]>("/screens"),
  create: (input: ScreenInput) => apiPost<ScreenView>("/screens", input),
  update: (id: string, input: ScreenInput) =>
    apiPut<ScreenView>(`/screens/${id}`, input),
  remove: (id: string) => apiDelete(`/screens/${id}`),

  setBinding: (id: string, body: BindDisplayRequest) =>
    apiPut<ScreenView>(`/screens/${id}/binding`, body),
  clearBinding: (id: string) => apiDelete(`/screens/${id}/binding`),

  listDisplays: () => apiGet<PhysicalDisplay[]>("/displays"),
  refreshDisplays: () => apiPost<PhysicalDisplay[]>("/displays/refresh"),

  render: (id: string) => apiGet<ScreenRenderResponse>(`/screens/${id}/render`),
};
