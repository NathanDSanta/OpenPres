pub mod audio;
pub mod bible;
pub mod convert;
pub mod devices;
pub mod import;
pub mod library;
pub mod live;
pub mod macros;
pub mod media;
pub mod playlist;
pub mod presenter;
pub mod screens;
pub mod stream;
pub mod system;
pub mod themes;
pub mod timers;
pub mod translation;
pub mod viewer;
pub mod server;
pub mod youtube;

use crate::{auth, error::AppError, state::SharedState};
use axum::{
    extract::{Request, State},
    http::Method,
    middleware::{self, Next},
    response::Response,
    Router,
};
use std::net::SocketAddr;
use tokio::{net::TcpListener, sync::oneshot};
use tower_http::{
    cors::{AllowHeaders, AllowMethods, AllowOrigin, CorsLayer},
    services::{ServeDir, ServeFile},
};

/// Every request gets a line in the log file: who, method, path, answer and time. Never the
/// query or the body (keys, passwords).
async fn log_requests(req: Request, next: Next) -> Response {
    let method = req.method().clone();
    let path = req.uri().path().to_string();
    // The server's own windows ask in-process and have no address.
    let from = req
        .extensions()
        .get::<axum::extract::ConnectInfo<SocketAddr>>()
        .map(|c| c.0.ip().to_string())
        .unwrap_or_else(|| "app".into());
    let started = std::time::Instant::now();
    let response = next.run(req).await;
    let status = response.status().as_u16();
    let ms = started.elapsed().as_secs_f64() * 1000.0;
    // Asked over and over (meters 12 times a second, the stream's picture, status checks):
    // only with OPENPRES_LOG=trace, unless they fail.
    let polled = path == "/stream/overlay"
        || (method == Method::GET
            && (matches!(
                path.as_str(),
                "/audio/meters" | "/revision" | "/events" | "/auth/status" | "/server" | "/stream/status"
            ) || path.ends_with("/meta")));
    if status >= 500 {
        tracing::warn!(target: "request", "{from} {method} {path} -> {status} ({ms:.1} ms)");
    } else if status >= 400 && status != 401 {
        tracing::info!(target: "request", "{from} {method} {path} -> {status} ({ms:.1} ms)");
    } else if polled {
        tracing::trace!(target: "request", "{from} {method} {path} -> {status} ({ms:.1} ms)");
    } else {
        tracing::debug!(target: "request", "{from} {method} {path} -> {status} ({ms:.1} ms)");
    }
    response
}

/// Every successful change notifies listening windows/clients.
async fn notify_changes(State(s): State<SharedState>, req: Request, next: Next) -> Response {
    let mutating = req.method() != Method::GET && req.method() != Method::HEAD;
    let path = req.uri().path().to_string();
    let response = next.run(req).await;
    // The stream overlay arrives many times a second and changes nothing others show.
    let quiet = path.ends_with("/stream/overlay") || path.contains("/auth/") || path.ends_with("/meta");
    if mutating && !quiet && response.status().is_success() {
        s.events.changed_topics(vec![topic(&path).to_string()]);
    }
    response
}

/// What a change is about: the API area (`/api/audio/buses/1` -> "audio").
pub fn topic(path: &str) -> &str {
    let path = path.strip_prefix("/api").unwrap_or(path);
    path.trim_start_matches('/').split('/').next().unwrap_or("")
}

/// The desktop windows are served from the app (tauri://localhost on macOS/Linux,
/// http(s)://tauri.localhost on Windows) and talk to this server cross-origin, with
/// credentials. Only those origins and local development servers are allowed;
/// browsers on other devices load the UI from this server itself (same origin).
pub fn is_app_origin(origin: &str) -> bool {
    let local = |rest: &str| {
        let host = rest.split(':').next().unwrap_or("");
        host == "localhost" || host == "127.0.0.1" || host == "[::1]"
    };
    origin == "tauri://localhost"
        || origin == "http://tauri.localhost"
        || origin == "https://tauri.localhost"
        || origin.strip_prefix("http://").is_some_and(local)
}

fn cors() -> CorsLayer {
    CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(|origin, _| {
            origin.to_str().is_ok_and(is_app_origin)
        }))
        .allow_credentials(true)
        .allow_methods(AllowMethods::mirror_request())
        .allow_headers(AllowHeaders::mirror_request())
        .expose_headers([axum::http::header::CONTENT_TYPE])
}

/// Axum 0.7 path params use `/:id` syntax.
pub fn build_router(state: SharedState) -> Router {
    let frontend_dir = state.frontend_dir.clone();

    let api = Router::new()
        .merge(system::routes())
        .merge(server::routes())
        .merge(library::routes())
        .merge(import::routes())
        .merge(playlist::routes())
        .merge(themes::routes())
        .merge(devices::routes())
        .merge(audio::routes())
        .merge(screens::routes())
        .merge(presenter::routes())
        .merge(live::routes())
        .merge(timers::routes())
        .merge(macros::routes())
        .merge(media::routes())
        .merge(convert::routes())
        .merge(stream::routes())
        .merge(viewer::routes())
        .merge(translation::routes())
        .merge(bible::routes())
        .merge(youtube::routes())
        .merge(system::font_routes())
        .layer(middleware::from_fn_with_state(state.clone(), notify_changes))
        .layer(middleware::from_fn_with_state(state.clone(), auth::require_auth))
        .layer(cors())
        .layer(middleware::from_fn(log_requests))
        .with_state(state);

    let frontend = ServeDir::new(&frontend_dir)
        .fallback(ServeFile::new(frontend_dir.join("index.html")));

    Router::new()
        .nest("/api", api)
        .fallback_service(frontend)
        .layer(middleware::from_fn(cache_headers))
}

/// Managers keep the interface in their cache: the page itself is checked every time (so
/// an updated server shows its new interface), the files it loads (named by their content)
/// are kept for good.
async fn cache_headers(req: Request, next: Next) -> Response {
    let path = req.uri().path().to_string();
    let mut response = next.run(req).await;
    if path.starts_with("/api") {
        return response;
    }
    let value = if path.starts_with("/assets/") { "public, max-age=31536000, immutable" } else { "no-cache" };
    if let Ok(value) = axum::http::HeaderValue::from_str(value) {
        response.headers_mut().insert(axum::http::header::CACHE_CONTROL, value);
    }
    response
}

/// Binds the port and runs the server in the background.
/// Returns as soon as the port is bound, so bind errors are reported immediately.
pub async fn start(state: SharedState, port: u16) -> Result<(), AppError> {
    let addr = state.config.read().await.bind_addr();
    let listener = bind(addr, port).await?;
    spawn_server(state, listener).await;
    Ok(())
}

/// Moves the server to a new port/address. If it can't be bound, the old server keeps
/// running (or is restored) and an error is returned.
pub async fn restart(state: SharedState, addr: [u8; 4], port: u16) -> Result<(), AppError> {
    match bind(addr, port).await {
        Ok(listener) => {
            if let Some(old) = spawn_server(state, listener).await {
                let _ = old.send(());
            }
            Ok(())
        }
        Err(first_error) => {
            // Same port, different interface (localhost <-> network): the old listener must
            // be released before the new one can bind.
            let (old_addr, old_port) = {
                let c = state.config.read().await;
                (c.bind_addr(), c.api_port)
            };
            if old_port != port {
                return Err(first_error);
            }
            if let Some(old) = state.server_shutdown.lock().await.take() {
                let _ = old.send(());
            }
            for _ in 0..20 {
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                if let Ok(listener) = bind(addr, port).await {
                    spawn_server(state, listener).await;
                    return Ok(());
                }
            }
            if let Ok(listener) = bind(old_addr, old_port).await {
                spawn_server(state, listener).await;
            }
            Err(first_error)
        }
    }
}

async fn bind(addr: [u8; 4], port: u16) -> Result<TcpListener, AppError> {
    TcpListener::bind(SocketAddr::from((addr, port)))
        .await
        .map_err(|e| AppError::Conflict(format!("cannot bind port {port}: {e}")))
}

/// Starts serving on `listener` and returns the previous server's shutdown handle, if any.
async fn spawn_server(state: SharedState, listener: TcpListener) -> Option<oneshot::Sender<()>> {
    let (tx, rx) = oneshot::channel::<()>();
    let app = build_router(state.clone());

    if let Ok(addr) = listener.local_addr() {
        tracing::info!("API listening on http://{addr}");
    }
    tokio::spawn(async move {
        let result = axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
            .with_graceful_shutdown(async move {
                let _ = rx.await;
            })
            .await;
        if let Err(e) = result {
            tracing::error!("API server error: {e}");
        }
    });

    state.server_shutdown.lock().await.replace(tx)
}
