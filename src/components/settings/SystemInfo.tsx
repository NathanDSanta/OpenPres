import { FolderOpen, RefreshCw } from "lucide-react";
import { systemApi, useLive } from "@/api";
import { formatBytes } from "@/lib/format";
import { notifyError } from "@/state/Dialogs";

const uptime = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
};

/** Versions, paths and the state of the helpers (ffmpeg, audio, displays). */
export default function SystemInfo() {
  const { data: info, reload } = useLive(() => systemApi.info());
  if (!info) return <div className="empty">Loading…</div>;
  return (
    <div className="settings-stack">
      <section className="card">
        <h2 className="card-title">
          OpenPres {info.version}
          <button className="btn btn-small" onClick={reload}>
            <RefreshCw size={14} /> Refresh
          </button>
        </h2>
        <dl className="settings-facts">
          <dt>System</dt>
          <dd>
            {info.os} ({info.arch}), {info.cpus} cores
          </dd>
          <dt>Running for</dt>
          <dd>{uptime(info.uptime_s)}</dd>
          <dt>Data folder</dt>
          <dd className="settings-path">
            <code>{info.data_dir}</code>
            <button className="btn btn-small" onClick={() => void systemApi.openDataFolder().catch(notifyError)}>
              <FolderOpen size={13} /> Open
            </button>
          </dd>
          <dt>Server</dt>
          <dd>
            port {info.api_port}
            {info.remote_access ? ` · network access on${info.lan_ip ? ` (http://${info.lan_ip}:${info.api_port})` : ""}` : " · this computer only"}
          </dd>
          <dt>ffmpeg</dt>
          <dd>
            {info.ffmpeg.version ? (
              <>
                {info.ffmpeg.version.replace(/ Copyright.*$/, "")} <span className="muted">({info.ffmpeg.bundled ? "included with OpenPres" : info.ffmpeg.path})</span>
              </>
            ) : (
              <span className="error-text">{info.ffmpeg.error ?? "not found"}</span>
            )}
          </dd>
          <dt>Audio</dt>
          <dd>
            {info.audio_host || "—"}
            {info.open_audio_devices.length > 0 && ` · ${info.open_audio_devices.length} device(s) open`}
          </dd>
          <dt>Displays</dt>
          <dd>{info.displays}</dd>
          <dt>Library</dt>
          <dd>
            {info.presentations} presentations · {info.media.count} media files ({formatBytes(info.media.bytes)}) · {info.bibles} Bibles
          </dd>
        </dl>
      </section>
    </div>
  );
}
