import { useEffect, useRef, useState } from "react";
import { notifyError } from "@/state/Dialogs";
import { Pause, Play, SkipBack, SkipForward, Square } from "lucide-react";
import { markChanged, mediaApi } from "@/api";
import { Fader } from "@/components/ui/audio";
import { formatDuration } from "@/lib/format";
import { END_ACTION_LABELS, type PlayerSlot, type PlayerView } from "@/types";
import "./Transport.css";

/** Play/pause, scrub, previous/next and clear for one player slot. */
export default function Transport({
  slot,
  player,
  offset,
  compact,
  showVolume = true,
}: {
  slot: PlayerSlot;
  player: PlayerView | null;
  /** Server clock minus local clock. */
  offset: number;
  compact?: boolean;
  showVolume?: boolean;
}) {
  const state = player?.[slot] ?? null;
  const [now, setNow] = useState(Date.now());
  const [scrub, setScrub] = useState<number | null>(null);
  const scrubbing = useRef(false);

  useEffect(() => {
    if (!state?.playing) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [state?.playing]);

  const position = state
    ? state.playing
      ? state.position_ms + (now + offset - state.anchor_ms)
      : state.position_ms
    : 0;
  const duration = state?.duration_ms ?? (state?.kind === "image" && state.image_seconds ? state.image_seconds * 1000 : null);
  const shown = scrub ?? Math.min(position, duration ?? position);
  const act = (p: Promise<unknown>) => void p.then(markChanged).catch(notifyError);

  return (
    <div className={`transport${compact ? " compact" : ""}`}>
      <div className="transport-title">
        <strong>{state ? state.name : slot === "audio" ? "No audio playing" : "Nothing on the media layer"}</strong>
        {state && !compact && <span className="muted small">{END_ACTION_LABELS[state.end_action]} · bus {state.bus}</span>}
      </div>
      <div className="transport-scrub">
        <span>{formatDuration(shown)}</span>
        <input
          type="range"
          min={0}
          max={Math.max(1, duration ?? 1)}
          value={Math.min(shown, duration ?? 1)}
          disabled={!state || !duration}
          onPointerDown={() => (scrubbing.current = true)}
          onChange={(e) => setScrub(Number(e.target.value))}
          onPointerUp={() => {
            scrubbing.current = false;
            if (scrub !== null) act(mediaApi.seek(slot, scrub));
            setScrub(null);
          }}
          onKeyUp={() => {
            if (scrub !== null) act(mediaApi.seek(slot, scrub));
            setScrub(null);
          }}
          aria-label="Position"
        />
        <span>{duration ? formatDuration(duration) : "--:--"}</span>
      </div>
      <div className="transport-buttons">
        <button className="btn btn-icon" disabled={!state} onClick={() => act(mediaApi.previous(slot))} title="Previous (or restart)">
          <SkipBack size={16} />
        </button>
        <button className="btn btn-icon btn-primary" disabled={!state} onClick={() => act(mediaApi.toggle(slot))} title={state?.playing ? "Pause" : "Play"}>
          {state?.playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button className="btn btn-icon" disabled={!state} onClick={() => act(mediaApi.next(slot))} title="Next">
          <SkipForward size={16} />
        </button>
        <button className="btn btn-icon btn-danger" disabled={!state} onClick={() => act(mediaApi.clear(slot))} title="Clear">
          <Square size={14} />
        </button>
      </div>
      {showVolume && player && (slot === "audio" || state?.kind === "video") && (
        <Fader value={player.volumes[slot === "visual" ? 0 : 1]} onChange={(db) => act(mediaApi.volume(slot, db))} />
      )}
    </div>
  );
}
