import { apiGet, apiPost, apiPut, apiDelete } from "./client";
import type { Theme, ThemeKind, ThemeSummary } from "@/types";

export const themesApi = {
  list: (kind?: ThemeKind) => apiGet<ThemeSummary[]>(kind ? `/themes?kind=${kind}` : "/themes"),
  get: (id: string) => apiGet<Theme>(`/themes/${id}`),
  create: (theme: Theme) => apiPost<Theme>("/themes", theme),
  update: (id: string, theme: Theme) => apiPut<Theme>(`/themes/${id}`, theme),
  remove: (id: string) => apiDelete(`/themes/${id}`),
};
