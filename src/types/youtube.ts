export interface YoutubeBroadcast {
  id: string;
  title: string;
  status: string;
  stream_key: string | null;
  ingestion_url: string | null;
  scheduled_start: string | null;
}

export interface YoutubeStatus {
  configured: boolean;
  built_in_client: boolean;
  client_id: string;
  client_secret_set: boolean;
  connected: boolean;
  channel_title: string;
  broadcast: YoutubeBroadcast | null;
}
