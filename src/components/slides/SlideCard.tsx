import type { ReactNode } from "react";
import type { LivePresentationState, Look } from "@/types";
import LookCanvas from "@/components/canvas/LookCanvas";
import { chipColors } from "@/lib/groups";
import { useApp } from "@/state/AppContext";
import "./styles/SlideCard.css";

interface SlideCardProps {
  look: Look | null;
  slide: LivePresentationState;
  number: number;
  group: string;
  live?: boolean;
  selected?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
  /** Replaces the plain group chip (e.g. with a group menu). */
  groupControl?: ReactNode;
  title?: string;
}

export default function SlideCard({ look, slide, number, group, live, selected, onClick, onDoubleClick, groupControl, title }: SlideCardProps) {
  const { groups } = useApp();
  const colors = chipColors(group, groups);
  return (
    <article
      className={`slide-card${live ? " live" : ""}${selected ? " selected" : ""}`}
      style={{ borderColor: live ? undefined : colors.border === "var(--border)" ? undefined : colors.border }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      title={title}
    >
      <LookCanvas look={look} slide={slide} backdrop="#0a0a0f" animate={false} />
      <div className="slide-card-caption">
        {groupControl ?? (
          <span className="slide-card-group" style={{ background: colors.background, borderColor: colors.border, color: colors.text }}>
            {group}
          </span>
        )}
        <span className="slide-card-number">{number}</span>
      </div>
    </article>
  );
}
