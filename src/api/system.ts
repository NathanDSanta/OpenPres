import { apiGet, apiPost, apiPut } from "./client";
import type {
  AuthStatus,
  ConfigResponse,
  ConfigUpdate,
  GroupsFile,
  HealthResponse,
  NetworkInfo,
  SecurityUpdate,
  TemplatesFile,
} from "@/types";

export const systemApi = {
  health: () => apiGet<HealthResponse>("/health"),
  getConfig: () => apiGet<ConfigResponse>("/config"),
  updateConfig: (body: ConfigUpdate) => apiPut<ConfigResponse>("/config", body),
  updateSecurity: (body: SecurityUpdate) => apiPut<ConfigResponse>("/config/security", body),
  network: () => apiGet<NetworkInfo>("/network"),

  authStatus: () => apiGet<AuthStatus>("/auth/status"),
  login: (password: string) => apiPost<{ authenticated: boolean }>("/auth/login", { password }),
  logout: () => apiPost("/auth/logout"),

  getWorkspace: <T>() => apiGet<T>("/workspace"),
  saveWorkspace: <T>(workspace: T) => apiPut<T>("/workspace", workspace),

  getGroups: () => apiGet<GroupsFile>("/groups"),
  saveGroups: (groups: GroupsFile) => apiPut<GroupsFile>("/groups", groups),

  getTemplates: () => apiGet<TemplatesFile>("/import/templates"),
  saveTemplates: (t: TemplatesFile) => apiPut<TemplatesFile>("/import/templates", t),
};
