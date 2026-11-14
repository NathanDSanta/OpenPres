import {
  audioApi,
  bibleApi,
  devicesApi,
  liveApi,
  mediaApi,
  presenterApi,
  screensApi,
  streamApi,
  systemApi,
  themesApi,
  timersApi,
} from "@/api";
import type { AudioView, MediaPlaylist, ScreenView, ThemeSummary, TimerView, VideoDevice } from "@/types";

/**
 * Everything the operator can do from the command bar or a keyboard shortcut. Every
 * command has a stable id, so shortcuts keep working across restarts.
 */
export interface CommandDef {
  id: string;
  title: string;
  group: string;
  hint?: string;
  keywords?: string;
  /** Commands that take a typed value, e.g. "Set API port 9000". */
  argument?: { prefix: string; placeholder: string };
  run: (arg?: string) => Promise<unknown> | void;
}

export interface CommandContext {
  navigate: (path: string) => void;
  openCommandBar: (mode: "present" | "command" | "bible") => void;
  openImport: () => void;
  importMedia: () => void;
}

export interface CommandData {
  audio: AudioView | null;
  props: ThemeSummary[];
  timers: TimerView[];
  folders: MediaPlaylist[];
  cameras: VideoDevice[];
  screens: ScreenView[];
}

export const PAGES = [
  { name: "Home", path: "/" },
  { name: "Songs", path: "/songs" },
  { name: "Reflow", path: "/reflow" },
  { name: "Bible", path: "/bible" },
  { name: "Media", path: "/media" },
  { name: "Screens", path: "/screens" },
  { name: "Audio", path: "/audio" },
  { name: "Themes", path: "/themes" },
  { name: "Timers", path: "/timers" },
  { name: "Live", path: "/live" },
  { name: "Settings", path: "/settings" },
];

export function staticCommands(ctx: CommandContext): CommandDef[] {
  return [
    { id: "app.command-bar", group: "App", title: "Open the command bar (present songs)", run: () => ctx.openCommandBar("present") },
    { id: "app.command-mode", group: "App", title: "Open the command bar (commands)", run: () => ctx.openCommandBar("command") },
    { id: "app.bible-search", group: "App", title: "Open the command bar (Bible)", run: () => ctx.openCommandBar("bible") },
    { id: "presenter.next", group: "Presentation", title: "Next slide / verse", hint: "slides or Bible, and announcements", run: () => presenterApi.next("all") },
    { id: "presenter.previous", group: "Presentation", title: "Previous slide / verse", hint: "slides or Bible, and announcements", run: () => presenterApi.previous("all") },
    { id: "presenter.next-slides", group: "Presentation", title: "Next slide (slides only)", run: () => presenterApi.next("slides") },
    { id: "presenter.previous-slides", group: "Presentation", title: "Previous slide (slides only)", run: () => presenterApi.previous("slides") },
    { id: "presenter.next-announcement", group: "Presentation", title: "Next announcement", run: () => presenterApi.next("announcements") },
    { id: "presenter.previous-announcement", group: "Presentation", title: "Previous announcement", run: () => presenterApi.previous("announcements") },
    { id: "bible.next", group: "Bible", title: "Next verse", run: () => bibleApi.next() },
    { id: "bible.previous", group: "Bible", title: "Previous verse", run: () => bibleApi.previous() },
    { id: "clear.slides", group: "Clear", title: "Clear slides", run: () => presenterApi.clear("slides") },
    { id: "clear.bible", group: "Clear", title: "Clear Bible", run: () => bibleApi.clear() },
    { id: "clear.announcements", group: "Clear", title: "Clear announcements", run: () => presenterApi.clear("announcements") },
    { id: "clear.media", group: "Clear", title: "Clear media", run: () => mediaApi.clear("visual") },
    { id: "clear.audio", group: "Clear", title: "Clear audio", run: () => mediaApi.clear("audio") },
    { id: "clear.video-input", group: "Clear", title: "Clear video input", run: () => liveApi.setVideoInput(null) },
    { id: "clear.props", group: "Clear", title: "Clear props", run: () => liveApi.clearProps("props") },
    { id: "clear.complements", group: "Clear", title: "Clear complements", run: () => liveApi.clearProps("complements") },
    { id: "clear.all", group: "Clear", title: "Clear all", hint: "every visual layer", run: () => liveApi.clear("all") },
    { id: "clear.everything", group: "Clear", title: "Clear everything", hint: "layers and audio", run: () => liveApi.clear("everything") },
    { id: "media.toggle", group: "Media", title: "Play / pause media", run: () => mediaApi.toggle("visual") },
    { id: "audio.toggle", group: "Media", title: "Play / pause audio", run: () => mediaApi.toggle("audio") },
    { id: "media.next", group: "Media", title: "Next media item", run: () => mediaApi.next("visual") },
    { id: "audio.next", group: "Media", title: "Next audio track", run: () => mediaApi.next("audio") },
    { id: "app.import-song", group: "App", title: "Import song", run: ctx.openImport },
    { id: "app.import-media", group: "App", title: "Import media", run: ctx.importMedia },
    { id: "stream.start", group: "Live", title: "Start stream", run: () => streamApi.start() },
    { id: "stream.stop", group: "Live", title: "Stop stream", run: () => streamApi.stop() },
    { id: "screens.refresh", group: "App", title: "Refresh displays", run: () => screensApi.refreshDisplays() },
    { id: "devices.refresh", group: "App", title: "Refresh devices", run: () => devicesApi.refresh() },
    { id: "audio.restart", group: "Audio", title: "Restart audio engine", run: () => audioApi.restart() },
    {
      id: "system.api-port",
      group: "App",
      title: "Set API port",
      argument: { prefix: "set api port", placeholder: "port number, e.g. 8787" },
      run: async (arg) => {
        const port = Number(arg);
        if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Enter a port between 1024 and 65535.");
        await systemApi.updateConfig({ api_port: port });
      },
    },
    {
      id: "presenter.goto",
      group: "Presentation",
      title: "Go to slide",
      argument: { prefix: "go to slide", placeholder: "slide number" },
      run: async (arg) => {
        const n = Number(arg);
        if (!Number.isInteger(n) || n < 1) throw new Error("Enter a slide number.");
        await presenterApi.goto(n - 1, "slides");
      },
    },
    {
      id: "bible.show",
      group: "Bible",
      title: "Show Bible passage",
      argument: { prefix: "bible", placeholder: "reference, e.g. Juan 3:16" },
      run: async (arg) => {
        if (!arg?.trim()) throw new Error("Type a reference, e.g. John 3:16.");
        await bibleApi.show({ query: arg });
      },
    },
    ...PAGES.map((p) => ({
      id: `nav.${p.path === "/" ? "home" : p.path.slice(1)}`,
      group: "Navigation",
      title: `Go to ${p.name}`,
      keywords: `open ${p.name} tab page`,
      run: () => ctx.navigate(p.path),
    })),
  ];
}

export function dynamicCommands(data: CommandData): CommandDef[] {
  const out: CommandDef[] = [];
  for (const [i, bus] of (data.audio?.config.buses ?? []).entries()) {
    const n = i + 1;
    out.push(
      { id: `bus.mute:${n}`, group: "Audio", title: `Mute ${bus.name}`, hint: `bus ${n}`, run: () => audioApi.setLevels(n, { muted: true }) },
      { id: `bus.unmute:${n}`, group: "Audio", title: `Unmute ${bus.name}`, hint: `bus ${n}`, run: () => audioApi.setLevels(n, { muted: false }) },
      {
        id: `bus.toggle-mute:${n}`,
        group: "Audio",
        title: `Mute / unmute ${bus.name}`,
        hint: `bus ${n}`,
        run: async () => {
          const view = await audioApi.get();
          await audioApi.setLevels(n, { muted: !view.config.buses[i]?.muted });
        },
      },
    );
  }
  for (const theme of data.props) {
    for (const design of theme.designs) {
      out.push(
        { id: `prop.toggle:${theme.id}:${design.id}`, group: "Props", title: `Toggle prop ${design.name}`, hint: theme.name, run: () => liveApi.setProp("props", theme.id, design.id) },
        { id: `complement.toggle:${theme.id}:${design.id}`, group: "Props", title: `Toggle complement ${design.name}`, hint: theme.name, run: () => liveApi.setProp("complements", theme.id, design.id) },
      );
    }
  }
  for (const timer of data.timers) {
    out.push(
      { id: `timer.start:${timer.id}`, group: "Timers", title: `Start timer ${timer.name}`, run: () => timersApi.action(timer.id, "start") },
      { id: `timer.pause:${timer.id}`, group: "Timers", title: `Pause timer ${timer.name}`, run: () => timersApi.action(timer.id, "pause") },
      { id: `timer.reset:${timer.id}`, group: "Timers", title: `Reset timer ${timer.name}`, run: () => timersApi.action(timer.id, "reset") },
      {
        id: `timer.toggle:${timer.id}`,
        group: "Timers",
        title: `Start / pause timer ${timer.name}`,
        run: async () => {
          const t = (await timersApi.list()).find((x) => x.id === timer.id);
          await timersApi.action(timer.id, t?.running ? "pause" : "start");
        },
      },
    );
  }
  for (const f of data.folders) {
    out.push({
      id: `folder.play:${f.id}`,
      group: "Media",
      title: `Play ${f.name}`,
      hint: f.kind === "audio" ? "audio folder" : f.kind === "video" ? "video folder" : "picture folder",
      run: () => mediaApi.play(f.kind === "audio" ? "audio" : "visual", { playlist_id: f.id }),
    });
  }
  for (const cam of data.cameras) {
    out.push({ id: `camera.show:${cam.id}`, group: "Layers", title: `Show camera ${cam.name}`, hint: "video input layer", run: () => liveApi.setVideoInput(cam.id) });
  }
  return out;
}

export async function loadCommandData(): Promise<CommandData> {
  const safe = async <T,>(p: Promise<T>, fallback: T) => {
    try {
      return await p;
    } catch {
      return fallback;
    }
  };
  const [audio, props, timers, folders, cameras, screens] = await Promise.all([
    safe(audioApi.get(), null),
    safe(themesApi.list("props"), []),
    safe(timersApi.list(), []),
    safe(mediaApi.playlists(), []),
    safe(devicesApi.listVideo(), []),
    safe(screensApi.list(), []),
  ]);
  return { audio, props, timers, folders, cameras, screens };
}

// ---------- key combinations ----------

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** "Ctrl+Shift+K", "ArrowRight", "Alt+F5"... (Cmd counts as Ctrl on macOS). */
export function comboFromEvent(e: KeyboardEvent): string | null {
  const key = e.key;
  if (["Control", "Shift", "Alt", "Meta", "AltGraph", "CapsLock", "Dead", "Unidentified"].includes(key)) return null;
  const parts: string[] = [];
  if (e.ctrlKey || (isMac && e.metaKey)) parts.push("Ctrl");
  if (!isMac && e.metaKey) parts.push("Meta");
  if (e.altKey) parts.push("Alt");
  // Shift is part of symbols ("?" is Shift+/ on some layouts), so only list it for
  // letters, digits and named keys.
  const named = key.length > 1;
  const name = key === " " ? "Space" : named ? key : key.toUpperCase();
  if (e.shiftKey && (named || /^[a-z0-9]$/i.test(key))) parts.push("Shift");
  // With Shift held, digits come out as symbols on most layouts: use the physical key.
  const digit = /^Digit(\d)$/.exec(e.code);
  parts.push(e.shiftKey && digit ? digit[1] : name);
  return parts.join("+");
}

export function prettyCombo(combo: string): string {
  return combo
    .split("+")
    .map((p) =>
      ({
        Ctrl: isMac ? "⌘" : "Ctrl",
        Alt: isMac ? "⌥" : "Alt",
        Shift: isMac ? "⇧" : "Shift",
        ArrowRight: "→",
        ArrowLeft: "←",
        ArrowUp: "↑",
        ArrowDown: "↓",
        Escape: "Esc",
      })[p] ?? p,
    )
    .join(isMac ? "" : "+");
}

/** combo -> command id */
export type Keybinds = Record<string, string>;

export const DEFAULT_KEYBINDS: Keybinds = {
  "Ctrl+K": "app.command-bar",
  "Ctrl+Shift+P": "app.command-mode",
  "Ctrl+B": "app.bible-search",
  ArrowRight: "presenter.next",
  ArrowDown: "presenter.next",
  PageDown: "presenter.next",
  ArrowLeft: "presenter.previous",
  ArrowUp: "presenter.previous",
  PageUp: "presenter.previous",
  "Ctrl+1": "nav.home",
  "Ctrl+2": "nav.songs",
  "Ctrl+3": "nav.reflow",
  "Ctrl+4": "nav.bible",
  "Ctrl+5": "nav.media",
  "Ctrl+6": "nav.screens",
  "Ctrl+7": "nav.audio",
  "Ctrl+8": "nav.themes",
  "Ctrl+9": "nav.live",
};

export interface UiSettings {
  /** null = never customised: the defaults apply. */
  keybinds?: Keybinds | null;
  /** First character that switches the command bar to Bible search. */
  bible_prefix?: string;
  /** First character that switches the command bar to commands. */
  command_prefix?: string;
}

export const DEFAULT_BIBLE_PREFIX = ":";
export const DEFAULT_COMMAND_PREFIX = ">";
