export type HealthResponse = {
  status: string;
  version: string;
};

export type ConfigResponse = {
  api_port: number;
  data_dir: string;
  remote_access: boolean;
  password_set: boolean;
  ffmpeg_path: string;
  version: string;
};

export type ConfigUpdate = {
  api_port?: number;
  ffmpeg_path?: string;
};

export type SecurityUpdate = {
  remote_access?: boolean;
  /** "" removes the password. */
  password?: string;
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
  authenticated: boolean;
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
