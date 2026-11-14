//! Access control for the HTTP API. The desktop app talks to the API in-process with an
//! internal key; browsers (e.g. an iPad) log in with the password and get a session cookie.

use crate::state::SharedState;
use axum::{
    extract::{ConnectInfo, Request, State},
    http::{header, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{collections::HashSet, net::SocketAddr, sync::Mutex};
use uuid::Uuid;

pub const SESSION_COOKIE: &str = "openpres_session";
pub const INTERNAL_HEADER: &str = "x-openpres-key";

pub struct AuthState {
    /// Random per run; lets the desktop app (and its windows) bypass the password.
    pub internal_key: String,
    sessions: Mutex<HashSet<String>>,
}

impl Default for AuthState {
    fn default() -> Self {
        Self {
            internal_key: format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple()),
            sessions: Mutex::new(HashSet::new()),
        }
    }
}

impl AuthState {
    pub fn new_session(&self) -> String {
        let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
        self.sessions.lock().unwrap_or_else(|e| e.into_inner()).insert(token.clone());
        token
    }
    pub fn valid_session(&self, token: &str) -> bool {
        self.sessions.lock().unwrap_or_else(|e| e.into_inner()).contains(token)
    }
    pub fn end_session(&self, token: &str) {
        self.sessions.lock().unwrap_or_else(|e| e.into_inner()).remove(token);
    }
    pub fn end_all_sessions(&self) {
        self.sessions.lock().unwrap_or_else(|e| e.into_inner()).clear();
    }
}

pub fn hash_password(salt: &str, password: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(salt.as_bytes());
    hasher.update(b":");
    hasher.update(password.as_bytes());
    hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Constant-time-ish comparison so the hash check does not leak timing.
pub fn same(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn cookie_value(req: &Request, name: &str) -> Option<String> {
    req.headers()
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .filter_map(|pair| pair.trim().split_once('='))
        .find(|(k, _)| *k == name)
        .map(|(_, v)| v.to_string())
}

fn query_value(req: &Request, name: &str) -> Option<String> {
    req.uri()
        .query()?
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .find(|(k, _)| *k == name)
        .map(|(_, v)| v.to_string())
}

pub fn session_token(req: &Request) -> Option<String> {
    cookie_value(req, SESSION_COOKIE).or_else(|| {
        req.headers()
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .map(str::to_string)
    })
}

/// What a request carries, read synchronously (a request cannot be held across awaits).
pub struct Credentials {
    trusted: bool,
    loopback: bool,
}

pub fn credentials(state: &SharedState, req: &Request) -> Credentials {
    let key = &state.auth.internal_key;
    let has_key = req
        .headers()
        .get(INTERNAL_HEADER)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| same(v, key))
        || query_value(req, "k").is_some_and(|v| same(&v, key));
    let has_session = session_token(req).is_some_and(|t| state.auth.valid_session(&t));
    let loopback = match req.extensions().get::<ConnectInfo<SocketAddr>>() {
        Some(ConnectInfo(addr)) => addr.ip().is_loopback(),
        None => true, // in-process requests
    };
    Credentials {
        trusted: has_key || has_session,
        loopback,
    }
}

/// Blocks other websites open in a browser on this computer from driving the API
/// (they would otherwise pass the "loopback without password" rule). Requests without
/// an Origin header (the app's own resources, curl, the iPad page itself) pass.
fn origin_allowed(req: &Request) -> bool {
    let Some(origin) = req.headers().get(header::ORIGIN).and_then(|v| v.to_str().ok()) else {
        return true;
    };
    if crate::api::is_app_origin(origin) {
        return true;
    }
    // Same origin: the page was served by this server (e.g. an iPad on the network).
    let host = req.headers().get(header::HOST).and_then(|v| v.to_str().ok()).unwrap_or("");
    origin.split_once("://").is_some_and(|(_, rest)| rest == host)
}

/// Is a request with these credentials allowed to use the API?
pub async fn is_authorized(state: &SharedState, credentials: &Credentials) -> bool {
    if credentials.trusted {
        return true;
    }
    // Without a password, only this computer may use the API.
    !state.config.read().await.password_required() && credentials.loopback
}

/// Middleware for /api: public endpoints pass, everything else needs authorization.
pub async fn require_auth(State(state): State<SharedState>, req: Request, next: Next) -> Response {
    let creds = credentials(&state, &req);
    if !creds.trusted && !origin_allowed(&req) {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "requests from other websites are not allowed" })),
        )
            .into_response();
    }
    let path = req.uri().path();
    let public = path.ends_with("/health") || path.contains("/auth/") || path.contains("/youtube/oauth/callback");
    if public || is_authorized(&state, &creds).await {
        return next.run(req).await;
    }
    (
        StatusCode::UNAUTHORIZED,
        Json(json!({ "error": "login required" })),
    )
        .into_response()
}
