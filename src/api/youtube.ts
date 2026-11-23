import { apiGet } from "./client";

export const youtubeApi = {
  /** The video a YouTube link points to (a channel's /live page: what it broadcasts now). */
  video: (url: string) => apiGet<{ video_id: string }>(`/youtube/video?url=${encodeURIComponent(url)}`),
};
