import { BookOpen, FilePenLine, Images, LayoutDashboard, Library, Palette, Projector, Radio, SlidersVertical, Timer, type LucideIcon } from "lucide-react";

export interface NavItem {
  name: string;
  path: string;
  icon: LucideIcon;
  /** Longer explanation, on hover. */
  hint: string;
  /** Starts a new group (a divider before it). */
  group?: boolean;
}

/** The pages, in the order of the work: running the show, preparing it, the stream. */
export const NAVIGATION: NavItem[] = [
  { name: "Dashboard", path: "/", icon: LayoutDashboard, hint: "Your dashboard: what you need during the service" },
  { name: "Songs", path: "/songs", icon: Library, hint: "Libraries and playlists of songs and presentations", group: true },
  { name: "Edit text", path: "/reflow", icon: FilePenLine, hint: "Edit the words of a song or presentation" },
  { name: "Bible", path: "/bible", icon: BookOpen, hint: "Find and show Bible passages" },
  { name: "Media", path: "/media", icon: Images, hint: "Pictures, videos, audio and video inputs" },
  { name: "Themes", path: "/themes", icon: Palette, hint: "How slides, Bible passages, props and masks look" },
  { name: "Screens", path: "/screens", icon: Projector, hint: "Virtual screens, the outputs and which layers each shows" },
  { name: "Audio", path: "/audio", icon: SlidersVertical, hint: "The mixer: inputs, buses and outputs" },
  { name: "Timers", path: "/timers", icon: Timer, hint: "Countdowns and timers" },
  { name: "Stream", path: "/live", icon: Radio, hint: "The livestream and the recording", group: true },
];
