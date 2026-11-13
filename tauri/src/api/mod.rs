pub mod audio;
pub mod devices;
pub mod library;
pub mod live;
pub mod media;
pub mod playlist;
pub mod presenter;
pub mod screens;
pub mod stream;
pub mod system;
pub mod themes;
pub mod timers;

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
    cors::CorsLayer,
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};

/// Every successful change notifies listening windows/clients.
async fn notify_changes(State(s): State<SharedState>, req: Request, next: Next) -> Response {
    let mutating = req.method() != Method::GET && req.method() != Method::HEAD;
    let path = req.uri().path().to_string();
    let response = next.run(req).await;
    let quiet = path.ends_with("/stream/frame") || path.contains("/auth/") || path.ends_with("/meta");
    if mutating && !quiet && response.status().is_success() {
        s.events.changed();
    }
    response
}

/// Axum 0.7 path params use `/:id` syntax.
pub fn build_router(state: SharedState) -> Router {
    let frontend_dir = state.frontend_dir.clone();

    let api = Router::new()
        .merge(system::routes())
        .merge(library::routes())
        .merge(playlist::routes())
        .merge(themes::routes())
        .merge(devices::routes())
        .merge(audio::routes())
        .merge(screens::routes())
        .merge(presenter::routes())
        .merge(live::routes())
        .merge(timers::routes())
        .merge(media::routes())
        .merge(stream::routes())
        .layer(middleware::from_fn_with_state(state.clone(), notify_changes))
        .layer(middleware::from_fn_with_state(state.clone(), auth::require_auth))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let frontend = ServeDir::new(&frontend_dir)
        .fallback(ServeFile::new(frontend_dir.join("index.html")));

    Router::new().nest("/api", api).fallback_service(frontend)
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
