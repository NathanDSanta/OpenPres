//! PowerPoint (and other presentation) files turned into PDF, so the Manager can import
//! their slides as pictures. Uses PowerPoint itself on Windows when it is installed, else
//! LibreOffice; without either, the Manager says so (and can still import the text).

use crate::{error::AppError, state::SharedState};
use axum::{
    body::Bytes,
    extract::{DefaultBodyLimit, Query},
    http::header,
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};

/// The longest a conversion may take (a big deck in LibreOffice takes some seconds).
const TIMEOUT: Duration = Duration::from_secs(180);

/// Extensions the converters can open.
const PRESENTATIONS: [&str; 7] = ["pptx", "ppt", "pptm", "ppsx", "pps", "odp", "key"];

pub fn routes() -> Router<SharedState> {
    Router::new().route(
        "/convert/pdf",
        get(info).post(to_pdf).layer(DefaultBodyLimit::max(300 * 1024 * 1024)),
    )
}

#[derive(Debug, Serialize)]
pub struct ConverterInfo {
    /// A presentation can be turned into PDF on the server's computer.
    pub available: bool,
    /// "PowerPoint" or "LibreOffice".
    pub with: Option<&'static str>,
}

#[derive(Deserialize)]
struct ConvertQuery {
    name: String,
}

enum Converter {
    PowerPoint,
    LibreOffice(PathBuf),
}

impl Converter {
    fn label(&self) -> &'static str {
        match self {
            Converter::PowerPoint => "PowerPoint",
            Converter::LibreOffice(_) => "LibreOffice",
        }
    }
}

/// GET /convert/pdf: whether the server can turn presentations into PDF.
async fn info() -> Json<ConverterInfo> {
    let found = tokio::task::spawn_blocking(find_converter).await.ok().flatten();
    Json(ConverterInfo { available: found.is_some(), with: found.map(|c| c.label()) })
}

/// POST /convert/pdf?name=deck.pptx (body: the file) -> the PDF.
async fn to_pdf(Query(q): Query<ConvertQuery>, body: Bytes) -> Result<impl IntoResponse, AppError> {
    let ext = Path::new(&q.name)
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_lowercase)
        .unwrap_or_default();
    if !PRESENTATIONS.contains(&ext.as_str()) {
        return Err(AppError::BadRequest(format!("`.{ext}` files can't be turned into PDF here")));
    }
    let converter = tokio::task::spawn_blocking(find_converter)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
        .ok_or_else(|| {
            AppError::BadRequest(
                "the server's computer needs PowerPoint or LibreOffice to show PowerPoint slides as pictures (or save the file as PDF)".into(),
            )
        })?;

    let work = std::env::temp_dir().join(format!("openpres-convert-{}", uuid::Uuid::new_v4()));
    let result = convert(&converter, &work, &ext, &body).await;
    let _ = tokio::fs::remove_dir_all(&work).await;
    let pdf = result?;
    Ok(([(header::CONTENT_TYPE, "application/pdf")], pdf))
}

async fn convert(converter: &Converter, work: &Path, ext: &str, data: &[u8]) -> Result<Vec<u8>, AppError> {
    let input = work.join(format!("presentation.{ext}"));
    let out_dir = work.join("out");
    tokio::fs::create_dir_all(&out_dir).await?;
    tokio::fs::write(&input, data).await?;

    let mut cmd = match converter {
        Converter::PowerPoint => {
            let mut cmd = tokio::process::Command::new("powershell");
            cmd.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", POWERPOINT_SCRIPT])
                .env("OPENPRES_IN", &input)
                .env("OPENPRES_OUT", out_dir.join("presentation.pdf"));
            cmd
        }
        Converter::LibreOffice(soffice) => {
            let mut cmd = tokio::process::Command::new(soffice);
            cmd.arg("--headless")
                .arg("--norestore")
                .arg("--nolockcheck")
                // Its own profile: works while the user has LibreOffice open.
                .arg(format!("-env:UserInstallation={}", file_url(&work.join("profile"))))
                .arg("--convert-to")
                .arg("pdf")
                .arg("--outdir")
                .arg(&out_dir)
                .arg(&input);
            cmd
        }
    };
    crate::tools::no_window_tokio(&mut cmd);
    cmd.kill_on_drop(true).stdin(std::process::Stdio::null());
    let output = tokio::time::timeout(TIMEOUT, cmd.output())
        .await
        .map_err(|_| AppError::Internal(format!("{} took too long to convert the file", converter.label())))?
        .map_err(|e| AppError::Internal(format!("cannot start {}: {e}", converter.label())))?;

    let pdf = std::fs::read_dir(&out_dir)?
        .flatten()
        .map(|e| e.path())
        .find(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("pdf")));
    match pdf {
        Some(path) => Ok(tokio::fs::read(path).await?),
        None => {
            let detail = String::from_utf8_lossy(&output.stderr);
            let detail = detail.trim();
            tracing::warn!("{} could not convert a presentation: {detail}", converter.label());
            Err(AppError::BadRequest(format!(
                "{} could not open the file{}",
                converter.label(),
                if detail.is_empty() { String::new() } else { format!(": {}", detail.lines().last().unwrap_or(detail)) }
            )))
        }
    }
}

/// PowerPoint opens the file without a window, saves it as PDF (32 = ppSaveAsPDF) and
/// quits, unless the user has other presentations open in it.
const POWERPOINT_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
$app = New-Object -ComObject PowerPoint.Application
try {
  $deck = $app.Presentations.Open($env:OPENPRES_IN, -1, 0, 0)
  try { $deck.SaveAs($env:OPENPRES_OUT, 32) } finally { $deck.Close() }
} finally {
  if ($app.Presentations.Count -eq 0) { $app.Quit() }
}
"#;

/// `file:///…` for LibreOffice's -env option (forward slashes, spaces escaped).
fn file_url(path: &Path) -> String {
    let text = path.to_string_lossy().replace('\\', "/");
    let encoded: String = text
        .chars()
        .map(|c| match c {
            ' ' => "%20".to_string(),
            '%' => "%25".to_string(),
            '#' => "%23".to_string(),
            c => c.to_string(),
        })
        .collect();
    format!("file:///{}", encoded.trim_start_matches('/'))
}

fn find_converter() -> Option<Converter> {
    if cfg!(windows) && powerpoint_installed() {
        return Some(Converter::PowerPoint);
    }
    find_soffice().map(Converter::LibreOffice)
}

fn powerpoint_installed() -> bool {
    let mut cmd = std::process::Command::new("reg");
    cmd.args(["query", r"HKCR\PowerPoint.Application\CurVer"]);
    crate::tools::no_window(&mut cmd);
    cmd.stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

fn find_soffice() -> Option<PathBuf> {
    let exe = if cfg!(windows) { "soffice.exe" } else { "soffice" };
    let mut candidates: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|paths| std::env::split_paths(&paths).flat_map(|dir| [dir.join(exe), dir.join("libreoffice")]).collect())
        .unwrap_or_default();
    if cfg!(windows) {
        for var in ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"] {
            if let Some(dir) = std::env::var_os(var) {
                candidates.push(PathBuf::from(dir).join(r"LibreOffice\program\soffice.exe"));
            }
        }
    } else if cfg!(target_os = "macos") {
        candidates.push("/Applications/LibreOffice.app/Contents/MacOS/soffice".into());
    } else {
        candidates.push("/usr/lib/libreoffice/program/soffice".into());
        candidates.push("/opt/libreoffice/program/soffice".into());
        candidates.push("/snap/bin/libreoffice".into());
    }
    candidates.into_iter().find(|p| p.is_file())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_urls_work_on_every_system() {
        assert_eq!(file_url(Path::new("/tmp/openpres x/profile")), "file:///tmp/openpres%20x/profile");
        assert_eq!(file_url(Path::new(r"C:\Users\Ana Maria\Temp\p")), "file:///C:/Users/Ana%20Maria/Temp/p");
    }
}
