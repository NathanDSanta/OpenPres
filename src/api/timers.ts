import { apiGet, apiPost, apiPut, apiDelete } from "./client";
import type { Service, TimerDef, TimerView } from "@/types";

export const timersApi = {
  list: () => apiGet<TimerView[]>("/timers"),
  create: (t: Omit<TimerDef, "id">) => apiPost<TimerDef>("/timers", t),
  update: (t: TimerDef) => apiPut<TimerDef>(`/timers/${t.id}`, t),
  remove: (id: string) => apiDelete(`/timers/${id}`),
  action: (id: string, action: "start" | "pause" | "reset") =>
    apiPost<TimerView[]>(`/timers/${id}/${action}`),
  services: () => apiGet<Service[]>("/services"),
  saveServices: (services: Service[]) => apiPut<Service[]>("/services", services),
};
