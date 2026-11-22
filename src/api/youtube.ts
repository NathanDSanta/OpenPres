import { apiGet, apiPost, apiPut } from "./client";
import type { YoutubeStatus } from "@/types";

export const youtubeApi = {
  status: () => apiGet<YoutubeStatus>("/youtube"),
  setClient: (client_id: string, client_secret?: string) =>
    apiPut<YoutubeStatus>("/youtube/client", { client_id, client_secret }),
  /** `remote`: the manager isn't on the server's computer, so it opens the sign-in itself. */
  connect: (remote = false) => apiPost<{ url: string; opened: boolean }>("/youtube/connect", { remote }),
  /** The address Google sent the browser to (from a manager on another computer). */
  complete: (url: string) => apiPost<YoutubeStatus>("/youtube/oauth/complete", { url }),
  disconnect: () => apiPost<YoutubeStatus>("/youtube/disconnect"),
  refreshBroadcast: () => apiPost<YoutubeStatus>("/youtube/broadcast/refresh"),
  useStreamKey: () => apiPost("/youtube/use-stream-key"),
};
