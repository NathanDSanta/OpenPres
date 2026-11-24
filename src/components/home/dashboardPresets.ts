import { createContext, useContext } from "react";
import {
  Baby,
  BookOpen,
  Camera,
  Church,
  Clapperboard,
  Coffee,
  Heart,
  LayoutDashboard,
  Mic,
  Moon,
  Music2,
  Presentation,
  Radio,
  Sparkles,
  Star,
  Sun,
  Users,
  Video,
  type LucideIcon,
} from "lucide-react";
import { upgrade, type Workspace } from "./grid";
import type { Mode } from "@/lib/manager";

/** One saved dashboard of a mode, switched with the ‹ › arrows or the Dashboards widget. */
export interface DashboardPreset {
  id: string;
  name: string;
  icon: string;
  workspace: Workspace;
}

export interface DashboardPresets {
  active: string;
  presets: DashboardPreset[];
}

export const DASHBOARD_ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  church: Church,
  music: Music2,
  bible: BookOpen,
  slides: Presentation,
  mic: Mic,
  video: Video,
  camera: Camera,
  stream: Radio,
  media: Clapperboard,
  people: Users,
  kids: Baby,
  coffee: Coffee,
  heart: Heart,
  star: Star,
  sparkles: Sparkles,
  sun: Sun,
  moon: Moon,
};

export const dashboardIcon = (icon: string): LucideIcon => DASHBOARD_ICONS[icon] ?? LayoutDashboard;

/** Each machine keeps its own dashboards per mode (this browser's storage, per server). */
const storageKey = (mode: Mode) => `openpres.dashboards.${mode}`;
/** Before presets: one dashboard per mode. */
const oldKey = (mode: Mode) => `openpres.dashboard.${mode}`;

export function single(id: string, workspace: Workspace, name = "Main"): DashboardPresets {
  return { active: id, presets: [{ id, name, icon: "dashboard", workspace }] };
}

export function loadPresets(mode: Mode, newId: () => string): DashboardPresets | null {
  try {
    const raw = localStorage.getItem(storageKey(mode));
    if (raw) {
      const parsed = JSON.parse(raw) as DashboardPresets;
      const presets = (parsed.presets ?? [])
        .map((p) => ({ ...p, workspace: upgrade(p.workspace) }))
        .filter((p): p is DashboardPreset => !!p.workspace && typeof p.id === "string");
      if (presets.length) return { active: presets.some((p) => p.id === parsed.active) ? parsed.active : presets[0].id, presets };
    }
    const old = localStorage.getItem(oldKey(mode));
    const ws = old ? upgrade(JSON.parse(old)) : null;
    return ws && ws.widgets.length ? single(newId(), ws) : null;
  } catch {
    return null;
  }
}

export function savePresets(mode: Mode, value: DashboardPresets) {
  localStorage.setItem(storageKey(mode), JSON.stringify(value));
}

/** What the Dashboards widget needs from the page. */
export const DashboardPresetsContext = createContext<{ value: DashboardPresets | null; switchTo: (id: string) => void }>({
  value: null,
  switchTo: () => {},
});

export const useDashboardPresets = () => useContext(DashboardPresetsContext);
