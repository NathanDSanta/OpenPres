import { useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useBuses } from "@/hooks/useBuses";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Clock3,
  Eraser,
  Film,
  FilePenLine,
  FolderOpen,
  Image as ImageIcon,
  LayoutDashboard,
  Layers,
  Library,
  ListPlus,
  ListMusic,
  Megaphone,
  MonitorCog,
  MonitorPlay,
  Music2,
  Pause,
  Play,
  Presentation,
  Radio,
  RotateCcw,
  Search,
  Shapes,
  SlidersVertical,
  Square,
  Timer,
  Video,
  VideoOff,
} from "lucide-react";
import {
  audioApi,
  bibleApi,
  cameraMjpegUrl,
  devicesApi,
  libraryApi,
  liveApi,
  markChanged,
  mediaApi,
  playlistApi,
  presenterApi,
  screensApi,
  streamApi,
  themesApi,
  timersApi,
  useLive,
} from "@/api";
import { SHOW_TOPICS } from "@/api/events";
import SceneCanvas from "@/components/canvas/SceneCanvas";
import ClearWidget from "./ClearWidget";
import ScreenPresetsWidget from "./ScreenPresetsWidget";
import DashboardsWidget from "./DashboardsWidget";
import Transport from "@/components/media/Transport";
import { BusStrip } from "@/components/audio/BusStrip";
import Select from "@/components/ui/Select";
import type { MenuEntry } from "@/components/ui/Menu";
import { contextEntries } from "@/components/global/ContextMenu";
import { addToPlaylist } from "@/lib/presentations";
import { useApp } from "@/state/AppContext";
import { useScene, useNow } from "@/hooks/useScene";
import { formatClock, formatDuration, timerValue } from "@/lib/format";
import { search } from "@/lib/search";
import { notifyError } from "@/state/Dialogs";
import type { PlayerSlot, PresenterTarget } from "@/types";

export interface WidgetProps {
  config: Record<string, unknown>;
  setConfig: (patch: Record<string, unknown>) => void;
  w: number;
  h: number;
  /** Size of one grid square in pixels. */
  cell: number;
}

export interface WidgetDef {
  type: string;
  title: string;
  description: string;
  icon: typeof Play;
  size: [number, number];
  min?: [number, number];
  /** The largest it can be resized to. */
  max?: [number, number];
  render: (props: WidgetProps) => ReactNode;
  /** Settings shown in edit mode. */
  settings?: (props: WidgetProps) => ReactNode;
  /** Draws edge to edge, without the title bar. */
  bare?: boolean;
  /** Kept for old layouts, not offered in "Add widget". */
  hidden?: boolean;
}

const run = (p: Promise<unknown>) =>
  void p.then(markChanged).catch((e) => {
    if (String(e?.message ?? e).startsWith("nothing is live")) return;
    notifyError(e);
  });

const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
const num = (v: unknown, fallback: number) => (typeof v === "number" ? v : fallback);

/** Labels next to icons only when the widget is wide enough for them. */
const wideEnough = (w: number, cell: number, px = 200) => w * cell + (w - 1) * 8 >= px;

// ---------------- presentation control ----------------

function PresenterWidget({ config, w, h, cell }: WidgetProps) {
  const target = str(config.target, "all") as PresenterTarget;
  const { data } = useLive(() => presenterApi.getState(), [], SHOW_TOPICS);
  const { data: bible } = useLive(() => bibleApi.live(), [], SHOW_TOPICS);
  const layers = target === "all" ? (["slides", "announcements"] as const) : ([target] as const);
  const active = layers.map((l) => ({ layer: l, state: data?.[l] ?? null }));
  const main = active.find((a) => a.state)?.state ?? null;
  const labels = wideEnough(w, cell, 240);
  // Big enough: what's on screen now and what comes next, to follow along.
  const roomy = w >= 3 && h >= 3;
  const { data: slides } = useLive(
    () => (roomy && main ? libraryApi.getSlides(main.presentation_id, main.arrangement) : Promise.resolve(null)),
    [roomy, main?.presentation_id, main?.arrangement],
    SHOW_TOPICS,
  );
  const now = main ? slides?.slides[main.slide_index] : undefined;
  const next = main ? slides?.slides[main.slide_index + 1] : undefined;
  return (
    <div className="wg-presenter">
      <div className="wg-presenter-status">
        {main ? (
          <>
            <span className="wg-big">
              {main.slide_index + 1}
              <small>/{main.total_slides}</small>
            </span>
            {(w > 1 || h > 1) && (
              <span className="wg-sub" title={main.title}>
                {main.title}
              </span>
            )}
          </>
        ) : (
          <span className="wg-sub">Nothing live</span>
        )}
        {target === "all" && bible && (w > 1 || h > 1) && (
          <span className="wg-bible-live" title="On the Bible layer (the arrows move it when it was shown last)">
            <BookOpen size={12} /> {bible.label}
          </span>
        )}
      </div>
      {target === "all" && w > 1 && h > 1 && (
        <div className="wg-layers">
          {active.map(({ layer, state }) => (
            <span key={layer} className={state ? "on" : ""}>
              {layer === "slides" ? <Presentation size={12} /> : <Megaphone size={12} />}
              {state ? `${state.slide_index + 1}/${state.total_slides}` : "–"}
            </span>
          ))}
        </div>
      )}
      {roomy && now && (
        <div className="wg-presenter-text">
          <span className="wg-group">Now · {now.group}</span>
          <p>{now.text}</p>
          {next && (
            <>
              <span className="wg-group wg-group-next">Next · {next.group}</span>
              <p className="wg-next">{next.text}</p>
            </>
          )}
        </div>
      )}
      <div className={`wg-presenter-buttons${roomy ? " big" : ""}`}>
        <button className="btn wg-step" onClick={() => run(presenterApi.previous(target))} title="Previous (← key)">
          <ChevronLeft size={22} />
        </button>
        <button className="btn wg-step btn-primary" onClick={() => run(presenterApi.next(target))} title="Next (→ key)">
          <ChevronRight size={22} />
        </button>
      </div>
      <button className="btn btn-small btn-danger wg-clear" onClick={() => run(presenterApi.clear(target))} title="Clear">
        <Eraser size={13} />
        {labels && " Clear"}
      </button>
    </div>
  );
}

function PresenterSettings({ config, setConfig }: WidgetProps) {
  return (
    <div className="field">
      <label>Controls</label>
      <Select
        value={str(config.target, "all")}
        options={[
          { value: "all", label: "Slides or Bible, and announcements together" },
          { value: "slides", label: "Slides only" },
          { value: "announcements", label: "Announcements only" },
        ]}
        onChange={(target) => setConfig({ target })}
      />
    </div>
  );
}

// ---------------- clear ----------------

// ---------------- songs ----------------

/** Click selects, double-click presents (from the first slide); right-click for more. */
function SongRows({ items, liveIds }: { items: { id: string; title: string; hint?: string }[]; liveIds: string[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const { data: playlists } = useLive(() => playlistApi.list(), [], SHOW_TOPICS);
  const { setSongsSelection, setReflowSelection } = useApp();
  const navigate = useNavigate();
  const present = (id: string) => run(presenterApi.load({ presentation_id: id, index: 0 }));
  const menuFor = (p: { id: string; title: string }): MenuEntry[] => [
    { key: "present", label: "Present", icon: <Play size={13} />, hint: "double-click", onSelect: () => present(p.id) },
    {
      key: "playlist",
      label: "Add to playlist",
      icon: <ListPlus size={13} />,
      children: (playlists ?? []).length
        ? (playlists ?? []).map((pl) => ({ key: pl.id, label: pl.name, checked: pl.presentation_ids.includes(p.id), onSelect: () => void addToPlaylist(pl.id, p.id).then(markChanged).catch(notifyError) }))
        : [{ key: "none", label: "No playlists yet", disabled: true }],
    },
    {
      key: "songs",
      label: "Open in Songs",
      icon: <Library size={13} />,
      onSelect: () => {
        setSongsSelection(p.id);
        navigate("/songs");
      },
    },
    {
      key: "edit",
      label: "Edit text",
      icon: <FilePenLine size={13} />,
      onSelect: () => {
        setReflowSelection(p.id);
        navigate("/reflow");
      },
    },
  ];
  return (
    <div className="wg-list">
      {items.map((p) => (
        <button
          key={p.id}
          ref={(el) => contextEntries(el, () => (setSelected(p.id), menuFor(p)))}
          className={`list-row${p.id === selected ? " active" : ""}${liveIds.includes(p.id) ? " live" : ""}`}
          onClick={() => setSelected(p.id)}
          onDoubleClick={() => present(p.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter") present(p.id);
          }}
          title="Double-click to present"
        >
          {liveIds.includes(p.id) && <span className="wg-live-dot" />}
          <span className="grow">{p.title}</span>
          {p.hint && <span className="muted small">{p.hint}</span>}
        </button>
      ))}
      {items.length === 0 && <div className="muted small wg-empty">Nothing here.</div>}
    </div>
  );
}

function PlaylistWidget({ config, setConfig }: WidgetProps) {
  const { data: playlists } = useLive(() => playlistApi.list(), [], SHOW_TOPICS);
  const id = str(config.playlistId) || playlists?.[0]?.id || "";
  const { data } = useLive(() => (id ? playlistApi.resolve(id) : Promise.resolve(null)), [id], SHOW_TOPICS);
  const { data: live } = useLive(() => presenterApi.getState(), [], SHOW_TOPICS);
  const liveIds = [live?.slides?.presentation_id, live?.announcements?.presentation_id].filter(Boolean) as string[];
  return (
    <div className="wg-column">
      <Select small value={id} placeholder="No playlists" options={(playlists ?? []).map((p) => ({ value: p.id, label: p.name }))} onChange={(playlistId) => setConfig({ playlistId })} />
      <SongRows liveIds={liveIds} items={(data?.items ?? []).flatMap((i) => (i.missing ? [] : [{ id: i.summary.id, title: i.summary.title }]))} />
    </div>
  );
}

function LibraryWidget({ config, setConfig, w, h, cell }: WidgetProps) {
  const { data: libraries } = useLive(() => libraryApi.listLibraries(), [], SHOW_TOPICS);
  const lib = str(config.libraryId);
  const { data } = useLive(() => (lib ? libraryApi.listPresentations(lib) : libraryApi.listAllPresentations()), [lib], SHOW_TOPICS);
  const { data: live } = useLive(() => presenterApi.getState(), [], SHOW_TOPICS);
  const [query, setQuery] = useState("");
  const results = useMemo(() => search(data ?? [], query, (p) => p.title).slice(0, 200), [data, query]);
  const liveIds = [live?.slides?.presentation_id, live?.announcements?.presentation_id].filter(Boolean) as string[];
  const stacked = !wideEnough(w, cell, 300);
  const searchBox = (
    <label className="wg-search">
      <Search size={13} />
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" />
    </label>
  );
  const librarySelect = <Select small value={lib} options={[{ value: "", label: "All libraries" }, ...(libraries ?? []).map((l) => ({ value: l.id, label: l.name }))]} onChange={(libraryId) => setConfig({ libraryId })} />;
  const rows = <SongRows liveIds={liveIds} items={results.map((p) => ({ id: p.id, title: p.title, hint: lib ? undefined : p.library_name }))} />;
  // Tall: the library on top, the songs, and the search at the bottom, near the hands.
  if (h >= 4) {
    return (
      <div className="wg-column wg-library-tall">
        {librarySelect}
        {rows}
        {searchBox}
      </div>
    );
  }
  return (
    <div className="wg-column">
      <div className={stacked ? "wg-column wg-tight" : "wg-row"}>
        <label className="wg-search">
          <Search size={13} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" />
        </label>
        <div className={stacked ? "" : "wg-row-select"}>
          <Select small value={lib} options={[{ value: "", label: "All libraries" }, ...(libraries ?? []).map((l) => ({ value: l.id, label: l.name }))]} onChange={(libraryId) => setConfig({ libraryId })} />
        </div>
      </div>
      <SongRows liveIds={liveIds} items={results.map((p) => ({ id: p.id, title: p.title, hint: lib ? undefined : p.library_name }))} />
    </div>
  );
}

function SlidesWidget({ w }: WidgetProps) {
  const { data: live } = useLive(() => presenterApi.getState(), [], SHOW_TOPICS);
  const state = live?.slides ?? null;
  const { data } = useLive(() => (state ? libraryApi.getSlides(state.presentation_id, state.arrangement) : Promise.resolve(null)), [state?.presentation_id, state?.arrangement], SHOW_TOPICS);
  if (!state) return <div className="wg-empty muted small">No presentation on the slides layer.</div>;
  return (
    <div className="wg-column">
      <span className="wg-sub" title={state.title}>
        {state.title}
      </span>
      <div className="wg-slides" style={{ gridTemplateColumns: `repeat(${Math.max(1, w - 1) + (w > 2 ? 1 : 0)}, minmax(0, 1fr))` }}>
        {(data?.slides ?? []).map((s, i) => (
          <button key={i} className={`wg-slide${i === state.slide_index ? " live" : ""}`} onClick={() => run(presenterApi.goto(i, "slides"))}>
            <span className="wg-slide-group">
              {i + 1} · {s.group}
            </span>
            <span className="wg-slide-text">{s.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------- screens ----------------

/** The screen as big as the widget allows, with a thin selector under it. */
function PreviewWidget({ config, setConfig }: WidgetProps) {
  const { data: screens } = useLive(() => screensApi.list(), [], ["screens"]);
  // "follow: stream": whichever screen the stream shows (the Livestream dashboard).
  const follows = !str(config.screenId) && config.follow === "stream";
  const { data: stream } = useLive(() => (follows ? streamApi.settings() : Promise.resolve(null)), [follows], ["stream"]);
  const id = str(config.screenId) || (follows ? stream?.screen_id : null) || screens?.[0]?.id || null;
  const { scene, offset } = useScene(id);
  return (
    <div className="wg-preview">
      <div className="wg-preview-canvas">{scene ? <SceneCanvas scene={scene} offset={offset} /> : <span className="muted small">No screen</span>}</div>
      <div className="wg-preview-bar">
        <Select small value={id ?? ""} placeholder="Choose a screen" options={(screens ?? []).map((s) => ({ value: s.id, label: s.name }))} onChange={(screenId) => setConfig({ screenId })} />
      </div>
    </div>
  );
}

/** The video inputs set up in OpenPres (not every camera the computer has). */
function VideoInputWidget({ h }: WidgetProps) {
  const { data: inputs } = useLive(() => devicesApi.inputs(), [], ["devices", "video-inputs"]);
  const { data: cams } = useLive(() => devicesApi.listVideo(), [], ["devices", "video-inputs"]);
  const { data: live } = useLive(() => liveApi.get(), [], SHOW_TOPICS);
  const current = live?.video_input ?? null;
  const connected = new Set((cams ?? []).map((c) => c.id));
  return (
    <div className="wg-column">
      {current && h > 1 && <img className="wg-camera" src={cameraMjpegUrl(current)} alt="Live camera" />}
      <div className="wg-list">
        {(inputs ?? []).map((input) => {
          const on = input.device_id === current;
          const missing = cams !== null && cams !== undefined && !connected.has(input.device_id);
          return (
            <button
              key={input.id}
              className={`list-row${on ? " active" : ""}`}
              disabled={missing && !on}
              onClick={() => run(liveApi.setVideoInput(on ? null : input.device_id))}
              title={missing ? "Its camera isn't connected" : on ? "Take it off the video layer" : "Put it on the video layer"}
            >
              {missing ? <VideoOff size={14} /> : <Video size={14} />}
              <span className="grow">{input.name}</span>
              {on && <span className="badge-live" />}
            </button>
          );
        })}
        {inputs?.length === 0 && <div className="muted small wg-empty">Add video inputs in Media → Video inputs.</div>}
      </div>
    </div>
  );
}

// ---------------- audio ----------------

function BusWidget({ config, setConfig }: WidgetProps) {
  const { data: view, setData } = useLive(() => audioApi.get(), [], ["audio", "devices"]);
  const buses = useBuses(view);
  if (!view) return null;
  const number = Math.min(16, Math.max(1, num(config.bus, 1)));
  return (
    <div className="wg-column">
      <Select
        small
        value={String(number)}
        options={buses.options(number)}
        onChange={(v) => setConfig({ bus: Number(v) })}
      />
      <BusStrip number={number} view={view} compact onChange={setData} />
    </div>
  );
}

// ---------------- media ----------------

function useServerOffset() {
  const sent = useRef(0);
  const [offset, setOffset] = useState(0);
  const { data } = useLive(async () => {
    sent.current = Date.now();
    const p = await mediaApi.player();
    setOffset(p.now_ms - (sent.current + Date.now()) / 2);
    return p;
  }, [], SHOW_TOPICS);
  return { player: data, offset };
}

function MediaWidget({ config, setConfig, h }: WidgetProps) {
  const slot = str(config.slot, "audio") as PlayerSlot;
  const { player, offset } = useServerOffset();
  return (
    <div className="wg-column">
      <div className="btn-group wg-tabs">
        <button className={`btn btn-small${slot === "visual" ? " btn-active" : ""}`} onClick={() => setConfig({ slot: "visual" })}>
          Media
        </button>
        <button className={`btn btn-small${slot === "audio" ? " btn-active" : ""}`} onClick={() => setConfig({ slot: "audio" })}>
          Audio
        </button>
      </div>
      <Transport slot={slot} player={player} offset={offset} compact showVolume={h > 1} />
    </div>
  );
}

function MediaFolderWidget({ config, setConfig }: WidgetProps) {
  const { data: folders } = useLive(() => mediaApi.playlists(), [], SHOW_TOPICS);
  const { data: items } = useLive(() => mediaApi.list(), [], SHOW_TOPICS);
  const { player } = useServerOffset();
  const [selected, setSelected] = useState<number | null>(null);
  const folder = folders?.find((p) => p.id === config.playlistId) ?? folders?.[0];
  const names = new Map((items ?? []).map((m) => [m.id, m.name]));
  if (!folder) return <div className="wg-empty muted small">Import media first.</div>;
  const slot: PlayerSlot = folder.kind === "audio" ? "audio" : "visual";
  const Icon = folder.kind === "audio" ? Music2 : folder.kind === "video" ? Film : ImageIcon;
  return (
    <div className="wg-column">
      <Select
        small
        value={folder.id}
        options={(folders ?? []).map((p) => ({ value: p.id, label: p.name, hint: p.kind === "audio" ? "audio" : p.kind === "video" ? "videos" : "pictures" }))}
        onChange={(playlistId) => setConfig({ playlistId })}
      />
      <div className="wg-list">
        {folder.items.map((id, i) => {
          const playing = player?.[slot]?.playlist_id === folder.id && player?.[slot]?.index === i;
          return (
            <button
              key={`${id}-${i}`}
              className={`list-row${selected === i ? " active" : ""}${playing ? " live" : ""}`}
              onClick={() => setSelected(i)}
              onDoubleClick={() => run(mediaApi.play(slot, { playlist_id: folder.id, index: i }))}
              title="Double-click to play"
            >
              {playing ? <Pause size={13} /> : <Icon size={13} />}
              <span className="grow">{names.get(id) ?? "Missing"}</span>
            </button>
          );
        })}
        {folder.items.length === 0 && <div className="muted small wg-empty">Empty folder.</div>}
      </div>
    </div>
  );
}

// ---------------- Bible ----------------

function BibleWidget({ h }: WidgetProps) {
  const { data: live } = useLive(() => bibleApi.live(), [], SHOW_TOPICS);
  const [query, setQuery] = useState("");
  const show = () => {
    if (!query.trim()) return;
    run(bibleApi.show({ query }).then(() => setQuery("")));
  };
  return (
    <div className="wg-column">
      <label className="wg-search">
        <BookOpen size={13} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && show()} placeholder="Juan 3:16 + Enter" />
      </label>
      {live ? (
        <div className="wg-bible">
          <strong>{live.label}</strong>
          {h > 1 && <p>{live.passages[0]?.text}</p>}
        </div>
      ) : (
        <span className="muted small wg-bible-empty">Nothing on the Bible layer.</span>
      )}
      <div className="wg-presenter-buttons">
        <button className="btn btn-small" disabled={!live} onClick={() => run(bibleApi.previous())} title="Previous verse">
          <ChevronLeft size={16} />
        </button>
        <button className="btn btn-small" disabled={!live} onClick={() => run(bibleApi.next())} title="Next verse">
          <ChevronRight size={16} />
        </button>
        <button className="btn btn-small btn-danger" disabled={!live} onClick={() => run(bibleApi.clear())} title="Clear the Bible layer">
          <Eraser size={14} />
        </button>
      </div>
    </div>
  );
}

// ---------------- time ----------------

function ClockWidget({ config, w, h, cell }: WidgetProps) {
  const now = useNow(500);
  const size = Math.max(14, Math.min((w * cell) / 5.5, (h * cell) / 2.2));
  return (
    <div className="wg-clock" style={{ fontSize: `${size}px` }}>
      {formatClock(new Date(now), str(config.format, "HH:mm:ss"))}
    </div>
  );
}

function TimersWidget() {
  const { data: timers } = useLive(() => timersApi.list(), [], SHOW_TOPICS);
  const { data: services } = useLive(() => timersApi.services(), [], SHOW_TOPICS);
  const now = useNow(250);
  if (!timers?.length) return <div className="wg-empty muted small">Create timers in the Timers tab.</div>;
  return (
    <div className="wg-list">
      {timers.map((t) => (
        <div key={t.id} className="wg-timer">
          <span className="grow" title={t.name}>
            {t.name}
          </span>
          <span className="wg-timer-value">{formatDuration(timerValue(t, now, services ?? []), "H:mm:ss")}</span>
          <button className="icon-btn" onClick={() => run(timersApi.action(t.id, t.running ? "pause" : "start"))} title={t.running ? "Pause" : "Start"}>
            {t.running ? <Pause size={13} /> : <Play size={13} />}
          </button>
          <button className="icon-btn" onClick={() => run(timersApi.action(t.id, "reset"))} title="Reset">
            <RotateCcw size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------------- props ----------------

function PropsWidget({ config, setConfig }: WidgetProps) {
  const { data: collections } = useLive(() => themesApi.list("props"), [], SHOW_TOPICS);
  const { data: live } = useLive(() => liveApi.get(), [], SHOW_TOPICS);
  const collection = collections?.find((c) => c.id === config.themeId) ?? collections?.[0];
  if (!collection) return <div className="wg-empty muted small">Create props in Themes → Props & complements.</div>;
  const on = (layer: "props" | "complements", designId: string) => (live?.[layer] ?? []).some((r) => r.theme_id === collection.id && r.design_id === designId);
  return (
    <div className="wg-column">
      {(collections?.length ?? 0) > 1 && <Select small value={collection.id} options={collections!.map((c) => ({ value: c.id, label: c.name }))} onChange={(themeId) => setConfig({ themeId })} />}
      <div className="wg-list">
        {collection.designs.map((d) => (
          <div key={d.id} className="wg-prop">
            <span className="grow">{d.name}</span>
            {(["props", "complements"] as const).map((layer) => (
              <button
                key={layer}
                className={`btn btn-small${on(layer, d.id) ? " btn-live" : ""}`}
                onClick={() => run(liveApi.setProp(layer, collection.id, d.id))}
                title={layer === "props" ? "Props layer" : "Complements layer"}
              >
                {layer === "props" ? "P" : "C"}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- stream ----------------

function StreamWidget({ w, cell }: WidgetProps) {
  const { data: status } = useLive(() => streamApi.status(), [], ["stream"]);
  const now = useNow(500);
  const running = !!status?.running;
  const labels = wideEnough(w, cell, 120);
  return (
    <div className="wg-stream">
      {running && status?.started_at_ms ? (
        <span className="badge-live">
          {status.streaming ? "LIVE" : "REC"} {formatDuration(now - status.started_at_ms, "H:mm:ss")}
        </span>
      ) : (
        <span className="muted small">{status?.error ? "Stopped with an error" : "Off air"}</span>
      )}
      <button className={`btn ${running ? "btn-danger" : "btn-live"}`} onClick={() => run(running ? streamApi.stop() : streamApi.start())} title={running ? "Stop" : "Go live"}>
        {running ? <Square size={14} /> : <Radio size={15} />}
        {labels && (running ? "Stop" : "Go live")}
      </button>
    </div>
  );
}

// ---------------- registry ----------------

const bus: Omit<WidgetDef, "type"> = {
  title: "Audio bus",
  description: "Volume, gain, mute and meter of a bus",
  icon: SlidersVertical,
  size: [1, 2],
  min: [1, 2],
  render: (p) => <BusWidget {...p} />,
};

export const WIDGETS: WidgetDef[] = [
  { type: "presenter", title: "Presentation control", description: "Previous / next / clear (also the arrow keys)", icon: Presentation, size: [2, 2], render: (p) => <PresenterWidget {...p} />, settings: (p) => <PresenterSettings {...p} /> },
  { type: "clear", title: "Clear", description: "Clear groups, and every layer in the order they stack", icon: Eraser, size: [1, 3], min: [1, 2], max: [1, 8], render: (p) => <ClearWidget {...p} /> },
  { type: "playlist", title: "Playlist songs", description: "Double-click a song of a playlist to present it", icon: ListMusic, size: [2, 2], render: (p) => <PlaylistWidget {...p} /> },
  { type: "library", title: "Library songs", description: "Search libraries; double-click to present", icon: Music2, size: [2, 2], render: (p) => <LibraryWidget {...p} /> },
  { type: "slides", title: "Live slides", description: "Jump to any slide of the live presentation", icon: Layers, size: [2, 2], min: [1, 2], render: (p) => <SlidesWidget {...p} /> },
  { type: "bible", title: "Bible", description: "Type a reference, step through verses", icon: BookOpen, size: [2, 1], render: (p) => <BibleWidget {...p} /> },
  { type: "preview", title: "Screen preview", description: "Watch any virtual screen", icon: MonitorPlay, size: [2, 2], bare: true, render: (p) => <PreviewWidget {...p} /> },
  { type: "video-input", title: "Video input", description: "Put one of the video inputs on the video layer", icon: Video, size: [1, 2], render: (p) => <VideoInputWidget {...p} /> },
  { type: "bus", ...bus },
  { type: "audio-input", ...bus, hidden: true },
  { type: "audio-output", ...bus, hidden: true },
  { type: "media", title: "Media player", description: "Scrub, pause, previous/next and clear", icon: Clapperboard, size: [2, 1], min: [2, 1], render: (p) => <MediaWidget {...p} /> },
  { type: "media-playlist", title: "Media folder", description: "Double-click an item of a media folder to play it", icon: FolderOpen, size: [2, 2], render: (p) => <MediaFolderWidget {...p} /> },
  { type: "props", title: "Props", description: "Toggle props and complements", icon: Shapes, size: [2, 2], render: (p) => <PropsWidget {...p} /> },
  { type: "timers", title: "Timers", description: "Start, pause and reset timers", icon: Timer, size: [2, 1], render: () => <TimersWidget /> },
  {
    type: "clock",
    title: "Clock",
    description: "The current time",
    icon: Clock3,
    size: [1, 1],
    render: (p) => <ClockWidget {...p} />,
    settings: ({ config, setConfig }) => (
      <div className="field">
        <label>Format</label>
        <input className="input" value={str(config.format, "HH:mm:ss")} onChange={(e) => setConfig({ format: e.target.value })} />
      </div>
    ),
  },
  { type: "screen-presets", title: "Screen presets", description: "Switch each screen between the admin's layer presets", icon: MonitorCog, size: [2, 2], min: [1, 1], render: () => <ScreenPresetsWidget /> },
  { type: "dashboards", title: "Dashboards", description: "Switch between this mode's dashboards", icon: LayoutDashboard, size: [1, 1], render: (p) => <DashboardsWidget {...p} /> },
  { type: "stream", title: "Stream", description: "Go live / stop with the elapsed time", icon: Radio, size: [1, 1], render: (p) => <StreamWidget {...p} /> },
];

export const widgetDef = (type: string) => WIDGETS.find((w) => w.type === type);
