import { apiDelete, apiGet, apiPost, apiPut } from "./client";
import type { OutputWindow, Power, ServerInfo, UpdateStatus } from "@/types";

/** The server itself: identity, setup, power, output windows, default dashboards. */
export const serverApi = {
  info: () => apiGet<ServerInfo>("/server"),
  /** Admin: rename, start with the computer. */
  update: (body: { name?: string; starts_with_computer?: boolean }) => apiPut<ServerInfo>("/server", body),
  setupStatus: () => apiGet<{ set_up: boolean; name: string; remote_access: boolean }>("/setup"),
  setUp: (body: { name: string; admin_password: string; operator_password: string; remote_access: boolean }) =>
    apiPost<{ set_up: boolean }>("/setup", body),
  /** Updates of the server itself. */
  updateStatus: () => apiGet<UpdateStatus>("/server/update"),
  checkUpdate: () => apiPost<UpdateStatus>("/server/update/check"),
  /** Admin: download, install and restart. */
  installUpdate: () => apiPost<UpdateStatus>("/server/update/install"),
  power: () => apiGet<{ power: Power }>("/power"),
  setPower: (power: Power) => apiPut<{ power: Power }>("/power", { power }),
  outputs: () => apiGet<{ outputs: OutputWindow[]; showing: boolean }>("/outputs"),
  setOutputVisible: (displayId: string, visible: boolean) =>
    apiPut<{ outputs: OutputWindow[] }>(`/outputs/display/${encodeURIComponent(displayId)}`, { visible }),
  setScreenOutputVisible: (screenId: string, visible: boolean) =>
    apiPut<{ outputs: OutputWindow[] }>(`/outputs/screen/${screenId}`, { visible }),
  defaultDashboard: <T>(mode: string) => apiGet<T | null>(`/dashboards/defaults/${mode}`),
  /** Admin. */
  setDefaultDashboard: <T>(mode: string, dashboard: T) => apiPut<T>(`/dashboards/defaults/${mode}`, dashboard),
  clearDefaultDashboard: (mode: string) => apiDelete(`/dashboards/defaults/${mode}`),
};
