import type { DesignRef } from "./themes";

export interface BibleSummary {
  id: string;
  abbreviation: string;
  name: string;
  language: string;
  license: string;
  attribution: string;
  source: string;
  bundled: boolean;
}

export interface BibleSettings {
  removed_bundled: string[];
  versions: string[];
  design: DesignRef | null;
  verse_numbers: boolean;
}

export interface BiblesView {
  installed: BibleSummary[];
  settings: BibleSettings;
  available_bundled: BibleSummary[];
  max_versions: number;
}

export interface BookOutline {
  code: string;
  name: string;
  /** Verses per chapter. */
  verses: number[];
}

export interface BibleReference {
  book: string;
  chapter: number;
  verse_start: number;
  verse_end: number;
}

export interface Passage {
  bible_id: string;
  abbreviation: string;
  version_name: string;
  language: string;
  attribution: string;
  reference: string;
  text: string;
  verses: [number, string][];
}

export interface LiveBible {
  reference: BibleReference;
  label: string;
  passages: Passage[];
}

export interface SearchHit {
  label: string;
  reference: BibleReference;
  text: string;
}

export interface CatalogEntry {
  id: string;
  name: string;
  english_name: string | null;
  abbreviation: string | null;
  language: string;
  language_name: string | null;
  license_url: string | null;
  books: number | null;
  verses: number | null;
}

export interface ImportMeta {
  id?: string;
  abbreviation?: string;
  name?: string;
  language?: string;
  license?: string;
  attribution?: string;
}

/** One verse. */
export interface VersePoint {
  book: string;
  chapter: number;
  verse: number;
}

/** A stretch of verses, possibly over several chapters or books. */
export interface BibleSpan {
  from: VersePoint;
  to: VersePoint;
}

/** Labels in the main version's language, added by the server. */
export interface SpanLabels {
  /** "Juan 3:16-21", "Juan 3:16 – 4:2". */
  label: string;
  from_label: string;
  to_label: string;
}

/** One showing of a passage: where it started and how far the reading went. */
export interface BibleHistoryEntry extends SpanLabels {
  id: string;
  first: BibleReference;
  first_label?: string;
  span: BibleSpan;
  shown_at: number;
  updated_at: number;
}

export interface BibleListItem extends Partial<SpanLabels> {
  id: string;
  span: BibleSpan;
  /** Show the whole passage at once (one chapter only); otherwise verse by verse. */
  whole: boolean;
  note: string;
}

export interface BibleList {
  id: string;
  name: string;
  items: BibleListItem[];
}
