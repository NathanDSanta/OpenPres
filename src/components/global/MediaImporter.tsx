import { useEffect, useMemo, useRef, useState } from "react";
import { Film, Image as ImageIcon, Music2 } from "lucide-react";
import { markChanged, mediaApi } from "@/api";
import Modal from "@/components/ui/Modal";
import Select from "@/components/ui/Select";
import { useApp } from "@/state/AppContext";
import type { MediaKind, MediaPlaylist } from "@/types";
import "./styles/MediaImporter.css";

interface Job {
  name: string;
  progress: number;
  error?: string;
}

export const MEDIA_ACCEPT = "image/*,video/*,audio/*,.mkv,.flac,.opus,.m4a";

const EXT: Record<MediaKind, RegExp> = {
  image: /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i,
  video: /\.(mp4|m4v|mov|webm|mkv|ogv)$/i,
  audio: /\.(mp3|wav|ogg|oga|flac|m4a|aac|opus|aiff?)$/i,
};

export function kindOfFile(file: File): MediaKind | null {
  if (file.type.startsWith("image/") || EXT.image.test(file.name)) return "image";
  if (file.type.startsWith("video/") || EXT.video.test(file.name)) return "video";
  if (file.type.startsWith("audio/") || EXT.audio.test(file.name)) return "audio";
  return null;
}

const KIND_LABEL: Record<MediaKind, string> = { image: "Pictures", video: "Videos", audio: "Audio" };
const KIND_ICON = { image: ImageIcon, video: Film, audio: Music2 };

/** Folder for one kind: an existing folder id, or a name for a new one. */
export type FolderChoice = { id?: string; name?: string };

/** Imports files (copied into the data folder) into the chosen folder of each kind. */
export async function importFiles(files: File[], folders: Partial<Record<MediaKind, FolderChoice>>, onUpdate: (jobs: Job[]) => void) {
  const jobs: Job[] = files.map((f) => ({ name: f.name, progress: 0 }));
  onUpdate([...jobs]);
  for (let i = 0; i < files.length; i++) {
    const kind = kindOfFile(files[i]);
    if (!kind) {
      jobs[i].error = "Not a picture, video or audio file";
      onUpdate([...jobs]);
      continue;
    }
    try {
      await mediaApi.import(files[i], folders[kind], (p) => {
        jobs[i].progress = p;
        onUpdate([...jobs]);
      });
      jobs[i].progress = 1;
    } catch (err) {
      jobs[i].error = err instanceof Error ? err.message : String(err);
    }
    onUpdate([...jobs]);
  }
  markChanged();
  return jobs;
}

/** Choose the folder for each kind of file being imported. */
export function ImportFolderDialog({
  files,
  preferred,
  onCancel,
  onImport,
}: {
  files: File[];
  /** Pre-selected folder (e.g. the one open in the Media tab). */
  preferred?: string | null;
  onCancel: () => void;
  onImport: (folders: Partial<Record<MediaKind, FolderChoice>>) => void;
}) {
  const [folders, setFolders] = useState<MediaPlaylist[] | null>(null);
  const kinds = useMemo(() => [...new Set(files.map(kindOfFile).filter(Boolean) as MediaKind[])], [files]);
  const [choice, setChoice] = useState<Partial<Record<MediaKind, string>>>({});
  const [names, setNames] = useState<Partial<Record<MediaKind, string>>>({});

  useEffect(() => {
    void mediaApi.playlists().then((list) => {
      setFolders(list);
      const initial: Partial<Record<MediaKind, string>> = {};
      for (const k of kinds) {
        const pref = list.find((f) => f.id === preferred && f.kind === k);
        initial[k] = pref?.id ?? list.find((f) => f.kind === k)?.id ?? "new";
      }
      setChoice(initial);
    });
  }, [kinds, preferred]);

  const ready = kinds.every((k) => choice[k] && (choice[k] !== "new" || names[k]?.trim()));
  return (
    <Modal
      title={`Import ${files.length} file${files.length === 1 ? "" : "s"}`}
      onClose={onCancel}
      footer={
        <>
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!ready}
            onClick={() =>
              onImport(Object.fromEntries(kinds.map((k) => [k, choice[k] === "new" ? { name: names[k]!.trim() } : { id: choice[k] }])))
            }
          >
            Import
          </button>
        </>
      }
    >
      {!folders ? (
        <p className="muted">Loading folders…</p>
      ) : kinds.length === 0 ? (
        <p className="muted">None of these files is a picture, video or audio file.</p>
      ) : (
        <div className="import-kinds">
          <p className="muted small">Each folder holds one kind of media. Files are copied into OpenPres, so they keep working if the originals move.</p>
          {kinds.map((k) => {
            const Icon = KIND_ICON[k];
            const count = files.filter((f) => kindOfFile(f) === k).length;
            return (
              <div key={k} className="import-kind">
                <span className="import-kind-label">
                  <Icon size={15} /> {KIND_LABEL[k]} <span className="muted small">({count})</span>
                </span>
                <Select
                  value={choice[k] ?? ""}
                  options={[
                    ...folders.filter((f) => f.kind === k).map((f) => ({ value: f.id, label: f.name, hint: `${f.items.length}` })),
                    { value: "new", label: "New folder…" },
                  ]}
                  onChange={(v) => setChoice((c) => ({ ...c, [k]: v }))}
                />
                {choice[k] === "new" && (
                  <input className="input" autoFocus placeholder="Folder name" value={names[k] ?? ""} onChange={(e) => setNames((n) => ({ ...n, [k]: e.target.value }))} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

/** Progress of running imports. */
export function ImportProgress({ jobs, onClose }: { jobs: Job[]; onClose: () => void }) {
  const done = jobs.length > 0 && jobs.every((j) => j.progress >= 1 || j.error);
  useEffect(() => {
    if (!done || jobs.some((j) => j.error)) return;
    const t = setTimeout(onClose, 2500);
    return () => clearTimeout(t);
  }, [done, jobs, onClose]);
  if (!jobs.length) return null;
  return (
    <div className="import-toast">
      <div className="import-toast-title">
        {done ? "Import finished" : "Importing media…"}
        {done && (
          <button className="btn btn-small" onClick={onClose}>
            Close
          </button>
        )}
      </div>
      {jobs.map((job, i) => (
        <div key={i} className="import-job">
          <span>{job.name}</span>
          {job.error ? (
            <em className="import-error">{job.error}</em>
          ) : (
            <div className="import-bar">
              <div style={{ width: `${Math.round(job.progress * 100)}%` }} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** The global "Import media" button: pick files, choose folders, copy them in. */
export default function MediaImporter() {
  const { mediaImportRequest } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<File[] | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);

  useEffect(() => {
    if (mediaImportRequest > 0) input.current?.click();
  }, [mediaImportRequest]);

  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        accept={MEDIA_ACCEPT}
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) setPending(files);
        }}
      />
      {pending && (
        <ImportFolderDialog
          files={pending}
          onCancel={() => setPending(null)}
          onImport={(folders) => {
            const files = pending;
            setPending(null);
            void importFiles(files, folders, setJobs);
          }}
        />
      )}
      <ImportProgress jobs={jobs} onClose={() => setJobs([])} />
    </>
  );
}
