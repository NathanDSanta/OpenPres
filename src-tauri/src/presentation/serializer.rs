use super::Presentation;
use crate::error::AppError;

/// Inverse of parser::parse. parse(serialize(p)) must equal p.
pub fn serialize(presentation: &Presentation) -> Result<String, AppError> { todo!() }
