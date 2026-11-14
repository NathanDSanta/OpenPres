//! YouTube account link (OAuth for installed apps, PKCE + loopback redirect), the live
//! broadcast lookup and its chat. Uses the YouTube Data API v3:
//! liveBroadcasts.list, liveStreams.list, liveChatMessages.list/insert/delete,
//! liveChatBans.insert.
//!
//! The OAuth client (a "Desktop app" client from Google Cloud with the YouTube Data API
//! enabled) is set in Settings, or compiled in with OPENPRES_YT_CLIENT_ID /
//! OPENPRES_YT_CLIENT_SECRET.

use crate::{error::AppError, storage::{now_ms, JsonDoc}};
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::VecDeque, path::PathBuf};
use tokio::sync::Mutex;

const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const API: &str = "https://www.googleapis.com/youtube/v3";
const SCOPE: &str = "https://www.googleapis.com/auth/youtube.force-ssl";
const CHAT_KEEP: usize = 600;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct YoutubeConfig {
    pub client_id: String,
    pub client_secret: String,
    pub refresh_token: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub access_token: String,
    pub expires_at_ms: i64,
    pub channel_title: String,
    pub channel_id: String,
}

impl YoutubeConfig {
    fn client(&self) -> (String, String) {
        let id = if self.client_id.trim().is_empty() {
            option_env!("OPENPRES_YT_CLIENT_ID").unwrap_or("").to_string()
        } else {
            self.client_id.trim().to_string()
        };
        let secret = if self.client_secret.trim().is_empty() {
            option_env!("OPENPRES_YT_CLIENT_SECRET").unwrap_or("").to_string()
        } else {
            self.client_secret.trim().to_string()
        };
        (id, secret)
    }
    pub fn configured(&self) -> bool {
        !self.client().0.is_empty()
    }
    pub fn connected(&self) -> bool {
        !self.refresh_token.is_empty()
    }
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct Broadcast {
    pub id: String,
    pub title: String,
    pub status: String,
    pub live_chat_id: String,
    pub stream_key: Option<String>,
    pub ingestion_url: Option<String>,
    pub scheduled_start: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ChatMessage {
    /// Running number, so clients can ask for what is new.
    pub seq: u64,
    pub id: String,
    pub kind: String,
    pub text: String,
    pub published_at: String,
    pub author_name: String,
    pub author_channel_id: String,
    pub author_image: String,
    pub is_owner: bool,
    pub is_moderator: bool,
    pub is_member: bool,
    pub amount: Option<String>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub deleted: bool,
}

#[derive(Default)]
struct Chat {
    live_chat_id: String,
    page_token: Option<String>,
    next_poll_ms: i64,
    seq: u64,
    messages: VecDeque<ChatMessage>,
    error: Option<String>,
}

struct Pending {
    state: String,
    verifier: String,
    redirect_uri: String,
}

pub struct Youtube {
    pub config: Mutex<JsonDoc<YoutubeConfig>>,
    pending: Mutex<Option<Pending>>,
    pub broadcast: Mutex<Option<Broadcast>>,
    chat: Mutex<Chat>,
    http: reqwest::Client,
}

fn api_error(context: &str, e: impl std::fmt::Display) -> AppError {
    AppError::Device(format!("{context}: {e}"))
}

fn random_token() -> String {
    let bytes: Vec<u8> = (0..2).flat_map(|_| *uuid::Uuid::new_v4().as_bytes()).collect();
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// Google's error message from an API answer, when there is one.
async fn google_error(res: reqwest::Response) -> String {
    let status = res.status();
    let body: Value = res.json().await.unwrap_or(Value::Null);
    let message = body
        .pointer("/error/message")
        .or(body.get("error_description"))
        .or(body.get("error"))
        .and_then(Value::as_str)
        .unwrap_or("");
    format!("{status} {message}")
}

impl Youtube {
    pub fn load(path: PathBuf) -> Result<Self, AppError> {
        Ok(Self {
            config: Mutex::new(JsonDoc::load(path)?),
            pending: Mutex::new(None),
            broadcast: Mutex::new(None),
            chat: Mutex::new(Chat::default()),
            http: reqwest::Client::builder()
                .user_agent(concat!("OpenPres/", env!("CARGO_PKG_VERSION")))
                .timeout(std::time::Duration::from_secs(20))
                .build()
                .map_err(|e| AppError::Internal(e.to_string()))?,
        })
    }

    pub async fn status(&self) -> Value {
        let c = self.config.lock().await.value.clone();
        let broadcast = self.broadcast.lock().await.clone();
        let chat_error = self.chat.lock().await.error.clone();
        json!({
            "configured": c.configured(),
            "built_in_client": c.client_id.trim().is_empty() && c.configured(),
            "client_id": c.client_id,
            "client_secret_set": !c.client_secret.is_empty(),
            "connected": c.connected(),
            "channel_title": c.channel_title,
            "broadcast": broadcast,
            "chat_error": chat_error,
        })
    }

    pub async fn set_client(&self, id: String, secret: Option<String>) -> Result<(), AppError> {
        let mut doc = self.config.lock().await;
        if doc.value.client_id != id.trim() {
            // Tokens belong to the old client.
            doc.value.refresh_token.clear();
            doc.value.access_token.clear();
        }
        doc.value.client_id = id.trim().to_string();
        if let Some(secret) = secret {
            doc.value.client_secret = secret.trim().to_string();
        }
        doc.save()
    }

    /// Starts the sign-in: returns the Google page to open in the browser.
    pub async fn auth_url(&self, redirect_uri: String) -> Result<String, AppError> {
        let (client_id, _) = self.config.lock().await.value.client();
        if client_id.is_empty() {
            return Err(AppError::BadRequest("enter the OAuth client id first (Settings, YouTube)".into()));
        }
        let verifier = random_token();
        let challenge = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        let state = random_token();
        let url = reqwest::Url::parse_with_params(
            AUTH_URL,
            &[
                ("client_id", client_id.as_str()),
                ("redirect_uri", redirect_uri.as_str()),
                ("response_type", "code"),
                ("scope", SCOPE),
                ("access_type", "offline"),
                ("prompt", "consent"),
                ("code_challenge", challenge.as_str()),
                ("code_challenge_method", "S256"),
                ("state", state.as_str()),
            ],
        )
        .map_err(|e| AppError::Internal(e.to_string()))?;
        *self.pending.lock().await = Some(Pending { state, verifier, redirect_uri });
        Ok(url.to_string())
    }

    /// Finishes the sign-in with the code Google sent to the callback.
    pub async fn finish_auth(&self, code: &str, state: &str) -> Result<(), AppError> {
        let pending = self.pending.lock().await.take().ok_or_else(|| AppError::BadRequest("no sign-in in progress".into()))?;
        if pending.state != state {
            return Err(AppError::BadRequest("the sign-in does not match; try again".into()));
        }
        let (client_id, client_secret) = self.config.lock().await.value.client();
        let res = self
            .http
            .post(TOKEN_URL)
            .form(&[
                ("client_id", client_id.as_str()),
                ("client_secret", client_secret.as_str()),
                ("code", code),
                ("code_verifier", pending.verifier.as_str()),
                ("redirect_uri", pending.redirect_uri.as_str()),
                ("grant_type", "authorization_code"),
            ])
            .send()
            .await
            .map_err(|e| api_error("cannot reach Google", e))?;
        if !res.status().is_success() {
            return Err(AppError::Device(format!("Google refused the sign-in: {}", google_error(res).await)));
        }
        let tokens: Value = res.json().await.map_err(|e| api_error("unexpected answer", e))?;
        {
            let mut doc = self.config.lock().await;
            doc.value.access_token = tokens["access_token"].as_str().unwrap_or("").to_string();
            doc.value.expires_at_ms = now_ms() + tokens["expires_in"].as_i64().unwrap_or(3600) * 1000;
            if let Some(refresh) = tokens["refresh_token"].as_str() {
                doc.value.refresh_token = refresh.to_string();
            }
            doc.save()?;
        }
        // Who signed in.
        if let Ok(me) = self.get("channels", &[("part", "snippet"), ("mine", "true")]).await {
            let mut doc = self.config.lock().await;
            doc.value.channel_title = me.pointer("/items/0/snippet/title").and_then(Value::as_str).unwrap_or("").to_string();
            doc.value.channel_id = me.pointer("/items/0/id").and_then(Value::as_str).unwrap_or("").to_string();
            doc.save()?;
        }
        let _ = self.refresh_broadcast().await;
        Ok(())
    }

    pub async fn disconnect(&self) -> Result<(), AppError> {
        let mut doc = self.config.lock().await;
        doc.value.refresh_token.clear();
        doc.value.access_token.clear();
        doc.value.channel_title.clear();
        doc.value.channel_id.clear();
        doc.save()?;
        *self.broadcast.lock().await = None;
        *self.chat.lock().await = Chat::default();
        Ok(())
    }

    async fn token(&self) -> Result<String, AppError> {
        let mut doc = self.config.lock().await;
        if !doc.value.connected() {
            return Err(AppError::Conflict("connect a YouTube account first".into()));
        }
        if !doc.value.access_token.is_empty() && doc.value.expires_at_ms > now_ms() + 60_000 {
            return Ok(doc.value.access_token.clone());
        }
        let (client_id, client_secret) = doc.value.client();
        let res = self
            .http
            .post(TOKEN_URL)
            .form(&[
                ("client_id", client_id.as_str()),
                ("client_secret", client_secret.as_str()),
                ("refresh_token", doc.value.refresh_token.as_str()),
                ("grant_type", "refresh_token"),
            ])
            .send()
            .await
            .map_err(|e| api_error("cannot reach Google", e))?;
        if !res.status().is_success() {
            let message = google_error(res).await;
            if message.contains("invalid_grant") {
                doc.value.refresh_token.clear();
                doc.save()?;
                return Err(AppError::Conflict("the YouTube sign-in expired; connect the account again".into()));
            }
            return Err(AppError::Device(format!("cannot renew the YouTube sign-in: {message}")));
        }
        let tokens: Value = res.json().await.map_err(|e| api_error("unexpected answer", e))?;
        doc.value.access_token = tokens["access_token"].as_str().unwrap_or("").to_string();
        doc.value.expires_at_ms = now_ms() + tokens["expires_in"].as_i64().unwrap_or(3600) * 1000;
        doc.save()?;
        Ok(doc.value.access_token.clone())
    }

    async fn get(&self, path: &str, query: &[(&str, &str)]) -> Result<Value, AppError> {
        let token = self.token().await?;
        let res = self
            .http
            .get(format!("{API}/{path}"))
            .bearer_auth(token)
            .query(query)
            .send()
            .await
            .map_err(|e| api_error("cannot reach YouTube", e))?;
        if !res.status().is_success() {
            return Err(AppError::Device(format!("YouTube: {}", google_error(res).await)));
        }
        res.json().await.map_err(|e| api_error("unexpected answer from YouTube", e))
    }

    async fn send(&self, method: reqwest::Method, path: &str, query: &[(&str, &str)], body: Option<Value>) -> Result<Value, AppError> {
        let token = self.token().await?;
        let mut req = self.http.request(method, format!("{API}/{path}")).bearer_auth(token).query(query);
        if let Some(body) = body {
            req = req.json(&body);
        }
        let res = req.send().await.map_err(|e| api_error("cannot reach YouTube", e))?;
        if !res.status().is_success() {
            return Err(AppError::Device(format!("YouTube: {}", google_error(res).await)));
        }
        Ok(res.json().await.unwrap_or(Value::Null))
    }

    /// Finds the account's live broadcast (active first, else the next upcoming one) and
    /// the stream key bound to it.
    pub async fn refresh_broadcast(&self) -> Result<Option<Broadcast>, AppError> {
        let mut found = None;
        for status in ["active", "upcoming"] {
            let list = self
                .get("liveBroadcasts", &[("part", "snippet,status,contentDetails"), ("broadcastStatus", status), ("broadcastType", "all"), ("maxResults", "10")])
                .await?;
            let items = list["items"].as_array().cloned().unwrap_or_default();
            // Upcoming: the one scheduled soonest.
            let mut items: Vec<Value> = items;
            items.sort_by_key(|b| b.pointer("/snippet/scheduledStartTime").and_then(Value::as_str).unwrap_or("").to_string());
            if let Some(b) = items.into_iter().next() {
                found = Some(b);
                break;
            }
        }
        let Some(b) = found else {
            *self.broadcast.lock().await = None;
            return Ok(None);
        };
        let mut broadcast = Broadcast {
            id: b["id"].as_str().unwrap_or("").to_string(),
            title: b.pointer("/snippet/title").and_then(Value::as_str).unwrap_or("").to_string(),
            status: b.pointer("/status/lifeCycleStatus").and_then(Value::as_str).unwrap_or("").to_string(),
            live_chat_id: b.pointer("/snippet/liveChatId").and_then(Value::as_str).unwrap_or("").to_string(),
            scheduled_start: b.pointer("/snippet/scheduledStartTime").and_then(Value::as_str).map(str::to_string),
            stream_key: None,
            ingestion_url: None,
        };
        if let Some(stream_id) = b.pointer("/contentDetails/boundStreamId").and_then(Value::as_str) {
            if let Ok(streams) = self.get("liveStreams", &[("part", "cdn"), ("id", stream_id)]).await {
                broadcast.stream_key = streams.pointer("/items/0/cdn/ingestionInfo/streamName").and_then(Value::as_str).map(str::to_string);
                broadcast.ingestion_url = streams.pointer("/items/0/cdn/ingestionInfo/ingestionAddress").and_then(Value::as_str).map(str::to_string);
            }
        }
        {
            let mut chat = self.chat.lock().await;
            if chat.live_chat_id != broadcast.live_chat_id {
                *chat = Chat { live_chat_id: broadcast.live_chat_id.clone(), ..Default::default() };
            }
        }
        *self.broadcast.lock().await = Some(broadcast.clone());
        Ok(Some(broadcast))
    }

    /// New chat messages after `since` (a `seq`). Polls YouTube at most as often as it
    /// asks (pollingIntervalMillis), however many windows show the chat.
    pub async fn chat_since(&self, since: u64) -> Result<Value, AppError> {
        let due = {
            let chat = self.chat.lock().await;
            !chat.live_chat_id.is_empty() && now_ms() >= chat.next_poll_ms
        };
        if due {
            let (live_chat_id, page_token) = {
                let chat = self.chat.lock().await;
                (chat.live_chat_id.clone(), chat.page_token.clone())
            };
            let mut query = vec![("liveChatId", live_chat_id.as_str()), ("part", "snippet,authorDetails"), ("maxResults", "200")];
            if let Some(t) = page_token.as_deref() {
                query.push(("pageToken", t));
            }
            let result = self.get("liveChat/messages", &query).await;
            let mut chat = self.chat.lock().await;
            match result {
                Ok(page) => {
                    chat.error = None;
                    chat.page_token = page["nextPageToken"].as_str().map(str::to_string);
                    let wait = page["pollingIntervalMillis"].as_i64().unwrap_or(5000).max(2000);
                    chat.next_poll_ms = now_ms() + wait;
                    for item in page["items"].as_array().into_iter().flatten() {
                        let id = item["id"].as_str().unwrap_or("").to_string();
                        if chat.messages.iter().any(|m| m.id == id) {
                            continue;
                        }
                        let snippet = &item["snippet"];
                        let author = &item["authorDetails"];
                        let kind = snippet["type"].as_str().unwrap_or("").to_string();
                        if kind == "messageDeletedEvent" {
                            if let Some(gone) = snippet.pointer("/messageDeletedDetails/deletedMessageId").and_then(Value::as_str) {
                                for m in chat.messages.iter_mut().filter(|m| m.id == gone) {
                                    m.deleted = true;
                                }
                            }
                            continue;
                        }
                        chat.seq += 1;
                        let seq = chat.seq;
                        chat.messages.push_back(ChatMessage {
                            seq,
                            id,
                            text: snippet["displayMessage"].as_str().unwrap_or("").to_string(),
                            published_at: snippet["publishedAt"].as_str().unwrap_or("").to_string(),
                            amount: snippet
                                .pointer("/superChatDetails/amountDisplayString")
                                .or(snippet.pointer("/superStickerDetails/amountDisplayString"))
                                .and_then(Value::as_str)
                                .map(str::to_string),
                            kind,
                            author_name: author["displayName"].as_str().unwrap_or("").to_string(),
                            author_channel_id: author["channelId"].as_str().unwrap_or("").to_string(),
                            author_image: author["profileImageUrl"].as_str().unwrap_or("").to_string(),
                            is_owner: author["isChatOwner"].as_bool().unwrap_or(false),
                            is_moderator: author["isChatModerator"].as_bool().unwrap_or(false),
                            is_member: author["isChatSponsor"].as_bool().unwrap_or(false),
                            deleted: false,
                        });
                        while chat.messages.len() > CHAT_KEEP {
                            chat.messages.pop_front();
                        }
                    }
                }
                Err(e) => {
                    chat.error = Some(e.to_string());
                    chat.next_poll_ms = now_ms() + 15_000;
                    if e.to_string().contains("liveChatEnded") || e.to_string().contains("403") {
                        chat.next_poll_ms = now_ms() + 60_000;
                    }
                }
            }
        }
        let chat = self.chat.lock().await;
        let messages: Vec<&ChatMessage> = chat.messages.iter().filter(|m| m.seq > since || since == 0).collect();
        Ok(json!({
            "live_chat_id": chat.live_chat_id,
            "messages": messages,
            "last_seq": chat.seq,
            "error": chat.error,
            "next_poll_ms": chat.next_poll_ms,
        }))
    }

    pub async fn send_message(&self, text: &str) -> Result<(), AppError> {
        let live_chat_id = self.chat.lock().await.live_chat_id.clone();
        if live_chat_id.is_empty() {
            return Err(AppError::Conflict("there is no live chat (no broadcast found)".into()));
        }
        let text: String = text.trim().chars().take(200).collect();
        if text.is_empty() {
            return Ok(());
        }
        self.send(
            reqwest::Method::POST,
            "liveChat/messages",
            &[("part", "snippet")],
            Some(json!({ "snippet": { "liveChatId": live_chat_id, "type": "textMessageEvent", "textMessageDetails": { "messageText": text } } })),
        )
        .await?;
        // Show it right away instead of after the next poll.
        self.chat.lock().await.next_poll_ms = 0;
        Ok(())
    }

    pub async fn delete_message(&self, id: &str) -> Result<(), AppError> {
        self.send(reqwest::Method::DELETE, "liveChat/messages", &[("id", id)], None).await?;
        let mut chat = self.chat.lock().await;
        for m in chat.messages.iter_mut().filter(|m| m.id == id) {
            m.deleted = true;
        }
        Ok(())
    }

    /// Hides a user from the chat: for `seconds` (timeout) or for good (None).
    pub async fn ban(&self, channel_id: &str, seconds: Option<u32>) -> Result<(), AppError> {
        let live_chat_id = self.chat.lock().await.live_chat_id.clone();
        let mut snippet = json!({
            "liveChatId": live_chat_id,
            "type": if seconds.is_some() { "temporary" } else { "permanent" },
            "bannedUserDetails": { "channelId": channel_id },
        });
        if let Some(s) = seconds {
            snippet["banDurationSeconds"] = json!(s);
        }
        self.send(reqwest::Method::POST, "liveChat/bans", &[("part", "snippet")], Some(json!({ "snippet": snippet }))).await?;
        Ok(())
    }
}
