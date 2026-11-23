import {
  Ban,
  BookOpen,
  Box,
  CircleX,
  Eraser,
  Image as ImageIcon,
  Layers,
  Megaphone,
  MessageSquareText,
  Music2,
  Presentation,
  Sparkles,
  SquareX,
  Type,
  Video,
  Volume2,
  VolumeX,
  type LucideIcon,
} from "lucide-react";
import type { ClearLayer } from "@/types";

/**
 * The layers as they stack on a screen, top first (the order ProPresenter lists its clear
 * buttons in), then the audio, which isn't on screen. Icons follow ProPresenter's: a speaker,
 * a message bubble, a box for props, a megaphone, a slide, a picture and a camera.
 */
export const CLEAR_LAYERS: {
  layer: ClearLayer;
  label: string;
  icon: LucideIcon;
}[] = [
  { layer: "audio", label: "Audio", icon: Volume2 },
  { layer: "props", label: "Props", icon: Box },
  { layer: "complements", label: "Complements", icon: MessageSquareText },
  { layer: "announcements", label: "Announcements", icon: Megaphone },
  { layer: "bible", label: "Bible", icon: BookOpen },
  { layer: "slides", label: "Slides", icon: Presentation },
  { layer: "media", label: "Media", icon: ImageIcon },
  { layer: "video_input", label: "Video input", icon: Video },
];

export const clearLayerLabel = (l: ClearLayer) =>
  CLEAR_LAYERS.find((x) => x.layer === l)?.label ?? l;

/** The icons a clear group can have. */
export const CLEAR_GROUP_ICONS: Record<string, LucideIcon> = {
  "clear-all": SquareX,
  everything: CircleX,
  eraser: Eraser,
  text: Type,
  media: ImageIcon,
  video: Video,
  audio: VolumeX,
  music: Music2,
  layers: Layers,
  props: Box,
  sparkles: Sparkles,
  stop: Ban,
};

export const clearGroupIcon = (icon: string): LucideIcon =>
  CLEAR_GROUP_ICONS[icon] ?? SquareX;
