import { apiGet, apiPost, apiPut, apiDelete } from "./client";
import type { Theme, ThemeSummary } from "@/types";

export const themesApi = {
  list: () => apiGet<ThemeSummary[]>("/themes"),
  get: (id: string) => apiGet<Theme>(`/themes/${id}`),
  create: (theme: Theme) => apiPost<Theme>("/themes", theme),
  update: (id: string, theme: Theme) => apiPut<Theme>(`/themes/${id}`, theme),
  remove: (id: string) => apiDelete(`/themes/${id}`),
};
