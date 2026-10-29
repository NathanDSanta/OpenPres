import { useCallback, useEffect, useState } from "react";
import { libraryApi, playlistApi } from "@/api";
import type {
  Library,
  Playlist,
  Presentation,
  PresentationSummary,
} from "@/types";

import type { Source } from "@/components/SourceSelector";

export function useSongs() {
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [source, setSource] = useState<Source | null>(null);

  const [presentations, setPresentations] = useState<PresentationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [presentation, setPresentation] = useState<Presentation | null>(null);

  const [loadingSources, setLoadingSources] = useState(true);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load libraries and playlists.
  useEffect(() => {
    let cancelled = false;

    async function loadSources() {
      try {
        const [libraryData, playlistData] = await Promise.all([
          libraryApi.listLibraries(),
          playlistApi.list(),
        ]);

        if (cancelled) return;

        setLibraries(libraryData);
        setPlaylists(playlistData);

        if (libraryData.length > 0) {
          setSource({ type: "library", id: libraryData[0].id });
        } else if (playlistData.length > 0) {
          setSource({ type: "playlist", id: playlistData[0].id });
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Could not load libraries and playlists.",
          );
        }
      } finally {
        if (!cancelled) setLoadingSources(false);
      }
    }

    void loadSources();

    return () => {
      cancelled = true;
    };
  }, []);

  // Load presentations for the selected source.
  useEffect(() => {
    if (!source) {
      setPresentations([]);
      setSelectedId(null);
      return;
    }

    const currentSource = source;
    let cancelled = false;

    async function loadPresentations() {
      setLoadingList(true);
      setError(null);
      setPresentations([]);
      setSelectedId(null);
      setPresentation(null);

      try {
        let items: PresentationSummary[];

        if (currentSource.type === "library") {
          items = await libraryApi.listPresentations(currentSource.id);
        } else {
          const result = await playlistApi.resolve(currentSource.id);

          items = result.items.flatMap((item) =>
            item.missing ? [] : [item.summary],
          );
        }

        if (cancelled) return;

        setPresentations(items);
        setSelectedId(items[0]?.id ?? null);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Could not load presentations.",
          );
        }
      } finally {
        if (!cancelled) setLoadingList(false);
      }
    }

    void loadPresentations();

    return () => {
      cancelled = true;
    };
  }, [source]);

  // Load the full JSON for the selected presentation.
  useEffect(() => {
    if (!selectedId) {
      setPresentation(null);
      return;
    }

    let cancelled = false;

    async function loadPreview() {
      setLoadingPreview(true);
      setPresentation(null);

      try {
        const result = await libraryApi.getPresentation(selectedId as string);

        if (!cancelled) setPresentation(result);
      } catch (err) {
        if (!cancelled) {
          setPresentation(null);
          setError(
            err instanceof Error
              ? err.message
              : "Could not load presentation preview.",
          );
        }
      } finally {
        if (!cancelled) setLoadingPreview(false);
      }
    }

    void loadPreview();

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const selectSource = useCallback((nextSource: Source) => {
    setError(null);
    setSource(nextSource);
  }, []);

  return {
    libraries,
    playlists,
    source,
    presentations,
    selectedId,
    presentation,
    loadingSources,
    loadingList,
    loadingPreview,
    error,
    selectSource,
    setSelectedId,
  };
}
