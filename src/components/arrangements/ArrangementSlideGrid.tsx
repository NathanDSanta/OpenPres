import type { FlatSlide, Presentation, SlidesResponse, Theme } from "@/types";
import SlideCard from "@/components/slides/SlideCard";
import GroupMenu from "@/components/slides/GroupMenu";
import { lookForSlide, slideState } from "@/lib/looks";

interface ArrangementSlideGridProps {
  presentation: Presentation;
  slides: FlatSlide[];
  slidesResponse: SlidesResponse | null;
  theme: Theme | null;
  loading: boolean;
  saving: boolean;
  liveIndex: number | null;
  onChangeGroup: (slideIndex: number, group: string | null) => void;
  onSlideDoubleClick?: (slideIndex: number) => void;
}

export function ArrangementSlideGrid({
  presentation,
  slides,
  slidesResponse,
  theme,
  loading,
  saving,
  liveIndex,
  onChangeGroup,
  onSlideDoubleClick,
}: ArrangementSlideGridProps) {
  if (loading) return <div className="arrangement-empty">Loading slides...</div>;
  if (slides.length === 0) return <div className="arrangement-empty">This arrangement has no slides.</div>;

  const title = presentation.metadata.title ?? presentation.nameid;
  const existing = presentation.groups.map((g) => g.name);
  const total = slidesResponse?.total ?? slides.length;

  return (
    <div className="arrangement-slide-grid">
      {slides.map((slide, index) => (
        <SlideCard
          key={`${slide.group}-${slide.index}-${index}`}
          look={lookForSlide(theme, presentation, slide.group)}
          slide={{ ...slideState(title, slides, index, presentation.id), total_slides: total }}
          number={index + 1}
          group={slide.group}
          live={liveIndex === index}
          title={onSlideDoubleClick ? "Double-click to show this slide" : undefined}
          onDoubleClick={onSlideDoubleClick ? () => onSlideDoubleClick(index) : undefined}
          groupControl={
            <GroupMenu
              current={slide.group}
              existing={existing}
              disabled={saving}
              canUsePrevious={index > 0}
              onPick={(group) => onChangeGroup(slide.index, group)}
            />
          }
        />
      ))}
    </div>
  );
}
