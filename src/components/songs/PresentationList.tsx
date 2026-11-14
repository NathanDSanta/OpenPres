import { FolderInput, ListPlus, Megaphone, Palette, Play, Presentation as PresentationIcon, Search, Trash2 } from "lucide-react";
import { libraryApi, markChanged, playlistApi, presenterApi, themesApi, useLive } from "@/api";
import { useMenu, divider, type MenuEntry } from "@/components/ui/Menu";
import { designMenuEntries } from "@/components/pickers/pickers";
import { addToPlaylist, moveToLibrary, setPresentationDesign, setPresentationLayer } from "@/lib/presentations";
import { notifyError, useDialogs } from "@/state/Dialogs";
import type { PresentationSummary } from "@/types";
import { PRESENTATION_DRAG } from "./SourceSelector";
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

/** Layer menu (presentation vs announcements), like the group picker. */
export function layerEntries(item: { id: string; layer: string }): MenuEntry[] {
  const set = (layer: "slides" | "announcements") => () => void setPresentationLayer(item.id, layer).catch(notifyError);
  return [
    { key: "slides", label: "Presentation (slides layer)", icon: <PresentationIcon size={13} />, checked: item.layer !== "announcements", onSelect: set("slides") },
    { key: "announcements", label: "Announcements layer", icon: <Megaphone size={13} />, checked: item.layer === "announcements", onSelect: set("announcements") },
  ];
}

export default function PresentationList({ presentations, selectedId, loading, hasSource, query, showLibrary, onQueryChange, onSelect, onPresent }: PresentationListProps) {
  const menu = useMenu();
  const { confirm } = useDialogs();
  const { data: themes } = useLive(() => themesApi.list("slides"));
  const { data: playlists } = useLive(() => playlistApi.list());
  const { data: libraries } = useLive(() => libraryApi.listLibraries());

  const rowMenu = (item: PresentationSummary): MenuEntry[] => [
    { key: "present", label: "Present", icon: <Play size={13} />, onSelect: () => onPresent(item.id) },
    divider("d0"),
    { key: "layer", label: "Layer", icon: item.layer === "announcements" ? <Megaphone size={13} /> : <PresentationIcon size={13} />, children: layerEntries(item) },
    {
      key: "design",
      label: "Design for every slide",
      icon: <Palette size={13} />,
      children: designMenuEntries(themes ?? [], null, (ref) => void setPresentationDesign(item.id, ref).catch(notifyError), "Default look"),
    },
    {
      key: "playlist",
      label: "Add to playlist",
      icon: <ListPlus size={13} />,
      children: (playlists ?? []).length
        ? (playlists ?? []).map((p) => ({ key: p.id, label: p.name, checked: p.presentation_ids.includes(item.id), onSelect: () => void addToPlaylist(p.id, item.id).catch(notifyError) }))
        : [{ key: "none", label: "No playlists yet", disabled: true }],
    },
    {
      key: "library",
      label: "Move to library",
      icon: <FolderInput size={13} />,
      children: (libraries ?? []).map((l) => ({ key: l.id, label: l.name, checked: l.name === item.library_name, onSelect: () => void moveToLibrary(item.id, l.id).catch(notifyError) })),
    },
    divider("d1"),
    {
      key: "delete",
      label: "Delete",
      danger: true,
      icon: <Trash2 size={13} />,
      onSelect: () =>
        void confirm({ title: `Delete “${item.title}”?`, message: "The presentation file is deleted.", confirmLabel: "Delete", danger: true }).then((ok) => {
          if (ok) void libraryApi.deletePresentation(item.id).then(markChanged).catch(notifyError);
        }),
    },
  ];

  return (
    <section className="panel presentation-list-panel">
      <header className="panel-header">
        <label className="presentation-search">
          <Search size={14} />
          <input value={query} onChange={(e) => onQueryChange(e.target.value)} placeholder="Search (accents and symbols ignored)" aria-label="Search presentations" />
        </label>
        <span className="presentation-count">{presentations.length}</span>
      </header>

      <div className="presentation-list">
        {loading && <p className="presentation-list-message">Loading presentations…</p>}
        {!loading && !hasSource && <p className="presentation-list-message">No libraries or playlists available.</p>}
        {!loading && hasSource && presentations.length === 0 && <p className="presentation-list-message">{query ? "Nothing matches your search." : "No presentations here."}</p>}

        {!loading &&
          presentations.map((item) => {
            const active = selectedId === item.id;
            const isAnnouncement = item.layer === "announcements";
            return (
              <div
                key={item.id}
                role="button"
                tabIndex={0}
                className={`presentation-row${active ? " active" : ""}`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(PRESENTATION_DRAG, item.id);
                  e.dataTransfer.effectAllowed = "copyMove";
                }}
                onClick={() => onSelect(item.id)}
                onDoubleClick={() => onPresent(item.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onPresent(item.id);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onSelect(item.id);
                  menu.open({ x: e.clientX, y: e.clientY }, rowMenu(item));
                }}
                title="Click to preview, double-click to present, drag onto a playlist or library"
              >
                <span className="presentation-title">
                  {item.title}
                  {showLibrary && item.library_name && <small className="presentation-library">{item.library_name}</small>}
                </span>
                <button
                  className={`layer-indicator ${isAnnouncement ? "announcement" : "slides"}`}
                  title={`${isAnnouncement ? "Announcements" : "Presentation"} layer (click to change)`}
                  onClick={(e) => {
                    e.stopPropagation();
                    menu.open(e.currentTarget, layerEntries(item));
                  }}
                  onDoubleClick={(e) => e.stopPropagation()}
                >
                  {isAnnouncement ? <Megaphone size={15} /> : <PresentationIcon size={15} />}
                </button>
              </div>
            );
          })}
      </div>
      {menu.element}
    </section>
  );
}

export { presenterApi };
