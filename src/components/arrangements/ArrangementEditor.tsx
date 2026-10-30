
import type { Presentation, Theme } from "@/types";
import { useArrangementEditor } from "@/hooks/useArrangementEditor";
import { ArrangementToolbar } from "./ArrangementToolbar";
import { ArrangementGroupRows } from "./ArrangementGroupRows";
import { ArrangementSlideGrid } from "./ArrangementSlideGrid";
import "./styles/ArrangementEditor.css";

interface ArrangementEditorProps {
  presentation: Presentation;
  theme: Theme | null;
}

export function ArrangementEditor({
  presentation,
  theme,
}: ArrangementEditorProps) {
  const editor = useArrangementEditor(presentation);

  return (
    <section className="arrangement-editor">
      <div className="arrangement-topbar">
        <ArrangementGroupRows
          availableGroups={editor.availableGroups}
          order={editor.order}
          saving={editor.saving}
          onAdd={editor.addGroup}
          onReorder={editor.reorderGroup}
          onRemove={editor.removeGroup}
        />

        <ArrangementToolbar
          arrangements={editor.arrangements}
          selectedArrangement={editor.selectedArrangement}
          saving={editor.saving}
          onSelect={editor.setSelectedArrangement}
          onCreate={editor.createArrangement}
          onDelete={editor.deleteArrangement}
        />
      </div>

      {editor.error && (
        <div className="arrangement-error" role="alert">
          {editor.error}
        </div>
      )}

      <div className="arrangement-slide-area">
        <ArrangementSlideGrid
          presentation={presentation}
          slides={editor.slides}
          slidesResponse={editor.slidesResponse}
          arrangement={editor.selectedArrangement}
          theme={theme}
          loading={editor.loading}
        />
      </div>
    </section>
  );
}

