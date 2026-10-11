//! Shared test helpers. Builds the real router with mock devices and a temp data dir.
#![allow(dead_code, unused)]
use axum::Router;
use tempfile::TempDir;

pub struct TestApp {
    pub router: Router,
    pub _data_dir: TempDir,
}

pub fn build_test_app() -> TestApp { todo!() }

/// Sends a request through the router without a network socket.
/// Returns (status, parsed JSON body).
pub async fn request(app: &TestApp, method: &str, uri: &str, body: Option<serde_json::Value>) -> (u16, serde_json::Value) {
    todo!()
}
