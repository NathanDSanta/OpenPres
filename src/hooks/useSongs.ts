import { useCallback, useEffect, useMemo, useState } from "react";
import { libraryApi, playlistApi, useRevision } from "@/api";
import { search } from "@/lib/search";
import { useApp } from "@/state/AppContext";
import type { Library, Playlist, Presentation, PresentationSummary } from "@/types";
import type { Source } from "@/components/songs/SourceSelector";

let rememberedSource: Source | null = null;

export function useSongs() {
  const { songsSelection, setSongsSelection } = useApp();
  const rev = useRevision();
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [source, setSource] = useState<Source | null>(rememberedSource);
  const [query, setQuery] = useState("");

  const [presentations, setPresentations] = useState<PresentationSummary[]>([]);
  const [presentation, setPresentation] = useState<Presentation | null>(null);

  const [loadingSources, setLoadingSources] = useState(true);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Libraries and playlists.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [libraryData, playlistData] = await Promise.all([libraryApi.listLibraries(), playlistApi.list()]);
        if (cancelled) return;
        setLibraries(libraryData);
        setPlaylists(playlistData);
        setSource((current) => current ?? (libraryData.length > 0 ? { type: "all" } : playlistData[0] ? { type: "playlist", id: playlistData[0].id } : null));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load libraries and playlists.");
      } finally {
        if (!cancelled) setLoadingSources(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rev]);

  // Presentations of the selected source.
  useEffect(() => {
    rememberedSource = source;
    if (!source) {
      setPresentations([]);
      return;
    }
    const current = source;
    let cancelled = false;
    (async () => {
      setLoadingList((loading) => loading || presentations.length === 0);
      try {
        let items: PresentationSummary[];
        if (current.type === "all") items = await libraryApi.listAllPresentations();
        else if (current.type === "library") items = await libraryApi.listPresentations(current.id);
        else {
          const result = await playlistApi.resolve(current.id);
          items = result.items.flatMap((item) => (item.missing ? [] : [item.summary]));
        }
        if (cancelled) return;
        setPresentations(items);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load presentations.");
      } finally {
        if (!cancelled) setLoadingList(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, rev]);

  // The selected presentation in full.
  useEffect(() => {
    if (!songsSelection) {
      setPresentation(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingPreview((l) => l || presentation?.id !== songsSelection);
      try {
        const result = await libraryApi.getPresentation(songsSelection);
        if (!cancelled) setPresentation(result);
      } catch {
        if (!cancelled) setPresentation(null);
      } finally {
        if (!cancelled) setLoadingPreview(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songsSelection, rev]);

  const filtered = useMemo(() => search(presentations, query, (p) => p.title), [presentations, query]);

  const selectSource = useCallback((next: Source) => {
    setError(null);
    setSource(next);
  }, []);

  return {
    libraries,
    playlists,
    source,
    query,
    setQuery,
    presentations: filtered,
    selectedId: songsSelection,
    presentation,
    loadingSources,
    loadingList,
    loadingPreview,
    error,
    selectSource,
    setSelectedId: setSongsSelection,
  };
}
