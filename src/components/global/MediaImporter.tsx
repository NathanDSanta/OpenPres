import { useEffect, useRef, useState } from "react";
import { mediaApi } from "@/api/media";
import { useApp } from "@/state/AppContext";
import "./styles/MediaImporter.css";

interface Job {
  name: string;
  progress: number;
  error?: string;
}

/** Imports files into the media library (copies them into the data folder). */
export async function importFiles(
  files: File[],
  playlistId: string | undefined,
  onUpdate: (jobs: Job[]) => void,
) {
  const jobs: Job[] = files.map((f) => ({ name: f.name, progress: 0 }));
  onUpdate([...jobs]);
  for (let i = 0; i < files.length; i++) {
    try {
      await mediaApi.import(files[i], playlistId, (p) => {
        jobs[i].progress = p;
        onUpdate([...jobs]);
      });
      jobs[i].progress = 1;
    } catch (err) {
      jobs[i].error = err instanceof Error ? err.message : String(err);
    }
    onUpdate([...jobs]);
  }
  return jobs;
}

export const MEDIA_ACCEPT = "image/*,video/*,audio/*,.mkv,.flac,.opus,.m4a";

/** The global "Import media" button target, with a small progress panel. */
export default function MediaImporter() {
  const { mediaImportRequest } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const [jobs, setJobs] = useState<Job[]>([]);

  useEffect(() => {
    if (mediaImportRequest > 0) input.current?.click();
  }, [mediaImportRequest]);

  const done = jobs.length > 0 && jobs.every((j) => j.progress >= 1 || j.error);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setJobs((j) => (j.some((x) => x.error) ? j : [])), 2500);
    return () => clearTimeout(t);
  }, [done]);

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
          if (files.length) void importFiles(files, undefined, setJobs);
        }}
      />
      {jobs.length > 0 && (
        <div className="import-toast">
          <div className="import-toast-title">
            {done ? "Import finished" : "Importing media…"}
            {done && (
              <button className="btn btn-small" onClick={() => setJobs([])}>
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
      )}
    </>
  );
}
