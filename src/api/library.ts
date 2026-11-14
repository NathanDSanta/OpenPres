import {
  apiGet,
  apiPost,
  apiPut,
  apiDelete,
  apiGetText,
  apiPutText,
  apiPostText,
} from "./client";
import type {
  Library,
  Presentation,
  PresentationSummary,
  SlidesResponse,
  PresentationWriteRequest,
  Arrangement,
  ArrangementWriteRequest,
} from "@/types";

export const libraryApi = {
  listLibraries: () => apiGet<Library[]>("/libraries"),
  createLibrary: (name: string) => apiPost<Library>("/libraries", { name }),
  deleteLibrary: (id: string) => apiDelete(`/libraries/${id}`),

  listPresentations: (libraryId: string) =>
    apiGet<PresentationSummary[]>(`/libraries/${libraryId}/presentations`),
  createPresentation: (libraryId: string, body: PresentationWriteRequest) =>
    apiPost<Presentation>(`/libraries/${libraryId}/presentations`, body),
  createPresentationRaw: (libraryId: string, raw: string) =>
    apiPostText<Presentation>(`/libraries/${libraryId}/presentations/raw`, raw),

  listAllPresentations: () => apiGet<PresentationSummary[]>("/presentations"),
  getPresentation: (id: string) => apiGet<Presentation>(`/presentations/${id}`),
  replacePresentation: (id: string, body: PresentationWriteRequest) =>
    apiPut<Presentation>(`/presentations/${id}`, body),
  deletePresentation: (id: string) => apiDelete(`/presentations/${id}`),
  movePresentation: (id: string, library_id: string) => apiPost(`/presentations/${id}/move`, { library_id }),

  getRaw: (id: string) => apiGetText(`/presentations/${id}/raw`),
  putRaw: (id: string, raw: string) =>
    apiPutText<Presentation>(`/presentations/${id}/raw`, raw),

  getSlides: (id: string, arrangement?: string) => {
    const q = arrangement
      ? `?arrangement=${encodeURIComponent(arrangement)}`
      : "";
    return apiGet<SlidesResponse>(`/presentations/${id}/slides${q}`);
  },

  setSlideGroup: (
    id: string,
    index: number,
    body: {
      arrangement: string;
      group: string | null;
    },
  ) => apiPut<Presentation>(`/presentations/${id}/slides/${index}/group`, body),

  listArrangements: (id: string) =>
    apiGet<Arrangement[]>(`/presentations/${id}/arrangements`),
  createArrangement: (id: string, body: ArrangementWriteRequest) =>
    apiPost<Arrangement>(`/presentations/${id}/arrangements`, body),
  setArrangement: (id: string, name: string, body: ArrangementWriteRequest) =>
    apiPut<Arrangement>(
      `/presentations/${id}/arrangements/${encodeURIComponent(name)}`,
      body,
    ),
  deleteArrangement: (id: string, name: string) =>
    apiDelete(`/presentations/${id}/arrangements/${encodeURIComponent(name)}`),
};
