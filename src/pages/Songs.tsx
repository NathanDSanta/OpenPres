import "@/styles/Songs.css";
import { markChanged, presenterApi } from "@/api";
import { useSongs } from "@/hooks/useSongs";
import SourceSelector from "@/components/songs/SourceSelector";
import PresentationList from "@/components/songs/PresentationList";
import PresentationPreview from "@/components/songs/PresentationPreview";
import { notifyError } from "@/state/Dialogs";

export default function Songs() {
  const songs = useSongs();
  return (
    <section className="songs-page">
      {songs.error && (
        <div className="alert alert-error" role="alert">
          {songs.error}
        </div>
      )}
      <div className="songs-workspace">
        <SourceSelector libraries={songs.libraries} playlists={songs.playlists} selectedSource={songs.source} loading={songs.loadingSources} onSelect={songs.selectSource} />
        <PresentationList
          presentations={songs.presentations}
          selectedId={songs.selectedId}
          loading={songs.loadingList}
          hasSource={songs.source !== null}
          query={songs.query}
          showLibrary={songs.source?.type === "all" || songs.source?.type === "playlist"}
          onQueryChange={songs.setQuery}
          onSelect={songs.setSelectedId}
          onPresent={(id) => void presenterApi.load({ presentation_id: id, index: 0 }).then(markChanged).catch(notifyError)}
        />
        <PresentationPreview presentation={songs.presentation} selectedId={songs.selectedId} loading={songs.loadingPreview} />
      </div>
    </section>
  );
}
