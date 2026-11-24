import {
  BookOpen,
  Box,
  Image as ImageIcon,
  Megaphone,
  Presentation,
  Video,
  Volume2,
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
  { layer: "announcements", label: "Announcements", icon: Megaphone },
  { layer: "bible", label: "Bible", icon: BookOpen },
  { layer: "slides", label: "Slides", icon: Presentation },
  { layer: "media", label: "Media", icon: ImageIcon },
  { layer: "video_input", label: "Video input", icon: Video },
];

export const clearLayerLabel = (l: ClearLayer) =>
  CLEAR_LAYERS.find((x) => x.layer === l)?.label ?? l;
