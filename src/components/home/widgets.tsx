import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  AudioLines,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Clock3,
  Eraser,
  Layers,
  ListMusic,
  Megaphone,
  MonitorPlay,
  Music2,
  Pause,
  Play,
  Presentation,
  Radio,
  RotateCcw,
  Search,
  Shapes,
  Speaker,
  Square,
  Timer,
  Video,
  X,
} from "lucide-react";
import {
  audioApi,
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
import SceneCanvas from "@/components/canvas/SceneCanvas";
import Transport from "@/components/media/Transport";
import { InputStripView, OutputStripView } from "@/components/audio/Strips";
import { useScene, useNow } from "@/hooks/useScene";
import { formatClock, formatDuration, timerValue } from "@/lib/format";
import { search } from "@/lib/search";
import type { PresenterTarget, PlayerSlot } from "@/types";

export interface WidgetProps {
  config: Record<string, unknown>;
  setConfig: (patch: Record<string, unknown>) => void;
  w: number;
  h: number;
}

export interface WidgetDef {
  type: string;
  title: string;
  description: string;
  icon: typeof Play;
  size: [number, number];
  min?: [number, number];
  render: (props: WidgetProps) => ReactNode;
  /** Settings shown in edit mode. */
  settings?: (props: WidgetProps) => ReactNode;
}

const run = (p: Promise<unknown>) =>
  void p.then(markChanged).catch((e) => alert(e instanceof Error ? e.message : String(e)));

const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);

// ---------------- presentation control ----------------

function PresenterWidget({ config, w, h }: WidgetProps) {
  const target = str(config.target, "all") as PresenterTarget;
  const { data } = useLive(() => presenterApi.getState());
  const layers = target === "all" ? (["slides", "announcements"] as const) : ([target] as const);
  const active = layers.map((l) => ({ layer: l, state: data?.[l] ?? null }));
  const main = active.find((a) => a.state)?.state ?? null;
  return (
    <div className="wg-presenter">
      <div className="wg-presenter-status">
        {main ? (
          <>
            <span className="wg-big">
              {main.slide_index + 1}
              <small>/{main.total_slides}</small>
            </span>
            {(w > 1 || h > 1) && <span className="wg-sub" title={main.title}>{main.title}</span>}
          </>
        ) : (
          <span className="wg-sub">Nothing live</span>
        )}
      </div>
      {h > 1 && main?.current && (
        <div className="wg-presenter-text">
          <span className="wg-group">{main.current.group}</span>
          <p>{main.current.text}</p>
          {h > 2 && main.next && <p className="wg-next">Next: {main.next.text}</p>}
        </div>
      )}
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
      <div className="wg-presenter-buttons">
        <button className="btn wg-step" onClick={() => run(presenterApi.previous(target))} title="Previous slide">
          <ChevronLeft size={22} />
        </button>
        <button className="btn wg-step btn-primary" onClick={() => run(presenterApi.next(target))} title="Next slide">
          <ChevronRight size={22} />
        </button>
      </div>
      <button className="btn btn-small btn-danger wg-clear" onClick={() => run(presenterApi.clear(target))}>
        <Eraser size={13} /> Clear
      </button>
    </div>
  );
}

function PresenterSettings({ config, setConfig }: WidgetProps) {
  return (
    <div className="field">
      <label>Controls</label>
      <select className="select" value={str(config.target, "all")} onChange={(e) => setConfig({ target: e.target.value })}>
        <option value="all">Slides and announcements together</option>
        <option value="slides">Slides only</option>
        <option value="announcements">Announcements only</option>
      </select>
    </div>
  );
}

// ---------------- clear ----------------

function ClearWidget({ w }: WidgetProps) {
  // Single-layer buttons need two columns of width.
  const big = w >= 2;
  return (
    <div className={`wg-clear-grid${big ? " big" : ""}`}>
      <button className="btn btn-danger" onClick={() => run(liveApi.clear("all"))} title="Clear every visual layer">
        <Eraser size={15} /> Clear all
      </button>
      <button className="btn btn-live" onClick={() => run(liveApi.clear("everything"))} title="Clear every layer and stop audio">
        <X size={15} /> Clear everything
      </button>
      {big && (
        <>
          <button className="btn btn-small" onClick={() => run(presenterApi.clear("slides"))}>Slides</button>
          <button className="btn btn-small" onClick={() => run(presenterApi.clear("announcements"))}>Announcements</button>
          <button className="btn btn-small" onClick={() => run(mediaApi.clear("visual"))}>Media</button>
          <button className="btn btn-small" onClick={() => run(liveApi.setVideoInput(null))}>Video input</button>
          <button className="btn btn-small" onClick={() => run(liveApi.clearProps("props"))}>Props</button>
          <button className="btn btn-small" onClick={() => run(liveApi.clearProps("complements"))}>Complements</button>
          <button className="btn btn-small" onClick={() => run(mediaApi.clear("audio"))}>Audio</button>
        </>
      )}
    </div>
  );
}

// ---------------- songs ----------------

function SongRows({ items, liveId }: { items: { id: string; title: string; hint?: string }[]; liveId: string[] }) {
  return (
    <div className="wg-list">
      {items.map((p) => (
        <button
          key={p.id}
          className={`list-row${liveId.includes(p.id) ? " active" : ""}`}
          onClick={() => run(presenterApi.load({ presentation_id: p.id, index: 0 }))}
          title="Present from the first slide"
        >
          <span className="grow">{p.title}</span>
          {p.hint && <span className="muted small">{p.hint}</span>}
        </button>
      ))}
      {items.length === 0 && <div className="muted small wg-empty">Nothing here.</div>}
    </div>
  );
}

function PlaylistWidget({ config, setConfig }: WidgetProps) {
  const { data: playlists } = useLive(() => playlistApi.list());
  const id = str(config.playlistId) || playlists?.[0]?.id || "";
  const { data } = useLive(() => (id ? playlistApi.resolve(id) : Promise.resolve(null)), [id]);
  const { data: live } = useLive(() => presenterApi.getState());
  const liveIds = [live?.slides?.presentation_id, live?.announcements?.presentation_id].filter(Boolean) as string[];
  return (
    <div className="wg-column">
      <select className="select wg-select" value={id} onChange={(e) => setConfig({ playlistId: e.target.value })}>
        {(playlists ?? []).map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <SongRows liveId={liveIds} items={(data?.items ?? []).flatMap((i) => (i.missing ? [] : [{ id: i.summary.id, title: i.summary.title }]))} />
    </div>
  );
}

function LibraryWidget({ config, setConfig }: WidgetProps) {
  const { data: libraries } = useLive(() => libraryApi.listLibraries());
  const lib = str(config.libraryId);
  const { data } = useLive(() => (lib ? libraryApi.listPresentations(lib) : libraryApi.listAllPresentations()), [lib]);
  const { data: live } = useLive(() => presenterApi.getState());
  const [query, setQuery] = useState("");
  const results = useMemo(() => search(data ?? [], query, (p) => p.title).slice(0, 100), [data, query]);
  const liveIds = [live?.slides?.presentation_id, live?.announcements?.presentation_id].filter(Boolean) as string[];
  return (
    <div className="wg-column">
      <div className="wg-row">
        <label className="wg-search">
          <Search size={13} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" />
        </label>
        <select className="select wg-select" value={lib} onChange={(e) => setConfig({ libraryId: e.target.value })}>
          <option value="">All</option>
          {(libraries ?? []).map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>
      <SongRows liveId={liveIds} items={results.map((p) => ({ id: p.id, title: p.title, hint: lib ? undefined : p.library_name }))} />
    </div>
  );
}

function SlidesWidget({ w }: WidgetProps) {
  const { data: live } = useLive(() => presenterApi.getState());
  const state = live?.slides ?? null;
  const { data } = useLive(() => (state ? libraryApi.getSlides(state.presentation_id, state.arrangement) : Promise.resolve(null)), [state?.presentation_id, state?.arrangement]);
  if (!state) return <div className="wg-empty muted small">No presentation on the slides layer.</div>;
  return (
    <div className="wg-column">
      <span className="wg-sub" title={state.title}>{state.title}</span>
      <div className="wg-slides" style={{ gridTemplateColumns: `repeat(${Math.max(1, w - 1) + (w > 2 ? 1 : 0)}, minmax(0, 1fr))` }}>
        {(data?.slides ?? []).map((s, i) => (
          <button key={i} className={`wg-slide${i === state.slide_index ? " live" : ""}`} onClick={() => run(presenterApi.goto(i, "slides"))}>
            <span className="wg-slide-group">{i + 1} · {s.group}</span>
            <span className="wg-slide-text">{s.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------- screens ----------------

function PreviewWidget({ config, setConfig }: WidgetProps) {
  const { data: screens } = useLive(() => screensApi.list());
  const id = str(config.screenId) || screens?.[0]?.id || null;
  const { scene, offset } = useScene(id);
  return (
    <div className="wg-preview">
      <div className="wg-preview-canvas">{scene ? <SceneCanvas scene={scene} offset={offset} /> : <span className="muted small">No screen</span>}</div>
      <select className="select wg-select wg-preview-select" value={id ?? ""} onChange={(e) => setConfig({ screenId: e.target.value })}>
        {(screens ?? []).map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function VideoInputWidget({ h }: WidgetProps) {
  const { data: cams } = useLive(() => devicesApi.listVideo());
  const { data: live } = useLive(() => liveApi.get());
  const current = live?.video_input ?? null;
  return (
    <div className="wg-column">
      {current && h > 1 && <img className="wg-camera" src={cameraMjpegUrl(current)} alt="Live camera" />}
      <div className="wg-list">
        {(cams ?? []).map((c) => (
          <button key={c.id} className={`list-row${c.id === current ? " active" : ""}`} onClick={() => run(liveApi.setVideoInput(c.id === current ? null : c.id))}>
            <Video size={14} />
            <span className="grow">{c.name}</span>
            {c.id === current && <span className="badge-live" />}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------- audio ----------------

function AudioInputWidget({ config, setConfig }: WidgetProps) {
  const { data: view } = useLive(() => audioApi.get());
  const strip = view?.config.inputs.find((i) => i.id === config.inputId) ?? view?.config.inputs[0];
  if (!view) return null;
  if (!strip) return <div className="wg-empty muted small">Add an audio input in Inputs.</div>;
  return (
    <div className="wg-column">
      {view.config.inputs.length > 1 && (
        <select className="select wg-select" value={strip.id} onChange={(e) => setConfig({ inputId: e.target.value })}>
          {view.config.inputs.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
      )}
      <InputStripView strip={strip} view={view} compact />
    </div>
  );
}

function AudioOutputWidget({ config, setConfig }: WidgetProps) {
  const { data: view } = useLive(() => audioApi.get());
  const strip = view?.config.outputs.find((o) => o.id === config.outputId) ?? view?.config.outputs[0];
  if (!view) return null;
  if (!strip) return <div className="wg-empty muted small">Add an output in Outputs.</div>;
  return (
    <div className="wg-column">
      {view.config.outputs.length > 1 && (
        <select className="select wg-select" value={strip.id} onChange={(e) => setConfig({ outputId: e.target.value })}>
          {view.config.outputs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      )}
      <OutputStripView strip={strip} view={view} compact />
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
  });
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

function MediaPlaylistWidget({ config, setConfig }: WidgetProps) {
  const { data: playlists } = useLive(() => mediaApi.playlists());
  const { data: items } = useLive(() => mediaApi.list());
  const { player } = useServerOffset();
  const playlist = playlists?.find((p) => p.id === config.playlistId) ?? playlists?.[0];
  const names = new Map((items ?? []).map((m) => [m.id, m.name]));
  if (!playlist) return <div className="wg-empty muted small">Create a media playlist in Media.</div>;
  const slot: PlayerSlot = playlist.kind === "audio" ? "audio" : "visual";
  return (
    <div className="wg-column">
      <select className="select wg-select" value={playlist.id} onChange={(e) => setConfig({ playlistId: e.target.value })}>
        {(playlists ?? []).map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <div className="wg-list">
        {playlist.items.map((id, i) => {
          const playing = player?.[slot]?.playlist_id === playlist.id && player?.[slot]?.index === i;
          return (
            <button key={`${id}-${i}`} className={`list-row${playing ? " active" : ""}`} onClick={() => run(mediaApi.play(slot, { playlist_id: playlist.id, index: i }))}>
              {playing ? <Pause size={13} /> : <Play size={13} />}
              <span className="grow">{names.get(id) ?? "Missing"}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------- time ----------------

function ClockWidget({ config, w }: WidgetProps) {
  const now = useNow(500);
  return (
    <div className="wg-clock" style={{ fontSize: `${Math.min(3.2, 1.2 + w * 0.6)}rem` }}>
      {formatClock(new Date(now), str(config.format, "HH:mm:ss"))}
    </div>
  );
}

function TimersWidget({ h }: WidgetProps) {
  const { data: timers } = useLive(() => timersApi.list());
  const now = useNow(250);
  if (!timers?.length) return <div className="wg-empty muted small">Create timers in Settings → Timers.</div>;
  return (
    <div className="wg-list">
      {timers.slice(0, h * 3).map((t) => (
        <div key={t.id} className="wg-timer">
          <span className="grow" title={t.name}>{t.name}</span>
          <span className="wg-timer-value">{formatDuration(timerValue(t, now), "H:mm:ss")}</span>
          <button className="btn btn-icon btn-small" onClick={() => run(timersApi.action(t.id, t.running ? "pause" : "start"))}>
            {t.running ? <Pause size={12} /> : <Play size={12} />}
          </button>
          <button className="btn btn-icon btn-small" onClick={() => run(timersApi.action(t.id, "reset"))}>
            <RotateCcw size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------------- props ----------------

function PropsWidget({ config, setConfig }: WidgetProps) {
  const { data: collections } = useLive(() => themesApi.list("props"));
  const { data: live } = useLive(() => liveApi.get());
  const collection = collections?.find((c) => c.id === config.themeId) ?? collections?.[0];
  if (!collection) return <div className="wg-empty muted small">Create a props collection in Themes.</div>;
  const on = (layer: "props" | "complements", designId: string) =>
    (live?.[layer] ?? []).some((r) => r.theme_id === collection.id && r.design_id === designId);
  return (
    <div className="wg-column">
      {(collections?.length ?? 0) > 1 && (
        <select className="select wg-select" value={collection.id} onChange={(e) => setConfig({ themeId: e.target.value })}>
          {collections!.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
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

function StreamWidget() {
  const { data: status } = useLive(() => streamApi.status());
  const now = useNow(500);
  const running = !!status?.running;
  return (
    <div className="wg-stream">
      {running && status?.started_at_ms ? (
        <span className="badge-live">
          {status.streaming ? "LIVE" : "REC"} {formatDuration(now - status.started_at_ms, "H:mm:ss")}
        </span>
      ) : (
        <span className="muted small">{status?.error ? "Stopped with an error" : "Off air"}</span>
      )}
      <button className={`btn ${running ? "btn-danger" : "btn-live"}`} onClick={() => run(running ? streamApi.stop() : streamApi.start())}>
        {running ? <Square size={14} /> : <Radio size={15} />}
        {running ? "Stop" : "Go live"}
      </button>
    </div>
  );
}

// ---------------- registry ----------------

export const WIDGETS: WidgetDef[] = [
  { type: "presenter", title: "Presentation control", description: "Previous / next / clear with the slide number", icon: Presentation, size: [2, 2], render: (p) => <PresenterWidget {...p} />, settings: (p) => <PresenterSettings {...p} /> },
  { type: "clear", title: "Clear", description: "Clear all, clear everything, or single layers", icon: Eraser, size: [1, 2], render: (p) => <ClearWidget {...p} /> },
  { type: "playlist", title: "Playlist songs", description: "Present the songs of a playlist", icon: ListMusic, size: [2, 2], render: (p) => <PlaylistWidget {...p} /> },
  { type: "library", title: "Library songs", description: "Search libraries and present", icon: Music2, size: [2, 2], render: (p) => <LibraryWidget {...p} /> },
  { type: "slides", title: "Live slides", description: "Jump to any slide of the live presentation", icon: Layers, size: [2, 2], min: [1, 2], render: (p) => <SlidesWidget {...p} /> },
  { type: "preview", title: "Screen preview", description: "Watch any virtual screen", icon: MonitorPlay, size: [2, 2], render: (p) => <PreviewWidget {...p} /> },
  { type: "video-input", title: "Video input", description: "Put a camera on the video layer", icon: Video, size: [1, 2], render: (p) => <VideoInputWidget {...p} /> },
  { type: "audio-input", title: "Audio input", description: "Mute, fader and gain of an input", icon: AudioLines, size: [1, 2], min: [1, 2], render: (p) => <AudioInputWidget {...p} /> },
  { type: "audio-output", title: "Audio output", description: "Volume and mute of an output", icon: Speaker, size: [1, 2], min: [1, 2], render: (p) => <AudioOutputWidget {...p} /> },
  { type: "media", title: "Media player", description: "Scrub, pause, previous/next and clear", icon: Clapperboard, size: [2, 1], min: [2, 1], render: (p) => <MediaWidget {...p} /> },
  { type: "media-playlist", title: "Media playlist", description: "Play items of a media/audio playlist", icon: ListMusic, size: [2, 2], render: (p) => <MediaPlaylistWidget {...p} /> },
  { type: "props", title: "Props", description: "Toggle props and complements", icon: Shapes, size: [2, 2], render: (p) => <PropsWidget {...p} /> },
  { type: "timers", title: "Timers", description: "Start, pause and reset timers", icon: Timer, size: [2, 1], render: (p) => <TimersWidget {...p} /> },
  { type: "clock", title: "Clock", description: "The current time", icon: Clock3, size: [1, 1], render: (p) => <ClockWidget {...p} />, settings: ({ config, setConfig }) => (
      <div className="field">
        <label>Format</label>
        <input className="input" value={str(config.format, "HH:mm:ss")} onChange={(e) => setConfig({ format: e.target.value })} />
      </div>
    ) },
  { type: "stream", title: "Stream", description: "Go live / stop with the elapsed time", icon: Radio, size: [1, 1], render: () => <StreamWidget /> },
];

export const widgetDef = (type: string) => WIDGETS.find((w) => w.type === type);
