import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, ChevronLeft, ChevronRight, Eraser, MonitorUp, Search, Settings2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { bibleApi, markChanged, themesApi, useLive } from "@/api";
import LookCanvas from "@/components/canvas/LookCanvas";
import { defaultBibleLook } from "@/lib/scene/defaults";
import { bibleAsSlide } from "@/lib/scene/draw";
import { notifyError } from "@/state/Dialogs";
import type { BibleReference, BookOutline, LiveBible, Look, SearchHit } from "@/types";
import "@/styles/Bible.css";

const OLD_TESTAMENT = 39;

function useDesignLook(ref: { theme_id: string; design_id: string } | null, versions: number): Look {
  const { data: theme } = useLive(() => (ref ? themesApi.get(ref.theme_id) : Promise.resolve(null)), [ref?.theme_id]);
  return useMemo(() => {
    const design = theme?.designs.find((d) => d.id === ref?.design_id);
    if (theme && design) return { theme: { id: theme.id, name: theme.name, width: theme.width, height: theme.height }, design };
    return defaultBibleLook(versions);
  }, [theme, ref?.design_id, versions]);
}

export default function Bible() {
  const navigate = useNavigate();
  const { data: view } = useLive(() => bibleApi.list());
  const primaryId = view?.settings.versions[0] ?? view?.installed[0]?.id ?? null;
  const { data: outline } = useLive(() => (primaryId ? bibleApi.get(primaryId) : Promise.resolve(null)), [primaryId]);
  const { data: live } = useLive(() => bibleApi.live());
  const [book, setBook] = useState<string>("JHN");
  const [chapter, setChapter] = useState(1);
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [query, setQuery] = useState("");
  const [parsed, setParsed] = useState<{ reference: BibleReference; label: string } | null>(null);
  const [searchText, setSearchText] = useState("");
  const [results, setResults] = useState<{ hits: SearchHit[]; total: number } | null>(null);
  const [searching, setSearching] = useState(false);
  const verseList = useRef<HTMLDivElement>(null);

  const books: BookOutline[] = outline?.books ?? [];
  const currentBook = books.find((b) => b.code === book) ?? books[0];
  const { data: text } = useLive(() => (primaryId && currentBook ? bibleApi.chapter(primaryId, currentBook.code, chapter) : Promise.resolve(null)), [primaryId, currentBook?.code, chapter]);
  const versionsShown = view?.settings.versions.length ?? 1;
  const look = useDesignLook(view?.settings.design ?? null, versionsShown);

  // Follow what is live (e.g. after next/previous or the command bar).
  const liveKey = live ? `${live.reference.book}:${live.reference.chapter}:${live.reference.verse_start}` : "";
  useEffect(() => {
    if (!live) return;
    setBook(live.reference.book);
    setChapter(live.reference.chapter);
    setSelection({ start: live.reference.verse_start, end: live.reference.verse_end });
  }, [liveKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    verseList.current?.querySelector(".bible-verse.selected")?.scrollIntoView({ block: "nearest" });
  }, [selection, text]);

  // Reference box: understood as you type, shown on Enter.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setParsed(null);
      return;
    }
    const t = window.setTimeout(() => {
      void bibleApi
        .parse(q)
        .then((r) => setParsed(r.reference ? { reference: r.reference, label: r.label ?? "" } : null))
        .catch(() => setParsed(null));
    }, 120);
    return () => window.clearTimeout(t);
  }, [query]);

  const show = (reference: BibleReference) =>
    void bibleApi
      .show({ reference })
      .then(() => markChanged())
      .catch(notifyError);

  const go = (reference: BibleReference, present: boolean) => {
    setBook(reference.book);
    setChapter(reference.chapter);
    setSelection({ start: reference.verse_start, end: reference.verse_end });
    if (present) show(reference);
  };

  const runSearch = async (words = searchText) => {
    if (!words.trim()) return;
    setSearching(true);
    try {
      setResults(await bibleApi.search(words, { limit: 300 }));
    } catch (e) {
      notifyError(e);
    } finally {
      setSearching(false);
    }
  };

  if (view && view.installed.length === 0) {
    return (
      <section className="page">
        <div className="empty">
          <BookOpen size={28} />
          <strong>No Bible installed</strong>
          <button className="btn btn-primary" onClick={() => navigate("/settings")}>
            Add one in Settings → Bibles
          </button>
        </div>
      </section>
    );
  }

  const verses = text?.verses ?? [];
  const selected = selection && currentBook ? { book: currentBook.code, chapter, verse_start: selection.start, verse_end: selection.end } : null;
  const liveHere = live && live.reference.book === currentBook?.code && live.reference.chapter === chapter;

  return (
    <section className="page bible-page">
      <div className="bible-layout">
        <aside className="panel bible-nav">
          <div className="bible-ref">
            <BookOpen size={15} />
            <input
              value={query}
              placeholder="Juan 3:16 · Ioan 3 16 · 1 Co 13:4-7"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || !query.trim()) return;
                if (parsed) {
                  go(parsed.reference, true);
                  setQuery("");
                } else {
                  // Not a reference: look for the words instead.
                  setSearchText(query);
                  void runSearch(query);
                }
              }}
            />
          </div>
          <div className="bible-ref-hint muted small">{query.trim() ? (parsed ? `Enter: show ${parsed.label}` : "Enter: find these words") : `Book names in ${view?.installed.find((b) => b.id === primaryId)?.abbreviation ?? "the main version"}`}</div>
          <div className="bible-books">
            {[books.slice(0, OLD_TESTAMENT), books.slice(OLD_TESTAMENT)].map((part, i) => (
              <div key={i} className="bible-books-part">
                <h3 className="section-title">
                  <span>{i === 0 ? "Old Testament" : "New Testament"}</span>
                </h3>
                {part.map((b) => (
                  <button
                    key={b.code}
                    className={`bible-book${b.code === currentBook?.code ? " active" : ""}${live?.reference.book === b.code ? " live" : ""}`}
                    onClick={() => {
                      setBook(b.code);
                      setChapter(1);
                      setSelection(null);
                    }}
                  >
                    {b.name}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </aside>

        <section className="panel bible-reader">
          <header className="panel-header">
            <h2>
              {currentBook?.name} {chapter}
            </h2>
            <div className="bible-chapters">
              {(currentBook?.verses ?? []).map((_, i) => (
                <button key={i} className={`bible-chapter${i + 1 === chapter ? " active" : ""}`} onClick={() => (setChapter(i + 1), setSelection(null))}>
                  {i + 1}
                </button>
              ))}
            </div>
          </header>
          <div className="bible-verses" ref={verseList}>
            {verses.map((v, i) => {
              const n = i + 1;
              const isSel = selection && n >= selection.start && n <= selection.end;
              const isLive = liveHere && n >= live!.reference.verse_start && n <= live!.reference.verse_end;
              return (
                <button
                  key={n}
                  className={`bible-verse${isSel ? " selected" : ""}${isLive ? " live" : ""}`}
                  onClick={(e) => {
                    if (e.shiftKey && selection) setSelection({ start: Math.min(selection.start, n), end: Math.max(selection.start, n) });
                    else setSelection({ start: n, end: n });
                  }}
                  onDoubleClick={() => currentBook && show({ book: currentBook.code, chapter, verse_start: n, verse_end: n })}
                  title="Click to select (Shift for several), double-click to show"
                >
                  <sup>{n}</sup>
                  <span>{v || <em className="muted">—</em>}</span>
                </button>
              );
            })}
          </div>
          <footer className="bible-reader-bar">
            <span className="muted small">{selected ? `${currentBook?.name} ${chapter}:${selected.verse_start}${selected.verse_end > selected.verse_start ? `-${selected.verse_end}` : ""}` : "Select a verse"}</span>
            <button className="btn btn-primary btn-small" disabled={!selected} onClick={() => selected && show(selected)}>
              <MonitorUp size={14} /> Show
            </button>
          </footer>
        </section>

        <div className="bible-side">
          <section className="panel bible-live">
            <header className="panel-header">
              <h2>On screen</h2>
              <button className="icon-btn" onClick={() => navigate("/settings")} title="Versions and design (Settings → Bibles)">
                <Settings2 size={14} />
              </button>
            </header>
            <div className="bible-live-preview">
              <LookCanvas look={look} slide={live ? bibleAsSlide(live as LiveBible, !look.design.elements.some((e) => e.text?.source.type === "bible")) : null} bible={live ?? null} backdrop="#07070b" />
            </div>
            <div className="bible-live-bar">
              <strong>{live?.label ?? "Nothing"}</strong>
              <span className="muted small">{live?.passages.map((p) => p.abbreviation).join(" · ")}</span>
              <span style={{ flex: 1 }} />
              <button className="btn btn-small" disabled={!live} onClick={() => void bibleApi.previous().then(markChanged).catch(notifyError)} title="Previous verse">
                <ChevronLeft size={15} />
              </button>
              <button className="btn btn-small" disabled={!live} onClick={() => void bibleApi.next().then(markChanged).catch(notifyError)} title="Next verse">
                <ChevronRight size={15} />
              </button>
              <button className="btn btn-small btn-danger" disabled={!live} onClick={() => void bibleApi.clear().then(markChanged).catch(notifyError)} title="Clear">
                <Eraser size={14} />
              </button>
            </div>
          </section>
          <section className="panel bible-search">
            <header className="panel-header">
              <label className="bible-search-box">
                <Search size={14} />
                <input value={searchText} placeholder="Find words (any order)" onChange={(e) => setSearchText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void runSearch()} />
              </label>
            </header>
            <div className="bible-results">
              {searching && <div className="empty">Searching…</div>}
              {!searching && results && results.hits.length === 0 && <div className="empty">No verse has all these words.</div>}
              {!searching && results && results.total > results.hits.length && <div className="muted small bible-results-count">Showing {results.hits.length} of {results.total}</div>}
              {!searching &&
                results?.hits.map((h, i) => (
                  <button key={i} className="bible-hit" onClick={() => go(h.reference, false)} onDoubleClick={() => go(h.reference, true)} title="Click to open, double-click to show">
                    <strong>{h.label}</strong>
                    <span>{h.text}</span>
                  </button>
                ))}
              {!results && !searching && <div className="muted small bible-results-count">Words do not need to be together; accents and punctuation do not matter.</div>}
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
