export type HealthResponse = {
  status: string;
  version: string;
}

export type ConfigResponse = {
  api_port: number;
  data_dir: string;
}

export type ConfigUpdate = {
  api_port: number;
}
