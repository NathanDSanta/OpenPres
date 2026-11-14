//! External programs the app relies on. ffmpeg ships inside the installer (Tauri
//! `externalBin`, placed next to the app executable); a path set in Settings wins, and
//! the system one is the last resort.

use std::path::{Path, PathBuf};

fn exe_name(base: &str) -> String {
    if cfg!(windows) {
        format!("{base}.exe")
    } else {
        base.to_string()
    }
}

fn is_file(p: &Path) -> bool {
    p.is_file()
}

/// The ffmpeg to run. `configured` is the Settings value ("ffmpeg" or empty = automatic).
pub fn ffmpeg(configured: &str) -> String {
    let configured = configured.trim();
    if !configured.is_empty() && configured != "ffmpeg" {
        return configured.to_string();
    }
    if let Some(bundled) = bundled("ffmpeg") {
        return bundled.to_string_lossy().into_owned();
    }
    if let Some(found) = in_path("ffmpeg") {
        return found.to_string_lossy().into_owned();
    }
    // GUI apps on macOS do not get the shell PATH (Homebrew, MacPorts).
    for dir in ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin", "/usr/bin"] {
        let p = Path::new(dir).join(exe_name("ffmpeg"));
        if is_file(&p) {
            return p.to_string_lossy().into_owned();
        }
    }
    "ffmpeg".into()
}

/// A program shipped with the app: next to the executable, or in `binaries/` during
/// development (`tauri dev` runs from target/debug).
pub fn bundled(base: &str) -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    let name = exe_name(base);
    let mut candidates = vec![dir.join(&name)];
    #[cfg(target_os = "macos")]
    candidates.push(dir.join("../Resources").join(&name));
    // tauri dev: target/<profile>/openpres -> ../../binaries/ffmpeg-<triple>
    for up in [dir.join("../../binaries"), dir.join("../../../binaries")] {
        if let Ok(entries) = std::fs::read_dir(&up) {
            for e in entries.flatten() {
                let file = e.file_name().to_string_lossy().into_owned();
                if file.starts_with(&format!("{base}-")) && !file.ends_with(".txt") {
                    candidates.push(e.path());
                }
            }
        }
    }
    // A real ffmpeg is several MB; anything tiny is a placeholder.
    candidates
        .into_iter()
        .find(|p| is_file(p) && std::fs::metadata(p).is_ok_and(|m| m.len() > 1_000_000))
}

fn in_path(base: &str) -> Option<PathBuf> {
    let name = exe_name(base);
    std::env::split_paths(&std::env::var_os("PATH")?)
        .map(|d| d.join(&name))
        .find(|p| is_file(p))
}

/// First line of `ffmpeg -version`, or the error when it cannot run.
pub fn ffmpeg_version(path: &str) -> Result<String, String> {
    let mut cmd = std::process::Command::new(path);
    cmd.arg("-version")
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    no_window(&mut cmd);
    match cmd.output() {
        Ok(out) if out.status.success() => Ok(String::from_utf8_lossy(&out.stdout)
            .lines()
            .next()
            .unwrap_or("ffmpeg")
            .to_string()),
        Ok(out) => Err(format!("ffmpeg exited with {}", out.status)),
        Err(e) => Err(format!("cannot run `{path}`: {e}")),
    }
}

/// Keeps console windows from flashing up on Windows when starting helpers.
pub fn no_window(cmd: &mut std::process::Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    #[cfg(not(windows))]
    let _ = cmd;
}

/// Same for tokio commands.
pub fn no_window_tokio(cmd: &mut tokio::process::Command) {
    #[cfg(windows)]
    {
        cmd.creation_flags(0x0800_0000);
    }
    #[cfg(not(windows))]
    let _ = cmd;
}

/// Opens a web page in the default browser of this computer.
pub fn open_url(url: &str) -> Result<(), String> {
    let mut cmd = if cfg!(windows) {
        let mut c = std::process::Command::new("rundll32");
        c.args(["url.dll,FileProtocolHandler", url]);
        c
    } else if cfg!(target_os = "macos") {
        let mut c = std::process::Command::new("open");
        c.arg(url);
        c
    } else {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(url);
        c
    };
    no_window(&mut cmd);
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}
