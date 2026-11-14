import { apiGet, apiPost, apiPut, apiDelete } from "./client";
import { uploadRaw } from "./server";
import type { MediaItem, MediaPlaylist, PlayerSlot, PlayerView } from "@/types";

export const mediaApi = {
  list: () => apiGet<MediaItem[]>("/media"),
  /** Into a folder (by id, or by name: created when missing); default folder otherwise. */
  import: (file: File, folder?: { id?: string; name?: string }, onProgress?: (f: number) => void) =>
    uploadRaw<MediaItem>(
      "/media/import",
      {
        name: file.name,
        ...(folder?.id ? { folder: folder.id } : {}),
        ...(folder?.name ? { folder_name: folder.name } : {}),
      },
      file,
      onProgress,
    ),
  move: (id: string, folder_id: string, index?: number) => apiPost(`/media/${id}/move`, { folder_id, index }),
  rename: (id: string, name: string) => apiPut<MediaItem>(`/media/${id}`, { name }),
  setMeta: (id: string, meta: { duration_ms?: number; width?: number; height?: number }) =>
    apiPut(`/media/${id}/meta`, meta),
  remove: (id: string) => apiDelete(`/media/${id}`),

  playlists: () => apiGet<MediaPlaylist[]>("/media/playlists"),
  createPlaylist: (p: Omit<MediaPlaylist, "id">) => apiPost<MediaPlaylist>("/media/playlists", p),
  updatePlaylist: (p: MediaPlaylist) => apiPut<MediaPlaylist>(`/media/playlists/${p.id}`, p),
  removePlaylist: (id: string) => apiDelete(`/media/playlists/${id}`),

  player: () => apiGet<PlayerView>("/player"),
  play: (
    slot: PlayerSlot,
    body: { playlist_id?: string; index?: number; media_id?: string; paused?: boolean } = {},
  ) => apiPost<PlayerView>(`/player/${slot}/play`, body),
  toggle: (slot: PlayerSlot) => apiPost<PlayerView>(`/player/${slot}/toggle`),
  pause: (slot: PlayerSlot) => apiPost<PlayerView>(`/player/${slot}/pause`),
  resume: (slot: PlayerSlot) => apiPost<PlayerView>(`/player/${slot}/resume`),
  seek: (slot: PlayerSlot, position_ms: number) =>
    apiPost<PlayerView>(`/player/${slot}/seek`, { position_ms: Math.max(0, Math.round(position_ms)) }),
  next: (slot: PlayerSlot) => apiPost<PlayerView>(`/player/${slot}/next`),
  previous: (slot: PlayerSlot) => apiPost<PlayerView>(`/player/${slot}/previous`),
  clear: (slot: PlayerSlot) => apiPost<PlayerView>(`/player/${slot}/clear`),
  volume: (slot: PlayerSlot, volume_db: number) =>
    apiPut<PlayerView>(`/player/${slot}/volume`, { volume_db }),
};
