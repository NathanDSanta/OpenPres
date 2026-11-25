//! Translation tracks: set up in the manager; phones (the Translation app) see them and listen
//! without a login while a track is on, and reach nothing else.

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
async fn phones_listen_to_a_track_while_it_is_on() {
    let app = app();
    let admin = admin(&app).await;

    // Spanish, off, manual, no bus yet.
    let (status, t, _) = call(&app, &admin, "GET", "/api/translation", None).await;
    assert_eq!(status, 200);
    assert_eq!(t["languages"][0]["code"], "es");
    assert_eq!(t["tracks"].as_array().unwrap().len(), 1);
    assert_eq!((t["tracks"][0]["on"].clone(), t["tracks"][0]["mode"].clone(), t["tracks"][0]["live"].clone()), (json!(false), json!("manual"), json!(false)));
    assert_eq!(t["tracks"][0]["problem"], Value::Null);
    // Phones reach the server only with remote access on (set up without it here).
    assert_eq!(t["reachable"], false);

    // Phones see the tracks without a login, and nothing else.
    let (status, phone, _) = call(&app, "", "GET", "/api/translation/tracks", None).await;
    assert_eq!(status, 200);
    assert_eq!(phone["tracks"], json!([{ "language": "es", "name": "Español", "live": false, "captions": false }]));
    assert_eq!(call(&app, "", "GET", "/api/translation", None).await.0, 401);
    assert_eq!(call(&app, "", "PUT", "/api/translation", Some(json!({ "tracks": [] }))).await.0, 401);
    assert_eq!(call(&app, "", "GET", "/api/audio/buses/9/listen", None).await.0, 401);
    let (status, err, _) = call(&app, "", "GET", "/api/translation/tracks/es/listen", None).await;
    assert_eq!((status, err["error"].clone()), (409, json!("conflict: Spanish translation: off")));
    assert_eq!(call(&app, "", "GET", "/api/translation/tracks/fr/listen", None).await.0, 404);

    // On, without a bus: says why phones hear nothing.
    let (_, t, _) = call(&app, &admin, "PUT", "/api/translation", Some(json!({ "tracks": [{ "language": "es", "on": true }] }))).await;
    assert_eq!((t["tracks"][0]["live"].clone(), t["tracks"][0]["problem"].clone()), (json!(false), json!("no interpreter's bus chosen")));
    assert_eq!(call(&app, &admin, "PUT", "/api/translation", Some(json!({ "tracks": [{ "language": "es", "bus": 17 }] }))).await.0, 400);

    // The interpreter's microphone on bus 9.
    let (status, t, _) = call(&app, &admin, "PUT", "/api/translation", Some(json!({ "tracks": [{ "language": "es", "on": true, "mode": "manual", "bus": 9, "source_bus": 1 }] }))).await;
    assert_eq!(status, 200);
    assert_eq!((t["tracks"][0]["live"].clone(), t["tracks"][0]["listeners"].clone()), (json!(true), json!(0)));
    assert_eq!(call(&app, "", "GET", "/api/translation/tracks", None).await.1["tracks"][0]["live"], true);

    // A phone listens: speech, 24 kHz mono, 50 ms at a time.
    let res = app.router.clone().oneshot(request("GET", "/api/translation/tracks/es/listen", "", None)).await.unwrap();
    assert_eq!(res.status().as_u16(), 200);
    assert_eq!(res.headers()[header::CONTENT_TYPE], "audio/L16; rate=24000; channels=1");
    let mut sound = res.into_body();
    let frame = tokio::time::timeout(Duration::from_secs(2), sound.frame()).await.expect("sound in time").unwrap().unwrap();
    assert_eq!(frame.into_data().unwrap().len(), 2400);
    assert_eq!(call(&app, &admin, "GET", "/api/translation", None).await.1["tracks"][0]["listeners"], 1);

    // Automatic: not there yet, so phones are cut off and told why.
    let (_, t, _) = call(&app, &admin, "PUT", "/api/translation", Some(json!({ "tracks": [{ "language": "es", "on": true, "mode": "automatic", "bus": 9, "source_bus": 1 }] }))).await;
    assert_eq!((t["tracks"][0]["live"].clone(), t["tracks"][0]["problem"].clone()), (json!(false), json!("automatic translation isn't available yet")));
    // Both buses are kept for switching back.
    assert_eq!((t["tracks"][0]["bus"].clone(), t["tracks"][0]["source_bus"].clone()), (json!(9), json!(1)));
    let ended = tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            match sound.frame().await {
                None => return,
                Some(Ok(_)) => continue,
                Some(Err(e)) => panic!("{e}"),
            }
        }
    })
    .await;
    assert!(ended.is_ok(), "the phone was cut off");
    assert_eq!(call(&app, "", "GET", "/api/translation/tracks/es/listen", None).await.0, 409);

    // Nothing while the server sleeps.
    call(&app, &admin, "PUT", "/api/translation", Some(json!({ "tracks": [{ "language": "es", "on": true, "bus": 9 }] }))).await;
    assert_eq!(call(&app, &admin, "PUT", "/api/power", Some(json!({ "power": "sleep" }))).await.0, 200);
    assert_eq!(call(&app, "", "GET", "/api/translation/tracks/es/listen", None).await.0, 409);
}
