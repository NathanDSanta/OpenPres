import { apiGet, apiPost, apiPut, apiDelete } from "./client";
import type { Playlist, PlaylistWriteRequest, PlaylistResponse } from "@/types";

export const playlistApi = {
  list: () => apiGet<Playlist[]>("/playlists"),
  create: (body: PlaylistWriteRequest) => apiPost<Playlist>("/playlists", body),
  get: (id: string) => apiGet<Playlist>(`/playlists/${id}`),
  update: (id: string, body: PlaylistWriteRequest) =>
    apiPut<Playlist>(`/playlists/${id}`, body),
  remove: (id: string) => apiDelete(`/playlists/${id}`),
  resolve: (id: string) =>
    apiGet<PlaylistResponse>(`/playlists/${id}/presentations`),
};
