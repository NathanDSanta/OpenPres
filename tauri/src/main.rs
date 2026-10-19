use openpres_lib::{api, build_app, config::AppConfig, devices::DeviceRegistry};

fn main() {
    tracing_subscriber::fmt::init();

    let config = AppConfig::load().expect("failed to load config");
    let port = config.api_port;
    let state =
        build_app(config, DeviceRegistry::new(vec![], vec![])).expect("failed to build app state");

    tauri::Builder::default()
        .setup(move |_app| {
            tauri::async_runtime::spawn(async move {
                if let Err(e) = api::start(state, port).await {
                    tracing::error!("API failed to start: {e}");
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
