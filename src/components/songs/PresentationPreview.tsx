import type { Presentation } from "@/types";
import { libraryApi, markChanged, themesApi, useLive } from "@/api";
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

/** Changes the presentation's theme/design metadata. */
export async function setPresentationLook(p: Presentation, themeId: string | null, designId: string | null) {
  const metadata = { ...p.metadata };
  if (themeId) metadata.theme = themeId;
  else delete metadata.theme;
  if (themeId && designId) metadata.design = designId;
  else delete metadata.design;
  await libraryApi.replacePresentation(p.id, { nameid: p.nameid, metadata, groups: p.groups });
  markChanged();
}

export default function PresentationPreview({ presentation, loading, liveOnDoubleClick = true }: PresentationPreviewProps) {
  const { theme, loading: loadingTheme, error: themeError } = usePresentationTheme(presentation);
  const { data: themes } = useLive(() => themesApi.list("slides"));

  if (loading && !presentation) {
    return <div className="presentation-preview-panel">Loading presentation...</div>;
  }
  if (!presentation) {
    return <div className="presentation-preview-panel">Select a presentation to preview it.</div>;
  }

  const designId = presentation.metadata.design ?? theme?.designs[0]?.id ?? "";

  return (
    <section className="presentation-preview-panel">
      <header className="preview-heading">
        <div>
          <h2>{presentation.metadata.title ?? presentation.nameid}</h2>
          <span>{theme ? `Theme: ${theme.name}` : "Default look"}</span>
        </div>
        <div className="preview-look">
          <select
            className="select"
            value={presentation.metadata.theme ?? ""}
            onChange={(e) => void setPresentationLook(presentation, e.target.value || null, null)}
            aria-label="Theme"
          >
            <option value="">Default look</option>
            {(themes ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          {theme && (
            <select
              className="select"
              value={designId}
              onChange={(e) => void setPresentationLook(presentation, theme.id, e.target.value)}
              aria-label="Design"
            >
              {theme.designs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          )}
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
