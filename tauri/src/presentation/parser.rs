use super::{Group, Presentation, Slide};
use crate::error::AppError;
use nokhwa::buffer;
use std::collections::BTreeMap;
use uuid::Uuid;

pub(crate) const META_END: &str = "###";
pub(crate) const SLIDE_SEPARATOR: &str = "------";

pub(crate) enum LineKind<'a> {
    SlideSeparator,
    GroupHeader(&'a str), // the trimmed name between the dashes (may be empty)
    Text,
}

pub(crate) fn classify(line: &str) -> LineKind<'_> {
    let t = line.trim();
    if t == SLIDE_SEPARATOR {
        return LineKind::SlideSeparator;
    }
    if t.len() >= 7 && t.starts_with("---") && t.ends_with("---") {
        return LineKind::GroupHeader(t[3..t.len() - 3].trim());
    }
    LineKind::Text
}

fn parse_err(line: usize, message: String) -> AppError {
    AppError::Parse { line, message }
}

fn join_trimmed(lines: &[&str]) -> String {
    let start = lines.iter().position(|l| !l.trim().is_empty());
    let end = lines.iter().rposition(|l| !l.trim().is_empty());
    match (start, end) {
        (Some(s), Some(e)) => lines[s..=e]
            .iter()
            .map(|l| l.trim_end())
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

fn flush_slide(current: &mut Option<Group>, buffer: &mut Vec<&str>) {
    let text = join_trimmed(buffer);
    buffer.clear();
    if text.is_empty() {
        return;
    }
    if let Some(group) = current.as_mut() {
        group.slides.push(Slide { text });
    }
}

/// File format:
///   key: value        (metadata, until the first line that is exactly `###`)
///   ###
///   ---group name---  (starts a group; empty names are rejected)
///   text lines
///   ------            (slide separator inside a group)
///
/// Errors (AppError::Parse with line number): missing `###`, empty group name,
/// text before the first group header, malformed metadata line.
pub fn parse(id: Uuid, input: &str) -> Result<Presentation, AppError> {
    let mut lines = input.lines().enumerate();

    // ---- Phase 1: metadata ----
    let mut metadata = BTreeMap::new();
    let mut found_end = false;
    for (i, line) in lines.by_ref() {
        let t = line.trim();
        if t == META_END {
            found_end = true;
            break;
        }
        if t.is_empty() {
            continue;
        }

        let Some((key, value)) = t.split_once(':') else {
            return Err(parse_err(
                i + 1,
                format!("expected `key: value`, got `{t}`"),
            ));
        };
        let key = key.trim();
        if key.is_empty() {
            return Err(parse_err(i + 1, "metadata key is empty".into()));
        }
        metadata.insert(key.to_string(), value.trim().to_string());
    }
    if !found_end {
        return Err(parse_err(
            1,
            format!("missing `{META_END}` line after the metadata"),
        ));
    }

    // ---- Phase 2: groups and slides ----
    let mut groups: Vec<Group> = Vec::new();
    let mut current: Option<Group> = None;
    let mut buffer: Vec<&str> = Vec::new();

    for (i, line) in lines {
        let n = i + 1;
        match classify(line) {
            LineKind::GroupHeader(name) => {
                if name.is_empty() {
                    return Err(parse_err(n, "group name cannot be empty".into()));
                }
                flush_slide(&mut current, &mut buffer);
                if let Some(done) = current.take() {
                    groups.push(done);
                }
                if groups.iter().any(|g| g.name == name) {
                    return Err(parse_err(n, format!("duplicate group name `{name}`")));
                }
                current = Some(Group {
                    name: name.to_string(),
                    slides: vec![],
                });
            }
            LineKind::SlideSeparator => {
                if current.is_none() {
                    return Err(parse_err(
                        n,
                        "slide separator found before the first group".into(),
                    ));
                }
                flush_slide(&mut current, &mut buffer);
            }
            LineKind::Text => {
                if current.is_none() {
                    if line.trim().is_empty() {
                        continue;
                    }
                    return Err(parse_err(n, "text found before the first group".into()));
                }
                buffer.push(line);
            }
        }
    }

    flush_slide(&mut current, &mut buffer);
    if let Some(done) = current.take() {
        groups.push(done);
    }

    Ok(Presentation {
        id,
        metadata,
        groups,
        arrangements: vec![],
    })
}
