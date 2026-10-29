import type { UUID, PathBuf } from "./common";

export interface Library {
  id: UUID;
  name: string;
  /** Filesystem path; useful for diagnostics, usually not needed by UI. */
  path: PathBuf;
}
export interface CreateLibraryRequest {
  name: string;
}

export type PresentationLayer = "slides" | "announcements";
export type PresentationMetadata = Record<string, string>;

export interface Slide {
  text: string;
}
export interface Group {
  name: string;
  slides: Slide[];
}
export interface Arrangement {
  name: string;
  order: string[];
}

export interface Presentation {
  id: UUID;
  /** Legacy/internal identifier from the .pres format; title normally lives in metadata.title. */
  nameid: string;
  metadata: PresentationMetadata;
  groups: Group[];
  arrangements: Arrangement[];
}

export interface PresentationWriteRequest {
  nameid?: string;
  metadata?: PresentationMetadata;
  groups?: Group[];
}

export interface PresentationSummary {
  id: UUID;
  title: string;
  layer: PresentationLayer;
  groups: number;
  slides: number;
}

export interface ArrangementWriteRequest {
  order: string[];
}
export interface SlidesQuery {
  arrangement?: string;
}
export interface FlatSlide {
  index: number;
  group: string;
  text: string;
}
export interface SlidesResponse {
  arrangement: string;
  total: number;
  slides: FlatSlide[];
}

export interface RawPresentationRequest {
  /** Raw .pres file text. Send as text/plain, not JSON. */
  raw: string;
}
