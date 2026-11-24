import {
  Baby,
  Bell,
  BookOpen,
  Camera,
  Church,
  Clapperboard,
  Coffee,
  DoorOpen,
  Flag,
  Gift,
  HandHeart,
  Heart,
  Hourglass,
  Lightbulb,
  Megaphone,
  Mic,
  Monitor,
  Moon,
  Music,
  PartyPopper,
  Play,
  Power,
  Presentation,
  Radio,
  Sparkles,
  Star,
  Sunrise,
  Timer,
  Users,
  Video,
  Volume2,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { clearLayerLabel } from "@/lib/clearLayers";
import type {
  AudioView,
  ClearGroup,
  Macro,
  MacroStep,
  MacroStepType,
  MacroTrigger,
  MediaPlaylist,
  PresentationSummary,
  ScreenPreset,
  ScreenView,
  Service,
  ThemeSummary,
  TimerView,
  VideoDevice,
} from "@/types";

/**
 * Icons a macro can have. The names are Lucide's, which the Stream Deck plugin draws too,
 * so a macro's key looks like its button.
 */
export const MACRO_ICONS: Record<string, LucideIcon> = {
  Zap,
  Sparkles,
  Church,
  Sunrise,
  Moon,
  Bell,
  Mic,
  Music,
  BookOpen,
  Presentation,
  Megaphone,
  Video,
  Camera,
  Clapperboard,
  Play,
  Radio,
  Monitor,
  Volume2,
  Timer,
  Hourglass,
  Coffee,
  Baby,
  Users,
  HandHeart,
  Heart,
  Gift,
  PartyPopper,
  Star,
  Flag,
  Lightbulb,
  DoorOpen,
  Power,
};

export const macroIcon = (name: string): LucideIcon => MACRO_ICONS[name] ?? Zap;

export const MACRO_COLORS = ["#B49AFF", "#5B8DEF", "#3DD68C", "#F5A524", "#E5484D", "#E879B9", "#4CC3D9", "#A1A1AA"];

/** Everything the step and trigger pickers list, and the descriptions name. */
export interface MacroData {
  presentations: PresentationSummary[];
  clearGroups: ClearGroup[];
  props: ThemeSummary[];
  cameras: VideoDevice[];
  folders: MediaPlaylist[];
  audio: AudioView | null;
  timers: TimerView[];
  screens: ScreenView[];
  presets: ScreenPreset[];
  services: Service[];
}

export const STEP_TYPES: { type: MacroStepType; label: string; group: string }[] = [
  { type: "present", label: "Present a song", group: "Presentation" },
  { type: "next", label: "Next", group: "Presentation" },
  { type: "previous", label: "Previous", group: "Presentation" },
  { type: "bible", label: "Bible passage", group: "Presentation" },
  { type: "clear", label: "Clear layers", group: "Clear" },
  { type: "clear_group", label: "Clear group", group: "Clear" },
  { type: "prop", label: "Prop", group: "Layers" },
  { type: "camera", label: "Video input", group: "Layers" },
  { type: "media_folder", label: "Media folder", group: "Layers" },
  { type: "mute", label: "Mute / unmute", group: "Audio" },
  { type: "timer", label: "Timer", group: "Timers" },
  { type: "screen_preset", label: "Screen preset", group: "Screens" },
  { type: "stream", label: "Stream", group: "Live" },
  { type: "power", label: "Server power", group: "Server" },
  { type: "wait", label: "Wait", group: "Flow" },
];

export const MOVE_LAYERS: { value: "all" | "slides" | "announcements" | "bible"; label: string }[] = [
  { value: "all", label: "Slide or verse (like the arrow keys)" },
  { value: "slides", label: "Slide" },
  { value: "announcements", label: "Announcement" },
  { value: "bible", label: "Bible verse" },
];

/** A new step of this kind, with the first choice already made where there is one. */
export function newStep(type: MacroStepType, data: MacroData): MacroStep {
  const firstProp = data.props.flatMap((t) => t.designs.map((d) => ({ theme_id: t.id, design_id: d.id })))[0];
  switch (type) {
    case "wait":
      return { type, seconds: 5 };
    case "present":
      return { type, presentation_id: "" };
    case "next":
    case "previous":
      return { type, layer: "all" };
    case "bible":
      return { type, reference: "" };
    case "clear":
      return { type, layers: ["slides"] };
    case "clear_group":
      return { type, group_id: data.clearGroups[0]?.id ?? "" };
    case "prop":
      return { type, theme_id: firstProp?.theme_id ?? "", design_id: firstProp?.design_id ?? "", show: true };
    case "camera":
      return { type, device_id: data.cameras[0]?.id ?? null };
    case "media_folder": {
      const f = data.folders[0];
      return { type, playlist_id: f?.id ?? "", audio: f?.kind === "audio" };
    }
    case "mute":
      return { type, bus: 1, muted: true };
    case "timer":
      return { type, timer_id: data.timers[0]?.id ?? "", action: "start" };
    case "screen_preset":
      return { type, screen_id: data.screens[0]?.id ?? "", preset_id: data.presets[0]?.id ?? "" };
    case "stream":
      return { type, start: true };
    case "power":
      return { type, power: "active" };
  }
}

/** Whether every choice of a step is made (otherwise the macro isn't saved yet). */
export function stepComplete(step: MacroStep): boolean {
  switch (step.type) {
    case "present":
      return !!step.presentation_id;
    case "bible":
      return !!step.reference.trim();
    case "clear":
      return step.layers.length > 0;
    case "clear_group":
      return !!step.group_id;
    case "prop":
      return !!step.theme_id && !!step.design_id;
    case "media_folder":
      return !!step.playlist_id;
    case "timer":
      return !!step.timer_id;
    case "screen_preset":
      return !!step.screen_id && !!step.preset_id;
    case "wait":
      return step.seconds >= 0 && step.seconds <= 3600;
    default:
      return true;
  }
}

export const busName = (data: MacroData, n: number) => data.audio?.config.buses[n - 1]?.name || `Bus ${n}`;

const serviceName = (data: MacroData, id: string | null) => (id ? data.services.find((s) => s.id === id)?.name ?? "a deleted service" : "any service");

const presentationTitle = (data: MacroData, id: string | null) =>
  id ? data.presentations.find((p) => p.id === id)?.title ?? "a deleted presentation" : "any song or presentation";

/** "30 minutes", "1 hour", "1 h 30 min". */
export function leadTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} minute${m === 1 ? "" : "s"}`;
  if (!m) return `${h} hour${h === 1 ? "" : "s"}`;
  return `${h} h ${m} min`;
}

/** What starts a macro by itself, in a few words. */
export function describeTrigger(t: MacroTrigger, data: MacroData): string {
  if (t.type === "service") {
    const service = serviceName(data, t.service_id);
    return t.minutes_before ? `${leadTime(t.minutes_before)} before ${service}` : `When ${service} starts`;
  }
  return `When ${presentationTitle(data, t.presentation_id)} ${t.when === "begins" ? "goes live" : "comes off"}`;
}

/** A step in a few words ("Present Amazing Grace", "Wait 5 s"). */
export function describeStep(step: MacroStep, data: MacroData): string {
  switch (step.type) {
    case "wait":
      return `Wait ${step.seconds} s`;
    case "present":
      return `Present ${presentationTitle(data, step.presentation_id)}`;
    case "next":
    case "previous":
      return `${step.type === "next" ? "Next" : "Previous"} ${MOVE_LAYERS.find((l) => l.value === step.layer)?.label.toLowerCase() ?? ""}`;
    case "bible":
      return `Show ${step.reference}`;
    case "clear":
      return `Clear ${step.layers.map(clearLayerLabel).join(", ").toLowerCase()}`;
    case "clear_group":
      return `Clear group ${data.clearGroups.find((g) => g.id === step.group_id)?.name ?? ""}`;
    case "prop": {
      const design = data.props.find((t) => t.id === step.theme_id)?.designs.find((d) => d.id === step.design_id);
      return `${step.show ? "Show" : "Hide"} ${design?.name ?? "a prop"}`;
    }
    case "camera":
      return step.device_id ? `Show ${data.cameras.find((c) => c.id === step.device_id)?.name ?? "a video input"}` : "Clear the video input";
    case "media_folder":
      return `Play ${data.folders.find((f) => f.id === step.playlist_id)?.name ?? "a media folder"}`;
    case "mute":
      return `${step.muted ? "Mute" : "Unmute"} ${busName(data, step.bus)}`;
    case "timer":
      return `${step.action[0].toUpperCase()}${step.action.slice(1)} ${data.timers.find((t) => t.id === step.timer_id)?.name ?? "a timer"}`;
    case "screen_preset":
      return `${data.screens.find((s) => s.id === step.screen_id)?.name ?? "A screen"}: ${data.presets.find((p) => p.id === step.preset_id)?.name ?? "a preset"}`;
    case "stream":
      return step.start ? "Start the stream" : "Stop the stream";
    case "power":
      return step.power === "active" ? "Switch the server on" : "Put the server on standby";
  }
}

/** "3 steps · 30 minutes before any service". */
export function macroSummary(m: Macro, data: MacroData): string {
  const steps = `${m.steps.length} step${m.steps.length === 1 ? "" : "s"}`;
  return [steps, ...m.triggers.map((t) => describeTrigger(t, data))].join(" · ");
}

/** "Name 2", or the next free number ("Name 3" for a copy of "Name 2"; "Psalm 23" stays a name). */
export function copyName(name: string, taken: string[]): string {
  const used = new Set(taken.map((n) => n.trim().toLowerCase()));
  const trimmed = name.trim() || "Macro";
  const numbered = /^(.*\S)\s+\d+$/.exec(trimmed);
  const base = numbered && used.has(numbered[1].toLowerCase()) ? numbered[1] : trimmed;
  let n = 2;
  while (used.has(`${base} ${n}`.toLowerCase())) n++;
  return `${base} ${n}`;
}
