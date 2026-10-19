use super::{Arrangement, Group, Presentation, Slide, DEFAULT_ARRANGEMENT};
use crate::{error::AppError, presentation::META_TITLE};
use nokhwa::buffer;
use std::collections::BTreeMap;
use unicode_normalization::UnicodeNormalization;
use uuid::Uuid;

pub(crate) const SECTION_SEPARATOR: &str = "###";
pub(crate) const SLIDE_SEPARATOR: &str = "------";

pub(crate) enum LineKind<'a> {
    SectionSeparator,
    SlideSeparator,
    GroupHeader(&'a str), // the trimmed name between the dashes (may be empty)
    Text,
}

pub(crate) fn classify(line: &str) -> LineKind<'_> {
    let t = line.trim();
    if t == SECTION_SEPARATOR {
        return LineKind::SectionSeparator;
    }
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

fn normalize_title(input: &str) -> String {
    let lowercase = input.to_lowercase();

    let diacritics: String = lowercase
        .nfd()
        .filter(|c| !unicode_normalization::char::is_combining_mark(*c))
        .collect();

    let clean: String = diacritics
        .chars()
        .map(|c| match c {
            'ș' | 'ş' => 's',
            'ț' | 'ţ' => 't',
            'ă' | 'â' => 'a',
            'î' => 'i',
            other => other,
        })
        .collect();

    let stripped: String = clean
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect();

    let whitespace = stripped.split_whitespace().collect::<Vec<&str>>().join(" ");

    whitespace
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
        if t == SECTION_SEPARATOR {
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
            format!("missing `{SECTION_SEPARATOR}` line after the metadata"),
        ));
    }

    // ---- Phase 2: groups and slides ----
    let mut groups: Vec<Group> = Vec::new();
    let mut current: Option<Group> = None;
    let mut buffer: Vec<&str> = Vec::new();

    for (i, line) in lines.by_ref() {
        let n = i + 1;
        match classify(line) {
            LineKind::SectionSeparator => break,
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

    // ----- Fase 3: Arrangements -----
    let group_names: Vec<&str> = groups.iter().map(|g| g.name.as_str()).collect();
    let mut arrangements: Vec<Arrangement> = Vec::new();

    for (i, line) in lines {
        let n = i + 1;
        let t = line.trim();
        if t.is_empty() {
            continue;
        }
        let Some((name, rest)) = t.split_once(':') else {
            return Err(parse_err(
                n,
                format!("expected `arrangementName: group, group`, got `{t}`"),
            ));
        };
        let name = name.trim();
        let rest = rest.trim();
        if name.is_empty() {
            return Err(parse_err(n, "arrangement name cannot be empty".into()));
        }
        if name == DEFAULT_ARRANGEMENT {
            return Err(parse_err(
                n,
                format!("arrangement name cannot be `{DEFAULT_ARRANGEMENT}`"),
            ));
        }
        if arrangements.iter().any(|a| a.name == name) {
            return Err(parse_err(n, format!("duplicate arrangement name `{name}`")));
        }
        if rest.is_empty() {
            return Err(parse_err(n, format!("arrangement `{name}` has no groups")));
        }
        let mut order: Vec<String> = Vec::new();
        for item in rest.split(',') {
            let group = item.trim();
            if group.is_empty() {
                return Err(parse_err(
                    n,
                    format!("arrangement `{name}` has an empty entry (doubled or trailing comma?)"),
                ));
            }
            if !group_names.contains(&group) {
                return Err(parse_err(
                    n,
                    format!(
                        "arrangement `{name}` uses unknown group `{group}` (known groups: {})",
                        group_names.join(", ")
                    ),
                ));
            }
            order.push(group.to_string());
        }
        arrangements.push(Arrangement {
            name: name.to_string(),
            order,
        });
    }

    let title = metadata.get(META_TITLE).map(|s| s.as_str());

    let nameid = normalize_title(title.expect("Missing title"));

    Ok(Presentation {
        id,
        nameid,
        metadata,
        groups,
        arrangements,
    })
}
