import { useMemo, useState } from "react";
import { FolderOpen, Library as LibraryIcon, ListMusic, MoreHorizontal, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { libraryApi, markChanged, playlistApi } from "@/api";
import { useMenu, divider } from "@/components/ui/Menu";
import { normalize } from "@/lib/search";
import { addToPlaylist, moveToLibrary } from "@/lib/presentations";
import { notify, notifyError, useDialogs } from "@/state/Dialogs";
import type { Library, Playlist } from "@/types";
import "./styles/SourceSelector.css";

export type Source = { type: "all" } | { type: "library"; id: string } | { type: "playlist"; id: string };

/** Dragged presentation rows carry their id with this type. */
export const PRESENTATION_DRAG = "application/x-openpres-presentation";

interface SourceSelectorProps {
  libraries: Library[];
  playlists: Playlist[];
  selectedSource: Source | null;
  loading: boolean;
  onSelect: (source: Source) => void;
}

/**
 * Libraries (few) on top, playlists (many, searchable) below. Drop a presentation on a
 * playlist to add it, on a library to move it there.
 */
export default function SourceSelector({ libraries, playlists, selectedSource, loading, onSelect }: SourceSelectorProps) {
  const { prompt, confirm } = useDialogs();
  const menu = useMenu();
  const [query, setQuery] = useState("");
  const [dropOn, setDropOn] = useState<string | null>(null);
  const shown = useMemo(() => {
    const q = normalize(query);
    return q ? playlists.filter((p) => normalize(p.name).includes(q)) : playlists;
  }, [playlists, query]);

  const dropProps = (key: string, onDrop: (id: string) => Promise<unknown>) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(PRESENTATION_DRAG)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setDropOn(key);
    },
    onDragLeave: () => setDropOn((d) => (d === key ? null : d)),
    onDrop: (e: React.DragEvent) => {
      const id = e.dataTransfer.getData(PRESENTATION_DRAG);
      setDropOn(null);
      if (!id) return;
      e.preventDefault();
      void onDrop(id).catch(notifyError);
    },
  });

  const newLibrary = async () => {
    const name = await prompt({ title: "New library", label: "Name", confirmLabel: "Create" });
    if (name) await libraryApi.createLibrary(name).then(markChanged).catch(notifyError);
  };
  const newPlaylist = async () => {
    const name = await prompt({ title: "New playlist", label: "Name", placeholder: "e.g. Sunday 17 Nov", confirmLabel: "Create" });
    if (!name) return;
    try {
      const p = await playlistApi.create({ name, presentation_ids: [] });
      markChanged();
      onSelect({ type: "playlist", id: p.id });
    } catch (e) {
      notifyError(e);
    }
  };

  const playlistMenu = (p: Playlist, anchor: HTMLElement) =>
    menu.open(anchor, [
      {
        key: "rename",
        label: "Rename",
        icon: <Pencil size={13} />,
        onSelect: () =>
          void prompt({ title: "Rename playlist", value: p.name, confirmLabel: "Rename" }).then((name) => {
            if (name) void playlistApi.update(p.id, { name, presentation_ids: p.presentation_ids }).then(markChanged).catch(notifyError);
          }),
      },
      divider("d"),
      {
        key: "delete",
        label: "Delete playlist",
        danger: true,
        icon: <Trash2 size={13} />,
        onSelect: () =>
          void confirm({ title: `Delete “${p.name}”?`, message: "The songs stay in their libraries.", confirmLabel: "Delete", danger: true }).then((ok) => {
            if (ok) void playlistApi.remove(p.id).then(markChanged).catch(notifyError);
          }),
      },
    ]);

  const libraryMenu = (l: Library, anchor: HTMLElement) =>
    menu.open(anchor, [
      {
        key: "delete",
        label: "Delete library and its songs",
        danger: true,
        icon: <Trash2 size={13} />,
        onSelect: () =>
          void confirm({ title: `Delete “${l.name}”?`, message: "Every presentation in it is deleted. This cannot be undone.", confirmLabel: "Delete", danger: true }).then((ok) => {
            if (ok) void libraryApi.deleteLibrary(l.id).then(markChanged).catch(notifyError);
          }),
      },
    ]);

  const isActive = (s: Source) =>
    selectedSource?.type === s.type && (s.type === "all" || (selectedSource as { id?: string }).id === (s as { id?: string }).id);

  return (
    <aside className="panel source-selector">
      <div className="source-group">
        <h3 className="section-title">
          <span>Libraries</span>
          <button className="icon-btn" onClick={() => void newLibrary()} title="New library">
            <Plus size={14} />
          </button>
        </h3>
        {libraries.length > 1 && (
          <button className={`list-row${isActive({ type: "all" }) ? " active" : ""}`} onClick={() => onSelect({ type: "all" })}>
            <LibraryIcon size={15} />
            <span className="grow">All libraries</span>
          </button>
        )}
        {libraries.map((library) => (
          <button
            key={library.id}
            className={`list-row${isActive({ type: "library", id: library.id }) ? " active" : ""}${dropOn === `l:${library.id}` ? " drop-target" : ""}`}
            onClick={() => onSelect({ type: "library", id: library.id })}
            onContextMenu={(e) => {
              e.preventDefault();
              libraryMenu(library, e.currentTarget);
            }}
            title={`${library.name} (drop a song here to move it)`}
            {...dropProps(`l:${library.id}`, async (id) => {
              await moveToLibrary(id, library.id);
              notify(`Moved to ${library.name}.`, "ok");
            })}
          >
            <FolderOpen size={15} />
            <span className="grow">{library.name}</span>
          </button>
        ))}
        {!loading && libraries.length === 0 && <p className="muted small source-empty">No libraries yet.</p>}
      </div>

      <div className="source-group source-playlists">
        <h3 className="section-title">
          <span>Playlists</span>
          <button className="icon-btn" onClick={() => void newPlaylist()} title="New playlist">
            <Plus size={14} />
          </button>
        </h3>
        {playlists.length > 6 && (
          <label className="source-search">
            <Search size={13} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a playlist" />
          </label>
        )}
        <div className="source-scroll">
          {shown.map((playlist) => (
            <div
              key={playlist.id}
              className={`list-row source-playlist${isActive({ type: "playlist", id: playlist.id }) ? " active" : ""}${dropOn === `p:${playlist.id}` ? " drop-target" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => onSelect({ type: "playlist", id: playlist.id })}
              onContextMenu={(e) => {
                e.preventDefault();
                playlistMenu(playlist, e.currentTarget);
              }}
              title="Drop a song here to add it"
              {...dropProps(`p:${playlist.id}`, async (id) => {
                await addToPlaylist(playlist.id, id);
                notify(`Added to ${playlist.name}.`, "ok");
              })}
            >
              <ListMusic size={15} />
              <span className="grow">{playlist.name}</span>
              <span className="muted small">{playlist.presentation_ids.length}</span>
              <button
                className="icon-btn source-more"
                onClick={(e) => {
                  e.stopPropagation();
                  playlistMenu(playlist, e.currentTarget);
                }}
              >
                <MoreHorizontal size={14} />
              </button>
            </div>
          ))}
          {!loading && playlists.length === 0 && <p className="muted small source-empty">No playlists yet.</p>}
          {playlists.length > 0 && shown.length === 0 && <p className="muted small source-empty">No playlist matches.</p>}
        </div>
      </div>
      {menu.element}
    </aside>
  );
}
