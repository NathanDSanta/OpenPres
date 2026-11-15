import { useEffect, useRef, useState } from "react";
import { formatDb } from "@/lib/format";

/**
 * Fader law: 75% of the travel is 0 dB, the top is +10 dB, the bottom is -inf.
 * Below 0 dB the scale is logarithmic like a console fader.
 */
export function faderToDb(p: number): number {
  if (p <= 0.001) return -100;
  if (p >= 0.75) return ((p - 0.75) / 0.25) * 10;
  return -60 * Math.pow((0.75 - p) / 0.75, 1.5);
}

export function dbToFader(db: number): number {
  if (db <= -100) return 0;
  if (db >= 0) return 0.75 + (Math.min(db, 10) / 10) * 0.25;
  if (db <= -60) return 0.002;
  return 0.75 - 0.75 * Math.pow(-db / 60, 1 / 1.5);
}

/** Sends changes at most every `ms` while dragging, and the final value on release. */
function useThrottled(send: (v: number) => void, ms = 60) {
  const last = useRef(0);
  const pending = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return (value: number, final = false) => {
    pending.current = value;
    const now = performance.now();
    const flush = () => {
      if (pending.current !== null) {
        send(pending.current);
        pending.current = null;
        last.current = performance.now();
      }
    };
    if (final || now - last.current > ms) {
      if (timer.current) clearTimeout(timer.current);
      flush();
    } else if (!timer.current) {
      timer.current = setTimeout(() => {
        timer.current = null;
        flush();
      }, ms);
    }
  };
}

interface FaderProps {
  value: number;
  onChange: (db: number) => void;
  vertical?: boolean;
  disabled?: boolean;
}

const roundDb = (db: number) => Math.round(db * 10) / 10;

/**
 * A volume fader from -inf to +10 dB: drag, click, mouse wheel or arrow keys; double-click
 * resets to 0 dB. Drawn by hand (not a native range input) so it looks and fills the same
 * way in every webview: the coloured part always runs from -inf up to the handle.
 */
export function Fader({ value, onChange, vertical, disabled }: FaderProps) {
  const [local, setLocal] = useState(value);
  const dragging = useRef(false);
  const track = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!dragging.current) setLocal(value);
  }, [value]);
  const send = useThrottled(onChange);

  const set = (db: number, final = false) => {
    const v = roundDb(Math.max(-100, Math.min(10, db)));
    setLocal(v);
    send(v, final);
  };
  const fromPointer = (clientX: number, clientY: number) => {
    const r = track.current!.getBoundingClientRect();
    const p = vertical ? 1 - (clientY - r.top) / r.height : (clientX - r.left) / r.width;
    return faderToDb(Math.max(0, Math.min(1, p)));
  };
  /** Moves along the fader law, so steps feel even over the whole travel. */
  const nudge = (steps: number) => set(faderToDb(Math.max(0, Math.min(1, dbToFader(local) + steps * 0.01))), true);

  const pos = dbToFader(local) * 100;
  const unity = dbToFader(0) * 100;
  return (
    <div className={`fader${vertical ? " vertical" : ""}${disabled ? " disabled" : ""}`}>
      <div
        ref={track}
        className="fader-track"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label="Volume"
        aria-orientation={vertical ? "vertical" : "horizontal"}
        aria-valuemin={-100}
        aria-valuemax={10}
        aria-valuenow={local}
        aria-valuetext={formatDb(local)}
        title="Double-click for 0 dB"
        onPointerDown={(e) => {
          if (disabled || e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          e.currentTarget.focus();
          dragging.current = true;
          set(fromPointer(e.clientX, e.clientY));
        }}
        onPointerMove={(e) => dragging.current && set(fromPointer(e.clientX, e.clientY))}
        onPointerUp={(e) => {
          if (!dragging.current) return;
          dragging.current = false;
          set(fromPointer(e.clientX, e.clientY), true);
        }}
        onPointerCancel={() => (dragging.current = false)}
        onDoubleClick={() => !disabled && set(0, true)}
        onWheel={(e) => {
          if (disabled) return;
          nudge(e.deltaY < 0 ? 2 : -2);
        }}
        onKeyDown={(e) => {
          if (disabled) return;
          const up = vertical ? "ArrowUp" : "ArrowRight";
          const down = vertical ? "ArrowDown" : "ArrowLeft";
          if (e.key === up || e.key === down || e.key === "Home" || e.key === "End" || e.key === "PageUp" || e.key === "PageDown") {
            e.preventDefault();
            e.stopPropagation();
          }
          if (e.key === up) nudge(e.shiftKey ? 5 : 1);
          else if (e.key === down) nudge(e.shiftKey ? -5 : -1);
          else if (e.key === "PageUp") nudge(10);
          else if (e.key === "PageDown") nudge(-10);
          else if (e.key === "Home") set(0, true);
          else if (e.key === "End") set(-100, true);
        }}
      >
        <div className="fader-rail">
          <div className="fader-fill" style={vertical ? { height: `${pos}%` } : { width: `${pos}%` }} />
        </div>
        <div className="fader-unity" style={vertical ? { bottom: `${unity}%` } : { left: `${unity}%` }} />
        <div className="fader-thumb" style={vertical ? { bottom: `${pos}%` } : { left: `${pos}%` }} />
      </div>
      <span className="fader-value">{formatDb(local)}</span>
    </div>
  );
}

interface KnobProps {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  label?: string;
  size?: number;
  defaultValue?: number;
}

/** A rotary knob (drag up/down, wheel, double-click to reset), like a console gain pot. */
export function Knob({ value, min, max, onChange, label = "Gain", size = 44, defaultValue = 0 }: KnobProps) {
  const [local, setLocal] = useState(value);
  const drag = useRef<{ y: number; v: number } | null>(null);
  useEffect(() => {
    if (!drag.current) setLocal(value);
  }, [value]);
  const send = useThrottled(onChange);
  const set = (v: number, final = false) => {
    const clamped = Math.round(Math.max(min, Math.min(max, v)) * 2) / 2;
    setLocal(clamped);
    send(clamped, final);
  };
  const t = (local - min) / (max - min);
  const angle = -135 + t * 270;
  const r = size / 2 - 4;
  const arc = (a: number) => {
    const rad = ((a - 90) * Math.PI) / 180;
    return [size / 2 + Math.cos(rad) * r, size / 2 + Math.sin(rad) * r];
  };
  const [sx, sy] = arc(-135);
  const [ex, ey] = arc(angle);
  return (
    <div
      className="knob"
      title={`${label}: double-click to reset, drag or scroll to change`}
      onPointerDown={(e) => {
        (e.target as Element).setPointerCapture?.(e.pointerId);
        drag.current = { y: e.clientY, v: local };
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        set(drag.current.v + ((drag.current.y - e.clientY) / 150) * (max - min));
      }}
      onPointerUp={() => {
        drag.current = null;
        set(local, true);
      }}
      onWheel={(e) => set(local - Math.sign(e.deltaY), true)}
      onDoubleClick={() => set(defaultValue, true)}
      role="slider"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={local}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp" || e.key === "ArrowRight") set(local + 1, true);
        if (e.key === "ArrowDown" || e.key === "ArrowLeft") set(local - 1, true);
      }}
    >
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="#0d0d12" stroke="var(--border)" strokeWidth="2" />
        <path
          d={`M ${sx} ${sy} A ${r} ${r} 0 ${angle + 135 > 180 ? 1 : 0} 1 ${ex} ${ey}`}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <line x1={size / 2} y1={size / 2} x2={ex} y2={ey} stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span className="knob-label">
        {label} {local > 0 ? "+" : ""}
        {local.toFixed(1)}
      </span>
    </div>
  );
}

const toPercent = (peak: number) => {
  if (peak <= 0.0001) return 0;
  const db = 20 * Math.log10(peak);
  return Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
};

/** Stereo peak meter (values 0..1). `length` "fill" stretches it to its container. */
export function Meter({ levels, vertical = true, length = 100 }: { levels?: [number, number]; vertical?: boolean; length?: number | "fill" }) {
  const [l, r] = levels ?? [0, 0];
  const fill = length === "fill";
  const size = fill ? "100%" : `${length}px`;
  const bar = (v: number, key: string) => (
    <div key={key} className="meter-bar" style={vertical ? { width: 6, height: size } : { height: 6, width: size }}>
      <div
        className="meter-fill"
        style={vertical ? { height: `${toPercent(v)}%`, ["--meter-size" as string]: fill ? "100%" : size } : { width: `${toPercent(v)}%` }}
      />
    </div>
  );
  return (
    <div className={`meter${vertical ? "" : " horizontal"}${fill ? " fill" : ""}`} style={vertical ? {} : { flexDirection: "column" }}>
      {[bar(l, "l"), bar(r, "r")]}
    </div>
  );
}
