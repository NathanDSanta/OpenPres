import type {
  FlatSlide,
  LivePresentationState,
  Presentation,
  SlidesResponse,
  Theme,
} from "@/types";
import { SlideRenderer } from "@/components/slides/SlideRenderer";
import { getGroupColor } from "./groupColors";
import { useState } from "react";

interface ArrangementSlideGridProps {
  presentation: Presentation;
  slides: FlatSlide[];
  slidesResponse: SlidesResponse | null;
  arrangement: string;
  theme: Theme | null;
  loading: boolean;
  saving: boolean;
  groupOptions: string[];
  onChangeGroup: (slideIndex: number, group: string | null) => void;
}

export function ArrangementSlideGrid({
  presentation,
  slides,
  slidesResponse,
  arrangement,
  theme,
  loading,
  saving,
  groupOptions,
  onChangeGroup,
}: ArrangementSlideGridProps) {
  const [openSlideIndex, setOpenSlideIndex] = useState<number | null>(null);

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
              <div className="arrangement-slide-group-control">
                <button
                  type="button"
                  className="arrangement-slide-group"
                  style={{
                    background: color.background,
                    borderColor: color.border,
                    color: color.text,
                  }}
                  disabled={saving}
                  onClick={() =>
                    setOpenSlideIndex((current) =>
                      current === slide.index ? null : slide.index,
                    )
                  }
                >
                  {slide.group}
                </button>

                {openSlideIndex === slide.index && (
                  <div className="arrangement-group-dropdown">
                    <div className="arrangement-group-dropdown-title">
                      Change slide group
                    </div>

                    {groupOptions.map((group) => (
                      <button
                        key={group}
                        type="button"
                        className="arrangement-group-dropdown-option"
                        disabled={saving || group === slide.group}
                        onClick={() => {
                          setOpenSlideIndex(null);
                          onChangeGroup(slide.index, group);
                        }}
                      >
                        {group}
                      </button>
                    ))}

                    <div className="arrangement-group-dropdown-divider" />

                    <button
                      type="button"
                      className="arrangement-group-dropdown-option"
                      disabled={saving || index === 0}
                      onClick={() => {
                        setOpenSlideIndex(null);
                        onChangeGroup(slide.index, null);
                      }}
                    >
                      Use previous slide's group
                    </button>
                  </div>
                )}
              </div>

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
