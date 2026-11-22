//! The server itself: identity, first-run setup, power (active / standby / asleep), the
//! output windows, and the default dashboards of each manager mode.

use crate::{
    api,
    auth,
    config::Power,
    error::AppError,
    server::{self, MODES},
    state::SharedState,
    workspace,
};
use axum::{
    extract::{Path, Request, State},
    routing::{get, put},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

pub fn routes() -> Router<SharedState> {
    Router::new()
        .route("/server", get(get_server).put(put_server))
        .route("/server/update", get(get_update))
        .route("/server/update/check", axum::routing::post(check_update))
        .route("/server/update/install", axum::routing::post(install_update))
        .route("/setup", get(get_setup).post(post_setup))
        .route("/power", get(get_power).put(put_power))
        .route("/outputs", get(get_outputs))
        .route("/outputs/display/:display", put(put_output))
        .route("/outputs/screen/:id", put(put_screen_output))
        .route("/dashboards/defaults", get(get_dashboards))
        .route(
            "/dashboards/defaults/:mode",
            get(get_dashboard).put(put_dashboard).delete(delete_dashboard),
        )
}

async fn server_json(s: &SharedState) -> Value {
    let mut v = serde_json::to_value(server::info(s).await).unwrap_or_default();
    v["starts_with_computer"] = json!(server::starts_with_computer());
    v
}

/// Updates of this server: the running version, a newer one, what it's doing.
async fn get_update(State(s): State<SharedState>) -> Json<crate::updates::UpdateStatus> {
    Json(s.updates.status())
}

/// Asks GitHub for a newer version now (it also asks by itself every few hours).
async fn check_update(State(s): State<SharedState>) -> Result<Json<crate::updates::UpdateStatus>, AppError> {
    if !s.updates.request(crate::updates::Request::Check) {
        return Err(AppError::Conflict("this server can't update itself (it isn't an installed release)".into()));
    }
    Ok(Json(s.updates.status()))
}

/// Admin: downloads and installs the newer version; the server restarts.
async fn install_update(State(s): State<SharedState>) -> Result<Json<crate::updates::UpdateStatus>, AppError> {
    if s.updates.status().available.is_none() {
        return Err(AppError::Conflict("there is no newer version".into()));
    }
    if !s.updates.request(crate::updates::Request::Install) {
        return Err(AppError::Conflict("this server can't update itself (it isn't an installed release)".into()));
    }
    Ok(Json(s.updates.status()))
}

/// Public: what the server is (managers show it before logging in).
async fn get_server(State(s): State<SharedState>) -> Json<Value> {
    Json(server_json(&s).await)
}

#[derive(Deserialize)]
struct ServerUpdate {
    name: Option<String>,
    starts_with_computer: Option<bool>,
}

/// Admin: rename the server, start it with the computer.
async fn put_server(State(s): State<SharedState>, Json(body): Json<ServerUpdate>) -> Result<Json<Value>, AppError> {
    if let Some(name) = body.name {
        let mut c = s.config.write().await;
        c.server_name = name.trim().chars().take(60).collect();
        c.save()?;
    }
    if let Some(on) = body.starts_with_computer {
        tokio::task::spawn_blocking(move || server::set_starts_with_computer(on))
            .await
            .map_err(|e| AppError::Internal(e.to_string()))??;
    }
    Ok(Json(server_json(&s).await))
}

async fn get_setup(State(s): State<SharedState>) -> Json<Value> {
    let c = s.config.read().await;
    Json(json!({ "set_up": c.set_up(), "name": c.display_name(), "remote_access": c.remote_access }))
}

#[derive(Deserialize)]
struct SetupBody {
    #[serde(default)]
    name: String,
    admin_password: String,
    operator_password: String,
    #[serde(default = "yes")]
    remote_access: bool,
}

fn yes() -> bool {
    true
}

/// First run only, and only from this computer: name and passwords.
async fn post_setup(State(s): State<SharedState>, req: Request) -> Result<Json<Value>, AppError> {
    let local = auth::credentials(&s, &req).local();
    let body: SetupBody = serde_json::from_slice(
        &axum::body::to_bytes(req.into_body(), 64 * 1024).await.map_err(|e| AppError::BadRequest(e.to_string()))?,
    )
    .map_err(|e| AppError::BadRequest(e.to_string()))?;
    if !local {
        return Err(AppError::Forbidden("the server is set up from its own computer".into()));
    }
    let mut config = s.config.read().await.clone();
    if config.set_up() {
        return Err(AppError::Conflict("the server is already set up".into()));
    }
    server::set_up(&mut config, &body.name, &body.admin_password, &body.operator_password, body.remote_access)?;
    let rebind = config.remote_access != s.config.read().await.remote_access;
    if rebind {
        api::restart(s.clone(), config.bind_addr(), config.api_port).await?;
    }
    config.save()?;
    *s.config.write().await = config;
    s.auth.end_operator_sessions();
    s.auth.end_admin_sessions();
    Ok(Json(json!({ "set_up": true })))
}

async fn get_power(State(s): State<SharedState>) -> Json<Value> {
    Json(json!({ "power": s.config.read().await.power }))
}

#[derive(Deserialize)]
struct PowerBody {
    power: Power,
}

/// Active / standby / asleep. Not from the Livestream mode.
async fn put_power(State(s): State<SharedState>, req: Request) -> Result<Json<Value>, AppError> {
    let mode = auth::credentials(&s, &req).mode;
    if mode.as_deref() == Some("livestream") {
        return Err(AppError::Forbidden("the Livestream mode can't switch the server on or off".into()));
    }
    let body: PowerBody = serde_json::from_slice(
        &axum::body::to_bytes(req.into_body(), 4096).await.map_err(|e| AppError::BadRequest(e.to_string()))?,
    )
    .map_err(|e| AppError::BadRequest(e.to_string()))?;
    server::set_power(&s, body.power).await?;
    Ok(Json(json!({ "power": body.power })))
}

async fn get_outputs(State(s): State<SharedState>) -> Json<Value> {
    let active = s.config.read().await.power == Power::Active;
    Json(json!({ "outputs": server::outputs(&s).await, "showing": active }))
}

#[derive(Deserialize)]
struct VisibleBody {
    visible: bool,
}

async fn put_output(
    State(s): State<SharedState>,
    Path(display): Path<String>,
    Json(body): Json<VisibleBody>,
) -> Json<Value> {
    server::set_output_visible(&s, &display, body.visible).await;
    Json(json!({ "outputs": server::outputs(&s).await }))
}

/// Shows or hides the window showing a screen (Escape in the window itself).
async fn put_screen_output(
    State(s): State<SharedState>,
    Path(id): Path<Uuid>,
    Json(body): Json<VisibleBody>,
) -> Result<Json<Value>, AppError> {
    let display = s
        .screens
        .read()
        .await
        .binding_of(id)
        .map(|b| b.physical_display.clone())
        .ok_or_else(|| AppError::NotFound("that screen isn't on a display".into()))?;
    server::set_output_visible(&s, &display, body.visible).await;
    Ok(Json(json!({ "outputs": server::outputs(&s).await })))
}

fn check_mode(mode: &str) -> Result<(), AppError> {
    if MODES.contains(&mode) {
        Ok(())
    } else {
        Err(AppError::NotFound(format!("mode {mode}")))
    }
}

/// The default dashboard of a mode: the admin's, else the old single home page (for the
/// modes that had it), else none (the manager uses its built-in one).
async fn default_dashboard(s: &SharedState, mode: &str) -> Value {
    if let Some(v) = s.dashboards.read().await.value.get(mode).filter(|v| v.is_object()) {
        return v.clone();
    }
    let legacy = s.workspace.read().await.value.clone();
    if legacy.get("widgets").is_some() && matches!(mode, "stage" | "all" | "admin") {
        legacy
    } else {
        Value::Null
    }
}

async fn get_dashboards(State(s): State<SharedState>) -> Json<Value> {
    let mut all = serde_json::Map::new();
    for mode in MODES {
        all.insert(mode.to_string(), default_dashboard(&s, mode).await);
    }
    Json(Value::Object(all))
}

async fn get_dashboard(State(s): State<SharedState>, Path(mode): Path<String>) -> Result<Json<Value>, AppError> {
    check_mode(&mode)?;
    Ok(Json(default_dashboard(&s, &mode).await))
}

/// Admin: this dashboard becomes the mode's default on every manager that resets.
async fn put_dashboard(
    State(s): State<SharedState>,
    Path(mode): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, AppError> {
    check_mode(&mode)?;
    workspace::validate(&body)?;
    let mut doc = s.dashboards.write().await;
    let mut all = doc.value.as_object().cloned().unwrap_or_default();
    all.insert(mode, body.clone());
    doc.replace(Value::Object(all))?;
    Ok(Json(body))
}

async fn delete_dashboard(State(s): State<SharedState>, Path(mode): Path<String>) -> Result<Json<Value>, AppError> {
    check_mode(&mode)?;
    let mut doc = s.dashboards.write().await;
    let mut all = doc.value.as_object().cloned().unwrap_or_default();
    all.remove(&mode);
    doc.replace(Value::Object(all))?;
    Ok(Json(Value::Null))
}
