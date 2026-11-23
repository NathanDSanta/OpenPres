//! The manager's and the setup window's frame: no system title bar. The window buttons
//! (`titlebar.js`, run on every page the window loads) sit in OpenPres's own top bar, float
//! in the corner of pages without one, or (an older server's pages) get a slim bar. On
//! macOS the system keeps its traffic lights, over the page.

use tauri::{Manager, WebviewWindowBuilder};

const SCRIPT: &str = include_str!("titlebar.js");

pub(crate) fn with_title_bar<'a, R: tauri::Runtime, M: Manager<R>>(
    builder: WebviewWindowBuilder<'a, R, M>,
) -> WebviewWindowBuilder<'a, R, M> {
    let builder = builder.initialization_script(SCRIPT);
    #[cfg(target_os = "macos")]
    {
        builder.title_bar_style(tauri::TitleBarStyle::Overlay).hidden_title(true)
    }
    #[cfg(not(target_os = "macos"))]
    {
        // Windows keeps the shadow (and the rounded corners on Windows 11) of a framed window.
        builder.decorations(false).shadow(true)
    }
}
