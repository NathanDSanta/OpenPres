//! Who may use the API, and for what.
//!
//! - The server's own windows (outputs, stream renderer, setup) carry a random per-run
//!   internal key: full access.
//! - Managers (the desktop manager, a browser, an iPad) log in with the operator password
//!   (every mode except Admin) and, for general settings, with the admin password. The
//!   operator login is remembered on that machine (a cookie, kept on disk by the server
//!   too, so it survives restarts); the admin login lasts until the manager closes.
//! - Before the passwords are set (first run, development, tests) this computer itself
//!   may do everything; other devices nothing.

use crate::{config::Power, state::SharedState};
use axum::{
    extract::{ConnectInfo, Request, State},
    http::{header, Method, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    net::SocketAddr,
    path::PathBuf,
    sync::Mutex,
    time::{Duration, Instant},
};
use uuid::Uuid;

/// The operator login (long lived).
pub const SESSION_COOKIE: &str = "openpres_session";
/// The admin login (until the manager closes).
pub const ADMIN_COOKIE: &str = "openpres_admin";
pub const INTERNAL_HEADER: &str = "x-openpres-key";
/// The manager mode a request comes from (livestream, stage, all, admin).
pub const MODE_HEADER: &str = "x-openpres-mode";

/// An admin login ends after this long even if the manager stays open.
const ADMIN_SESSION: Duration = Duration::from_secs(12 * 3600);

/// What a request may do.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Access {
    None,
    /// Everything except the general settings.
    Operator,
    /// Everything.
    Admin,
}

/// Remembered operator logins: SHA-256 of each token (the tokens themselves are only on
/// the managers), so a copy of this file can't be used to log in.
#[derive(Default, Serialize, Deserialize)]
struct SavedSessions {
    operators: Vec<String>,
}

pub struct AuthState {
    /// Random per run; lets the server's own windows skip the passwords.
    pub internal_key: String,
    /// Operator logins by token hash.
    operators: Mutex<Vec<String>>,
    /// Admin logins: token -> when it ends.
    admins: Mutex<HashMap<String, Instant>>,
    file: Option<PathBuf>,
}

impl Default for AuthState {
    fn default() -> Self {
        Self::load(None)
    }
}

fn new_token() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

fn token_hash(token: &str) -> String {
    hex(&Sha256::digest(token.as_bytes()))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

impl AuthState {
    /// `file`: where operator logins are kept (None: only in memory).
    pub fn load(file: Option<PathBuf>) -> Self {
        let saved: SavedSessions = file
            .as_ref()
            .filter(|f| f.exists())
            .and_then(|f| crate::storage::read_json(f).ok())
            .unwrap_or_default();
        Self {
            internal_key: new_token(),
            operators: Mutex::new(saved.operators),
            admins: Mutex::new(HashMap::new()),
            file,
        }
    }

    fn save_operators(&self, operators: &[String]) {
        if let Some(file) = &self.file {
            let saved = SavedSessions { operators: operators.to_vec() };
            if let Err(e) = crate::storage::write_json(file, &saved) {
                tracing::warn!("could not save the logins: {e}");
            }
        }
    }

    pub fn new_session(&self, access: Access) -> String {
        let token = new_token();
        match access {
            Access::Admin => {
                self.admins.lock().unwrap_or_else(|e| e.into_inner()).insert(token.clone(), Instant::now() + ADMIN_SESSION);
            }
            Access::Operator => {
                let mut operators = self.operators.lock().unwrap_or_else(|e| e.into_inner());
                operators.push(token_hash(&token));
                // Keep the newest few hundred machines.
                let excess = operators.len().saturating_sub(500);
                operators.drain(..excess);
                self.save_operators(&operators);
            }
            Access::None => {}
        }
        token
    }

    /// What a login token allows.
    pub fn session_access(&self, token: &str) -> Access {
        {
            let mut admins = self.admins.lock().unwrap_or_else(|e| e.into_inner());
            match admins.get(token) {
                Some(ends) if *ends > Instant::now() => return Access::Admin,
                Some(_) => {
                    admins.remove(token);
                }
                None => {}
            }
        }
        let hash = token_hash(token);
        if self.operators.lock().unwrap_or_else(|e| e.into_inner()).iter().any(|h| same(h, &hash)) {
            Access::Operator
        } else {
            Access::None
        }
    }

    pub fn end_session(&self, token: &str) {
        self.admins.lock().unwrap_or_else(|e| e.into_inner()).remove(token);
        let hash = token_hash(token);
        let mut operators = self.operators.lock().unwrap_or_else(|e| e.into_inner());
        let before = operators.len();
        operators.retain(|h| *h != hash);
        if operators.len() != before {
            self.save_operators(&operators);
        }
    }

    /// Logs every manager out of operator access (the operator password changed).
    pub fn end_operator_sessions(&self) {
        let mut operators = self.operators.lock().unwrap_or_else(|e| e.into_inner());
        operators.clear();
        self.save_operators(&operators);
    }

    /// Ends every admin login (the admin password changed).
    pub fn end_admin_sessions(&self) {
        self.admins.lock().unwrap_or_else(|e| e.into_inner()).clear();
    }
}

pub fn hash_password(salt: &str, password: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(salt.as_bytes());
    hasher.update(b":");
    hasher.update(password.as_bytes());
    hex(&hasher.finalize())
}

/// A new salt and the password's hash with it.
pub fn new_password_hash(password: &str) -> (String, String) {
    let salt = Uuid::new_v4().simple().to_string();
    (hash_password(&salt, password), salt)
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

/// Every login token a request carries (operator and admin cookies, a bearer token).
pub fn session_tokens(req: &Request) -> Vec<String> {
    let bearer = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(str::to_string);
    [cookie_value(req, SESSION_COOKIE), cookie_value(req, ADMIN_COOKIE), bearer]
        .into_iter()
        .flatten()
        .collect()
}

/// What a request carries, read synchronously (a request cannot be held across awaits).
pub struct Credentials {
    /// From the internal key or a login.
    access: Access,
    loopback: bool,
    /// The manager mode it comes from, if it says.
    pub mode: Option<String>,
}

impl Credentials {
    /// From this computer (or from inside the app).
    pub fn local(&self) -> bool {
        self.loopback
    }
}

pub fn credentials(state: &SharedState, req: &Request) -> Credentials {
    let key = &state.auth.internal_key;
    let has_key = req
        .headers()
        .get(INTERNAL_HEADER)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| same(v, key))
        || query_value(req, "k").is_some_and(|v| same(&v, key));
    let access = if has_key {
        Access::Admin
    } else {
        session_tokens(req)
            .iter()
            .map(|t| state.auth.session_access(t))
            .max()
            .unwrap_or(Access::None)
    };
    let loopback = match req.extensions().get::<ConnectInfo<SocketAddr>>() {
        Some(ConnectInfo(addr)) => addr.ip().is_loopback(),
        None => true, // in-process requests
    };
    let mode = req.headers().get(MODE_HEADER).and_then(|v| v.to_str().ok()).map(str::to_string);
    Credentials { access, loopback, mode }
}

/// Blocks other websites open in a browser on this computer from driving the API
/// (they would otherwise pass the "loopback before setup" rule). Requests without
/// an Origin header (the app's own resources, curl, the page itself) pass.
fn origin_allowed(req: &Request) -> bool {
    let Some(origin) = req.headers().get(header::ORIGIN).and_then(|v| v.to_str().ok()) else {
        return true;
    };
    if crate::api::is_app_origin(origin) {
        return true;
    }
    // Same origin: the page was served by this server (a manager or an iPad).
    let host = req.headers().get(header::HOST).and_then(|v| v.to_str().ok()).unwrap_or("");
    origin.split_once("://").is_some_and(|(_, rest)| rest == host)
}

/// What a request with these credentials may do.
pub async fn access(state: &SharedState, credentials: &Credentials) -> Access {
    if credentials.access == Access::Admin || !credentials.loopback {
        return credentials.access;
    }
    // This computer, before the passwords are set.
    let c = state.config.read().await;
    let local = if !c.admin_password_set() {
        Access::Admin
    } else if !c.password_required() {
        Access::Operator
    } else {
        Access::None
    };
    credentials.access.max(local)
}

/// The path inside /api (nested routers may see it with or without the prefix).
fn api_path(path: &str) -> &str {
    path.strip_prefix("/api").unwrap_or(path)
}

/// Endpoints anyone may call: identity, login, setup (which checks for itself).
fn public(method: &Method, path: &str) -> bool {
    let path = api_path(path);
    path == "/health"
        || (path == "/server" && method == Method::GET)
        || path.starts_with("/auth/")
        || path == "/setup"
        || path == "/youtube/oauth/callback"
}

/// General settings: only the admin.
fn admin_only(method: &Method, path: &str) -> bool {
    if method == Method::GET || method == Method::HEAD {
        return false;
    }
    let path = api_path(path);
    path == "/config"
        || path == "/config/security"
        || path == "/server"
        || path == "/ui-settings"
        || path == "/system/open-data-folder"
        || path == "/system/open-logs-folder"
        || path.starts_with("/dashboards/")
}

/// The manager modes split the work: the Stage mode doesn't run the stream, and the
/// Livestream mode doesn't switch the server on or off. (The rest is the manager's to
/// show or hide.)
fn mode_allows(mode: Option<&str>, method: &Method, path: &str) -> bool {
    if method == Method::GET || method == Method::HEAD {
        return true;
    }
    let path = api_path(path);
    match mode {
        Some("stage") => !(path.starts_with("/stream/") || path.starts_with("/youtube/")) || path == "/stream/overlay",
        Some("livestream") => path != "/power",
        _ => true,
    }
}

/// What still works while the server sleeps: waking it up (and logging in to do so).
fn allowed_asleep(method: &Method, path: &str) -> bool {
    let path = api_path(path);
    public(method, path) || path == "/power" || path == "/events" || path == "/revision" || path == "/server"
}

fn error(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({ "error": message }))).into_response()
}

/// Middleware for /api: public endpoints pass; everything else needs operator access,
/// general settings admin access, and a sleeping server only wakes up.
pub async fn require_auth(State(state): State<SharedState>, req: Request, next: Next) -> Response {
    let creds = credentials(&state, &req);
    if creds.access == Access::None && !origin_allowed(&req) {
        return error(StatusCode::FORBIDDEN, "requests from other websites are not allowed");
    }
    let path = req.uri().path().to_string();
    let method = req.method().clone();
    if !public(&method, &path) {
        let granted = access(&state, &creds).await;
        if granted == Access::None {
            return error(StatusCode::UNAUTHORIZED, "login required");
        }
        if granted < Access::Admin && admin_only(&method, &path) {
            return error(StatusCode::FORBIDDEN, "only the admin can change this");
        }
    }
    if !mode_allows(creds.mode.as_deref(), &method, &path) {
        return error(StatusCode::FORBIDDEN, "this manager mode doesn't do that");
    }
    if state.config.read().await.power == Power::Sleep && !allowed_asleep(&method, &path) {
        return error(StatusCode::CONFLICT, "the server is asleep; wake it up first");
    }
    next.run(req).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn operator_logins_survive_a_restart_and_admin_ones_do_not() {
        let dir = std::env::temp_dir().join(format!("openpres-auth-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("sessions.json");
        let auth = AuthState::load(Some(file.clone()));
        let op = auth.new_session(Access::Operator);
        let admin = auth.new_session(Access::Admin);
        assert_eq!(auth.session_access(&op), Access::Operator);
        assert_eq!(auth.session_access(&admin), Access::Admin);
        assert_eq!(auth.session_access("nope"), Access::None);
        assert!(!std::fs::read_to_string(&file).unwrap().contains(&op), "only hashes are kept");

        let restarted = AuthState::load(Some(file.clone()));
        assert_eq!(restarted.session_access(&op), Access::Operator);
        assert_eq!(restarted.session_access(&admin), Access::None);

        restarted.end_operator_sessions();
        assert_eq!(AuthState::load(Some(file)).session_access(&op), Access::None);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn general_settings_are_admin_only() {
        assert!(admin_only(&Method::PUT, "/api/config/security"));
        assert!(admin_only(&Method::PUT, "/api/dashboards/defaults/stage"));
        assert!(!admin_only(&Method::GET, "/api/config"));
        assert!(!admin_only(&Method::PUT, "/api/screens/x"));
        assert!(allowed_asleep(&Method::PUT, "/api/power"));
        assert!(!allowed_asleep(&Method::POST, "/api/presenter/next"));
        assert!(public(&Method::GET, "/server") && !public(&Method::PUT, "/server"));
        assert!(!mode_allows(Some("stage"), &Method::POST, "/api/stream/start"));
        assert!(mode_allows(Some("all"), &Method::POST, "/api/stream/start"));
        assert!(!mode_allows(Some("livestream"), &Method::PUT, "/api/power"));
    }
}
