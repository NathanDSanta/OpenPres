export interface YoutubeBroadcast {
  id: string;
  title: string;
  status: string;
  live_chat_id: string;
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
  chat_error: string | null;
}

export interface ChatMessage {
  seq: number;
  id: string;
  kind: string;
  text: string;
  published_at: string;
  author_name: string;
  author_channel_id: string;
  author_image: string;
  is_owner: boolean;
  is_moderator: boolean;
  is_member: boolean;
  amount: string | null;
  deleted?: boolean;
}

export interface ChatPage {
  live_chat_id: string;
  messages: ChatMessage[];
  last_seq: number;
  error: string | null;
}
