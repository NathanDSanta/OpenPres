import { useEffect, useRef, useState } from "react";
import { BookOpen, ChevronLeft, ChevronRight, Eraser, MonitorUp } from "lucide-react";
import { bibleApi, markChanged, useLive } from "@/api";
import { SHOW_TOPICS } from "@/api/events";
import { notifyError } from "@/state/Dialogs";
import type { BibleReference } from "@/types";
import type { WidgetProps } from "./widgets";

const run = (p: Promise<unknown>) =>
  void p.then(markChanged).catch((e) => {
    if (String(e?.message ?? e).startsWith("nothing is live")) return;
    notifyError(e);
  });

type Chapter = { book: string; chapter: number };

/**
 * The Bible page, small: a reference box, then the chapter's verses like the page's reader.
 * Typing a reference opens its chapter; Enter shows it. The list follows what's on screen, a
 * double-click shows a verse, and previous / next / clear are next to the box.
 */
export default function BibleWidget({ h }: WidgetProps) {
  const { data: live } = useLive(() => bibleApi.live(), [], SHOW_TOPICS);
  const { data: view } = useLive(() => bibleApi.list(), [], ["bibles"]);
  const [query, setQuery] = useState("");
  const [parsed, setParsed] = useState<{ reference: BibleReference; label: string } | null>(null);
  // The chapter in the list: the one on screen, or the one typed.
  const [opened, setOpened] = useState<Chapter | null>(null);
  const [selected, setSelected] = useState<{ start: number; end: number } | null>(null);
  const liveRef = live?.reference ?? null;

  useEffect(() => {
    if (!liveRef) return;
    setOpened({ book: liveRef.book, chapter: liveRef.chapter });
    setSelected(null);
  }, [liveRef?.book, liveRef?.chapter, liveRef?.verse_start, liveRef?.verse_end]);

  // A reference opens its chapter while it's typed (like the Bible page).
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setParsed(null);
      return;
    }
    const t = window.setTimeout(() => {
      bibleApi
        .parse(q)
        .then((r) => {
          const reference = r.reference;
          setParsed(reference ? { reference, label: r.label ?? "" } : null);
          if (reference) {
            setOpened({ book: reference.book, chapter: reference.chapter });
            setSelected({ start: reference.verse_start, end: reference.verse_end });
          }
        })
        .catch(() => setParsed(null));
    }, 150);
    return () => window.clearTimeout(t);
  }, [query]);

  const bibleId = live?.passages[0]?.bible_id ?? view?.settings.versions[0] ?? view?.installed[0]?.id ?? null;
  const { data: text } = useLive(
    () => (bibleId && opened ? bibleApi.chapter(bibleId, opened.book, opened.chapter) : Promise.resolve(null)),
    [bibleId, opened?.book, opened?.chapter],
  );

  // Keep the verse on screen (or the one typed) in view.
  const list = useRef<HTMLDivElement>(null);
  const focus = selected?.start ?? (liveRef && opened && liveRef.book === opened.book && liveRef.chapter === opened.chapter ? liveRef.verse_start : null);
  useEffect(() => {
    if (!focus) return;
    list.current?.querySelector<HTMLElement>(`[data-verse="${focus}"]`)?.scrollIntoView({ block: "nearest" });
  }, [focus, text]);

  const show = (reference: BibleReference) => run(bibleApi.show({ reference }));
  const submit = () => {
    if (!query.trim()) return;
    if (parsed) show(parsed.reference);
    else run(bibleApi.show({ query }));
    setQuery("");
  };
  const showSelected = () => opened && selected && show({ book: opened.book, chapter: opened.chapter, verse_start: selected.start, verse_end: selected.end });

  const liveHere = !!liveRef && !!opened && liveRef.book === opened.book && liveRef.chapter === opened.chapter;
  const heading = text ? `${text.name} ${text.chapter}` : null;

  return (
    <div className="wg-column wg-bible2">
      <div className="wg-bible2-bar">
        <label className="wg-search wg-bible2-search" title="Type a reference: Enter shows it">
          <BookOpen size={12} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") setQuery("");
            }}
            placeholder="Reference, e.g. Psalm 23"
          />
        </label>
        <button className="icon-btn" disabled={!live} onClick={() => run(bibleApi.previous())} title="Previous verse">
          <ChevronLeft size={15} />
        </button>
        <button className="icon-btn" disabled={!live} onClick={() => run(bibleApi.next())} title="Next verse">
          <ChevronRight size={15} />
        </button>
        <button className="icon-btn wg-bible2-clear" disabled={!live} onClick={() => run(bibleApi.clear())} title="Clear the Bible layer">
          <Eraser size={14} />
        </button>
      </div>
      <div className="wg-bible2-head">
        {live ? (
          <span className="wg-bible-live" title={live.label}>
            <span className="wg-live-dot" /> {live.label}
          </span>
        ) : (
          <span className="muted small">Nothing on the Bible layer.</span>
        )}
        {h > 1 && heading && <span className="wg-bible2-chapter">{heading}</span>}
      </div>
      {h > 1 && (
        <>
          <div className="wg-bible2-verses" ref={list}>
            {!opened && <div className="wg-empty muted small">Type a reference to open its chapter.</div>}
            {(text?.verses ?? []).map((v, i) => {
              const n = i + 1;
              const isLive = liveHere && n >= liveRef!.verse_start && n <= liveRef!.verse_end;
              const isSel = !!selected && n >= selected.start && n <= selected.end;
              return (
                <button
                  key={n}
                  data-verse={n}
                  className={`wg-bible2-verse${isLive ? " live" : ""}${isSel ? " selected" : ""}`}
                  onClick={(e) => {
                    if (e.shiftKey && selected) setSelected({ start: Math.min(selected.start, n), end: Math.max(selected.end, n) });
                    else setSelected({ start: n, end: n });
                  }}
                  onDoubleClick={() => opened && show({ book: opened.book, chapter: opened.chapter, verse_start: n, verse_end: n })}
                  title="Click to select (Shift for several), double-click to show"
                >
                  <sup>{n}</sup>
                  <span>{v}</span>
                </button>
              );
            })}
          </div>
          {selected && opened && (
            <button className="btn btn-small btn-primary wg-bible2-show" onClick={showSelected}>
              <MonitorUp size={13} /> Show {heading ?? ""}:{selected.start}
              {selected.end > selected.start ? `-${selected.end}` : ""}
            </button>
          )}
        </>
      )}
    </div>
  );
}
