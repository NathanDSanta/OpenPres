import type { Presentation } from "@/types";
import { usePresentationTheme } from "@/hooks/usePresentationTheme";
import { ArrangementEditor } from "@/components/arrangements/ArrangementEditor";

import "./styles/PresentationPreview.css";

interface PresentationPreviewProps {
  presentation: Presentation | null;
  selectedId: string | null;
  loading: boolean;
}

export default function PresentationPreview({
  presentation,
  loading,
}: PresentationPreviewProps) {
  const { theme, loading: loadingTheme, error: themeError } =
    usePresentationTheme(presentation);

  if (loading) {
    return <div className="presentation-preview-panel">Loading presentation...</div>;
  }

  if (!presentation) {
    return (
      <div className="presentation-preview-panel">
        Select a presentation to preview it.
      </div>
    );
  }

  return (
    <section className="presentation-preview-panel">
      <header className="preview-heading">
        <div>
          <h2>{presentation.metadata.title ?? presentation.nameid}</h2>
          <span>
            {theme ? `Theme: ${theme.name}` : "Default slide style"}
          </span>
        </div>
      </header>

      {loadingTheme ? (
        <div className="preview-content">Loading theme...</div>
      ) : (
        <div className="preview-content">
          {themeError && (
            <div className="songs-error" role="alert">
              {themeError} — showing default slides.
            </div>
          )}

          <ArrangementEditor
            presentation={presentation}
            theme={theme}
          />
        </div>
      )}
    </section>
  );
}

