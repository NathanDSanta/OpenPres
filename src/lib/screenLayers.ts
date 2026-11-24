import { BookOpen, Image as ImageIcon, Layers, Megaphone, Presentation, Shapes, Video, type LucideIcon } from "lucide-react";
import type { LayerKind } from "@/types";

/** The icon of each layer a screen can show. */
export const LAYER_ICONS: Record<LayerKind, LucideIcon> = {
  video_input: Video,
  media: ImageIcon,
  slides: Presentation,
  bible: BookOpen,
  announcements: Megaphone,
  complements: Layers,
  props: Shapes,
};
