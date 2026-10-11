use super::Presentation;
use crate::error::AppError;
use uuid::Uuid;

/// File format:
///   key: value        (metadata, until the first line that is exactly `###`)
///   ###
///   ---group name---  (starts a group; empty names are rejected)
///   text lines
///   ------            (slide separator inside a group)
///
/// Errors (AppError::Parse with line number): missing `###`, empty group name,
/// text before the first group header, malformed metadata line.
pub fn parse(id: Uuid, input: &str) -> Result<Presentation, AppError> { todo!() }
