import {
  Presentation as PresentationIcon,
  Megaphone,
  Search,
} from "lucide-react";
import type { PresentationSummary } from "@/types";

import "./styles/PresentationList.css";

interface PresentationListProps {
  presentations: PresentationSummary[];
  selectedId: string | null;
  loading: boolean;
  hasSource: boolean;
  query: string;
  showLibrary: boolean;
  onQueryChange: (query: string) => void;
  onSelect: (id: string) => void;
  onPresent: (id: string) => void;
}

export default function PresentationList({
  presentations,
  selectedId,
  loading,
  hasSource,
  query,
  showLibrary,
  onQueryChange,
  onSelect,
  onPresent,
}: PresentationListProps) {
  return (
    <section className="presentation-list-panel">
      <header className="panel-heading">
        <div>
          <h2>Presentations</h2>
          <p>Click to preview, double-click to present.</p>
        </div>

        <span className="presentation-count">
          {presentations.length}
        </span>
      </header>

      <label className="presentation-search">
        <Search size={14} />
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search (accents and symbols ignored)"
          aria-label="Search presentations"
        />
      </label>

      <div className="presentation-list">
        {loading && (
          <p className="presentation-list-message">
            Loading presentations...
          </p>
        )}

        {!loading && !hasSource && (
          <p className="presentation-list-message">
            No libraries or playlists available.
          </p>
        )}

        {!loading && hasSource && presentations.length === 0 && (
          <p className="presentation-list-message">
            {query ? "Nothing matches your search." : "No presentations in this source."}
          </p>
        )}

        {!loading &&
          presentations.map((item) => {
            const active = selectedId === item.id;
            const isAnnouncement = item.layer === "announcements";

            return (
              <button
                key={item.id}
                type="button"
                className={`presentation-row${active ? " active" : ""}`}
                onClick={() => onSelect(item.id)}
                onDoubleClick={() => onPresent(item.id)}
                title={`${item.title} — ${isAnnouncement ? "Announcements" : "Slides"
                  }`}
                aria-pressed={active}
              >
                <PresentationIcon
                  className="presentation-row-leading"
                  size={17}
                />

                <span className="presentation-title">
                  {item.title}
                  {showLibrary && item.library_name && (
                    <small className="presentation-library">{item.library_name}</small>
                  )}
                </span>

                <span
                  className={`layer-indicator ${isAnnouncement ? "announcement" : "slides"
                    }`}
                  title={
                    isAnnouncement
                      ? "Announcements layer"
                      : "Slides layer"
                  }
                  aria-label={
                    isAnnouncement
                      ? "Announcements layer"
                      : "Slides layer"
                  }
                >
                  {isAnnouncement ? (
                    <Megaphone size={17} />
                  ) : (
                    <PresentationIcon size={17} />
                  )}
                </span>
              </button>
            );
          })}
      </div>
    </section>
  );
}

