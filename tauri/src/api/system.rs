use crate::{
    api,
    auth::{self, hash_password, same, SESSION_COOKIE},
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
use uuid::Uuid;

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
    /// New password; "" removes it; absent leaves it unchanged.
    password: Option<String>,
}

async fn put_security(
    State(s): State<SharedState>,
    Json(body): Json<SecurityUpdate>,
) -> Result<Json<Value>, AppError> {
    let mut config = s.config.read().await.clone();
    if let Some(password) = body.password {
        if password.is_empty() {
            config.password_hash = None;
            config.password_salt = None;
        } else {
            if password.len() < 4 {
                return Err(AppError::BadRequest("use a password of at least 4 characters".into()));
            }
            let salt = Uuid::new_v4().simple().to_string();
            config.password_hash = Some(hash_password(&salt, &password));
            config.password_salt = Some(salt);
            s.auth.end_all_sessions();
        }
    }
    if let Some(remote) = body.remote_access {
        config.remote_access = remote;
    }
    if config.remote_access && !config.password_required() {
        return Err(AppError::BadRequest(
            "set a password before allowing access from other devices".into(),
        ));
    }
    let rebind = config.remote_access != s.config.read().await.remote_access;
    if rebind {
        api::restart(s.clone(), config.bind_addr(), config.api_port).await?;
    }
    config.save()?;
    *s.config.write().await = config;
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

async fn auth_status(State(s): State<SharedState>, req: Request) -> Json<Value> {
    let creds = auth::credentials(&s, &req);
    drop(req);
    let required = s.config.read().await.password_required();
    let authenticated = auth::is_authorized(&s, &creds).await;
    Json(json!({ "password_required": required, "authenticated": authenticated }))
}

#[derive(Deserialize)]
struct LoginBody {
    password: String,
}

async fn login(State(s): State<SharedState>, Json(body): Json<LoginBody>) -> Result<Response, AppError> {
    let (hash, salt) = {
        let c = s.config.read().await;
        (c.password_hash.clone(), c.password_salt.clone())
    };
    let (Some(hash), Some(salt)) = (hash, salt) else {
        return Ok(Json(json!({ "authenticated": true })).into_response());
    };
    if !same(&hash_password(&salt, &body.password), &hash) {
        // Slow down guessing.
        tokio::time::sleep(std::time::Duration::from_millis(600)).await;
        return Err(AppError::Unauthorized("wrong password".into()));
    }
    let token = s.auth.new_session();
    let cookie = format!(
        "{SESSION_COOKIE}={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000"
    );
    Ok((
        [(header::SET_COOKIE, cookie)],
        Json(json!({ "authenticated": true, "token": token })),
    )
        .into_response())
}

async fn logout(State(s): State<SharedState>, req: Request) -> Response {
    if let Some(token) = auth::session_token(&req) {
        s.auth.end_session(&token);
    }
    (
        StatusCode::OK,
        [(header::SET_COOKIE, format!("{SESSION_COOKIE}=; Path=/; Max-Age=0"))],
        Json(json!({ "authenticated": false })),
    )
        .into_response()
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
                Ok(AppEvent::Changed { revision }) => {
                    return Some((Ok(Event::default().event("changed").data(revision.to_string())), rx));
                }
                Ok(_) | Err(RecvError::Lagged(_)) => continue,
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
