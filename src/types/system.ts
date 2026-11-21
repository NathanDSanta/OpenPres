export type HealthResponse = {
  status: string;
  version: string;
};

export type ConfigResponse = {
  api_port: number;
  data_dir: string;
  remote_access: boolean;
  /** The operator password is set. */
  password_set: boolean;
  admin_password_set: boolean;
  server_id: string;
  /** Set by the admin; "" = the computer's name. */
  server_name: string;
  display_name: string;
  ffmpeg_path: string;
  version: string;
};

export type ConfigUpdate = {
  api_port?: number;
  ffmpeg_path?: string;
};

export type SecurityUpdate = {
  remote_access?: boolean;
  operator_password?: string;
  admin_password?: string;
};

export type NetworkInfo = {
  remote_access: boolean;
  port: number;
  urls: string[];
};

export type Shading = "darken" | "lighten" | "none";

export interface GroupClass {
  name: string;
  color: string;
  numbered: boolean;
  count: number;
  shading: Shading;
}

export interface GroupsFile {
  classes: GroupClass[];
}

export interface ImportTemplate {
  id: string;
  name: string;
  prefix: string[];
  repeat: string[];
  start: number;
}

export interface TemplatesFile {
  templates: ImportTemplate[];
}

export interface AuthStatus {
  password_required: boolean;
  /** The admin and operator passwords are set. */
  set_up: boolean;
  /** Logged in (operator or admin). */
  authenticated: boolean;
  /** Logged in as the admin. */
  admin: boolean;
}

export type Power = "active" | "standby" | "sleep";

/** What a server says about itself (public). */
export interface ServerInfo {
  id: string;
  name: string;
  host: string;
  version: string;
  power: Power;
  port: number;
  set_up: boolean;
  starts_with_computer: boolean;
}

export interface OutputWindow {
  screen_id: string;
  display_id: string;
  visible: boolean;
}

/** A server found on the network by the manager. */
export interface FoundServer {
  id: string;
  name: string;
  host: string;
  addresses: string[];
  port: number;
  power: string;
  version: string;
}

export interface LocalServerStatus {
  running: boolean;
  port: number;
  info: ServerInfo | null;
  host: string;
  /** A server has run on this computer before: the manager starts it by itself. */
  has_data: boolean;
}

export interface SystemInfo {
  version: string;
  os: string;
  arch: string;
  cpus: number;
  uptime_s: number;
  data_dir: string;
  api_port: number;
  remote_access: boolean;
  lan_ip: string | null;
  ffmpeg: { path: string; bundled: boolean; version: string | null; error: string | null };
  audio_host: string;
  open_audio_devices: string[];
  displays: number;
  media: { count: number; bytes: number };
  presentations: number;
  bibles: number;
}
