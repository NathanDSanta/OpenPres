import { useEffect, useRef } from "react";
import { libraryApi, markChanged, presenterApi, useLive } from "@/api";
import { SHOW_TOPICS } from "@/api/events";
import SlideCard from "@/components/slides/SlideCard";
import Select from "@/components/ui/Select";
import { usePresentationTheme } from "@/hooks/usePresentationTheme";
import { lookForSlide, slideState } from "@/lib/looks";
import { notifyError } from "@/state/Dialogs";
import type { WidgetProps } from "./widgets";

const run = (p: Promise<unknown>) => void p.then(markChanged).catch(notifyError);

/**
 * The presentation on the slides layer, drawn like the Songs page's previews (its theme, the
 * groups' colours, the live slide outlined). A click shows a slide; the arrangement can be
 * switched without leaving the slide that's on screen.
 */
export default function LiveSlidesWidget({ w, cell }: WidgetProps) {
  const { data: live } = useLive(() => presenterApi.getState(), [], SHOW_TOPICS);
  const state = live?.slides ?? null;
  const id = state?.presentation_id ?? null;
  const { data: presentation } = useLive(() => (id ? libraryApi.getPresentation(id) : Promise.resolve(null)), [id], SHOW_TOPICS);
  const { theme } = usePresentationTheme(presentation?.id === id ? presentation : null);
  const arrangement = state?.arrangement && state.arrangement !== "default" ? state.arrangement : undefined;
  const { data: slides } = useLive(() => (id ? libraryApi.getSlides(id, arrangement) : Promise.resolve(null)), [id, arrangement], SHOW_TOPICS);

  // Keep the live slide in view.
  const grid = useRef<HTMLDivElement>(null);
  useEffect(() => {
    grid.current?.querySelector<HTMLElement>(".slide-card.live")?.scrollIntoView({ block: "nearest" });
  }, [state?.slide_index, slides]);

  if (!state) return <div className="wg-empty muted small">No presentation on the slides layer.</div>;

  const list = slides?.slides ?? [];
  const title = presentation?.metadata.title ?? state.title;
  const arrangements = [{ value: "default", label: "Default (as written)" }, ...(presentation?.arrangements ?? []).filter((a) => a.name !== "default").map((a) => ({ value: a.name, label: a.name }))];

  // Another arrangement: the same slide stays on screen when it's in that one too.
  const switchArrangement = async (arrangement: string) => {
    if (!id || arrangement === state.arrangement) return;
    try {
      const next = await libraryApi.getSlides(id, arrangement === "default" ? undefined : arrangement);
      const current = list[state.slide_index];
      const same = current ? next.slides.findIndex((s) => s.group === current.group && s.index === current.index) : -1;
      await presenterApi.load({ presentation_id: id, arrangement: arrangement === "default" ? undefined : arrangement, index: Math.max(0, same) });
      markChanged();
    } catch (err) {
      notifyError(err);
    }
  };

  // Cards about 150 px wide, at least one column.
  const columns = Math.max(1, Math.floor((w * cell + (w - 1) * 8) / 150));
  return (
    <div className="wg-column wg-live-slides">
      <div className="wg-live-slides-bar">
        <span className="wg-sub" title={title}>
          {title}
        </span>
        {arrangements.length > 1 && (
          <div className="wg-live-slides-arrangement" title="Arrangement: the slide on screen stays when it's in the other one">
            <Select small value={state.arrangement} options={arrangements} onChange={(a) => void switchArrangement(a)} />
          </div>
        )}
      </div>
      <div className="wg-live-slides-grid" ref={grid} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {presentation &&
          list.map((slide, i) => (
            <SlideCard
              key={`${slide.group}-${slide.index}-${i}`}
              look={lookForSlide(theme, presentation, slide.group)}
              slide={{ ...slideState(title, list, i, presentation.id), total_slides: slides?.total ?? list.length }}
              number={i + 1}
              group={slide.group}
              live={i === state.slide_index}
              title="Click to show this slide"
              onClick={() => run(presenterApi.goto(i, "slides"))}
            />
          ))}
      </div>
    </div>
  );
}
