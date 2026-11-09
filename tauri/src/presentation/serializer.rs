use super::{
    parser::{classify, LineKind, SECTION_SEPARATOR, SLIDE_SEPARATOR},
    Presentation, DEFAULT_ARRANGEMENT,
};
use crate::error::AppError;

fn bad(message: String) -> AppError {
    AppError::BadRequest(message)
}

/// Inverse of parser::parse. parse(serialize(p)) must equal p.
pub fn serialize(presentation: &Presentation) -> Result<String, AppError> {
    let mut out = String::new();
    let mut group_names = std::collections::HashSet::new();

    for (key, value) in &presentation.metadata {
        if key.trim().is_empty() || key != key.trim() || key.contains(":") || key.contains('\n') {
            return Err(bad(format!("invalid metadata key `{key}`")));
        }
        if value.contains('\n') {
            return Err(bad(format!("metadata `{key} cannot contain a line break`")));
        }
        out.push_str(&format!("{key}: {value}\n"));
    }
    out.push_str(SECTION_SEPARATOR);
    out.push('\n');

    for group in &presentation.groups {
        let name = group.name.trim();

        if !group_names.insert(name) {
            return Err(bad(format!("duplicate group name `{name}`")));
        }

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

    // Arrangements go after the slides, behind the same `###` separator.
    if !presentation.arrangements.is_empty() {
        let group_names: Vec<&str> = presentation.groups.iter().map(|g| g.name.trim()).collect();
        let mut seen: Vec<&str> = Vec::new();

        out.push_str(SECTION_SEPARATOR);
        out.push('\n');

        for arrangement in &presentation.arrangements {
            let name = arrangement.name.trim();
            if name.is_empty() || name.contains(':') || name.contains('\n') {
                return Err(bad(format!(
                    "invalid arrangement name `{}` (not empty, no `:` and no line breaks)",
                    arrangement.name
                )));
            }
            if name == DEFAULT_ARRANGEMENT {
                return Err(bad(format!(
                    "arrangement name cannot be `{DEFAULT_ARRANGEMENT}`"
                )));
            }
            if seen.contains(&name) {
                return Err(bad(format!("duplicate arrangement name `{name}`")));
            }
            seen.push(name);

            if arrangement.order.is_empty() {
                return Err(bad(format!("arrangement `{name}` has no groups")));
            }
            for group in &arrangement.order {
                if !group_names.contains(&group.as_str()) {
                    return Err(bad(format!(
                        "arrangement `{name}` uses unknown group `{group}`"
                    )));
                }
                // groups are separated by commas, so a name cannot contain one
                if group.contains(',') {
                    return Err(bad(format!(
                        "group `{group}` contains a comma and cannot be used in arrangement `{name}` (rename the group)"
                    )));
                }
            }

            let groups_text = arrangement.order.join(", ");
            out.push_str(&format!("{name}: {groups_text}\n"));
        }
    }
    Ok(out)
}
