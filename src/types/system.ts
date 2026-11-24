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
  /** The oldest manager that can manage it (compatibility.json). */
  oldest_manager?: string;
  power: Power;
  port: number;
  set_up: boolean;
  starts_with_computer: boolean;
  /** New versions install by themselves when nothing is live. */
  auto_update: boolean;
}

/** A newer version of OpenPres (GitHub Releases). */
export interface AvailableUpdate {
  version: string;
  /** Release notes (Markdown). */
  notes: string;
  date: string | null;
}

/** The server's own updates (`/server/update`). */
export type UpdateStatus = {
  current: string;
  /** An installed release (test builds don't update themselves). */
  supported: boolean;
  available: AvailableUpdate | null;
  error: string | null;
  checked_at_ms: number | null;
  /** Updates install by themselves (Settings → System). */
  automatic: boolean;
  /** An automatic update is waiting for the server to be free: why. */
  waiting: string | null;
} & (
  | { state: "idle" | "checking" | "installing" }
  | { state: "downloading"; done: number; total: number | null }
);

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
  /** Empty from older servers. */
  oldest_manager?: string;
}

export interface LocalServerStatus {
  running: boolean;
  port: number;
  info: ServerInfo | null;
  host: string;
  /** A server has run on this computer before. */
  has_data: boolean;
  /** This computer is used as a server (chosen when OpenPres first opened); null: not chosen yet. */
  choice: boolean | null;
  /** Its server is set up (has passwords). */
  set_up: boolean;
}

export interface SystemInfo {
  version: string;
  os: string;
  arch: string;
  cpus: number;
  uptime_s: number;
  data_dir: string;
  /** The server's log files (one a day, the last 14 days). */
  logs_dir: string;
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
