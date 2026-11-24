import { BookOpen, Crown, Radio, ShieldCheck, type LucideIcon } from "lucide-react";

/**
 * Manager modes. Each shows only what that operator works with; the operator password opens
 * the first three, the admin password the Admin mode (which also has the general settings).
 */
export type Mode = "livestream" | "stage" | "all" | "admin";

export interface ModeInfo {
  id: Mode;
  name: string;
  description: string;
  icon: LucideIcon;
  /** The colour of the mode's circle in the top bar. */
  color: string;
}

export const MODES: ModeInfo[] = [
  { id: "livestream", name: "Livestream", description: "The stream: links, source, recording, cameras and sound", icon: Radio, color: "#E5484D" },
  { id: "stage", name: "Stage", description: "Presentations, screens, Bible and everything shown in the room", icon: BookOpen, color: "#3E8EED" },
  { id: "all", name: "Jack of all trades", description: "Everything an operator can do", icon: Crown, color: "#8B6FE0" },
  { id: "admin", name: "Admin", description: "Everything, including the general settings", icon: ShieldCheck, color: "#D9A23B" },
];

export const modeInfo = (mode: Mode) => MODES.find((m) => m.id === mode) ?? MODES[2];

/** What a mode works with. */
export type Area = "stream" | "stage" | "power" | "general";

const AREAS: Record<Mode, Area[]> = {
  livestream: ["stream"],
  stage: ["stage", "power"],
  all: ["stream", "stage", "power"],
  admin: ["stream", "stage", "power", "general"],
};

export const can = (mode: Mode, area: Area) => AREAS[mode].includes(area);

/** Which pages each mode has (paths of the sidebar). */
const PAGE_AREAS: Record<string, Area[]> = {
  "/": [],
  "/songs": ["stage"],
  "/reflow": ["stage"],
  "/bible": ["stage"],
  "/media": ["stage"],
  "/screens": ["stage"],
  "/audio": ["stage", "stream"],
  "/themes": ["stage"],
  "/timers": ["stage"],
  "/live": ["stream"],
  "/settings": [],
};

export function canOpen(mode: Mode, path: string): boolean {
  const key = Object.keys(PAGE_AREAS)
    .filter((p) => (p === "/" ? path === "/" : path === p || path.startsWith(`${p}/`)))
    .sort((a, b) => b.length - a.length)[0];
  if (key === undefined) return true;
  const areas = PAGE_AREAS[key];
  return areas.length === 0 || areas.some((a) => can(mode, a));
}

// ---------- remembered on this machine ----------

const MODE_KEY = "openpres.mode";

/** The mode used last on this machine (for this server). */
export function savedMode(): Mode | null {
  try {
    const m = localStorage.getItem(MODE_KEY);
    return MODES.some((x) => x.id === m) ? (m as Mode) : null;
  } catch {
    return null;
  }
}

let current: Mode | null = null;

/** Sent with every request (the server checks a few things by mode). */
export const currentMode = () => current;

export function setCurrentMode(mode: Mode | null) {
  current = mode;
  if (!mode) return;
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* private browsing */
  }
}

// ---------- the desktop manager ----------

const SHELL_KEY = "openpres.shell";

/**
 * In the desktop manager, the server's interface is opened from the manager's own page
 * (?shell=<its address>); "Switch server" goes back there.
 */
export function shellUrl(): string | null {
  try {
    const fromQuery = new URLSearchParams(window.location.search).get("shell");
    if (fromQuery) {
      sessionStorage.setItem(SHELL_KEY, fromQuery);
      const url = new URL(window.location.href);
      url.searchParams.delete("shell");
      window.history.replaceState(null, "", url.toString());
      return fromQuery;
    }
    return sessionStorage.getItem(SHELL_KEY);
  } catch {
    return null;
  }
}

export function switchServer() {
  const shell = shellUrl();
  if (shell) window.location.href = `${shell}/?switch=1`;
}

/** Which commands (keyboard shortcuts, command bar) a mode may run. */
const COMMAND_GROUP_AREAS: Record<string, Area[]> = {
  Presentation: ["stage"],
  Bible: ["stage"],
  Clear: ["stage"],
  Media: ["stage"],
  Props: ["stage"],
  Timers: ["stage"],
  Layers: ["stage", "stream"],
  Audio: ["stage", "stream"],
  Live: ["stream"],
};

const COMMAND_AREAS: Record<string, Area[]> = {
  "app.command-bar": ["stage"],
  "app.bible-search": ["stage"],
  "app.import-song": ["stage"],
  "app.import-media": ["stage"],
  "screens.refresh": ["stage"],
  "system.api-port": ["general"],
};

export function commandAllowed(mode: Mode, command: { id: string; group: string }): boolean {
  const areas = COMMAND_AREAS[command.id] ?? COMMAND_GROUP_AREAS[command.group];
  return !areas || areas.some((a) => can(mode, a));
}

/** Home widgets each mode can place. */
const WIDGET_AREAS: Record<string, Area[]> = {
  stream: ["stream"],
  preview: ["stage", "stream"],
  "video-input": ["stage", "stream"],
  bus: ["stage", "stream"],
  "audio-input": ["stage", "stream"],
  "audio-output": ["stage", "stream"],
  clock: ["stage", "stream"],
  "screen-presets": ["stage", "stream"],
  dashboards: ["stage", "stream"],
  // Each operator gets the collections that are theirs (the widget filters them).
  props: ["stage", "stream"],
};

export function widgetAllowed(mode: Mode, type: string): boolean {
  const areas = WIDGET_AREAS[type] ?? ["stage"];
  return areas.some((a) => can(mode, a));
}
