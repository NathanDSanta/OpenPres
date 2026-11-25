//! The server: first-run setup, operator and admin logins, power states, output windows
//! and default dashboards, through the real router.

use axum::{
    body::Body,
    extract::ConnectInfo,
    http::{header, Request},
    Router,
};
use http_body_util::BodyExt;
use openpres_lib::{
    api, build_app,
    config::{AppConfig, Power},
    devices::mock::demo_registry,
    screens::{
        detect_displays,
        physical::{PhysicalDisplay, StaticDisplays},
    },
    server,
    state::SharedState,
};
use serde_json::{json, Value};
use std::net::SocketAddr;
use tower::ServiceExt;

struct App {
    state: SharedState,
    router: Router,
    _dir: tempfile::TempDir,
}

fn app() -> App {
    let dir = tempfile::tempdir().unwrap();
    let config = AppConfig::load_from(dir.path().to_path_buf()).unwrap();
    let displays = StaticDisplays(vec![PhysicalDisplay {
        id: "HDMI-1@0,0".into(),
        name: "Projector".into(),
        width: 1920,
        height: 1080,
        position: (0, 0),
    }]);
    let state = build_app(config, demo_registry(), Box::new(displays), dir.path().join("frontend")).unwrap();
    let router = api::build_router(state.clone());
    App { state, router, _dir: dir }
}

/// Who sends a request.
#[derive(Clone, Copy)]
enum From<'a> {
    /// This computer, without a login.
    Local,
    /// Another device on the network, with these cookies.
    Remote(&'a str),
}

async fn call(app: &App, from: From<'_>, method: &str, uri: &str, body: Option<Value>, mode: Option<&str>) -> (u16, Value, Vec<String>) {
    let mut req = Request::builder().method(method).uri(uri);
    if let Some(mode) = mode {
        req = req.header("x-openpres-mode", mode);
    }
    if let From::Remote(cookies) = from {
        if !cookies.is_empty() {
            req = req.header(header::COOKIE, cookies);
        }
    }
    let body = match body {
        Some(b) => {
            req = req.header(header::CONTENT_TYPE, "application/json");
            Body::from(b.to_string())
        }
        None => Body::empty(),
    };
    let mut req = req.body(body).unwrap();
    if let From::Remote(_) = from {
        req.extensions_mut().insert(ConnectInfo(SocketAddr::from(([192, 168, 1, 20], 50000))));
    }
    let res = app.router.clone().oneshot(req).await.unwrap();
    let status = res.status().as_u16();
    let cookies = res
        .headers()
        .get_all(header::SET_COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .map(|v| v.split(';').next().unwrap_or("").to_string())
        .collect();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null), cookies)
}

async fn set_up(app: &App) {
    let (status, _, _) = call(
        app,
        From::Local,
        "POST",
        "/api/setup",
        Some(json!({ "name": "Main hall", "admin_password": "admin-pw", "operator_password": "op-pw", "remote_access": false })),
        None,
    )
    .await;
    assert_eq!(status, 200);
}

async fn login(app: &App, password: &str, role: &str) -> String {
    let (status, _, cookies) = call(app, From::Remote(""), "POST", "/api/auth/login", Some(json!({ "password": password, "role": role })), None).await;
    assert_eq!(status, 200, "login as {role}");
    cookies.join("; ")
}

#[tokio::test]
async fn setup_happens_once_and_only_on_this_computer() {
    let app = app();
    let (_, info, _) = call(&app, From::Remote(""), "GET", "/api/server", None, None).await;
    assert_eq!(info["set_up"], false);
    // Before setup this computer may do everything, other devices nothing.
    assert_eq!(call(&app, From::Local, "GET", "/api/screens", None, None).await.0, 200);
    assert_eq!(call(&app, From::Remote(""), "GET", "/api/screens", None, None).await.0, 401);
    let body = json!({ "name": "x", "admin_password": "admin-pw", "operator_password": "op-pw" });
    assert_eq!(call(&app, From::Remote(""), "POST", "/api/setup", Some(body.clone()), None).await.0, 403);

    set_up(&app).await;
    let (_, info, _) = call(&app, From::Remote(""), "GET", "/api/server", None, None).await;
    assert_eq!((info["set_up"].clone(), info["name"].clone()), (json!(true), json!("Main hall")));
    assert_eq!(call(&app, From::Local, "POST", "/api/setup", Some(body), None).await.0, 409, "only once");
    // Now this computer logs in like everyone else.
    assert_eq!(call(&app, From::Local, "GET", "/api/screens", None, None).await.0, 401);
}

#[tokio::test]
async fn operators_manage_and_only_the_admin_changes_general_settings() {
    let app = app();
    set_up(&app).await;
    let (status, _, _) = call(&app, From::Remote(""), "POST", "/api/auth/login", Some(json!({ "password": "nope" })), None).await;
    assert_eq!(status, 401);

    let operator = login(&app, "op-pw", "operator").await;
    assert_eq!(call(&app, From::Remote(&operator), "GET", "/api/screens", None, None).await.0, 200);
    let (_, status_body, _) = call(&app, From::Remote(&operator), "GET", "/api/auth/status", None, None).await;
    assert_eq!((status_body["authenticated"].clone(), status_body["admin"].clone()), (json!(true), json!(false)));
    let rename = json!({ "name": "Chapel" });
    assert_eq!(call(&app, From::Remote(&operator), "PUT", "/api/server", Some(rename.clone()), None).await.0, 403);
    assert_eq!(
        call(&app, From::Remote(&operator), "PUT", "/api/config/security", Some(json!({ "operator_password": "new-op" })), None).await.0,
        403
    );
    // The operator password doesn't open the admin.
    let (status, _, _) = call(&app, From::Remote(""), "POST", "/api/auth/login", Some(json!({ "password": "op-pw", "role": "admin" })), None).await;
    assert_eq!(status, 401);

    let admin = login(&app, "admin-pw", "admin").await;
    let both = format!("{operator}; {admin}");
    assert_eq!(call(&app, From::Remote(&both), "PUT", "/api/server", Some(rename), None).await.0, 200);
    assert_eq!(app.state.config.read().await.display_name(), "Chapel");

    // Leaving admin keeps the operator login.
    let (status, _, cookies) = call(&app, From::Remote(&both), "POST", "/api/auth/logout", Some(json!({ "role": "admin" })), None).await;
    assert_eq!(status, 200);
    assert!(cookies.iter().any(|c| c == "openpres_admin="));
    assert_eq!(call(&app, From::Remote(&both), "PUT", "/api/server", Some(json!({ "name": "x" })), None).await.0, 403);
    assert_eq!(call(&app, From::Remote(&operator), "GET", "/api/screens", None, None).await.0, 200);

    // A new operator password logs every manager out.
    let admin = login(&app, "admin-pw", "admin").await;
    let (status, _, _) = call(&app, From::Remote(&admin), "PUT", "/api/config/security", Some(json!({ "operator_password": "new-op" })), None).await;
    assert_eq!(status, 200);
    assert_eq!(call(&app, From::Remote(&operator), "GET", "/api/screens", None, None).await.0, 401);
    login(&app, "new-op", "operator").await;
}

#[tokio::test]
async fn standby_shows_nothing_and_sleep_only_wakes_up() {
    let app = app();
    set_up(&app).await;
    let op = login(&app, "op-pw", "operator").await;
    let standby = json!({ "power": "standby" });
    // The livestream operator can't switch the server.
    assert_eq!(call(&app, From::Remote(&op), "PUT", "/api/power", Some(standby.clone()), Some("livestream")).await.0, 403);
    assert_eq!(call(&app, From::Remote(&op), "PUT", "/api/power", Some(standby), Some("stage")).await.0, 200);
    assert_eq!(app.state.config.read().await.power, Power::Standby);
    // On standby: no streaming, but managing works.
    assert_eq!(call(&app, From::Remote(&op), "POST", "/api/stream/start", None, Some("all")).await.0, 409);
    let screen = json!({ "name": "Lobby", "kind": "audience" });
    assert_eq!(call(&app, From::Remote(&op), "POST", "/api/screens", Some(screen), None).await.0, 201);

    assert_eq!(call(&app, From::Remote(&op), "PUT", "/api/power", Some(json!({ "power": "sleep" })), Some("stage")).await.0, 200);
    assert_eq!(call(&app, From::Remote(&op), "GET", "/api/screens", None, None).await.0, 409);
    assert_eq!(call(&app, From::Remote(&op), "GET", "/api/server", None, None).await.0, 200);
    assert_eq!(call(&app, From::Remote(&op), "PUT", "/api/power", Some(json!({ "power": "active" })), Some("all")).await.0, 200);
    assert_eq!(call(&app, From::Remote(&op), "GET", "/api/screens", None, None).await.0, 200);
}

#[tokio::test]
async fn output_windows_follow_assignments_visibility_and_power() {
    let app = app();
    let (_, screen, _) = call(&app, From::Local, "POST", "/api/screens", Some(json!({ "name": "Front", "kind": "audience" })), None).await;
    let id = screen["id"].as_str().unwrap().to_string();
    detect_displays(&app.state).await.unwrap();
    assert!(server::plan(&app.state).await.windows.is_empty());

    let binding = json!({ "display_id": "HDMI-1@0,0" });
    let (status, _, _) = call(&app, From::Local, "PUT", &format!("/api/screens/{id}/binding"), Some(binding), None).await;
    assert_eq!(status, 200);
    let plan = server::plan(&app.state).await;
    assert_eq!(plan.windows.len(), 1);
    assert!(plan.windows[0].visible);

    // Escape on the window (or a manager) hides it; it stays assigned.
    let hide = json!({ "visible": false });
    assert_eq!(call(&app, From::Local, "PUT", &format!("/api/outputs/screen/{id}"), Some(hide), None).await.0, 200);
    assert!(!server::plan(&app.state).await.windows[0].visible);
    let (_, outputs, _) = call(&app, From::Local, "GET", "/api/outputs", None, None).await;
    assert_eq!(outputs["outputs"][0]["visible"], false);

    server::set_power(&app.state, Power::Standby).await.unwrap();
    assert!(server::plan(&app.state).await.windows.is_empty(), "nothing shows on standby");
}

#[tokio::test]
async fn monitor_screens_list_other_screens() {
    let app = app();
    let (_, a, _) = call(&app, From::Local, "POST", "/api/screens", Some(json!({ "name": "Front", "kind": "audience" })), None).await;
    let a = a["id"].as_str().unwrap().to_string();
    let body = json!({ "name": "Monitor", "kind": "monitor", "monitor_screens": [a] });
    let (status, m, _) = call(&app, From::Local, "POST", "/api/screens", Some(body), None).await;
    assert_eq!(status, 201);
    assert_eq!(m["monitor_screens"], json!([a]));
    assert!(call(&app, From::Local, "DELETE", &format!("/api/screens/{a}"), None, None).await.0 < 300);
    let (_, list, _) = call(&app, From::Local, "GET", "/api/screens", None, None).await;
    let monitor = list.as_array().unwrap().iter().find(|s| s["kind"] == "monitor").unwrap();
    assert!(monitor.get("monitor_screens").is_none(), "deleted screens leave the monitor");
}

#[tokio::test]
async fn default_dashboards_are_set_by_the_admin() {
    let app = app();
    set_up(&app).await;
    let op = login(&app, "op-pw", "operator").await;
    let admin = login(&app, "admin-pw", "admin").await;
    let dashboard = json!({ "version": 2, "cols": 6, "rows": 4, "scroll": false, "widgets": [] });
    assert_eq!(call(&app, From::Remote(&op), "PUT", "/api/dashboards/defaults/stage", Some(dashboard.clone()), None).await.0, 403);
    assert_eq!(call(&app, From::Remote(&admin), "PUT", "/api/dashboards/defaults/stage", Some(dashboard.clone()), None).await.0, 200);
    let (_, got, _) = call(&app, From::Remote(&op), "GET", "/api/dashboards/defaults/stage", None, None).await;
    assert_eq!(got, dashboard);
    let (_, none, _) = call(&app, From::Remote(&op), "GET", "/api/dashboards/defaults/livestream", None, None).await;
    assert_eq!(none, Value::Null);
}

#[tokio::test]
async fn the_admin_joins_the_beta_program_and_everyone_can_see_it() {
    let app = app();
    set_up(&app).await;
    let admin = login(&app, "admin-pw", "admin").await;
    let operator = login(&app, "op-pw", "operator").await;

    // Anyone (the plugin, the apps) can see the version and whether betas are wanted.
    let (status, health, _) = call(&app, From::Remote(""), "GET", "/api/health", None, None).await;
    assert_eq!(status, 200);
    assert_eq!(health["beta_program"], false);
    assert_eq!(health["version_name"], openpres_lib::updates::display_version(env!("CARGO_PKG_VERSION")));
    assert_eq!(call(&app, From::Remote(&admin), "GET", "/api/server", None, None).await.1["beta_program"], false);

    // Only the admin joins.
    assert_eq!(call(&app, From::Remote(&operator), "PUT", "/api/server", Some(json!({ "beta_program": true })), None).await.0, 403);
    let (status, server, _) = call(&app, From::Remote(&admin), "PUT", "/api/server", Some(json!({ "beta_program": true })), None).await;
    assert_eq!((status, server["beta_program"].clone()), (200, json!(true)));
    assert_eq!(call(&app, From::Remote(""), "GET", "/api/health", None, None).await.1["beta_program"], true);
    assert_eq!(call(&app, From::Remote(&admin), "GET", "/api/server/update", None, None).await.1["beta"], true);

    // Leaving it.
    call(&app, From::Remote(&admin), "PUT", "/api/server", Some(json!({ "beta_program": false })), None).await;
    assert_eq!(call(&app, From::Remote(""), "GET", "/api/health", None, None).await.1["beta_program"], false);
}
