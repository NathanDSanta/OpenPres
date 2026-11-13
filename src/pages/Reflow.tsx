import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { libraryApi, markChanged, useLive } from "@/api";
import { usePresentationTheme } from "@/hooks/usePresentationTheme";
import PresentationPreview from "@/components/songs/PresentationPreview";
import { groupColor } from "@/lib/groups";
import { search } from "@/lib/search";
import { GROUP_DESIGN_PREFIX } from "@/lib/looks";
import { newId } from "@/lib/scene/defaults";
import { useApp } from "@/state/AppContext";
import type { Group, Presentation } from "@/types";
import "@/styles/Reflow.css";

interface Block {
  /** Stable React key: never derived from the text, so typing keeps focus. */
  key: string;
  group: string;
  text: string;
}

const toBlocks = (p: Presentation): Block[] =>
  p.groups.flatMap((g) => g.slides.map((s) => ({ key: newId(), group: g.name, text: s.text })));

/** Rebuilds groups in order; empty slides are skipped (the file format has none). */
function toGroups(blocks: Block[]): Group[] {
  const groups: Group[] = [];
  for (const block of blocks) {
    const text = block.text.replace(/\s+$/g, "");
    let group = groups.find((g) => g.name === block.group);
    if (!group) {
      group = { name: block.group, slides: [] };
      groups.push(group);
    }
    if (text.trim()) group.slides.push({ text });
  }
  return groups.filter((g) => g.slides.length > 0);
}

/** Lines that the .pres format reads as separators can't be typed as lyrics. */
const sanitize = (text: string) =>
  text
    .split("\n")
    .map((l) => (/^\s*(###|-{6,}|-{3,}.*-{3,})\s*$/.test(l) ? l.replace(/-/g, "—").replace(/#/g, "＃") : l))
    .join("\n");

function PresentationSearch({ onPick }: { onPick: (id: string) => void }) {
  const { data } = useLive(() => libraryApi.listAllPresentations());
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const results = useMemo(() => search(data ?? [], query, (p) => p.title).slice(0, 12), [data, query]);
  return (
    <div className="reflow-search">
      <Search size={15} />
      <input
        value={query}
        placeholder="Find a presentation in any library…"
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && results[0]) {
            onPick(results[0].id);
            setQuery("");
            setOpen(false);
          }
        }}
      />
      {open && query && (
        <div className="reflow-search-results">
          {results.length === 0 && <div className="muted small" style={{ padding: 10 }}>No matches</div>}
          {results.map((p) => (
            <button
              key={p.id}
              className="list-row"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onPick(p.id);
                setQuery("");
                setOpen(false);
              }}
            >
              <span className="grow">{p.title}</span>
              <span className="muted small">{p.library_name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SlideText({
  block,
  color,
  first,
  onChange,
  onKeyDown,
  register,
}: {
  block: Block;
  color: string;
  first: boolean;
  onChange: (text: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  register: (el: HTMLTextAreaElement | null) => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [block.text]);
  return (
    <div className={`reflow-slide${first ? " first" : ""}`} style={{ ["--group-color" as string]: color }}>
      <textarea
        ref={(el) => {
          ref.current = el;
          register(el);
        }}
        className="reflow-textarea"
        value={block.text}
        rows={1}
        spellCheck
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Empty slide (type text, or Backspace to merge)"
      />
    </div>
  );
}

function ReflowEditor({ presentation }: { presentation: Presentation }) {
  const { groups: classes } = useApp();
  const { theme } = usePresentationTheme(presentation);
  const [blocks, setBlocks] = useState<Block[]>(() => toBlocks(presentation));
  const [status, setStatus] = useState<"saved" | "pending" | "saving" | "error">("saved");
  const [error, setError] = useState<string | null>(null);
  const refs = useRef(new Map<string, HTMLTextAreaElement>());
  const lastSaved = useRef(JSON.stringify(presentation.groups));
  const dirty = useRef(false);
  const focusNext = useRef<{ key: string; pos: number | "end" } | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;

  // Outside changes (group edits in the right column) reload the text, unless typing.
  useEffect(() => {
    const serverGroups = JSON.stringify(presentation.groups);
    if (serverGroups !== lastSaved.current && !dirty.current) {
      lastSaved.current = serverGroups;
      setBlocks(toBlocks(presentation));
    }
  }, [presentation]);

  useLayoutEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    const el = refs.current.get(target.key);
    if (el) {
      el.focus();
      const pos = target.pos === "end" ? el.value.length : target.pos;
      el.setSelectionRange(pos, pos);
    }
  });

  const save = useCallback(async () => {
    const groups = toGroups(blocksRef.current);
    if (groups.length === 0) return;
    setStatus("saving");
    try {
      const updated = await libraryApi.replacePresentation(presentation.id, {
        nameid: presentation.nameid,
        metadata: presentation.metadata,
        groups,
      });
      lastSaved.current = JSON.stringify(updated.groups);
      dirty.current = false;
      setStatus("saved");
      setError(null);
      markChanged();
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [presentation.id, presentation.metadata, presentation.nameid]);

  const update = (next: Block[]) => {
    setBlocks(next);
    dirty.current = true;
    setStatus("pending");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void save(), 700);
  };

  useEffect(
    () => () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        if (dirty.current) void save();
      }
    },
    [save],
  );

  const onKeyDown = (index: number) => (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const block = blocks[index];
    const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
    const atEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length;

    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      // New slide in the same group from the cursor on.
      e.preventDefault();
      const before = el.value.slice(0, el.selectionStart).replace(/\n$/, "");
      const after = el.value.slice(el.selectionEnd).replace(/^\n/, "");
      const created: Block = { key: newId(), group: block.group, text: after };
      const next = [...blocks];
      next.splice(index, 1, { ...block, text: before }, created);
      focusNext.current = { key: created.key, pos: 0 };
      update(next);
    } else if (e.key === "Backspace" && atStart && index > 0) {
      // Merge into the previous slide.
      e.preventDefault();
      const prev = blocks[index - 1];
      const joiner = prev.text && block.text ? "\n" : "";
      const next = [...blocks];
      next.splice(index - 1, 2, { ...prev, text: prev.text + joiner + block.text });
      focusNext.current = { key: prev.key, pos: prev.text.length + joiner.length };
      update(next);
    } else if (e.key === "Delete" && atEnd && index < blocks.length - 1) {
      e.preventDefault();
      const following = blocks[index + 1];
      const joiner = block.text && following.text ? "\n" : "";
      const next = [...blocks];
      next.splice(index, 2, { ...block, text: block.text + joiner + following.text });
      focusNext.current = { key: block.key, pos: block.text.length };
      update(next);
    } else if (e.key === "ArrowUp" && index > 0 && !el.value.slice(0, el.selectionStart).includes("\n")) {
      e.preventDefault();
      focusNext.current = { key: blocks[index - 1].key, pos: "end" };
      setBlocks([...blocks]);
    } else if (e.key === "ArrowDown" && index < blocks.length - 1 && !el.value.slice(el.selectionEnd).includes("\n")) {
      e.preventDefault();
      focusNext.current = { key: blocks[index + 1].key, pos: 0 };
      setBlocks([...blocks]);
    } else if (e.key === "ArrowLeft" && atStart && index > 0) {
      e.preventDefault();
      focusNext.current = { key: blocks[index - 1].key, pos: "end" };
      setBlocks([...blocks]);
    } else if (e.key === "ArrowRight" && atEnd && index < blocks.length - 1) {
      e.preventDefault();
      focusNext.current = { key: blocks[index + 1].key, pos: 0 };
      setBlocks([...blocks]);
    }
  };

  const setGroupDesign = async (group: string, designId: string) => {
    const metadata = { ...presentation.metadata };
    const key = `${GROUP_DESIGN_PREFIX}${group}`;
    if (designId) metadata[key] = designId;
    else delete metadata[key];
    await libraryApi.replacePresentation(presentation.id, { nameid: presentation.nameid, metadata, groups: toGroups(blocks) });
    markChanged();
  };

  return (
    <div className="reflow-editor">
      <div className="reflow-editor-status">
        <span className="muted small">
          <kbd>Ctrl</kbd>+<kbd>Enter</kbd> new slide · <kbd>Backspace</kbd> at the start merges with the previous slide
        </span>
        <span className={`reflow-save ${status}`}>
          {status === "saved" ? "Saved" : status === "saving" ? "Saving…" : status === "pending" ? "Editing…" : "Not saved"}
        </span>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="reflow-text">
        {blocks.map((block, i) => {
          const firstOfGroup = i === 0 || blocks[i - 1].group !== block.group;
          const color = groupColor(block.group, classes) ?? "#5b5a6b";
          return (
            <div key={block.key} className="reflow-block">
              {firstOfGroup && (
                <div className="reflow-group-header" style={{ ["--group-color" as string]: color }}>
                  <span>{block.group}</span>
                  {theme && theme.designs.length > 1 && (
                    <select
                      className="reflow-group-design"
                      value={presentation.metadata[`${GROUP_DESIGN_PREFIX}${block.group}`] ?? ""}
                      onChange={(e) => void setGroupDesign(block.group, e.target.value)}
                      title="Design used for this group"
                    >
                      <option value="">Presentation design</option>
                      {theme.designs.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
              <SlideText
                block={block}
                color={color}
                first={firstOfGroup}
                register={(el) => {
                  if (el) refs.current.set(block.key, el);
                  else refs.current.delete(block.key);
                }}
                onChange={(text) => update(blocks.map((b) => (b.key === block.key ? { ...b, text: sanitize(text) } : b)))}
                onKeyDown={onKeyDown(i)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Reflow() {
  const { reflowSelection, setReflowSelection } = useApp();
  const { data: presentation, error } = useLive(
    () => (reflowSelection ? libraryApi.getPresentation(reflowSelection) : Promise.resolve(null)),
    [reflowSelection],
  );
  const current = presentation && presentation.id === reflowSelection ? presentation : null;

  return (
    <section className="page reflow-page">
      <header className="page-header">
        <div>
          <h1>Reflow</h1>
          <p>Edit the words of a presentation. What is live stays as it is until you move to another slide.</p>
        </div>
        <PresentationSearch onPick={setReflowSelection} />
      </header>
      {error && <div className="alert alert-error">{error}</div>}
      {!reflowSelection ? (
        <div className="card empty">Pick a presentation with the search, or select one in Songs.</div>
      ) : !current ? (
        <div className="card empty">Loading…</div>
      ) : (
        <div className="reflow-layout">
          <ReflowEditor key={current.id} presentation={current} />
          <PresentationPreview presentation={current} selectedId={current.id} loading={false} liveOnDoubleClick={false} />
        </div>
      )}
    </section>
  );
}
