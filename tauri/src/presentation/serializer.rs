use super::{
    parser::{classify, LineKind, META_END, SLIDE_SEPARATOR},
    Presentation,
};
use crate::error::AppError;

fn bad(message: String) -> AppError {
    AppError::BadRequest(message)
}

/// Inverse of parser::parse. parse(serialize(p)) must equal p.
pub fn serialize(presentation: &Presentation) -> Result<String, AppError> {
    let mut out = String::new();

    for (key, value) in &presentation.metadata {
        if key.trim().is_empty() || key != key.trim() || key.contains(":") || key.contains('\n') {
            return Err(bad(format!("invalid metadata key `{key}`")));
        }
        if value.contains('\n') {
            return Err(bad(format!("metadata `{key} cannot contain a line break`")));
        }
        out.push_str(&format!("{key}: {value}\n"));
    }
    out.push_str(META_END);
    out.push('\n');

    for group in &presentation.groups {
        let name = group.name.trim();
        if name.is_empty() || name.contains('\n') {
            return Err(bad("group names cannot be empty or multi-line".into()));
        }
        out.push_str(&format!("---{name}---\n"));

        for (i, slide) in group.slides.iter().enumerate() {
            if slide.text.trim().is_empty() {
                return Err(bad(format!("group `{name}` has an empty slide")));
            }
            if i > 0 {
                out.push_str(SLIDE_SEPARATOR);
                out.push('\n');
            }
            for line in slide.text.lines() {
                if !matches!(classify(line), LineKind::Text) {
                    return Err(bad(format!("slide text in group `{name}` contains a line that looks like a separator: `{line}`")));
                }
                out.push_str(line);
                out.push('\n');
            }
        }
    }
    Ok(out)
}
