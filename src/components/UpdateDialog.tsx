import type { ReactNode } from "react";
import { Download, Info, Loader2, Sparkles } from "lucide-react";
import "@/styles/Update.css";

export type UpdatePhase =
  | { step: "ready" }
  | { step: "downloading"; done: number; total: number | null }
  | { step: "installing" };

interface Props {
  /** e.g. "OpenPres 0.4.0 is available". */
  title: string;
  current: string;
  date?: string | null;
  notes: string;
  /** What else happens (the server restarts…). */
  note?: ReactNode;
  /** Shown while installing. */
  installing?: string;
  phase: UpdatePhase;
  error?: string | null;
  onUpdate: () => void;
  onLater: () => void;
}

/** The release notes, as GitHub writes them: "### New", "- Thing ([#12](…))". */
function Notes({ text }: { text: string }) {
  const lines = text
    .split("\n")
    .map((l) => l.trim().replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\*\*(.+?)\*\*/g, "$1"))
    .filter(Boolean);
  if (lines.length === 0) return null;
  return (
    <div className="update-notes">
      {lines.map((line, i) => {
        if (line.startsWith("#")) return <h4 key={i}>{line.replace(/^#+\s*/, "")}</h4>;
        if (/^[-*]\s/.test(line)) return <li key={i}>{line.slice(2)}</li>;
        return <p key={i}>{line}</p>;
      })}
    </div>
  );
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** "A new version is available": Update, or Remind me later. */
export default function UpdateDialog({
  title,
  current,
  date,
  notes,
  note,
  installing = "Installing… OpenPres opens again by itself.",
  phase,
  error,
  onUpdate,
  onLater,
}: Props) {
  const busy = phase.step !== "ready";
  const percent = phase.step === "downloading" && phase.total ? Math.min(100, (phase.done / phase.total) * 100) : null;
  return (
    <div className="modal-backdrop update-backdrop">
      <div className="update-dialog" role="dialog" aria-modal="true" aria-labelledby="update-title">
        <header className="update-head">
          <div className="update-icon">
            <Sparkles size={22} />
          </div>
          <div>
            <h2 id="update-title">{title}</h2>
            <p>
              You have {current}
              {date ? ` · released ${new Date(date).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}` : ""}
            </p>
          </div>
        </header>

        <Notes text={notes} />

        {note && (
          <p className="update-note">
            <Info size={14} /> <span>{note}</span>
          </p>
        )}

        {phase.step === "downloading" && (
          <div className="update-progress">
            <div className={`update-bar${percent === null ? " indeterminate" : ""}`}>
              <div style={{ width: percent === null ? undefined : `${percent}%` }} />
            </div>
            <small>
              Downloading…{" "}
              {phase.total ? `${mb(phase.done)} of ${mb(phase.total)}` : mb(phase.done)}
            </small>
          </div>
        )}
        {phase.step === "installing" && (
          <div className="update-progress">
            <div className="update-bar indeterminate">
              <div />
            </div>
            <small>{installing}</small>
          </div>
        )}
        {error && <div className="alert alert-error">The update didn't work: {error}</div>}

        <footer className="update-actions">
          <button className="btn" onClick={onLater} disabled={busy}>
            Remind me later
          </button>
          <button className="btn btn-primary" onClick={onUpdate} disabled={busy} autoFocus>
            {busy ? <Loader2 size={15} className="spin" /> : <Download size={15} />} {busy ? "Updating…" : error ? "Try again" : "Update"}
          </button>
        </footer>
      </div>
    </div>
  );
}
