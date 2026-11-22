use crate::{
    api,
    auth::{self, hash_password, same, Access, ADMIN_COOKIE, SESSION_COOKIE},
    error::AppError,
    events::AppEvent,
    groups::{self, GroupsFile},
    state::SharedState,
    templates::{self, TemplatesFile},
    workspace,
};
use axum::{
    extract::{Request, State},
    http::{header, StatusCode},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
    routing::{get, post, put},
    Json, Router,
};
use futures_util::{stream, Stream, StreamExt};
use serde::Deserialize;
use serde_json::{json, Value};
use std::convert::Infallible;
use tokio::sync::broadcast::error::RecvError;

pub fn routes() -> Router<SharedState> {
    Router::new()
        .route("/health", get(health))
        .route("/config", get(get_config).put(put_config))
        .route("/config/security", put(put_security))
        .route("/network", get(network))
        .route("/auth/status", get(auth_status))
        .route("/auth/login", post(login))
        .route("/auth/logout", post(logout))
        .route("/events", get(events))
        .route("/revision", get(revision))
        .route("/workspace", get(get_workspace).put(put_workspace))
        .route("/ui-settings", get(get_ui_settings).put(put_ui_settings))
        .route("/system/info", get(system_info))
        .route("/system/open-data-folder", post(open_data_folder))
        .route("/groups", get(get_groups).put(put_groups))
        .route("/import/templates", get(get_templates).put(put_templates))
}

async fn health() -> Json<Value> {
    Json(json!({ "status": "ok", "version": env!("CARGO_PKG_VERSION") }))
}

async fn config_json(s: &SharedState) -> Value {
    let c = s.config.read().await;
    json!({
        "api_port": c.api_port,
        "data_dir": c.data_dir,
        "remote_access": c.remote_access,
        "password_set": c.password_required(),
        "admin_password_set": c.admin_password_set(),
        "server_id": c.server_id,
        "server_name": c.server_name,
        "display_name": c.display_name(),
        "ffmpeg_path": c.ffmpeg_path,
        "version": env!("CARGO_PKG_VERSION"),
    })
}

async fn get_config(State(s): State<SharedState>) -> Json<Value> {
    Json(config_json(&s).await)
}

#[derive(Deserialize)]
struct ConfigUpdate {
    api_port: Option<u16>,
    ffmpeg_path: Option<String>,
}

/// Body: {"api_port": 9000, "ffmpeg_path": "ffmpeg"} (both optional).
/// The response is still sent from the old port; later requests go to the new one.
async fn put_config(
    State(s): State<SharedState>,
    Json(body): Json<ConfigUpdate>,
) -> Result<Json<Value>, AppError> {
    if let Some(port) = body.api_port {
        if port < 1024 {
            return Err(AppError::BadRequest("api_port must be between 1024 and 65535".into()));
        }
        let (current, addr) = {
            let c = s.config.read().await;
            (c.api_port, c.bind_addr())
        };
        if port != current {
            api::restart(s.clone(), addr, port).await?;
        }
        s.config.write().await.api_port = port;
    }
    if let Some(path) = body.ffmpeg_path {
        let path = path.trim();
        s.config.write().await.ffmpeg_path = if path.is_empty() { "ffmpeg".into() } else { path.to_string() };
    }
    s.config.read().await.save()?;
    Ok(Json(config_json(&s).await))
}

#[derive(Deserialize)]
struct SecurityUpdate {
    remote_access: Option<bool>,
    /// New operator password; absent leaves it unchanged.
    #[serde(alias = "password")]
    operator_password: Option<String>,
    /// New admin password; absent leaves it unchanged.
    admin_password: Option<String>,
}

/// Admin only: the passwords and whether other devices may connect.
async fn put_security(
    State(s): State<SharedState>,
    Json(body): Json<SecurityUpdate>,
) -> Result<Json<Value>, AppError> {
    let mut config = s.config.read().await.clone();
    let mut operators_out = false;
    let mut admins_out = false;
    if let Some(password) = &body.operator_password {
        crate::server::check_password(password, "operator")?;
        let (hash, salt) = auth::new_password_hash(password);
        config.password_hash = Some(hash);
        config.password_salt = Some(salt);
        operators_out = true;
    }
    if let Some(password) = &body.admin_password {
        crate::server::check_password(password, "admin")?;
        let (hash, salt) = auth::new_password_hash(password);
        config.admin_password_hash = Some(hash);
        config.admin_password_salt = Some(salt);
        admins_out = true;
    }
    if let (Some(op), Some(admin)) = (&config.password_hash, &config.admin_password_hash) {
        let same_password = |password: &Option<String>, hash: &str, salt: &Option<String>| {
            password.as_ref().zip(salt.as_ref()).is_some_and(|(p, salt)| same(&hash_password(salt, p), hash))
        };
        if same_password(&body.operator_password, admin, &config.admin_password_salt)
            || same_password(&body.admin_password, op, &config.password_salt)
        {
            return Err(AppError::BadRequest("the admin and operator passwords must be different".into()));
        }
    }
    if let Some(remote) = body.remote_access {
        config.remote_access = remote;
    }
    if config.remote_access && !config.password_required() {
        return Err(AppError::BadRequest(
            "set an operator password before allowing access from other devices".into(),
        ));
    }
    let rebind = config.remote_access != s.config.read().await.remote_access;
    if rebind {
        api::restart(s.clone(), config.bind_addr(), config.api_port).await?;
    }
    config.save()?;
    *s.config.write().await = config;
    if operators_out {
        s.auth.end_operator_sessions();
    }
    if admins_out {
        s.auth.end_admin_sessions();
    }
    Ok(Json(config_json(&s).await))
}

/// Addresses other devices can use to open the web interface.
async fn network(State(s): State<SharedState>) -> Json<Value> {
    let c = s.config.read().await;
    let mut urls = vec![format!("http://localhost:{}", c.api_port)];
    if let Some(ip) = lan_ip() {
        urls.push(format!("http://{ip}:{}", c.api_port));
    }
    Json(json!({
        "remote_access": c.remote_access,
        "port": c.api_port,
        "urls": urls,
    }))
}

/// The address used for outgoing traffic (no packet is actually sent).
fn lan_ip() -> Option<std::net::IpAddr> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("192.0.2.1:9").ok()?;
    let ip = socket.local_addr().ok()?.ip();
    (!ip.is_loopback() && !ip.is_unspecified()).then_some(ip)
}

// ---------- login ----------

/// Whether this manager is logged in, and how.
async fn auth_status(State(s): State<SharedState>, req: Request) -> Json<Value> {
    let creds = auth::credentials(&s, &req);
    drop(req);
    let access = auth::access(&s, &creds).await;
    let c = s.config.read().await;
    Json(json!({
        "password_required": c.password_required(),
        "set_up": c.set_up(),
        "authenticated": access >= Access::Operator,
        "admin": access == Access::Admin,
        "access": access,
    }))
}

#[derive(Deserialize)]
struct LoginBody {
    password: String,
    /// "admin" for the admin login; otherwise the operator one.
    #[serde(default)]
    role: Option<String>,
}

/// Operator login (remembered on this machine) or admin login (until the manager closes).
/// The admin password also works for the operator login.
async fn login(State(s): State<SharedState>, Json(body): Json<LoginBody>) -> Result<Response, AppError> {
    let admin_wanted = body.role.as_deref() == Some("admin");
    let (operator_ok, admin_ok) = {
        let c = s.config.read().await;
        let check = |hash: &Option<String>, salt: &Option<String>| match (hash, salt) {
            (Some(hash), Some(salt)) => same(&hash_password(salt, &body.password), hash),
            _ => false,
        };
        (check(&c.password_hash, &c.password_salt), check(&c.admin_password_hash, &c.admin_password_salt))
    };
    let granted = match (admin_wanted, operator_ok, admin_ok) {
        (true, _, true) => Access::Admin,
        (false, true, _) | (false, _, true) => Access::Operator,
        _ => {
            // Slow down guessing.
            tokio::time::sleep(std::time::Duration::from_millis(600)).await;
            return Err(AppError::Unauthorized("wrong password".into()));
        }
    };
    let token = s.auth.new_session(granted);
    let cookie = if granted == Access::Admin {
        // No Max-Age: gone when the manager (or browser) closes.
        format!("{ADMIN_COOKIE}={token}; HttpOnly; SameSite=Lax; Path=/")
    } else {
        format!("{SESSION_COOKIE}={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000")
    };
    Ok((
        [(header::SET_COOKIE, cookie)],
        Json(json!({ "authenticated": true, "admin": granted == Access::Admin, "token": token })),
    )
        .into_response())
}

#[derive(Deserialize, Default)]
struct LogoutBody {
    /// "admin": leave admin only; otherwise log out completely.
    #[serde(default)]
    role: Option<String>,
}

async fn logout(State(s): State<SharedState>, req: Request) -> Response {
    let tokens = auth::session_tokens(&req);
    let body: LogoutBody = axum::body::to_bytes(req.into_body(), 4096)
        .await
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();
    let admin_only = body.role.as_deref() == Some("admin");
    for token in tokens {
        let access = s.auth.session_access(&token);
        if access == Access::Admin || !admin_only {
            s.auth.end_session(&token);
        }
    }
    let mut cookies = vec![(header::SET_COOKIE, format!("{ADMIN_COOKIE}=; Path=/; Max-Age=0"))];
    if !admin_only {
        cookies.push((header::SET_COOKIE, format!("{SESSION_COOKIE}=; Path=/; Max-Age=0")));
    }
    let mut response = (StatusCode::OK, Json(json!({ "authenticated": admin_only }))).into_response();
    for (name, value) in cookies {
        if let Ok(value) = value.parse() {
            response.headers_mut().append(name, value);
        }
    }
    response
}

// ---------- change notifications ----------

async fn revision(State(s): State<SharedState>) -> Json<Value> {
    Json(json!({ "revision": s.events.revision() }))
}

/// Server-sent events: `changed` with the new revision whenever anything changes.
async fn events(State(s): State<SharedState>) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let rx = s.events.subscribe();
    let first = s.events.revision();
    let initial = stream::once(async move { Ok(Event::default().event("changed").data(first.to_string())) });
    let updates = stream::unfold(rx, |mut rx| async move {
        loop {
            match rx.recv().await {
                Ok(AppEvent::Changed { revision, topics }) => {
                    // "<revision> <topic>,<topic>": what changed, so pages refetch only that.
                    let data = format!("{revision} {}", topics.join(","));
                    return Some((Ok(Event::default().event("changed").data(data.trim_end())), rx));
                }
                Err(RecvError::Lagged(_)) => continue,
                Err(RecvError::Closed) => return None,
            }
        }
    });
    Sse::new(initial.chain(updates)).keep_alive(KeepAlive::default())
}

// ---------- documents ----------

async fn get_workspace(State(s): State<SharedState>) -> Json<Value> {
    Json(s.workspace.read().await.value.clone())
}

async fn put_workspace(State(s): State<SharedState>, Json(body): Json<Value>) -> Result<Json<Value>, AppError> {
    workspace::validate(&body)?;
    s.workspace.write().await.replace(body.clone())?;
    Ok(Json(body))
}

async fn get_ui_settings(State(s): State<SharedState>) -> Json<Value> {
    Json(s.ui_settings.read().await.value.clone())
}

async fn put_ui_settings(State(s): State<SharedState>, Json(body): Json<Value>) -> Result<Json<Value>, AppError> {
    workspace::validate(&body)?;
    s.ui_settings.write().await.replace(body.clone())?;
    Ok(Json(body))
}

// ---------- fonts ----------

pub fn font_routes() -> Router<SharedState> {
    Router::new().route("/fonts", get(fonts))
}

/// Font families installed on this computer (for the theme editor).
async fn fonts() -> Json<Value> {
    static FAMILIES: std::sync::OnceLock<Vec<String>> = std::sync::OnceLock::new();
    let families = match FAMILIES.get() {
        Some(f) => f.clone(),
        None => {
            let list = tokio::task::spawn_blocking(|| {
                let mut db = fontdb::Database::new();
                db.load_system_fonts();
                let mut names: Vec<String> = db
                    .faces()
                    .filter_map(|f| f.families.first().map(|(n, _)| n.clone()))
                    .filter(|n| !n.starts_with('.'))
                    .collect();
                names.sort_by_key(|n| n.to_lowercase());
                names.dedup();
                names
            })
            .await
            .unwrap_or_default();
            FAMILIES.get_or_init(|| list).clone()
        }
    };
    Json(json!({ "system": families }))
}

// ---------- system information ----------

async fn system_info(State(s): State<SharedState>) -> Json<Value> {
    let (data_dir, port, remote, ffmpeg_setting) = {
        let c = s.config.read().await;
        (c.data_dir.clone(), c.api_port, c.remote_access, c.ffmpeg_path.clone())
    };
    let ffmpeg = crate::tools::ffmpeg(&ffmpeg_setting);
    let ffmpeg_for_version = ffmpeg.clone();
    let ffmpeg_version = tokio::task::spawn_blocking(move || crate::tools::ffmpeg_version(&ffmpeg_for_version))
        .await
        .unwrap_or_else(|e| Err(e.to_string()));
    let bundled = crate::tools::bundled("ffmpeg").is_some_and(|p| p.to_string_lossy() == ffmpeg);
    let (media_count, media_bytes) = {
        let m = s.media.read().await;
        (m.items.len(), m.items.iter().map(|i| i.size).sum::<u64>())
    };
    let presentations = s.libraries.read().await.count_presentations();
    let audio = s.audio.status();
    let bibles = s.bibles.read().await.list().len();
    Json(json!({
        "version": env!("CARGO_PKG_VERSION"),
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "cpus": std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1),
        "uptime_s": s.started_at.elapsed().as_secs(),
        "data_dir": data_dir,
        "api_port": port,
        "remote_access": remote,
        "lan_ip": lan_ip().map(|ip| ip.to_string()),
        "ffmpeg": {
            "path": ffmpeg,
            "bundled": bundled,
            "version": ffmpeg_version.as_ref().ok(),
            "error": ffmpeg_version.as_ref().err(),
        },
        "audio_host": audio.host,
        "open_audio_devices": audio.open_devices,
        "displays": s.screens.read().await.displays.len(),
        "media": { "count": media_count, "bytes": media_bytes },
        "presentations": presentations,
        "bibles": bibles,
    }))
}

/// Opens the data folder in the system file manager (this computer only).
async fn open_data_folder(State(s): State<SharedState>) -> Result<StatusCode, AppError> {
    let dir = s.config.read().await.data_dir.clone();
    let program = if cfg!(windows) {
        "explorer"
    } else if cfg!(target_os = "macos") {
        "open"
    } else {
        "xdg-open"
    };
    let mut cmd = std::process::Command::new(program);
    cmd.arg(&dir);
    crate::tools::no_window(&mut cmd);
    cmd.spawn().map_err(|e| AppError::Internal(format!("cannot open the folder: {e}")))?;
    Ok(StatusCode::NO_CONTENT)
}

async fn get_groups(State(s): State<SharedState>) -> Json<GroupsFile> {
    Json(s.groups.read().await.value.clone())
}

async fn put_groups(State(s): State<SharedState>, Json(mut body): Json<GroupsFile>) -> Result<Json<GroupsFile>, AppError> {
    for class in &mut body.classes {
        class.name = class.name.trim().to_string();
    }
    groups::validate(&body)?;
    s.groups.write().await.replace(body.clone())?;
    Ok(Json(body))
}

async fn get_templates(State(s): State<SharedState>) -> Json<TemplatesFile> {
    Json(s.templates.read().await.value.clone())
}

async fn put_templates(
    State(s): State<SharedState>,
    Json(body): Json<TemplatesFile>,
) -> Result<Json<TemplatesFile>, AppError> {
    templates::validate(&body)?;
    s.templates.write().await.replace(body.clone())?;
    Ok(Json(body))
}
