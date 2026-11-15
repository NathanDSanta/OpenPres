import { useEffect, useMemo, useState } from "react";
import {
  AlignJustify,
  ArrowDown,
  ArrowUp,
  Bookmark,
  BookmarkPlus,
  History as HistoryIcon,
  ListOrdered,
  ListPlus,
  MonitorUp,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { bibleApi, markChanged, useLive } from "@/api";
import { useMenu, divider, heading, type MenuAnchor, type MenuEntry } from "@/components/ui/Menu";
import Select from "@/components/ui/Select";
import { dayLabel, isSingleVerse, itemFor, oneChapter, referenceToShow, shownTime } from "@/lib/bible";
import { notifyError, useDialogs } from "@/state/Dialogs";
import type { BibleHistoryEntry, BibleList, BibleListItem, BibleReference } from "@/types";

type NewItem = Omit<BibleListItem, "id">;

const LAST_LIST_KEY = "openpres.bible.list";
const rememberList = (id: string) => {
  try {
    localStorage.setItem(LAST_LIST_KEY, id);
  } catch {
    /* storage unavailable */
  }
};
const lastList = () => {
  try {
    return localStorage.getItem(LAST_LIST_KEY);
  } catch {
    return null;
  }
};

/**
 * "Save to list" menu: every list, plus "New list…". Used by the history, the reader, the
 * search results and the on-screen panel.
 */
export function useSaveToList() {
  const menu = useMenu();
  const { prompt, notify } = useDialogs();

  const createWith = async (items: NewItem[]) => {
    const name = await prompt({ title: "New list", label: "Name", placeholder: "Sunday sermon", confirmLabel: "Create" });
    if (!name?.trim()) return;
    try {
      const list = await bibleApi.createList(name.trim(), items);
      rememberList(list.id);
      markChanged();
      notify(items.length ? `Saved to “${list.name}”.` : `Created “${list.name}”.`, "info");
    } catch (e) {
      notifyError(e);
    }
  };

  const open = async (anchor: MenuAnchor, items: NewItem[]) => {
    let lists: BibleList[] = [];
    try {
      lists = (await bibleApi.lists()).lists;
    } catch (e) {
      notifyError(e);
      return;
    }
    const entries: MenuEntry[] = [
      heading("h", "Save to list"),
      ...lists.map<MenuEntry>((l) => ({
        key: l.id,
        label: l.name,
        hint: String(l.items.length),
        icon: <Bookmark size={13} />,
        onSelect: () =>
          void bibleApi
            .addToList(l.id, items)
            .then(() => {
              rememberList(l.id);
              markChanged();
              notify(`Saved to “${l.name}”.`, "info");
            })
            .catch(notifyError),
      })),
      ...(lists.length ? [divider("d")] : []),
      { key: "new", label: "New list…", icon: <Plus size={13} />, onSelect: () => void createWith(items) },
    ];
    menu.open(anchor, entries, 200);
  };

  return { open, element: menu.element, createWith };
}

const show = (reference: BibleReference) =>
  void bibleApi
    .show({ reference })
    .then(() => markChanged())
    .catch(notifyError);

/** Start and end of a span, e.g. "from Juan 3:16 to Juan 3:21". */
function StartEnd({ from, to, single }: { from: string; to: string; single: boolean }) {
  if (single) return null;
  return (
    <span className="bible-span">
      <span>
        <b>Start</b> {from}
      </span>
      <span>
        <b>End</b> {to}
      </span>
    </span>
  );
}

// ---------------- history ----------------

export function BibleHistoryPanel({ onOpen }: { onOpen: (r: BibleReference) => void }) {
  const { data, setData } = useLive(() => bibleApi.history());
  const { confirm } = useDialogs();
  const save = useSaveToList();
  const entries = data?.entries ?? [];

  const groups = useMemo(() => {
    const out: { day: string; entries: BibleHistoryEntry[] }[] = [];
    for (const e of entries) {
      const day = dayLabel(e.shown_at);
      if (out[out.length - 1]?.day !== day) out.push({ day, entries: [] });
      out[out.length - 1].entries.push(e);
    }
    return out;
  }, [entries]);

  const remove = (id: string) => {
    if (data) setData({ ...data, entries: data.entries.filter((e) => e.id !== id) });
    void bibleApi.deleteHistoryEntry(id).catch(notifyError);
  };

  return (
    <div className="bible-collection">
      <div className="bible-collection-bar">
        <span className="muted small">{entries.length ? `${entries.length} passage${entries.length === 1 ? "" : "s"} shown` : ""}</span>
        <button
          className="btn btn-small"
          disabled={!entries.length}
          onClick={() =>
            void confirm({ title: "Clear the history?", message: "Saved lists are not affected.", confirmLabel: "Clear", danger: true }).then(
              (ok) => {
                if (!ok) return;
                void bibleApi
                  .clearHistory()
                  .then(() => {
                    setData({ entries: [], current: data?.current ?? null });
                    markChanged();
                  })
                  .catch(notifyError);
              },
            )
          }
        >
          <Trash2 size={13} /> Clear
        </button>
      </div>
      <div className="bible-collection-list">
        {entries.length === 0 && (
          <div className="empty small">
            <HistoryIcon size={20} />
            Passages appear here once they are shown, with where the reading started and ended.
          </div>
        )}
        {groups.map((g) => (
          <div key={g.day}>
            <div className="bible-collection-day">{g.day}</div>
            {g.entries.map((e) => {
              const live = e.id === data?.current;
              const single = isSingleVerse(e.span);
              return (
                <div
                  key={e.id}
                  className={`bible-item${live ? " live" : ""}`}
                  onClick={() => onOpen(e.first)}
                  onDoubleClick={() => show(e.first)}
                  title="Click to open, double-click to show again from the start"
                >
                  <div className="bible-item-main">
                    <strong>
                      {live && <span className="badge-live" />}
                      {e.label}
                    </strong>
                    <StartEnd from={e.from_label} to={e.to_label} single={single} />
                  </div>
                  <span className="bible-item-time muted small">{shownTime(e.shown_at)}</span>
                  <div className="bible-item-actions" onClick={(ev) => ev.stopPropagation()} onDoubleClick={(ev) => ev.stopPropagation()}>
                    <button className="icon-btn" title="Show again from the start" onClick={() => show(e.first)}>
                      <MonitorUp size={14} />
                    </button>
                    <button
                      className="icon-btn"
                      title="Save to a list"
                      onClick={(ev) => void save.open(ev.currentTarget, [{ span: e.span, whole: !!oneChapter(e.span) && e.first.verse_end > e.first.verse_start, note: "" }])}
                    >
                      <BookmarkPlus size={14} />
                    </button>
                    <button className="icon-btn" title="Remove from the history" onClick={() => remove(e.id)}>
                      <X size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {save.element}
    </div>
  );
}

// ---------------- saved lists ----------------

export function BibleListsPanel({ onOpen, selection }: { onOpen: (r: BibleReference) => void; selection: BibleReference | null }) {
  const { data, setData } = useLive(() => bibleApi.lists());
  const { prompt, confirm } = useDialogs();
  const save = useSaveToList();
  const menu = useMenu();
  const lists = data?.lists ?? [];
  const [listId, setListId] = useState<string | null>(lastList());
  const list = lists.find((l) => l.id === listId) ?? lists[0] ?? null;
  const [adding, setAdding] = useState("");
  const [parsed, setParsed] = useState<{ reference: BibleReference; label: string } | null>(null);

  useEffect(() => {
    if (list && list.id !== listId) setListId(list.id);
  }, [list, listId]);

  useEffect(() => {
    const q = adding.trim();
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
  }, [adding]);

  /** Saves the list (optimistically) and takes the labels the server sends back. */
  const update = (next: BibleList) => {
    setData({ lists: lists.map((l) => (l.id === next.id ? next : l)) });
    void bibleApi
      .updateList(next)
      .then((saved) => setData((d) => (d ? { lists: d.lists.map((l) => (l.id === saved.id ? saved : l)) } : d)))
      .catch(notifyError);
  };

  const add = (items: NewItem[]) => {
    if (!list) return;
    void bibleApi
      .addToList(list.id, items)
      .then((saved) => setData((d) => (d ? { lists: d.lists.map((l) => (l.id === saved.id ? saved : l)) } : d)))
      .catch(notifyError);
  };

  const moveItem = (from: number, to: number) => {
    if (!list || to < 0 || to >= list.items.length) return;
    const items = [...list.items];
    items.splice(to, 0, items.splice(from, 1)[0]);
    update({ ...list, items });
  };

  const listMenu = (anchor: HTMLElement) => {
    if (!list) return;
    menu.open(anchor, [
      {
        key: "rename",
        label: "Rename…",
        icon: <Pencil size={13} />,
        onSelect: () =>
          void prompt({ title: "Rename list", label: "Name", value: list.name, confirmLabel: "Rename" }).then((name) => name?.trim() && update({ ...list, name: name.trim() })),
      },
      {
        key: "delete",
        label: "Delete list…",
        icon: <Trash2 size={13} />,
        danger: true,
        onSelect: () =>
          void confirm({ title: `Delete “${list.name}”?`, message: `${list.items.length} saved passage${list.items.length === 1 ? "" : "s"} will be removed.`, confirmLabel: "Delete", danger: true }).then(
            (ok) => {
              if (!ok) return;
              void bibleApi
                .deleteList(list.id)
                .then(() => {
                  setData({ lists: lists.filter((l) => l.id !== list.id) });
                  setListId(null);
                  markChanged();
                })
                .catch(notifyError);
            },
          ),
      },
    ]);
  };

  return (
    <div className="bible-collection">
      <div className="bible-collection-bar">
        {lists.length > 0 ? (
          <Select
            small
            value={list?.id ?? ""}
            options={lists.map((l) => ({ value: l.id, label: l.name, hint: String(l.items.length) }))}
            onChange={(id) => {
              setListId(id);
              rememberList(id);
            }}
          />
        ) : (
          <span className="muted small">No lists yet</span>
        )}
        <button className="btn btn-small btn-icon" title="New list" onClick={() => void save.createWith([])}>
          <Plus size={14} />
        </button>
        {list && (
          <button className="btn btn-small btn-icon" title="Rename or delete this list" onClick={(e) => listMenu(e.currentTarget)}>
            <MoreHorizontal size={14} />
          </button>
        )}
      </div>

      {list && (
        <div className="bible-list-add">
          <input
            className="input"
            value={adding}
            placeholder="Add a passage, e.g. 1 Co 13:4-7"
            onChange={(e) => setAdding(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && parsed) {
                add([itemFor(parsed.reference)]);
                setAdding("");
              }
            }}
          />
          <button
            className="btn btn-small"
            disabled={!parsed && !selection}
            title={parsed ? `Add ${parsed.label}` : "Add the verses selected in the reader"}
            onClick={() => {
              if (parsed) {
                add([itemFor(parsed.reference)]);
                setAdding("");
              } else if (selection) add([itemFor(selection)]);
            }}
          >
            <ListPlus size={14} /> {parsed ? "Add" : "Add selection"}
          </button>
        </div>
      )}

      <div className="bible-collection-list">
        {!list && (
          <div className="empty small">
            <Bookmark size={20} />
            Keep the passages for a sermon or a study in a list. Create one with +.
          </div>
        )}
        {list && list.items.length === 0 && <div className="empty small">Empty. Type a passage above, or save one from the history, the reader or the search.</div>}
        {list?.items.map((item, i) => {
          const single = isSingleVerse(item.span);
          const canWhole = oneChapter(item.span) && !single;
          return (
            <div
              key={item.id}
              className="bible-item"
              onClick={() => onOpen(referenceToShow({ span: item.span, whole: true }))}
              onDoubleClick={() => show(referenceToShow(item))}
              title={item.whole ? "Double-click to show the whole passage" : "Double-click to show it verse by verse"}
            >
              <span className="bible-item-index muted small">{i + 1}</span>
              <div className="bible-item-main">
                <strong>{item.label ?? "…"}</strong>
                {!single && (
                  <span className="bible-item-mode muted small">{item.whole ? "Whole passage at once" : "Verse by verse"}</span>
                )}
                {!canWhole && <StartEnd from={item.from_label ?? ""} to={item.to_label ?? ""} single={single} />}
              </div>
              <div className="bible-item-actions" onClick={(ev) => ev.stopPropagation()} onDoubleClick={(ev) => ev.stopPropagation()}>
                {canWhole && (
                  <button
                    className={`icon-btn${item.whole ? " active" : ""}`}
                    title={item.whole ? "Shown as a whole passage. Click to show it verse by verse" : "Shown verse by verse. Click to show the whole passage at once"}
                    onClick={() => update({ ...list, items: list.items.map((x) => (x.id === item.id ? { ...x, whole: !x.whole } : x)) })}
                  >
                    {item.whole ? <AlignJustify size={14} /> : <ListOrdered size={14} />}
                  </button>
                )}
                <button className="icon-btn" title="Show" onClick={() => show(referenceToShow(item))}>
                  <MonitorUp size={14} />
                </button>
                <button className="icon-btn" title="Move up" disabled={i === 0} onClick={() => moveItem(i, i - 1)}>
                  <ArrowUp size={14} />
                </button>
                <button className="icon-btn" title="Move down" disabled={i === list.items.length - 1} onClick={() => moveItem(i, i + 1)}>
                  <ArrowDown size={14} />
                </button>
                <button className="icon-btn" title="Remove from the list" onClick={() => update({ ...list, items: list.items.filter((x) => x.id !== item.id) })}>
                  <X size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {save.element}
      {menu.element}
    </div>
  );
}
