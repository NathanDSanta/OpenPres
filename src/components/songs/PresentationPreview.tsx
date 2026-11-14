import type { DesignRef, Presentation } from "@/types";
import { DesignPicker } from "@/components/pickers/pickers";
import { setPresentationDesign } from "@/lib/presentations";
import { notifyError } from "@/state/Dialogs";
import { usePresentationTheme } from "@/hooks/usePresentationTheme";
import { ArrangementEditor } from "@/components/arrangements/ArrangementEditor";
import "./styles/PresentationPreview.css";

interface PresentationPreviewProps {
  presentation: Presentation | null;
  selectedId: string | null;
  loading: boolean;
  /** Reflow uses the same view without "double-click to go live". */
  liveOnDoubleClick?: boolean;
}

export default function PresentationPreview({ presentation, loading, liveOnDoubleClick = true }: PresentationPreviewProps) {
  const { theme, loading: loadingTheme, error: themeError } = usePresentationTheme(presentation);

  if (loading && !presentation) {
    return <div className="presentation-preview-panel">Loading presentation...</div>;
  }
  if (!presentation) {
    return <div className="presentation-preview-panel">Select a presentation to preview it.</div>;
  }

  const designId = presentation.metadata.design ?? theme?.designs[0]?.id ?? "";
  const value: DesignRef | null = presentation.metadata.theme && designId ? { theme_id: presentation.metadata.theme, design_id: designId } : null;
  const perGroup = Object.keys(presentation.metadata).some((k) => k.startsWith("design@"));

  return (
    <section className="panel presentation-preview-panel">
      <header className="preview-heading">
        <div>
          <h2>{presentation.metadata.title ?? presentation.nameid}</h2>
          <span>{theme ? `${theme.name}${perGroup ? " · some groups use their own design" : ""}` : "Default look"}</span>
        </div>
        <div className="preview-look" title="Theme, then the design used on every slide">
          <DesignPicker kind="slides" small value={value} noneLabel="Default look" onChange={(ref) => void setPresentationDesign(presentation.id, ref).catch(notifyError)} />
        </div>
      </header>

      {loadingTheme && !theme ? (
        <div className="preview-content">Loading theme...</div>
      ) : (
        <div className="preview-content">
          {themeError && (
            <div className="songs-error" role="alert">
              {themeError} — showing the default look.
            </div>
          )}
          <ArrangementEditor presentation={presentation} theme={theme} liveOnDoubleClick={liveOnDoubleClick} />
        </div>
      )}
    </section>
  );
}
