import { apiGet, apiPost, apiPut } from "./client";
import type { YoutubeStatus } from "@/types";

export const youtubeApi = {
  status: () => apiGet<YoutubeStatus>("/youtube"),
  setClient: (client_id: string, client_secret?: string) =>
    apiPut<YoutubeStatus>("/youtube/client", { client_id, client_secret }),
  connect: () => apiPost<{ url: string; opened: boolean }>("/youtube/connect"),
  disconnect: () => apiPost<YoutubeStatus>("/youtube/disconnect"),
  refreshBroadcast: () => apiPost<YoutubeStatus>("/youtube/broadcast/refresh"),
  useStreamKey: () => apiPost("/youtube/use-stream-key"),
};
