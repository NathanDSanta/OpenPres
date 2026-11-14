import { libraryApi, markChanged, playlistApi } from "@/api";
import type { DesignRef, Presentation } from "@/types";

/** Rewrites a presentation's metadata (layer, theme, design). */
export async function updateMetadata(id: string, change: (metadata: Record<string, string>) => void): Promise<Presentation> {
  const p = await libraryApi.getPresentation(id);
  const metadata = { ...p.metadata };
  change(metadata);
  const saved = await libraryApi.replacePresentation(p.id, { nameid: p.nameid, metadata, groups: p.groups });
  markChanged();
  return saved;
}

export const setPresentationLayer = (id: string, layer: "slides" | "announcements") =>
  updateMetadata(id, (m) => {
    m.layer = layer;
  });

/** One design for every slide (per-group designs are removed); null = default look. */
export const setPresentationDesign = (id: string, ref: DesignRef | null) =>
  updateMetadata(id, (m) => {
    for (const key of Object.keys(m)) if (key.startsWith("design@")) delete m[key];
    if (ref) {
      m.theme = ref.theme_id;
      m.design = ref.design_id;
    } else {
      delete m.theme;
      delete m.design;
    }
  });

export async function addToPlaylist(playlistId: string, presentationId: string) {
  const playlist = await playlistApi.get(playlistId);
  await playlistApi.update(playlistId, { name: playlist.name, presentation_ids: [...playlist.presentation_ids, presentationId] });
  markChanged();
  return playlist;
}

export async function moveToLibrary(presentationId: string, libraryId: string) {
  await libraryApi.movePresentation(presentationId, libraryId);
  markChanged();
}
