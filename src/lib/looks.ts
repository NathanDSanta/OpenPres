import type { Design, LivePresentationState, Look, Presentation, Theme } from "@/types";

export const META_DESIGN = "design";
export const GROUP_DESIGN_PREFIX = "design@";

export function pickDesign(theme: Theme, id?: string | null, name?: string | null): Design | null {
  return (
    (id ? theme.designs.find((d) => d.id === id) : undefined) ??
    (name ? theme.designs.find((d) => d.name.toLowerCase() === name.toLowerCase()) : undefined) ??
    theme.designs[0] ??
    null
  );
}

/** The look a slide of `group` gets with this theme (group override, then presentation design). */
export function lookForSlide(theme: Theme | null, presentation: Presentation | null, group: string): Look | null {
  if (!theme) return null;
  const meta = presentation?.metadata ?? {};
  const design = pickDesign(theme, meta[`${GROUP_DESIGN_PREFIX}${group}`] ?? meta[META_DESIGN]);
  if (!design) return null;
  return { theme: { id: theme.id, name: theme.name, width: theme.width, height: theme.height }, design };
}

export function slideState(
  title: string,
  slides: { group: string; text: string }[],
  index: number,
  presentationId = "preview",
): LivePresentationState {
  const at = (i: number) => (slides[i] ? { index: i, group: slides[i].group, text: slides[i].text } : null);
  return {
    presentation_id: presentationId,
    title,
    arrangement: "default",
    slide_index: index,
    total_slides: slides.length,
    current: at(index),
    previous: at(index - 1),
    next: at(index + 1),
  };
}
