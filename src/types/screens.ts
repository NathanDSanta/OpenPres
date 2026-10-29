import type { UUID } from "./common";
import type { LayerStack } from "./layers";

export type ScreenKind = "audience" | "stage";

export interface PhysicalDisplay {
  id: string;
  name: string;
  width: number;
  height: number;
  /** Desktop coordinate [x, y], including potentially negative values. */
  position: [number, number];
}

export interface Binding {
  virtual_screen: UUID;
  physical_display: string;
}

export interface VirtualScreen {
  id: UUID;
  name: string;
  kind: ScreenKind;
  width: number;
  height: number;
  layers: LayerStack;
  theme_id: UUID | null;
}

export interface ScreenInput {
  name: string;
  kind: ScreenKind;
  width?: number;
  height?: number;
  theme_id?: UUID | null;
}

/** GET /screens and successful create/update/bind responses. */
export interface ScreenView extends VirtualScreen {
  display_id: string | null;
  display_connected: boolean;
}

export interface BindDisplayRequest {
  display_id: string;
}
