import { useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  Film,
  FolderPlus,
  Image as ImageIcon,
  MonitorUp,
  MoreHorizontal,
  Music2,
  Pencil,
  Play,
  Plus,
  Search,
  Settings2,
  Trash2,
  Upload,
  Video,
} from "lucide-react";
import { cameraMjpegUrl, devicesApi, liveApi, markChanged, mediaApi, screensApi, useLive } from "@/api";
import { audioApi } from "@/api/audio";
import { mediaUrl } from "@/api/server";
import Transport from "@/components/media/Transport";
import { ImportFolderDialog, ImportProgress, MEDIA_ACCEPT, importFiles } from "@/components/global/MediaImporter";
import Modal from "@/components/ui/Modal";
import Select from "@/components/ui/Select";
import { useMenu, divider, type MenuEntry } from "@/components/ui/Menu";
import { formatBytes, formatDuration } from "@/lib/format";
import { search } from "@/lib/search";
import { notifyError, useDialogs } from "@/state/Dialogs";
import { END_ACTION_LABELS, type EndAction, type MediaItem, type MediaKind, type MediaPlaylist, type PlaylistKind, type ScreenBackground, type ScreenView, type VideoInput } from "@/types";
import "@/styles/Media.css";

const KINDS: { kind: PlaylistKind; label: string; icon: typeof Film }[] = [
  { kind: "image", label: "Pictures", icon: ImageIcon },
  { kind: "video", label: "Videos", icon: Film },
  { kind: "audio", label: "Audio", icon: Music2 },
];
const KIND_ICON: Record<MediaKind, typeof Film> = { image: ImageIcon, video: Film, audio: Music2 };
const ITEM_DRAG = "application/x-openpres-media";

export function screenInput(screen: ScreenView) {
  const { id: _id, display_id: _d, display_connected: _c, ...input } = screen;
  return input;
}

/** Makes a picture/video (or a whole folder) the background of a virtual screen. */
export async function setScreenBackground(screen: ScreenView, background: ScreenBackground) {
  await screensApi.update(screen.id, { ...screenInput(screen), background });
  markChanged();
}

function Thumb({ item }: { item: MediaItem }) {
  const Icon = KIND_ICON[item.kind];
  if (item.kind === "image") return <img className="media-thumb" src={mediaUrl(item.id)} alt="" loading="lazy" crossOrigin="anonymous" draggable={false} />;
  if (item.kind === "video") return <video className="media-thumb" src={`${mediaUrl(item.id)}#t=0.5`} muted preload="metadata" crossOrigin="anonymous" />;
  return (
    <div className="media-thumb media-thumb-icon">
      <Icon size={26} />
    </div>
  );
}

function FolderSettings({ folder, busNames, onSave }: { folder: MediaPlaylist; busNames: string[]; onSave: (p: MediaPlaylist) => void }) {
  return (
    <div className="media-folder-settings">
      <div className="field">
        <label>When an item ends</label>
        <Select value={folder.end_action} options={Object.entries(END_ACTION_LABELS).map(([value, label]) => ({ value: value as EndAction, label }))} onChange={(end_action) => onSave({ ...folder, end_action })} />
      </div>
      {folder.kind !== "image" && (
        <>
          <div className="field">
            <label>Audio to bus</label>
            <Select value={String(folder.bus)} options={busNames.map((n, i) => ({ value: String(i + 1), label: `${i + 1}. ${n}` }))} onChange={(v) => onSave({ ...folder, bus: Number(v) })} />
          </div>
          <div className="field">
            <label>Channels</label>
            <Select
              value={folder.mono ? "mono" : "stereo"}
              options={[
                { value: "stereo", label: "Stereo" },
                { value: "mono", label: "Mono (L+R)" },
              ]}
              onChange={(v) => onSave({ ...folder, mono: v === "mono" })}
            />
          </div>
        </>
      )}
      {folder.kind !== "audio" && (
        <div className="field">
          <label>Fit</label>
          <Select
            value={folder.fit}
            options={[
              { value: "cover", label: "Fill (crop)" },
              { value: "contain", label: "Fit (letterbox)" },
              { value: "stretch", label: "Stretch" },
            ]}
            onChange={(fit) => onSave({ ...folder, fit })}
          />
        </div>
      )}
      {folder.kind === "image" && (
        <div className="field">
          <label>Seconds per picture (0 = manual)</label>
          <input className="input" type="number" min={0} value={folder.image_seconds} onChange={(e) => onSave({ ...folder, image_seconds: Math.max(0, Number(e.target.value) || 0) })} />
        </div>
      )}
    </div>
  );
}

// ---------------- video inputs ----------------

function VideoInputDialog({ input, onClose }: { input: VideoInput | null; onClose: () => void }) {
  const { data: devices, reload } = useLive(() => devicesApi.listVideo());
  const [draft, setDraft] = useState<Omit<VideoInput, "id"> & { id?: string }>(input ?? { name: "", device_id: "", width: 1280, height: 720, fps: 30 });
  const device = devices?.find((d) => d.id === draft.device_id);
  const resolutions = device?.resolutions?.length ? device.resolutions : ([[1920, 1080], [1280, 720], [640, 480]] as [number, number][]);
  const save = async () => {
    try {
      if (input) await devicesApi.updateInput({ ...draft, id: input.id } as VideoInput);
      else await devicesApi.createInput({ ...draft, name: draft.name.trim() || device?.name || "Camera" });
      markChanged();
      onClose();
    } catch (e) {
      notifyError(e);
    }
  };
  return (
    <Modal
      title={input ? `${input.name}` : "Add video input"}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={() => void devicesApi.refresh().then(reload)}>
            Refresh devices
          </button>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!draft.device_id} onClick={() => void save()}>
            {input ? "Save" : "Add"}
          </button>
        </>
      }
    >
      <div className="dialog-split narrow">
        <div className="dialog-preview">
          <div className="video-input-preview">{draft.device_id ? <img src={cameraMjpegUrl(draft.device_id)} alt="" /> : <Camera size={28} />}</div>
        </div>
        <div className="form-stack">
          <div className="field">
            <label>Name</label>
            <input className="input" value={draft.name} placeholder={device?.name ?? "Camera 1"} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </div>
          <div className="field">
            <label>Device</label>
            <Select value={draft.device_id} placeholder="Choose a camera or capture card" options={(devices ?? []).map((d) => ({ value: d.id, label: d.name }))} onChange={(device_id) => setDraft({ ...draft, device_id })} />
          </div>
          <div className="field-row">
            <div className="field">
              <label>Resolution</label>
              <Select
                value={`${draft.width}x${draft.height}`}
                options={[...new Map(resolutions.map(([w, h]) => [`${w}x${h}`, { value: `${w}x${h}`, label: `${w} × ${h}` }])).values()]}
                onChange={(v) => {
                  const [width, height] = v.split("x").map(Number);
                  setDraft({ ...draft, width, height });
                }}
              />
            </div>
            <div className="field">
              <label>Frame rate</label>
              <Select value={String(draft.fps)} options={[15, 24, 25, 30, 50, 60].map((f) => ({ value: String(f), label: `${f} fps` }))} onChange={(v) => setDraft({ ...draft, fps: Number(v) })} />
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function VideoInputs() {
  const { data: inputs } = useLive(() => devicesApi.inputs());
  const { data: live } = useLive(() => liveApi.get());
  const [editing, setEditing] = useState<VideoInput | "new" | null>(null);
  const { confirm } = useDialogs();
  return (
    <div className="media-inputs">
      <div className="media-inputs-grid">
        {(inputs ?? []).map((input) => {
          const on = live?.video_input === input.device_id;
          return (
            <article
              key={input.id}
              className={`media-input${on ? " live" : ""}`}
              onDoubleClick={() => void liveApi.setVideoInput(on ? null : input.device_id).then(markChanged).catch(notifyError)}
              title="Double-click to show it on the video input layer"
            >
              <div className="media-input-frame">
                <img src={cameraMjpegUrl(input.device_id)} alt="" />
                {on && <span className="media-live-badge">LIVE</span>}
              </div>
              <footer>
                <Video size={14} />
                <span className="grow">{input.name}</span>
                <span className="muted small">
                  {input.height}p{input.fps}
                </span>
                <button className="icon-btn" onClick={() => setEditing(input)} title="Settings">
                  <Settings2 size={14} />
                </button>
                <button
                  className="icon-btn"
                  title="Remove"
                  onClick={() =>
                    void confirm({ title: `Remove “${input.name}”?`, confirmLabel: "Remove", danger: true }).then((ok) => {
                      if (ok) void devicesApi.removeInput(input.id).then(markChanged).catch(notifyError);
                    })
                  }
                >
                  <Trash2 size={14} />
                </button>
              </footer>
            </article>
          );
        })}
        <button className="media-input add" onClick={() => setEditing("new")}>
          <Plus size={20} />
          <span>Add input</span>
        </button>
      </div>
      {editing && <VideoInputDialog input={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

// ---------------- page ----------------

type Selection = { type: "folder"; id: string } | { type: "inputs" };

export default function Media() {
  const { data: items } = useLive(() => mediaApi.list());
  const { data: folders } = useLive(() => mediaApi.playlists());
  const { data: audio } = useLive(() => audioApi.get());
  const { data: screens } = useLive(() => screensApi.list());
  const { prompt, confirm } = useDialogs();
  const menu = useMenu();
  const sentAt = useRef(0);
  const [offset, setOffset] = useState(0);
  const { data: player } = useLive(async () => {
    sentAt.current = Date.now();
    const p = await mediaApi.player();
    setOffset(p.now_ms - (sentAt.current + Date.now()) / 2);
    return p;
  });
  const [selection, setSelection] = useState<Selection | null>(null);
  const [query, setQuery] = useState("");
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [pending, setPending] = useState<File[] | null>(null);
  const [jobs, setJobs] = useState<{ name: string; progress: number; error?: string }[]>([]);
  const [dropFolder, setDropFolder] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const byId = useMemo(() => new Map((items ?? []).map((m) => [m.id, m])), [items]);
  const folder = selection?.type === "folder" ? (folders ?? []).find((f) => f.id === selection.id) ?? null : null;
  useEffect(() => {
    if (!selection && folders?.length) setSelection({ type: "folder", id: folders[0].id });
    if (selection?.type === "folder" && folders && !folders.some((f) => f.id === selection.id)) setSelection(folders[0] ? { type: "folder", id: folders[0].id } : null);
  }, [folders, selection]);

  const act = (p: Promise<unknown>) => void p.then(markChanged).catch(notifyError);
  const busNames = (audio?.config.buses ?? []).map((b) => b.name);

  const newFolder = async (kind: PlaylistKind) => {
    const name = await prompt({ title: `New ${KINDS.find((k) => k.kind === kind)!.label.toLowerCase()} folder`, label: "Folder name", confirmLabel: "Create" });
    if (!name) return;
    act(
      mediaApi
        .createPlaylist({ name, kind, items: [], end_action: kind === "audio" ? "next" : "loop_all", bus: 1, mono: false, fit: "cover", image_seconds: kind === "image" ? 8 : 0 })
        .then((p) => setSelection({ type: "folder", id: p.id })),
    );
  };

  const play = (item: MediaItem) => {
    const containing = (folders ?? []).find((f) => f.items.includes(item.id));
    const slot = item.kind === "audio" ? "audio" : "visual";
    act(containing ? mediaApi.play(slot, { playlist_id: containing.id, media_id: item.id }) : mediaApi.play(slot, { media_id: item.id }));
  };

  const backgroundMenu = (bg: (fit: "cover") => ScreenBackground): MenuEntry[] =>
    (screens ?? []).length
      ? (screens ?? []).map((s) => ({ key: s.id, label: s.name, icon: <MonitorUp size={13} />, onSelect: () => void setScreenBackground(s, bg("cover")).catch(notifyError) }))
      : [{ key: "none", label: "No virtual screens yet", disabled: true }];

  const itemMenu = (item: MediaItem): MenuEntry[] => [
    { key: "play", label: item.kind === "audio" ? "Play" : "Show on the media layer", icon: <Play size={13} />, onSelect: () => play(item) },
    ...(item.kind !== "audio" ? [{ key: "bg", label: "Set as screen background", icon: <MonitorUp size={13} />, children: backgroundMenu((fit) => ({ type: "media", media_id: item.id, fit })) }] : []),
    {
      key: "move",
      label: "Move to folder",
      children: (folders ?? [])
        .filter((f) => f.kind === item.kind)
        .map((f) => ({ key: f.id, label: f.name, checked: f.items.includes(item.id), onSelect: () => act(mediaApi.move(item.id, f.id)) })),
    },
    {
      key: "rename",
      label: "Rename",
      icon: <Pencil size={13} />,
      onSelect: () => void prompt({ title: "Rename", value: item.name, confirmLabel: "Rename" }).then((name) => name && act(mediaApi.rename(item.id, name))),
    },
    divider("d"),
    {
      key: "delete",
      label: "Delete",
      danger: true,
      icon: <Trash2 size={13} />,
      onSelect: () => void confirm({ title: `Delete “${item.name}”?`, message: "The file is removed from OpenPres.", confirmLabel: "Delete", danger: true }).then((ok) => ok && act(mediaApi.remove(item.id))),
    },
  ];

  const folderMenu = (f: MediaPlaylist): MenuEntry[] => [
    { key: "play", label: "Play folder", icon: <Play size={13} />, onSelect: () => act(mediaApi.play(f.kind === "audio" ? "audio" : "visual", { playlist_id: f.id })) },
    ...(f.kind !== "audio"
      ? [{ key: "bg", label: f.kind === "image" ? "Cycle as screen background" : "Play as screen background", icon: <MonitorUp size={13} />, children: backgroundMenu((fit) => ({ type: "folder", folder_id: f.id, fit, seconds: f.image_seconds || 10 })) }]
      : []),
    { key: "rename", label: "Rename", icon: <Pencil size={13} />, onSelect: () => void prompt({ title: "Rename folder", value: f.name, confirmLabel: "Rename" }).then((name) => name && act(mediaApi.updatePlaylist({ ...f, name }))) },
    divider("d"),
    {
      key: "delete",
      label: "Delete folder",
      danger: true,
      icon: <Trash2 size={13} />,
      onSelect: () =>
        void confirm({ title: `Delete “${f.name}”?`, message: `The folder and its ${f.items.length} file${f.items.length === 1 ? "" : "s"} are removed from OpenPres.`, confirmLabel: "Delete", danger: true }).then(
          (ok) => ok && act(mediaApi.removePlaylist(f.id)),
        ),
    },
  ];

  const visible = folder ? search(folder.items.map((id) => byId.get(id)).filter(Boolean) as MediaItem[], query, (m) => m.name) : [];
  const reorder = (id: string, before: string | null) => {
    if (!folder) return;
    const rest = folder.items.filter((x) => x !== id);
    const at = before ? rest.indexOf(before) : rest.length;
    rest.splice(at < 0 ? rest.length : at, 0, id);
    act(mediaApi.updatePlaylist({ ...folder, items: rest }));
  };

  return (
    <section className="page media-page">
      <div className="media-layout">
        <aside className="panel media-side">
          {KINDS.map(({ kind, label, icon: Icon }) => (
            <div key={kind} className="media-side-group">
              <h3 className="section-title">
                <span>{label}</span>
                <button className="icon-btn" onClick={() => void newFolder(kind)} title={`New ${label.toLowerCase()} folder`}>
                  <FolderPlus size={14} />
                </button>
              </h3>
              {(folders ?? [])
                .filter((f) => f.kind === kind)
                .map((f) => (
                  <button
                    key={f.id}
                    className={`list-row${selection?.type === "folder" && selection.id === f.id ? " active" : ""}${dropFolder === f.id ? " drop-target" : ""}`}
                    onClick={() => setSelection({ type: "folder", id: f.id })}
                    onDoubleClick={() => act(mediaApi.play(f.kind === "audio" ? "audio" : "visual", { playlist_id: f.id }))}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      menu.open({ x: e.clientX, y: e.clientY }, folderMenu(f));
                    }}
                    onDragOver={(e) => {
                      if (!e.dataTransfer.types.includes(ITEM_DRAG) && !e.dataTransfer.types.includes("Files")) return;
                      e.preventDefault();
                      setDropFolder(f.id);
                    }}
                    onDragLeave={() => setDropFolder(null)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDropFolder(null);
                      const id = e.dataTransfer.getData(ITEM_DRAG);
                      if (id) {
                        if (byId.get(id)?.kind !== f.kind) return notifyError(new Error("That folder holds another kind of media."));
                        return act(mediaApi.move(id, f.id));
                      }
                      const files = Array.from(e.dataTransfer.files);
                      if (files.length) void importFiles(files, { [f.kind]: { id: f.id } }, setJobs);
                    }}
                    title="Double-click to play the folder"
                  >
                    <Icon size={14} />
                    <span className="grow">{f.name}</span>
                    <span className="muted small">{f.items.length}</span>
                  </button>
                ))}
              {!(folders ?? []).some((f) => f.kind === kind) && <span className="muted small media-side-empty">No folders</span>}
            </div>
          ))}
          <div className="media-side-group">
            <h3 className="section-title">
              <span>Video inputs</span>
            </h3>
            <button className={`list-row${selection?.type === "inputs" ? " active" : ""}`} onClick={() => setSelection({ type: "inputs" })}>
              <Camera size={14} />
              <span className="grow">Cameras & capture</span>
            </button>
          </div>
        </aside>

        <section className="panel media-main">
          {selection?.type === "inputs" ? (
            <>
              <header className="panel-header">
                <h2>
                  <Camera size={15} /> Video inputs
                </h2>
                <span className="muted small">Double-click an input to show it on the video input layer.</span>
              </header>
              <div className="panel-body">
                <VideoInputs />
              </div>
            </>
          ) : folder ? (
            <>
              <header className="panel-header">
                <h2>
                  {(() => {
                    const Icon = KINDS.find((k) => k.kind === folder.kind)!.icon;
                    return <Icon size={15} />;
                  })()}
                  {folder.name}
                </h2>
                <div className="page-actions">
                  <label className="media-search">
                    <Search size={14} />
                    <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" />
                  </label>
                  <button className={`icon-btn${showSettings ? " active" : ""}`} onClick={() => setShowSettings((s) => !s)} title="Folder settings">
                    <Settings2 size={15} />
                  </button>
                  <button className="icon-btn" onClick={(e) => menu.open(e.currentTarget, folderMenu(folder))} title="More">
                    <MoreHorizontal size={15} />
                  </button>
                  <input
                    ref={fileInput}
                    type="file"
                    multiple
                    hidden
                    accept={MEDIA_ACCEPT}
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? []);
                      e.target.value = "";
                      if (files.length) setPending(files);
                    }}
                  />
                  <button className="btn btn-small btn-primary" onClick={() => fileInput.current?.click()}>
                    <Upload size={14} /> Import
                  </button>
                </div>
              </header>
              {showSettings && <FolderSettings folder={folder} busNames={busNames} onSave={(p) => act(mediaApi.updatePlaylist(p))} />}
              <div
                className="panel-body media-grid"
                onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()}
                onDrop={(e) => {
                  if (!e.dataTransfer.files.length) return;
                  e.preventDefault();
                  setPending(Array.from(e.dataTransfer.files));
                }}
              >
                {visible.map((item) => {
                  const playing = player?.visual?.media_id === item.id || player?.audio?.media_id === item.id;
                  return (
                    <article
                      key={item.id}
                      className={`media-card${selectedItem === item.id ? " selected" : ""}${playing ? " playing" : ""}`}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData(ITEM_DRAG, item.id)}
                      onDragOver={(e) => e.dataTransfer.types.includes(ITEM_DRAG) && e.preventDefault()}
                      onDrop={(e) => {
                        const id = e.dataTransfer.getData(ITEM_DRAG);
                        if (id && id !== item.id) {
                          e.preventDefault();
                          e.stopPropagation();
                          reorder(id, item.id);
                        }
                      }}
                      onClick={() => setSelectedItem(item.id)}
                      onDoubleClick={() => play(item)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setSelectedItem(item.id);
                        menu.open({ x: e.clientX, y: e.clientY }, itemMenu(item));
                      }}
                      title={item.kind === "audio" ? "Double-click to play" : "Double-click to show on the media layer"}
                    >
                      <Thumb item={item} />
                      {playing && <span className="media-live-badge">{item.kind === "audio" ? "PLAYING" : "LIVE"}</span>}
                      <div className="media-card-info">
                        <strong title={item.name}>{item.name}</strong>
                        <span>
                          {item.duration_ms ? formatDuration(item.duration_ms, "m:ss") + " · " : ""}
                          {formatBytes(item.size)}
                        </span>
                      </div>
                      <button
                        className="icon-btn media-card-more"
                        onClick={(e) => {
                          e.stopPropagation();
                          menu.open(e.currentTarget, itemMenu(item));
                        }}
                      >
                        <MoreHorizontal size={14} />
                      </button>
                    </article>
                  );
                })}
                {visible.length === 0 && (
                  <div className="empty media-empty">
                    {query ? "Nothing matches." : "This folder is empty. Import files or drop them here."}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="empty">Create a folder to import media.</div>
          )}
        </section>
      </div>

      <section className="media-players">
        <div className="panel media-player">
          <span className="section-title">
            <span>Media layer</span>
          </span>
          <Transport slot="visual" player={player} offset={offset} />
        </div>
        <div className="panel media-player">
          <span className="section-title">
            <span>Audio</span>
          </span>
          <Transport slot="audio" player={player} offset={offset} />
        </div>
      </section>

      {pending && (
        <ImportFolderDialog
          files={pending}
          preferred={folder?.id}
          onCancel={() => setPending(null)}
          onImport={(choice) => {
            const files = pending;
            setPending(null);
            void importFiles(files, choice, setJobs);
          }}
        />
      )}
      <ImportProgress jobs={jobs} onClose={() => setJobs([])} />
      {menu.element}
    </section>
  );
}
