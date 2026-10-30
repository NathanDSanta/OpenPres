import "@/styles/Songs.css";


import { useSongs } from "@/hooks/useSongs";

import SourceSelector from "@/components/songs/SourceSelector";
import PresentationList from "@/components/songs/PresentationList";
import PresentationPreview from "@/components/songs/PresentationPreview";

export default function Songs() {
  const {
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
  } = useSongs();

  return (
    <section className="songs-page">
      <header className="songs-header">
        <div>
          <h1>Songs</h1>
          <p className="songs-subtitle">
            Browse your libraries, playlists and presentations.
          </p>
        </div>
      </header>

      {error && (

        <div className="songs-error" role="alert">
          {error}
        </div>
      )}

      <div className="songs-workspace">
        <div className="songs-content-column">
          <SourceSelector
            libraries={libraries}
            playlists={playlists}
            selectedSource={source}
            loading={loadingSources}
            onSelect={selectSource}
          />

          <PresentationList
            presentations={presentations}
            selectedId={selectedId}
            loading={loadingList}
            hasSource={source !== null}
            onSelect={setSelectedId}
          />
        </div>

        <PresentationPreview
          presentation={presentation}
          selectedId={selectedId}
          loading={loadingPreview}
        />
      </div>
    </section>
  );
}

