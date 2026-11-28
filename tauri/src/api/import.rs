//! Songs the Manager couldn't import (they don't follow the numbering rules) are kept in
//! the data folder's "Import review" folder, with the reason in `problems.txt`, so they
//! can be fixed and added by hand.

use crate::{error::AppError, state::SharedState};
use axum::{
    body::Bytes,
    extract::{DefaultBodyLimit, Query, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::{
    io::Write,
    path::{Path, PathBuf},
};

pub const REVIEW_DIR: &str = "Import review";
const PROBLEMS: &str = "problems.txt";

pub fn routes() -> Router<SharedState> {
    Router::new()
        .route(
            "/import/review",
            get(list).post(save).layer(DefaultBodyLimit::max(100 * 1024 * 1024)),
        )
        .route("/import/review/open", post(open))
}

#[derive(Debug, Serialize)]
pub struct ReviewFile {
    pub name: String,
    pub bytes: u64,
}

#[derive(Debug, Serialize)]
pub struct ReviewFolder {
    /// Where the folder is on the server's computer.
    pub folder: String,
    pub files: Vec<ReviewFile>,
}

#[derive(Deserialize)]
struct SaveQuery {
    name: String,
    #[serde(default)]
    reason: String,
}

async fn review_dir(s: &SharedState) -> PathBuf {
    s.data_dir().await.join(REVIEW_DIR)
}

/// GET /import/review: what is waiting to be added by hand.
async fn list(State(s): State<SharedState>) -> Result<Json<ReviewFolder>, AppError> {
    let dir = review_dir(&s).await;
    let mut files = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let Ok(meta) = entry.metadata() else { continue };
            if meta.is_file() && name != PROBLEMS {
                files.push(ReviewFile { name, bytes: meta.len() });
            }
        }
    }
    files.sort_by_key(|f| f.name.to_lowercase());
    Ok(Json(ReviewFolder { folder: dir.to_string_lossy().to_string(), files }))
}

/// POST /import/review?name=Song.docx&reason=…  (body: the file)
/// Keeps the file (never overwriting another one) and notes why it wasn't imported.
async fn save(
    State(s): State<SharedState>,
    Query(q): Query<SaveQuery>,
    body: Bytes,
) -> Result<(StatusCode, Json<ReviewFile>), AppError> {
    let dir = review_dir(&s).await;
    let reason = q.reason.replace(['\r', '\n'], " ");
    let saved = tokio::task::spawn_blocking(move || keep(&dir, &q.name, &reason, &body))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))??;
    Ok((StatusCode::CREATED, Json(saved)))
}

/// POST /import/review/open: shows the folder in the file manager (on the server's computer).
async fn open(State(s): State<SharedState>) -> Result<StatusCode, AppError> {
    let dir = review_dir(&s).await;
    std::fs::create_dir_all(&dir)?;
    crate::api::system::open_folder(&dir)
}

fn keep(dir: &Path, name: &str, reason: &str, data: &[u8]) -> Result<ReviewFile, AppError> {
    std::fs::create_dir_all(dir)?;
    let path = unique_path(dir, &safe_file_name(name));
    std::fs::write(&path, data)?;
    let file_name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let mut log = std::fs::OpenOptions::new().create(true).append(true).open(dir.join(PROBLEMS))?;
    let when = chrono::Local::now().format("%Y-%m-%d %H:%M");
    let reason = if reason.trim().is_empty() { "could not be imported" } else { reason.trim() };
    writeln!(log, "{when}  {file_name}: {reason}")?;
    Ok(ReviewFile { name: file_name, bytes: data.len() as u64 })
}

/// A name that is valid everywhere: no folders, no characters Windows refuses.
pub fn safe_file_name(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or("");
    let cleaned: String = base
        .chars()
        .map(|c| if c.is_control() || "<>:\"|?*".contains(c) { '_' } else { c })
        .collect();
    let cleaned = cleaned.trim().trim_end_matches(['.', ' ']).trim_start_matches('.');
    let mut out: String = cleaned.chars().take(150).collect();
    if out.is_empty() || out.eq_ignore_ascii_case(PROBLEMS) {
        out = format!("song {}", out).trim().to_string();
        if out == "song" {
            out.push_str(".txt");
        }
    }
    out
}

/// `name`, or `name (2)`, `name (3)`… when a file with that name is already there.
fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    (2..)
        .map(|n| dir.join(format!("{stem} ({n}){ext}")))
        .find(|p| !p.exists())
        .expect("a free name")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_lose_folders_and_forbidden_characters() {
        assert_eq!(safe_file_name("C:\\songs\\Cântare: 12?.docx"), "Cântare_ 12_.docx");
        assert_eq!(safe_file_name("../../etc/passwd"), "passwd");
        assert_eq!(safe_file_name("  .hidden. "), "hidden");
        assert_eq!(safe_file_name(""), "song.txt");
        assert_eq!(safe_file_name("problems.txt"), "song problems.txt");
    }

    #[test]
    fn files_are_kept_side_by_side_with_the_reasons() {
        let dir = tempfile::tempdir().unwrap();
        let a = keep(dir.path(), "Song.docx", "The verse numbers go 1, 3.", b"one").unwrap();
        let b = keep(dir.path(), "Song.docx", "", b"two").unwrap();
        assert_eq!(a.name, "Song.docx");
        assert_eq!(b.name, "Song (2).docx");
        assert_eq!(std::fs::read(dir.path().join("Song (2).docx")).unwrap(), b"two");
        let log = std::fs::read_to_string(dir.path().join(PROBLEMS)).unwrap();
        assert!(log.contains("Song.docx: The verse numbers go 1, 3."));
        assert!(log.contains("Song (2).docx: could not be imported"));
    }
}
