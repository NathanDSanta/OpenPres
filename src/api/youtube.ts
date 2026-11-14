import { apiDelete, apiGet, apiPost, apiPut } from "./client";
import type { ChatPage, YoutubeStatus } from "@/types";

export const youtubeApi = {
  status: () => apiGet<YoutubeStatus>("/youtube"),
  setClient: (client_id: string, client_secret?: string) =>
    apiPut<YoutubeStatus>("/youtube/client", { client_id, client_secret }),
  connect: () => apiPost<{ url: string; opened: boolean }>("/youtube/connect"),
  disconnect: () => apiPost<YoutubeStatus>("/youtube/disconnect"),
  refreshBroadcast: () => apiPost<YoutubeStatus>("/youtube/broadcast/refresh"),
  useStreamKey: () => apiPost("/youtube/use-stream-key"),
  chat: (since: number) => apiGet<ChatPage>(`/youtube/chat?since=${since}`),
  send: (text: string) => apiPost("/youtube/chat", { text }),
  remove: (id: string) => apiDelete(`/youtube/chat/${encodeURIComponent(id)}`),
  ban: (channel_id: string, seconds?: number) => apiPost("/youtube/chat/ban", { channel_id, seconds }),
};
