import type { DesignRef } from "./themes";

export type PropsLayer = "props" | "complements";

export interface LiveLayers {
  video_input: string | null;
  props: DesignRef[];
  complements: DesignRef[];
}
