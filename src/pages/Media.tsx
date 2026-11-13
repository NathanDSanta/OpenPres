import { useEffect, useMemo, useRef, useState } from "react";
import { Film, Image as ImageIcon, Music, Pencil, Play, Plus, Trash2, Upload, X } from "lucide-react";
import { markChanged, mediaApi, useLive } from "@/api";
import Transport from "@/components/media/Transport";
import { MEDIA_ACCEPT, importFiles } from "@/components/global/MediaImporter";
import { BusSelect } from "@/components/audio/Strips";
import { audioApi } from "@/api/audio";
import { formatBytes, formatDuration } from "@/lib/format";
import { search } from "@/lib/search";
import { mediaUrl } from "@/api/server";
import { END_ACTION_LABELS, type EndAction, type MediaItem, type MediaKind, type MediaPlaylist, type PlaylistKind } from "@/types";
import "@/styles/Media.css";

const KIND_ICON: Record<MediaKind, typeof Film> = { image: ImageIcon, video: Film, audio: Music };
const DRAG_TYPE = "application/x-openpres-media";

function Thumb({ item }: { item: MediaItem }) {
  const Icon = KIND_ICON[item.kind];
  if (item.kind === "image") return <img className="media-thumb" src={mediaUrl(item.id)} alt="" loading="lazy" crossOrigin="anonymous" />;
  if (item.kind === "video")
    return <video className="media-thumb" src={`${mediaUrl(item.id)}#t=0.5`} muted preload="metadata" crossOrigin="anonymous" />;
  return (
    <div className="media-thumb media-thumb-icon">
      <Icon size={22} />
    </div>
  );
}

function PlaylistSettings({ playlist, busNames, onSave }: { playlist: MediaPlaylist; busNames: string[]; onSave: (p: MediaPlaylist) => void }) {
  return (
    <div className="field-row">
      <div className="field">
        <label>When an item ends</label>
        <select className="select" value={playlist.end_action} onChange={(e) => onSave({ ...playlist, end_action: e.target.value as EndAction })}>
          {Object.entries(END_ACTION_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Audio to bus</label>
        <BusSelect value={playlist.bus} names={busNames} onChange={(bus) => onSave({ ...playlist, bus })} />
      </div>
      <div className="field">
        <label>Channels</label>
        <select className="select" value={playlist.mono ? "mono" : "stereo"} onChange={(e) => onSave({ ...playlist, mono: e.target.value === "mono" })}>
          <option value="stereo">Stereo</option>
          <option value="mono">Mono (L+R)</option>
        </select>
      </div>
      {playlist.kind === "visual" && (
        <>
          <div className="field">
            <label>Fit</label>
            <select className="select" value={playlist.fit} onChange={(e) => onSave({ ...playlist, fit: e.target.value as MediaPlaylist["fit"] })}>
              <option value="cover">Fill (crop)</option>
              <option value="contain">Fit (letterbox)</option>
              <option value="stretch">Stretch</option>
            </select>
          </div>
          <div className="field">
            <label>Pictures stay (seconds, 0 = manual)</label>
            <input
              className="input"
              type="number"
              min={0}
              value={playlist.image_seconds}
              onChange={(e) => onSave({ ...playlist, image_seconds: Math.max(0, Number(e.target.value) || 0) })}
            />
          </div>
        </>
      )}
    </div>
  );
}

export default function Media() {
  const { data: items } = useLive(() => mediaApi.list());
  const { data: playlists } = useLive(() => mediaApi.playlists());
  const { data: audio } = useLive(() => audioApi.get());
  const sentAt = useRef(0);
  const [offset, setOffset] = useState(0);
  const { data: player } = useLive(async () => {
    sentAt.current = Date.now();
    const p = await mediaApi.player();
    setOffset(p.now_ms - (sentAt.current + Date.now()) / 2);
    return p;
  });
  const [filter, setFilter] = useState<MediaKind | "all">("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [jobs, setJobs] = useState<{ name: string; progress: number; error?: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const byId = useMemo(() => new Map((items ?? []).map((m) => [m.id, m])), [items]);
  const visible = search((items ?? []).filter((m) => filter === "all" || m.kind === filter), query, (m) => m.name);
  const playlist = (playlists ?? []).find((p) => p.id === selected) ?? null;
  useEffect(() => {
    if (!selected && playlists?.length) setSelected(playlists[0].id);
  }, [playlists, selected]);

  const act = (p: Promise<unknown>) =>
    void p.then(markChanged).catch((e) => setError(e instanceof Error ? e.message : String(e)));

  const savePlaylist = (p: MediaPlaylist) => act(mediaApi.updatePlaylist(p));

  const addToPlaylist = (item: MediaItem, at?: number) => {
    if (!playlist) return;
    const fits = playlist.kind === "audio" ? item.kind === "audio" : item.kind !== "audio";
    if (!fits) {
      setError(playlist.kind === "audio" ? "Only audio goes in an audio playlist." : "Audio goes in an audio playlist.");
      return;
    }
    const next = [...playlist.items];
    next.splice(at ?? next.length, 0, item.id);
    savePlaylist({ ...playlist, items: next });
  };

  const createPlaylist = (kind: PlaylistKind) =>
    act(
      mediaApi
        .createPlaylist({
          name: kind === "audio" ? "New audio playlist" : "New media playlist",
          kind,
          items: [],
          end_action: kind === "audio" ? "stop" : "next",
          bus: 1,
          mono: false,
          fit: "cover",
          image_seconds: 0,
        })
        .then((p) => setSelected(p.id)),
    );

  const play = (item: MediaItem) =>
    act(mediaApi.play(item.kind === "audio" ? "audio" : "visual", { media_id: item.id }));

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>Media</h1>
          <p>Imported pictures, videos and audio are copied into OpenPres, so they keep working if the originals move.</p>
        </div>
        <div className="page-actions">
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            accept={MEDIA_ACCEPT}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (files.length) void importFiles(files, playlist?.id, setJobs).then(markChanged);
            }}
          />
          <button className="btn btn-primary" onClick={() => fileInput.current?.click()}>
            <Upload size={15} /> Import{playlist ? ` into “${playlist.name}”` : ""}
          </button>
        </div>
      </header>
      {error && (
        <div className="alert alert-error" onClick={() => setError(null)}>
          {error}
        </div>
      )}
      {jobs.some((j) => j.progress < 1 && !j.error) && (
        <div className="alert alert-info">
          Importing {jobs.filter((j) => j.progress < 1).length} file(s)…{" "}
          {Math.round((jobs.reduce((s, j) => s + j.progress, 0) / jobs.length) * 100)}%
        </div>
      )}

      <div className="media-layout">
        <section className="card media-library">
          <div className="card-title">
            <span>Library</span>
            <div className="btn-group">
              {(["all", "image", "video", "audio"] as const).map((k) => (
                <button key={k} className={`btn btn-small${filter === k ? " btn-active" : ""}`} onClick={() => setFilter(k)}>
                  {k === "all" ? "All" : k === "image" ? "Pictures" : k === "video" ? "Videos" : "Audio"}
                </button>
              ))}
            </div>
          </div>
          <input className="input" placeholder="Search media" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="media-grid">
            {visible.length === 0 && <div className="empty">Nothing here yet. Use Import.</div>}
            {visible.map((item) => (
              <div
                key={item.id}
                className="media-card"
                draggable
                onDragStart={(e) => e.dataTransfer.setData(DRAG_TYPE, item.id)}
                onDoubleClick={() => play(item)}
                title="Double-click to play · drag into a playlist"
              >
                <Thumb item={item} />
                <div className="media-card-info">
                  <strong>{item.name}</strong>
                  <span>
                    {item.duration_ms ? formatDuration(item.duration_ms) : item.kind} · {formatBytes(item.size)}
                  </span>
                </div>
                <div className="media-card-actions">
                  <button className="btn btn-icon btn-small" title="Play" onClick={() => play(item)}>
                    <Play size={13} />
                  </button>
                  {playlist && (
                    <button className="btn btn-icon btn-small" title={`Add to ${playlist.name}`} onClick={() => addToPlaylist(item)}>
                      <Plus size={13} />
                    </button>
                  )}
                  <button
                    className="btn btn-icon btn-small"
                    title="Rename"
                    onClick={() => {
                      const name = prompt("New name", item.name);
                      if (name) act(mediaApi.rename(item.id, name));
                    }}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    className="btn btn-icon btn-small"
                    title="Delete"
                    onClick={() => confirm(`Delete “${item.name}” from OpenPres?`) && act(mediaApi.remove(item.id))}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="card media-playlists">
          <div className="card-title">
            <span>Playlists</span>
            <div className="page-actions">
              <button className="btn btn-small" onClick={() => createPlaylist("audio")}>
                <Plus size={13} /> Audio
              </button>
              <button className="btn btn-small" onClick={() => createPlaylist("visual")}>
                <Plus size={13} /> Pictures/videos
              </button>
            </div>
          </div>
          <div className="list media-playlist-list">
            {(playlists ?? []).map((p) => (
              <button key={p.id} className={`list-row${p.id === selected ? " active" : ""}`} onClick={() => setSelected(p.id)}>
                {p.kind === "audio" ? <Music size={15} /> : <Film size={15} />}
                <span className="grow">{p.name}</span>
                <span className="muted small">{p.items.length}</span>
              </button>
            ))}
          </div>
          {playlist && (
            <div
              className="media-playlist"
              onDragOver={(e) => e.dataTransfer.types.includes(DRAG_TYPE) && e.preventDefault()}
              onDrop={(e) => {
                const id = e.dataTransfer.getData(DRAG_TYPE);
                const item = byId.get(id);
                if (item) addToPlaylist(item);
              }}
            >
              <div className="field-row">
                <div className="field">
                  <label>Name</label>
                  <input
                    className="input"
                    defaultValue={playlist.name}
                    key={playlist.id}
                    onBlur={(e) => e.target.value.trim() && e.target.value !== playlist.name && savePlaylist({ ...playlist, name: e.target.value.trim() })}
                  />
                </div>
              </div>
              <PlaylistSettings playlist={playlist} busNames={audio?.config.bus_names ?? []} onSave={savePlaylist} />
              <div className="media-playlist-items">
                {playlist.items.length === 0 && <div className="empty">Drag media here, or use + in the library.</div>}
                {playlist.items.map((id, index) => {
                  const item = byId.get(id);
                  const slot = playlist.kind === "audio" ? "audio" : "visual";
                  const isPlaying = player?.[slot]?.playlist_id === playlist.id && player?.[slot]?.index === index;
                  return (
                    <div
                      key={`${id}-${index}`}
                      className={`media-playlist-item${isPlaying ? " playing" : ""}`}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData("text/plain", String(index))}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        const from = Number(e.dataTransfer.getData("text/plain"));
                        if (!Number.isInteger(from) || e.dataTransfer.types.includes(DRAG_TYPE)) return;
                        e.stopPropagation();
                        const next = [...playlist.items];
                        const [moved] = next.splice(from, 1);
                        next.splice(index, 0, moved);
                        savePlaylist({ ...playlist, items: next });
                      }}
                      onDoubleClick={() => act(mediaApi.play(slot, { playlist_id: playlist.id, index }))}
                    >
                      <span className="muted small">{index + 1}</span>
                      <span className="grow">{item?.name ?? "Missing media"}</span>
                      <span className="muted small">{item?.duration_ms ? formatDuration(item.duration_ms) : item?.kind}</span>
                      <button className="btn btn-icon btn-small" title="Play from here" onClick={() => act(mediaApi.play(slot, { playlist_id: playlist.id, index }))}>
                        <Play size={13} />
                      </button>
                      <button
                        className="btn btn-icon btn-small"
                        title="Remove from playlist"
                        onClick={() => savePlaylist({ ...playlist, items: playlist.items.filter((_, i) => i !== index) })}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="page-actions" style={{ justifyContent: "space-between" }}>
                <button
                  className="btn btn-small btn-danger"
                  onClick={() => confirm(`Delete the playlist “${playlist.name}”? The media stays in the library.`) && act(mediaApi.removePlaylist(playlist.id).then(() => setSelected(null)))}
                >
                  <Trash2 size={13} /> Delete playlist
                </button>
                <button className="btn btn-small btn-primary" disabled={!playlist.items.length} onClick={() => act(mediaApi.play(playlist.kind === "audio" ? "audio" : "visual", { playlist_id: playlist.id }))}>
                  <Play size={13} /> Play playlist
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="media-players">
          <div className="card">
            <h2 className="card-title">Media layer (pictures & videos)</h2>
            <Transport slot="visual" player={player} offset={offset} />
          </div>
          <div className="card">
            <h2 className="card-title">Audio</h2>
            <Transport slot="audio" player={player} offset={offset} />
          </div>
          <p className="muted small">
            Video sound and audio files play on the bus set in their playlist (bus 1 when played from the library). Route buses to devices in Outputs.
          </p>
        </section>
      </div>
    </section>
  );
}
