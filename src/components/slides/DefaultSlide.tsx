import type { LivePresentationState } from "@/types";

interface DefaultSlideProps {
  state: LivePresentationState;
}

export function DefaultSlide({ state }: DefaultSlideProps) {
  return (
    <div className="default-slide">
      <div className="default-slide-title">
        {state.title}
      </div>

      <div className="default-slide-text">
        {state.current?.text}
      </div>
    </div>
  );
}

