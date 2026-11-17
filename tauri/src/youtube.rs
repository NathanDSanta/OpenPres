//! YouTube account link (OAuth for installed apps, PKCE + loopback redirect) and the live
//! broadcast lookup (its preview and stream key). Uses the YouTube Data API v3:
//! liveBroadcasts.list, liveStreams.list.
//!
//! The OAuth client (a "Desktop app" client from Google Cloud with the YouTube Data API
//! enabled) is set in Settings, or compiled in with OPENPRES_YT_CLIENT_ID /
//! OPENPRES_YT_CLIENT_SECRET.

use crate::{error::AppError, storage::{now_ms, JsonDoc}};
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use tokio::sync::Mutex;

const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const API: &str = "https://www.googleapis.com/youtube/v3";
const SCOPE: &str = "https://www.googleapis.com/auth/youtube.force-ssl";

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
    pub stream_key: Option<String>,
    pub ingestion_url: Option<String>,
    pub scheduled_start: Option<String>,
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
        json!({
            "configured": c.configured(),
            "built_in_client": c.client_id.trim().is_empty() && c.configured(),
            "client_id": c.client_id,
            "client_secret_set": !c.client_secret.is_empty(),
            "connected": c.connected(),
            "channel_title": c.channel_title,
            "broadcast": broadcast,
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
        *self.broadcast.lock().await = Some(broadcast.clone());
        Ok(Some(broadcast))
    }
}
