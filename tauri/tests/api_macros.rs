//! Macros through the real router: only the admin sets them up, anyone runs them, the steps
//! run in order (a step that fails doesn't stop the rest), and a running macro can be stopped.

use axum::{
    body::Body,
    extract::ConnectInfo,
    http::{header, Request},
    Router,
};
use http_body_util::BodyExt;
use openpres_lib::{api, build_app, config::AppConfig, devices::mock::demo_registry, screens::physical::StaticDisplays, state::SharedState};
use serde_json::{json, Value};
use std::{net::SocketAddr, time::Duration};
use tower::ServiceExt;

struct App {
    _state: SharedState,
    router: Router,
    _dir: tempfile::TempDir,
}

fn app() -> App {
    let dir = tempfile::tempdir().unwrap();
    let config = AppConfig::load_from(dir.path().to_path_buf()).unwrap();
    let state = build_app(config, demo_registry(), Box::new(StaticDisplays(vec![])), dir.path().join("frontend")).unwrap();
    let router = api::build_router(state.clone());
    App { _state: state, router, _dir: dir }
}

/// From another device, with these cookies (none before logging in).
async fn call(app: &App, cookies: &str, method: &str, uri: &str, body: Option<Value>) -> (u16, Value, Vec<String>) {
    let mut req = Request::builder().method(method).uri(uri);
    if !cookies.is_empty() {
        req = req.header(header::COOKIE, cookies);
    }
    let body = match body {
        Some(b) => {
            req = req.header(header::CONTENT_TYPE, "application/json");
            Body::from(b.to_string())
        }
        None => Body::empty(),
    };
    let mut req = req.body(body).unwrap();
    req.extensions_mut().insert(ConnectInfo(SocketAddr::from(([192, 168, 1, 20], 50000))));
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

async fn logins(app: &App) -> (String, String) {
    // From this computer, before anything is set up.
    let req = Request::builder().method("POST").uri("/api/setup").header(header::CONTENT_TYPE, "application/json");
    let body = json!({ "name": "Main hall", "admin_password": "admin-pw", "operator_password": "op-pw", "remote_access": false });
    let res = app.router.clone().oneshot(req.body(Body::from(body.to_string())).unwrap()).await.unwrap();
    assert_eq!(res.status().as_u16(), 200, "setup");
    let login = |password: &'static str, role: &'static str| async move {
        let (status, _, cookies) = call(app, "", "POST", "/api/auth/login", Some(json!({ "password": password, "role": role }))).await;
        assert_eq!(status, 200, "login as {role}");
        cookies.join("; ")
    };
    let operator = login("op-pw", "operator").await;
    let admin = login("admin-pw", "admin").await;
    (operator, admin)
}

/// Waits until no macro runs (at most two seconds) and returns the status.
async fn settled(app: &App, cookies: &str) -> Value {
    for _ in 0..100 {
        let (_, status, _) = call(app, cookies, "GET", "/api/macros/status", None).await;
        if status["running"].as_array().is_some_and(|r| r.is_empty()) {
            return status;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("the macro kept running");
}

#[tokio::test]
async fn the_admin_sets_up_macros_and_anyone_runs_them() {
    let app = app();
    let (operator, admin) = logins(&app).await;
    let (status, timer, _) = call(&app, &operator, "POST", "/api/timers", Some(json!({ "name": "Sermon", "kind": { "type": "countdown", "seconds": 1800 } }))).await;
    assert_eq!(status, 201);
    let timer_id = timer["id"].as_str().unwrap().to_string();

    let id = "7d8f0c1e-1111-4b8e-9a5e-2c3d4e5f6a7b";
    let file = json!({ "macros": [{
        "id": id, "name": "Start the sermon", "icon": "Mic", "color": "#B49AFF",
        "steps": [
            { "type": "next", "layer": "slides" },
            { "type": "wait", "seconds": 0.05 },
            { "type": "timer", "timer_id": timer_id, "action": "start" },
            { "type": "mute", "bus": 2, "muted": true }
        ],
        "triggers": [{ "type": "service", "minutes_before": 30 }]
    }]});
    assert_eq!(call(&app, &operator, "PUT", "/api/macros", Some(file.clone())).await.0, 403, "only the admin sets them up");
    assert_eq!(call(&app, &admin, "PUT", "/api/macros", Some(file)).await.0, 200);
    let (_, saved, _) = call(&app, &operator, "GET", "/api/macros", None).await;
    assert_eq!(saved["macros"][0]["steps"].as_array().unwrap().len(), 4);

    let run = format!("/api/macros/{id}/run");
    assert_eq!(call(&app, &operator, "POST", &run, Some(json!({ "from": "stream_deck" }))).await.0, 200);
    let status = settled(&app, &operator).await;
    let last = &status["recent"][0];
    assert_eq!(last["why"], "Stream Deck");
    assert_eq!(last["finished"], true);
    // Nothing was live to move: that step failed, and the rest still ran.
    let errors = last["errors"].as_array().unwrap();
    assert_eq!(errors.len(), 1);
    assert!(errors[0].as_str().unwrap().starts_with("Step 1: nothing is live"), "{errors:?}");
    let (_, timers, _) = call(&app, &operator, "GET", "/api/timers", None).await;
    assert_eq!(timers[0]["running"], true);
    let (_, audio, _) = call(&app, &operator, "GET", "/api/audio", None).await;
    assert_eq!(audio["config"]["buses"][1]["muted"], true);

    assert_eq!(call(&app, &operator, "POST", "/api/macros/00000000-0000-0000-0000-000000000000/run", None).await.0, 404);
}

#[tokio::test]
async fn a_running_macro_runs_once_and_can_be_stopped() {
    let app = app();
    let (operator, admin) = logins(&app).await;
    let id = "3a1e5c77-2222-4b8e-9a5e-2c3d4e5f6a7b";
    let file = json!({ "macros": [{
        "id": id, "name": "Long pause", "icon": "Hourglass", "color": "#E5484D",
        "steps": [{ "type": "wait", "seconds": 30 }, { "type": "mute", "bus": 3, "muted": true }]
    }]});
    assert_eq!(call(&app, &admin, "PUT", "/api/macros", Some(file)).await.0, 200);
    let run = format!("/api/macros/{id}/run");
    assert_eq!(call(&app, &operator, "POST", &run, None).await.0, 200);
    assert_eq!(call(&app, &operator, "POST", &run, None).await.0, 409, "already running");
    let (_, status, _) = call(&app, &operator, "GET", "/api/macros/status", None).await;
    assert_eq!(status["running"], json!([id]));

    assert_eq!(call(&app, &operator, "POST", &format!("/api/macros/{id}/stop"), None).await.0, 200);
    let status = settled(&app, &operator).await;
    assert_eq!(status["recent"][0]["stopped"], true);
    assert_eq!(status["recent"][0]["why"], "By hand");
    let (_, audio, _) = call(&app, &operator, "GET", "/api/audio", None).await;
    assert_eq!(audio["config"]["buses"][2]["muted"], false, "the steps after the pause didn't run");
    assert_eq!(call(&app, &operator, "POST", &format!("/api/macros/{id}/stop"), None).await.0, 409);
}
