//! OpenPres's own title bar for its framed windows (the manager and the server's setup).
//!
//! The bar is a script (`titlebar.js`) the window runs on every page it loads, so it's
//! there on the manager's server list and on a server's interface alike, whichever version
//! the server is. On Windows and Linux the system frame is off and the bar has the window
//! buttons; on macOS the system keeps its traffic lights, drawn over the bar.

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
