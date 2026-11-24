import { Download, FolderOpen, RefreshCw } from "lucide-react";
import { markChanged, serverApi, systemApi, useLive } from "@/api";
import { useManager } from "@/state/Manager";
import { Toggle } from "@/components/ui/Toggle";
import type { UpdateStatus } from "@/types";
import { formatBytes } from "@/lib/format";
import { notifyError } from "@/state/Dialogs";

const uptime = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
};

/** "Up to date", "0.4.0 is available", "Downloading… 40%"… with Check now / Update. */
function Updates({ status }: { status: UpdateStatus | null }) {
  if (!status) return <>…</>;
  if (!status.supported) return <span className="muted">A test build: it doesn't update itself.</span>;
  const check = () => void serverApi.checkUpdate().catch(notifyError);
  const install = () => void serverApi.installUpdate().catch(notifyError);
  let text: React.ReactNode;
  if (status.state === "checking") text = "Checking…";
  else if (status.state === "downloading")
    text = `Downloading the update…${status.total ? ` ${Math.round((100 * status.done) / status.total)}%` : ""}`;
  else if (status.state === "installing") text = "Installing the update: the server restarts…";
  else if (status.available && status.waiting) text = `OpenPres ${status.available.version} ${status.waiting}`;
  else if (status.available) text = `OpenPres ${status.available.version} is available`;
  else if (status.checked_at_ms) text = `Up to date (checked ${new Date(status.checked_at_ms).toLocaleString()})`;
  else text = "Not checked yet";
  return (
    <>
      {text}
      {status.error && status.state === "idle" && <span className="error-text"> · {status.error}</span>}
      {status.state === "idle" &&
        (status.available ? (
          <button className="btn btn-small btn-primary" onClick={install}>
            <Download size={13} /> Update
          </button>
        ) : (
          <button className="btn btn-small" onClick={check}>
            <RefreshCw size={13} /> Check now
          </button>
        ))}
    </>
  );
}

/** The admin's switch: new versions install by themselves when nothing is live. */
function AutomaticUpdates({ status }: { status: UpdateStatus | null }) {
  const { admin } = useManager();
  if (!status?.supported) return null;
  const set = (on: boolean) => void serverApi.update({ auto_update: on }).then(markChanged).catch(notifyError);
  return (
    <>
      <dt>Automatic updates</dt>
      <dd className="settings-toggle-fact">
        <label className="toggle-inline">
          <Toggle checked={status.automatic} onChange={set} disabled={!admin} title={admin ? undefined : "Only the admin changes this"} />
          <span>{status.automatic ? "On" : "Off"}</span>
        </label>
        <span className="muted small">
          {status.automatic
            ? "New versions install by themselves once nothing has been live for 5 minutes (no stream, recording, slides, Bible or media). The server restarts; managers reconnect."
            : "New versions are offered to the admin, who chooses when to update."}
        </span>
      </dd>
    </>
  );
}

/** Versions, paths and the state of the helpers (ffmpeg, audio, displays). */
export default function SystemInfo() {
  const { data: info, reload } = useLive(() => systemApi.info());
  const { data: updates } = useLive(() => serverApi.updateStatus(), [], ["update"]);
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
          <dt>Updates</dt>
          <dd className="settings-path">
            <Updates status={updates} />
          </dd>
          <AutomaticUpdates status={updates} />
          <dt>Running for</dt>
          <dd>{uptime(info.uptime_s)}</dd>
          <dt>Data folder</dt>
          <dd className="settings-path">
            <code>{info.data_dir}</code>
            <button className="btn btn-small" onClick={() => void systemApi.openDataFolder().catch(notifyError)}>
              <FolderOpen size={13} /> Open
            </button>
          </dd>
          <dt>Log files</dt>
          <dd className="settings-path">
            <code>{info.logs_dir}</code>
            <button className="btn btn-small" onClick={() => void systemApi.openLogsFolder().catch(notifyError)}>
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
