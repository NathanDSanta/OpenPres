import type {
  FlatSlide,
  LivePresentationState,
  Presentation,
  SlidesResponse,
  Theme,
} from "@/types";
import { SlideRenderer } from "@/components/slides/SlideRenderer";
import { getGroupColor } from "./groupColors";

interface ArrangementSlideGridProps {
  presentation: Presentation;
  slides: FlatSlide[];
  slidesResponse: SlidesResponse | null;
  arrangement: string;
  theme: Theme | null;
  loading: boolean;
}

export function ArrangementSlideGrid({
  presentation,
  slides,
  slidesResponse,
  arrangement,
  theme,
  loading,
}: ArrangementSlideGridProps) {
  if (loading) {
    return <div className="arrangement-empty">Loading slides...</div>;
  }

  if (slides.length === 0) {
    return (
      <div className="arrangement-empty">
        This arrangement has no slides.
      </div>
    );
  }

  const title =
    presentation.metadata.title ?? presentation.nameid;

  return (
    <div className="arrangement-slide-grid">
      {slides.map((slide, index) => {
        const state: LivePresentationState = {
          presentation_id: presentation.id,
          title,
          arrangement,
          slide_index: slide.index,
          total_slides: slidesResponse?.total ?? slides.length,
          current: slide,
          previous: slides[index - 1] ?? null,
          next: slides[index + 1] ?? null,
        };

        const color = getGroupColor(slide.group);

        return (
          <article
            key={`${slide.group}-${slide.index}-${index}`}
            className="arrangement-slide-card"
          >
            <SlideRenderer state={state} theme={theme} />

            <div className="arrangement-slide-caption">
              <span
                className="arrangement-slide-group"
                style={{
                  background: color.background,
                  borderColor: color.border,
                  color: color.text,
                }}
              >
                {slide.group}
              </span>

              <span className="arrangement-slide-number">
                {index + 1}
              </span>
            </div>
          </article>
        );
      })}
    </div>
  );
}
