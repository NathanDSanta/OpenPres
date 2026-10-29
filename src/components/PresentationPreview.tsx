import { Braces, LoaderCircle } from "lucide-react";
import type { Presentation } from "@/types";

import "./styles/PresentationPreview.css";

interface PresentationPreviewProps {
  presentation: Presentation | null;
  selectedId: string | null;
  loading: boolean;
}

export default function PresentationPreview({
  presentation,
  selectedId,
  loading,
}: PresentationPreviewProps) {
  return (
    <section className="presentation-preview-panel">
      <header className="preview-heading">
        <div className="preview-heading-icon">
          <Braces size={18} />
        </div>

        <div className="preview-heading-text">
          <h2>Preview</h2>
          <p>Presentation JSON</p>
        </div>

        <span className="preview-format">JSON</span>
      </header>

      <div className="preview-content">
        {loading ? (
          <div className="preview-state">
            <LoaderCircle size={19} className="preview-spinner" />
            <span>Loading presentation...</span>
          </div>
        ) : !selectedId ? (
          <div className="preview-state">
            Select a presentation to inspect its data.
          </div>
        ) : !presentation ? (
          <div className="preview-state">
            The presentation preview could not be loaded.
          </div>
        ) : (
          <pre className="preview-json">
            <code>{JSON.stringify(presentation, null, 2)}</code>
          </pre>
        )}
      </div>
    </section>
  );
}

