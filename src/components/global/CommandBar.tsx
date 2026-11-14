import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpen, ChevronRight, Command as CommandIcon, CornerDownLeft, Megaphone, Presentation, Search } from "lucide-react";
import { bibleApi, libraryApi, markChanged, presenterApi } from "@/api";
import { search } from "@/lib/search";
import { dynamicCommands, loadCommandData, prettyCombo, staticCommands, type CommandDef } from "@/lib/commands";
import { useApp, type CommandMode } from "@/state/AppContext";
import type { BibleReference, Passage, PresentationSummary, SearchHit } from "@/types";
import "./styles/CommandBar.css";

interface Data {
  presentations: PresentationSummary[];
  commands: CommandDef[];
}

type Result =
  | { kind: "presentation"; p: PresentationSummary }
  | { kind: "command"; c: CommandDef; arg: string | undefined }
  | { kind: "verse"; label: string; text: string; reference: BibleReference; exact?: boolean };

/**
 * The command bar: type to find and present a song; start with the command prefix (">"
 * by default) for commands, or with the Bible prefix (":") for a Bible reference or words.
 */
export default function CommandBar() {
  const { commandOpen, openCommand, setImportOpen, requestMediaImport, keybinds, biblePrefix, commandPrefix } = useApp();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [data, setData] = useState<Data | null>(null);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [bible, setBible] = useState<{ q: string; exact: { label: string; passages: Passage[]; reference: BibleReference } | null; hits: SearchHit[] } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const ctx = useMemo(
    () => ({
      navigate,
      openCommandBar: (mode: "present" | "command" | "bible") => openCommand(mode),
      openImport: () => setImportOpen(true),
      importMedia: requestMediaImport,
    }),
    [navigate, openCommand, setImportOpen, requestMediaImport],
  );

  useEffect(() => {
    if (!commandOpen) return;
    setQuery(commandOpen === "command" ? commandPrefix : commandOpen === "bible" ? biblePrefix : "");
    setSelected(0);
    setError(null);
    setBible(null);
    void Promise.all([libraryApi.listAllPresentations().catch(() => []), loadCommandData()]).then(([presentations, d]) =>
      setData({ presentations, commands: [...staticCommands(ctx), ...dynamicCommands(d)] }),
    );
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [commandOpen, ctx, biblePrefix, commandPrefix]);

  const mode: CommandMode = query.startsWith(commandPrefix) ? "command" : query.startsWith(biblePrefix) ? "bible" : "present";
  const text = mode === "command" ? query.slice(commandPrefix.length).trimStart() : mode === "bible" ? query.slice(biblePrefix.length).trimStart() : query;

  // Bible: interpret the text as a reference and also search it as words.
  useEffect(() => {
    if (mode !== "bible") return;
    const q = text.trim();
    if (!q) {
      setBible({ q, exact: null, hits: [] });
      return;
    }
    const t = window.setTimeout(() => {
      void Promise.all([
        bibleApi.parse(q).catch(() => ({ reference: null })),
        q.length >= 3 ? bibleApi.search(q, { limit: 40 }).catch(() => ({ hits: [], total: 0 })) : Promise.resolve({ hits: [], total: 0 }),
      ]).then(([parsed, found]) => {
        const exact =
          parsed.reference && "passages" in parsed && parsed.passages
            ? { label: parsed.label ?? "", passages: parsed.passages, reference: parsed.reference }
            : null;
        setBible({ q, exact, hits: found.hits });
      });
    }, 140);
    return () => window.clearTimeout(t);
  }, [mode, text]);

  const results: Result[] = useMemo(() => {
    if (mode === "bible") {
      if (!bible) return [];
      const out: Result[] = [];
      if (bible.exact) {
        out.push({ kind: "verse", label: bible.exact.label, text: bible.exact.passages.map((p) => `${p.abbreviation}: ${p.text}`).join("  ·  "), reference: bible.exact.reference, exact: true });
      }
      for (const h of bible.hits) out.push({ kind: "verse", label: h.label, text: h.text, reference: h.reference });
      return out;
    }
    if (!data) return [];
    if (mode === "present") {
      return search(data.presentations, text, (p) => p.title)
        .slice(0, 50)
        .map((p) => ({ kind: "presentation" as const, p }));
    }
    const lower = text.toLowerCase();
    const withArgs = data.commands
      .filter((c) => c.argument && lower.startsWith(c.argument.prefix))
      .map((c) => ({ kind: "command" as const, c, arg: text.slice(c.argument!.prefix.length).trim() }));
    const matched = search(data.commands, text, (c) => `${c.title} ${c.keywords ?? ""} ${c.hint ?? ""} ${c.group}`)
      .filter((c) => !withArgs.some((w) => w.c === c))
      .map((c) => ({ kind: "command" as const, c, arg: undefined as string | undefined }));
    return [...withArgs, ...matched].slice(0, 80);
  }, [data, mode, text, bible]);

  useEffect(() => setSelected(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(".cmd-item.selected")?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const shortcutOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const [combo, id] of Object.entries(keybinds)) if (!map.has(id)) map.set(id, combo);
    return map;
  }, [keybinds]);

  if (!commandOpen) return null;
  const close = () => openCommand(null);

  const run = async (index: number) => {
    const item = results[index];
    if (!item) return;
    setError(null);
    try {
      if (item.kind === "presentation") {
        await presenterApi.load({ presentation_id: item.p.id, index: 0 });
      } else if (item.kind === "verse") {
        await bibleApi.show({ reference: item.reference });
      } else {
        if (item.c.argument && !item.arg) {
          setQuery(`${commandPrefix}${item.c.argument.prefix} `);
          return;
        }
        await item.c.run(item.arg);
      }
      markChanged();
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const complete = () => {
    const item = results[selected];
    if (item?.kind === "command") {
      setQuery(`${commandPrefix}${item.c.argument ? `${item.c.argument.prefix} ` : item.c.title.toLowerCase()}`);
    } else if (item?.kind === "verse") {
      setQuery(`${biblePrefix}${item.label}`);
    }
  };

  const placeholder =
    mode === "command" ? "Type a command…" : mode === "bible" ? "Reference (Juan 3:16) or words to find…" : "Find a song and press Enter to present it…";

  return (
    <div className="cmd-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="cmd-panel" role="dialog" aria-label="Command bar">
        <div className="cmd-input-row">
          {mode === "command" ? <CommandIcon size={20} /> : mode === "bible" ? <BookOpen size={20} /> : <Search size={20} />}
          <input
            ref={inputRef}
            className="cmd-input"
            value={query}
            placeholder={placeholder}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelected((s) => Math.min(results.length - 1, s + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelected((s) => Math.max(0, s - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                void run(selected);
              } else if (e.key === "Tab") {
                e.preventDefault();
                complete();
              }
            }}
          />
          <span className={`cmd-mode ${mode}`}>{mode === "command" ? "Command" : mode === "bible" ? "Bible" : "Present"}</span>
        </div>
        {error && <div className="cmd-error">{error}</div>}
        <div className="cmd-results" ref={listRef}>
          {mode !== "bible" && !data && <div className="cmd-empty">Loading…</div>}
          {results.length === 0 && (mode === "bible" ? bible !== null : !!data) && (
            <div className="cmd-empty">
              {mode === "present"
                ? `No song matches. Type ${commandPrefix} for commands or ${biblePrefix} for the Bible.`
                : mode === "bible"
                  ? text.trim()
                    ? "No reference or verse matches."
                    : "Type a reference like “Juan 3:16”, or words to find in the Bible."
                  : "No command matches."}
            </div>
          )}
          {results.map((item, i) => (
            <button
              key={item.kind === "presentation" ? item.p.id : item.kind === "verse" ? `${item.label}-${i}` : `${item.c.id}-${i}`}
              className={`cmd-item${i === selected ? " selected" : ""}${item.kind === "verse" ? " verse" : ""}`}
              onMouseEnter={() => setSelected(i)}
              onClick={() => void run(i)}
            >
              {item.kind === "presentation" ? (
                <>
                  {item.p.layer === "announcements" ? <Megaphone size={16} /> : <Presentation size={16} />}
                  <span className="cmd-title">{item.p.title}</span>
                  <span className="cmd-hint">{item.p.library_name}</span>
                </>
              ) : item.kind === "verse" ? (
                <>
                  <BookOpen size={16} />
                  <span className="cmd-title">
                    <b>{item.label}</b>
                    <span className="cmd-verse-text">{item.text}</span>
                  </span>
                  {item.exact && <span className="cmd-hint">reference</span>}
                </>
              ) : (
                <>
                  <ChevronRight size={16} />
                  <span className="cmd-title">
                    {item.c.argument ? (
                      <>
                        {item.c.title} <em>{item.arg || item.c.argument.placeholder}</em>
                      </>
                    ) : (
                      item.c.title
                    )}
                  </span>
                  {shortcutOf.get(item.c.id) && <kbd>{prettyCombo(shortcutOf.get(item.c.id)!)}</kbd>}
                  {item.c.hint && <span className="cmd-hint">{item.c.hint}</span>}
                </>
              )}
              {i === selected && <CornerDownLeft size={14} className="cmd-enter" />}
            </button>
          ))}
        </div>
        <footer className="cmd-footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> choose
          </span>
          <span>
            <kbd>Enter</kbd> {mode === "present" ? "present first slide" : mode === "bible" ? "show on screen" : "run"}
          </span>
          {mode !== "present" && (
            <span>
              <kbd>Tab</kbd> complete
            </span>
          )}
          <span>
            <kbd>{commandPrefix}</kbd> commands
          </span>
          <span>
            <kbd>{biblePrefix}</kbd> Bible
          </span>
          <span>
            <kbd>Esc</kbd> close
          </span>
        </footer>
      </div>
    </div>
  );
}
