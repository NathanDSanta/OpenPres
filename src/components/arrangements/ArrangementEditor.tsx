import type { Presentation, Theme } from "@/types";
import { presenterApi, useLive } from "@/api";
import { useArrangementEditor } from "@/hooks/useArrangementEditor";
import { useDialogs } from "@/state/Dialogs";
import { ArrangementToolbar } from "./ArrangementToolbar";
import { ArrangementGroupRows } from "./ArrangementGroupRows";
import { ArrangementSlideGrid } from "./ArrangementSlideGrid";
import "./styles/ArrangementEditor.css";

interface ArrangementEditorProps {
  presentation: Presentation;
  theme: Theme | null;
  /** When set, double-clicking a slide shows it live (Songs). Reflow leaves it unset. */
  liveOnDoubleClick?: boolean;
}

export function ArrangementEditor({ presentation, theme, liveOnDoubleClick = false }: ArrangementEditorProps) {
  const editor = useArrangementEditor(presentation);
  const { prompt } = useDialogs();
  const { data: live } = useLive(() => presenterApi.getState());

  const liveState = [live?.slides, live?.announcements].find((s) => s?.presentation_id === presentation.id);
  const sameArrangement =
    liveState && (liveState.arrangement === editor.selectedArrangement || (liveState.arrangement === "default" && editor.selectedArrangement === "default"));
  const liveIndex = liveState && sameArrangement ? liveState.slide_index : null;

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
          onCreate={() => void editor.createArrangement(() => prompt({ title: "New arrangement", label: "Name", placeholder: "e.g. Short, Extended", confirmLabel: "Create" }))}
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
          presentation={editor.presentation}
          slides={editor.slides}
          slidesResponse={editor.slidesResponse}
          theme={theme}
          loading={editor.loading}
          saving={editor.saving}
          liveIndex={liveIndex}
          onChangeGroup={editor.changeSlideGroup}
          onSlideDoubleClick={
            liveOnDoubleClick
              ? (index) =>
                  void presenterApi.load({
                    presentation_id: presentation.id,
                    arrangement: editor.selectedArrangement === "default" ? undefined : editor.selectedArrangement,
                    index,
                  })
              : undefined
          }
        />
      </div>
    </section>
  );
}
