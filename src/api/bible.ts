import { apiDelete, apiGet, apiPost, apiPut } from "./client";
import { uploadRaw } from "./server";
import type {
  BibleHistoryEntry,
  BibleList,
  BibleListItem,
  BibleReference,
  BibleSettings,
  BibleSummary,
  BiblesView,
  BookOutline,
  CatalogEntry,
  ImportMeta,
  LiveBible,
  Passage,
  SearchHit,
} from "@/types";

const qs = (params: Record<string, string | number | undefined>) =>
  new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => [k, String(v)]),
  ).toString();

export const bibleApi = {
  list: () => apiGet<BiblesView>("/bibles"),
  get: (id: string) => apiGet<{ bible: BibleSummary; books: BookOutline[] }>(`/bibles/${id}`),
  remove: (id: string) => apiDelete(`/bibles/${id}`),
  saveSettings: (s: BibleSettings) => apiPut<BiblesView>("/bibles/settings", s),
  restoreBundled: (id: string) => apiPost<BibleSummary>(`/bibles/bundled/${id}`),
  importFile: (file: File, meta: ImportMeta, onProgress?: (f: number) => void) =>
    uploadRaw<BibleSummary>(
      "/bibles/import",
      Object.fromEntries(Object.entries({ file_name: file.name, ...meta }).filter(([, v]) => v)) as Record<string, string>,
      file,
      onProgress,
    ),
  catalog: () => apiGet<{ translations: CatalogEntry[] }>("/bibles/catalog"),
  download: (id: string, meta: ImportMeta) => apiPost<BibleSummary>("/bibles/download", { id, ...meta }),
  chapter: (id: string, book: string, chapter: number) =>
    apiGet<{ book: string; name: string; chapter: number; verses: string[] }>(`/bibles/${id}/${book}/${chapter}`),
  parse: (q: string, bible?: string) =>
    apiGet<{ reference: BibleReference | null; label?: string; passages?: Passage[] }>(`/bibles/parse?${qs({ q, bible })}`),
  search: (q: string, opts: { bible?: string; book?: string; limit?: number } = {}) =>
    apiGet<{ hits: SearchHit[]; total: number }>(`/bibles/search?${qs({ q, ...opts })}`),

  live: () => apiGet<LiveBible | null>("/bible/live"),
  show: (body: { reference?: BibleReference; query?: string }) => apiPost<LiveBible>("/bible/show", body),
  next: () => apiPost<LiveBible>("/bible/next"),
  previous: () => apiPost<LiveBible>("/bible/previous"),
  clear: () => apiPost("/bible/clear"),

  /** Passages that were shown, newest first; `current` is the one on screen. */
  history: () => apiGet<{ entries: BibleHistoryEntry[]; current: string | null }>("/bible/history"),
  clearHistory: () => apiDelete("/bible/history"),
  deleteHistoryEntry: (id: string) => apiDelete(`/bible/history/${id}`),

  lists: () => apiGet<{ lists: BibleList[] }>("/bible/lists"),
  createList: (name: string, items: Omit<BibleListItem, "id">[] = []) => apiPost<BibleList>("/bible/lists", { id: "", name, items: items.map((i) => ({ ...i, id: "" })) }),
  updateList: (list: BibleList) => apiPut<BibleList>(`/bible/lists/${list.id}`, list),
  deleteList: (id: string) => apiDelete(`/bible/lists/${id}`),
  addToList: (id: string, items: Omit<BibleListItem, "id">[]) => apiPost<BibleList>(`/bible/lists/${id}/items`, { items: items.map((i) => ({ ...i, id: "" })) }),
};
