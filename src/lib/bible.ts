import type { BibleListItem, BibleReference, BibleSpan } from "@/types";

export const spanOf = (r: BibleReference): BibleSpan => ({
  from: { book: r.book, chapter: r.chapter, verse: r.verse_start },
  to: { book: r.book, chapter: r.chapter, verse: Math.max(r.verse_start, r.verse_end) },
});

export const oneChapter = (s: BibleSpan) => s.from.book === s.to.book && s.from.chapter === s.to.chapter;

export const isSingleVerse = (s: BibleSpan) => oneChapter(s) && s.from.verse === s.to.verse;

/** What goes on screen for a saved passage: all of it, or its first verse (then step). */
export function referenceToShow(item: Pick<BibleListItem, "span" | "whole">): BibleReference {
  const { from, to } = item.span;
  const whole = item.whole && oneChapter(item.span);
  return { book: from.book, chapter: from.chapter, verse_start: from.verse, verse_end: whole ? to.verse : from.verse };
}

/** A new list item for a reference: a range is a full passage shown at once. */
export const itemFor = (r: BibleReference): Omit<BibleListItem, "id"> => ({ span: spanOf(r), whole: r.verse_end > r.verse_start, note: "" });

/** "19:42" today, "Sat 19:42" this week, "12 Nov 19:42" otherwise. */
export function shownTime(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (ms >= start.getTime()) return time;
  if (ms >= start.getTime() - 6 * 86400000) return `${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
  return `${d.toLocaleDateString([], { day: "numeric", month: "short" })} ${time}`;
}

/** Heading for a group of history entries. */
export function dayLabel(ms: number, now = Date.now()): string {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (ms >= start.getTime()) return "Today";
  if (ms >= start.getTime() - 86400000) return "Yesterday";
  return new Date(ms).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
}
