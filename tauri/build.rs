fn main() {
    // The app's commands get permissions ("allow-<command>"), so the capabilities can say
    // which pages may call which (see capabilities/). A new command goes in this list.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "api_request",
            "local_server",
            "close_setup",
            "page_log",
        ]),
    ))
    .expect("failed to run tauri-build");
}
