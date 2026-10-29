
import { FolderOpen, ListMusic, Check } from "lucide-react";
import type { Library, Playlist } from "@/types";

import "./styles/SourceSelector.css";

export type Source =
  | { type: "library"; id: string }
  | { type: "playlist"; id: string };

interface SourceSelectorProps {
  libraries: Library[];
  playlists: Playlist[];
  selectedSource: Source | null;
  loading: boolean;
  onSelect: (source: Source) => void;
}

export default function SourceSelector({
  libraries,
  playlists,
  selectedSource,
  loading,
  onSelect,
}: SourceSelectorProps) {
  return (
    <section className="source-selector">
      <div className="source-group">
        <div className="source-heading">
          <FolderOpen size={16} />
          <span>Libraries</span>
          <span className="source-count">{libraries.length}</span>
        </div>

        <div className="source-options">
          {libraries.map((library) => {
            const active =
              selectedSource?.type === "library" &&
              selectedSource.id === library.id;

            return (
              <button
                key={library.id}
                type="button"
                className={`source-option${active ? " active" : ""}`}
                onClick={() =>
                  onSelect({ type: "library", id: library.id })
                }
                title={library.name}
                aria-pressed={active}
              >
                <FolderOpen size={16} />
                <span className="source-option-name">
                  {library.name}
                </span>
                {active && <Check size={15} className="source-check" />}
              </button>
            );
          })}

          {!loading && libraries.length === 0 && (
            <p className="source-empty">No libraries found</p>
          )}
        </div>
      </div>

      <div className="source-group">
        <div className="source-heading">
          <ListMusic size={16} />
          <span>Playlists</span>
          <span className="source-count">{playlists.length}</span>
        </div>

        <div className="source-options">
          {playlists.map((playlist) => {
            const active =
              selectedSource?.type === "playlist" &&
              selectedSource.id === playlist.id;

            return (
              <button
                key={playlist.id}
                type="button"
                className={`source-option${active ? " active" : ""}`}
                onClick={() =>
                  onSelect({ type: "playlist", id: playlist.id })
                }
                title={playlist.name}
                aria-pressed={active}
              >
                <ListMusic size={16} />
                <span className="source-option-name">
                  {playlist.name}
                </span>
                {active && <Check size={15} className="source-check" />}
              </button>
            );
          })}

          {!loading && playlists.length === 0 && (
            <p className="source-empty">No playlists found</p>
          )}
        </div>
      </div>

      {loading && (
        <p className="source-loading">Loading sources...</p>
      )}
    </section>
  );
}

