pub mod audio;
pub mod devices;
pub mod layers;
pub mod library;
pub mod playlist;
pub mod presenter;
pub mod screens;
pub mod system;
pub mod themes;

use crate::{error::AppError, state::SharedState};
use axum::Router;
use std::net::SocketAddr;
use tokio::{net::TcpListener, sync::oneshot};
use tower_http::{cors::CorsLayer, trace::TraceLayer};

/// 127.0.0.1 = only this machine. Use [0, 0, 0, 0] to allow other devices on the network.
pub const BIND_ADDR: [u8; 4] = [127, 0, 0, 1];

/// Axum 0.7 path params use `/:id` syntax.
pub fn build_router(state: SharedState) -> Router {
    Router::new()
        .merge(system::routes())
        .merge(library::routes())
        .merge(playlist::routes())
        .merge(themes::routes())
        .merge(devices::routes())
        .merge(audio::routes())
        .merge(screens::routes())
        .merge(layers::routes())
        .merge(presenter::routes())
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

/// Binds the port and runs the server in the background.
/// Returns as soon as the port is bound, so bind errors are reported immediately.
pub async fn start(state: SharedState, port: u16) -> Result<(), AppError> {
    let listener = bind(port).await?;
    spawn_server(state, listener).await;
    Ok(())
}

/// Moves the server to a new port. If the new port can't be bound, the old
/// server keeps running and an error is returned.
pub async fn restart_on_port(state: SharedState, new_port: u16) -> Result<(), AppError> {
    let listener = bind(new_port).await?;
    if let Some(old) = spawn_server(state, listener).await {
        let _ = old.send(());
    }
    Ok(())
}

async fn bind(port: u16) -> Result<TcpListener, AppError> {
    TcpListener::bind(SocketAddr::from((BIND_ADDR, port)))
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
        let result = axum::serve(listener, app)
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
