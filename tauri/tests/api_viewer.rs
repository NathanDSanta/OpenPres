//! Viewers (the Android app): off until the admin lets them watch, with or without a password of
//! their own; they see the screens and hear the buses, and nothing else.

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

fn request(method: &str, uri: &str, cookies: &str, body: Option<Value>) -> Request<Body> {
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
    // Another device on the network.
    req.extensions_mut().insert(ConnectInfo(SocketAddr::from(([192, 168, 1, 30], 50000))));
    req
}

async fn call(app: &App, cookies: &str, method: &str, uri: &str, body: Option<Value>) -> (u16, Value, Vec<String>) {
    let res = app.router.clone().oneshot(request(method, uri, cookies, body)).await.unwrap();
    let status = res.status().as_u16();
    let set: Vec<String> = res
        .headers()
        .get_all(header::SET_COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .map(|v| v.split(';').next().unwrap_or("").to_string())
        .collect();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null), set)
}

async fn admin(app: &App) -> String {
    let setup = json!({ "name": "Main hall", "admin_password": "admin-pw", "operator_password": "op-pw", "remote_access": false });
    let mut req = Request::builder().method("POST").uri("/api/setup").header(header::CONTENT_TYPE, "application/json");
    req = req.header(header::ACCEPT, "application/json");
    let res = app.router.clone().oneshot(req.body(Body::from(setup.to_string())).unwrap()).await.unwrap();
    assert_eq!(res.status().as_u16(), 200);
    let (status, _, cookies) = call(app, "", "POST", "/api/auth/login", Some(json!({ "password": "admin-pw", "role": "admin" }))).await;
    assert_eq!(status, 200);
    cookies.join("; ")
}

#[tokio::test]
async fn viewers_watch_and_listen_and_nothing_else() {
    let app = app();
    let admin = admin(&app).await;
    let (_, screen, _) = call(&app, &admin, "POST", "/api/screens", Some(json!({ "name": "Main screen", "kind": "audience" }))).await;
    let render = format!("/api/screens/{}/render", screen["id"].as_str().unwrap());

    // Off: nothing without a login.
    assert_eq!(call(&app, "", "GET", "/api/screens", None).await.0, 401);
    assert_eq!(call(&app, "", "POST", "/api/auth/login", Some(json!({ "password": "", "role": "viewer" }))).await.0, 403);
    let (_, status, _) = call(&app, "", "GET", "/api/auth/status", None).await;
    assert_eq!(status["viewers"], false);

    // On, without a password: anyone watches.
    assert_eq!(call(&app, &admin, "PUT", "/api/config/security", Some(json!({ "viewers": true }))).await.0, 200);
    assert_eq!(call(&app, "", "GET", "/api/screens", None).await.0, 200);
    assert_eq!(call(&app, "", "GET", &render, None).await.0, 200);
    let (status, viewer, _) = call(&app, "", "GET", "/api/viewer", None).await;
    assert_eq!(status, 200);
    assert_eq!(viewer["buses"].as_array().unwrap().len(), 16);
    // ...and nothing else.
    assert_eq!(call(&app, "", "GET", "/api/presenter/state", None).await.0, 401);
    assert_eq!(call(&app, "", "POST", "/api/presenter/next", None).await.0, 401);
    assert_eq!(call(&app, "", "PUT", "/api/screens/x", Some(json!({}))).await.0, 401);

    // With a password of their own.
    assert_eq!(call(&app, &admin, "PUT", "/api/config/security", Some(json!({ "viewer_password": "watch" }))).await.0, 200);
    assert_eq!(call(&app, "", "GET", "/api/screens", None).await.0, 401);
    let (_, status, _) = call(&app, "", "GET", "/api/auth/status", None).await;
    assert_eq!((status["viewers"].clone(), status["viewer_password_required"].clone()), (json!(true), json!(true)));
    assert_eq!(call(&app, "", "POST", "/api/auth/login", Some(json!({ "password": "nope", "role": "viewer" }))).await.0, 401);
    let (status, _, cookies) = call(&app, "", "POST", "/api/auth/login", Some(json!({ "password": "watch", "role": "viewer" }))).await;
    assert_eq!(status, 200);
    let viewer = cookies.join("; ");
    assert!(viewer.starts_with("openpres_viewer="), "{viewer}");
    assert_eq!(call(&app, &viewer, "GET", "/api/screens", None).await.0, 200);
    assert_eq!(call(&app, &viewer, "GET", "/api/timers", None).await.0, 401);
    // The operator password isn't the viewers'.
    assert_eq!(call(&app, "", "POST", "/api/auth/login", Some(json!({ "password": "op-pw", "role": "viewer" }))).await.0, 401);

    // A bus's sound: 50 ms of 48 kHz stereo 16-bit at a time.
    assert_eq!(call(&app, &viewer, "GET", "/api/audio/buses/17/listen", None).await.0, 404);
    let res = app.router.clone().oneshot(request("GET", "/api/audio/buses/1/listen", &viewer, None)).await.unwrap();
    assert_eq!(res.status().as_u16(), 200);
    assert_eq!(res.headers()[header::CONTENT_TYPE], "audio/L16; rate=48000; channels=2");
    let mut body = res.into_body();
    let frame = tokio::time::timeout(Duration::from_secs(2), body.frame()).await.expect("sound in time").unwrap().unwrap();
    assert_eq!(frame.into_data().unwrap().len(), 2400 * 4);

    // A new password logs viewers out; turning viewers off too.
    assert_eq!(call(&app, &admin, "PUT", "/api/config/security", Some(json!({ "viewer_password": "watch2" }))).await.0, 200);
    assert_eq!(call(&app, &viewer, "GET", "/api/screens", None).await.0, 401);
}
