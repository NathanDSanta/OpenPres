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
/// A viewer's login (the Android app): watching screens and listening to buses only.
pub const VIEWER_COOKIE: &str = "openpres_viewer";
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
    /// Watching screens and listening to buses (the Android app): see `viewer_allowed`.
    Viewer,
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
    #[serde(default)]
    viewers: Vec<String>,
}

pub struct AuthState {
    /// Random per run; lets the server's own windows skip the passwords.
    pub internal_key: String,
    /// Operator logins by token hash.
    operators: Mutex<Vec<String>>,
    /// Viewer logins by token hash.
    viewers: Mutex<Vec<String>>,
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
            viewers: Mutex::new(saved.viewers),
            admins: Mutex::new(HashMap::new()),
            file,
        }
    }

    fn save_operators(&self, operators: &[String]) {
        let viewers = self.viewers.lock().unwrap_or_else(|e| e.into_inner()).clone();
        self.save_sessions(operators, &viewers);
    }

    fn save_viewers(&self, viewers: &[String]) {
        let operators = self.operators.lock().unwrap_or_else(|e| e.into_inner()).clone();
        self.save_sessions(&operators, viewers);
    }

    fn save_sessions(&self, operators: &[String], viewers: &[String]) {
        if let Some(file) = &self.file {
            let saved = SavedSessions { operators: operators.to_vec(), viewers: viewers.to_vec() };
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
            Access::Viewer => {
                let mut viewers = self.viewers.lock().unwrap_or_else(|e| e.into_inner());
                viewers.push(token_hash(&token));
                let excess = viewers.len().saturating_sub(500);
                viewers.drain(..excess);
                self.save_viewers(&viewers);
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
        } else if self.viewers.lock().unwrap_or_else(|e| e.into_inner()).iter().any(|h| same(h, &hash)) {
            Access::Viewer
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
        drop(operators);
        let mut viewers = self.viewers.lock().unwrap_or_else(|e| e.into_inner());
        let before = viewers.len();
        viewers.retain(|h| *h != hash);
        if viewers.len() != before {
            self.save_viewers(&viewers);
        }
    }

    /// Logs every viewer out (the viewer password changed, or viewers were turned off).
    pub fn end_viewer_sessions(&self) {
        let mut viewers = self.viewers.lock().unwrap_or_else(|e| e.into_inner());
        viewers.clear();
        self.save_viewers(&viewers);
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
    [cookie_value(req, SESSION_COOKIE), cookie_value(req, ADMIN_COOKIE), cookie_value(req, VIEWER_COOKIE), bearer]
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
    let c = state.config.read().await;
    // Viewers without a password of their own: anyone may watch.
    let open = if c.viewers && !c.viewer_password_set() { Access::Viewer } else { Access::None };
    if credentials.access == Access::Admin || !credentials.loopback {
        return credentials.access.max(open);
    }
    // This computer, before the passwords are set.
    let local = if !c.admin_password_set() {
        Access::Admin
    } else if !c.password_required() {
        Access::Operator
    } else {
        Access::None
    };
    credentials.access.max(local).max(open)
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
        // Checks for itself: only from this computer.
        || (path == "/server/quit" && method == Method::POST)
}

/// What phones with the Translation app may do without a login: see the tracks and listen to
/// one while it's on (translation.rs). Not while the server sleeps.
fn translation_listener(method: &Method, path: &str) -> bool {
    if method != Method::GET && method != Method::HEAD {
        return false;
    }
    let path = api_path(path);
    path == "/translation/tracks"
        || path.strip_prefix("/translation/tracks/").and_then(|rest| rest.strip_suffix("/listen")).is_some_and(|lang| !lang.is_empty() && !lang.contains('/'))
}

/// General settings (and the song groups and import templates): only the admin.
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
        || path == "/import/review/open"
        || path == "/server/update/install"
        || path.starts_with("/dashboards/")
        // Rarely changed, shared by everyone: song groups, import templates, clear groups,
        // screen presets and macros.
        || path == "/groups"
        || path == "/import/templates"
        || path == "/clear-groups"
        || path == "/screen-presets"
        || path == "/macros"
}

/// What viewers (the Android app, or /viewer in a browser) may do: watch the screens and
/// listen to the buses. Nothing else, and nothing that changes anything.
pub fn viewer_allowed(method: &Method, path: &str) -> bool {
    if method != Method::GET && method != Method::HEAD {
        return false;
    }
    let path = api_path(path);
    let under = |prefix: &str, suffix: &str| path.strip_prefix(prefix).is_some_and(|rest| rest.ends_with(suffix) && rest.matches('/').count() == suffix.matches('/').count());
    matches!(path, "/screens" | "/media" | "/fonts" | "/events" | "/revision" | "/viewer" | "/devices/video/frame")
        || under("/screens/", "/render")
        || under("/media/", "/file")
        || under("/audio/buses/", "/listen")
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
    if !public(&method, &path) && !translation_listener(&method, &path) {
        let granted = access(&state, &creds).await;
        if granted == Access::None || (granted == Access::Viewer && !viewer_allowed(&method, &path)) {
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
    fn phones_only_reach_the_translation_tracks() {
        assert!(translation_listener(&Method::GET, "/api/translation/tracks"));
        assert!(translation_listener(&Method::GET, "/api/translation/tracks/es/listen"));
        assert!(!translation_listener(&Method::GET, "/api/translation"));
        assert!(!translation_listener(&Method::PUT, "/api/translation/tracks"));
        assert!(!translation_listener(&Method::GET, "/api/translation/tracks//listen"));
        assert!(!translation_listener(&Method::GET, "/api/translation/tracks/es/x/listen"));
        assert!(!translation_listener(&Method::GET, "/api/audio/buses/1/listen"));
    }

    #[test]
    fn general_settings_are_admin_only() {
        assert!(admin_only(&Method::PUT, "/api/config/security"));
        assert!(admin_only(&Method::PUT, "/api/dashboards/defaults/stage"));
        assert!(!admin_only(&Method::GET, "/api/config"));
        assert!(!admin_only(&Method::PUT, "/api/screens/x"));
        assert!(admin_only(&Method::PUT, "/api/groups"));
        assert!(admin_only(&Method::PUT, "/api/import/templates"));
        assert!(!admin_only(&Method::GET, "/api/groups"));
        assert!(!admin_only(&Method::GET, "/api/import/templates"));
        assert!(admin_only(&Method::PUT, "/api/clear-groups"));
        assert!(!admin_only(&Method::POST, "/api/clear-groups/x/run"));
        assert!(admin_only(&Method::PUT, "/api/screen-presets"));
        assert!(!admin_only(&Method::PUT, "/api/screens/x/preset"));
        assert!(allowed_asleep(&Method::PUT, "/api/power"));
        assert!(!allowed_asleep(&Method::POST, "/api/presenter/next"));
        assert!(public(&Method::GET, "/server") && !public(&Method::PUT, "/server"));
        assert!(!mode_allows(Some("stage"), &Method::POST, "/api/stream/start"));
        assert!(mode_allows(Some("all"), &Method::POST, "/api/stream/start"));
        assert!(!mode_allows(Some("livestream"), &Method::PUT, "/api/power"));
    }
}
