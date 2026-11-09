export type HealthResponse = {
  status: string;
  version: string;
};

export type ConfigResponse = {
  api_port: number;
  data_dir: string;
  group_styles: GroupStyle[];
};

export type ConfigUpdate = {
  api_port: number;
  group_styles?: GroupStyle[];
};

export type GroupStyle = {
  name: string;
  color: string;
};
