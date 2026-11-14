//! Reading Bibles from the common file formats, so churches can add translations they
//! are licensed to use: Zefania XML, OSIS XML, OpenSong XML, USFM, and JSON (OpenPres,
//! scrollmapper, "abbrev/chapters" arrays and the Free Use Bible API `complete.json`).

use super::{books, new_bible, Bible, BibleBook};
use crate::error::AppError;
use quick_xml::{events::Event, Reader};
use serde_json::Value;
use std::collections::BTreeMap;

/// Details typed in the import dialog; empty values are taken from the file.
#[derive(Debug, Default, Clone, serde::Deserialize)]
pub struct ImportMeta {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub abbreviation: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub language: String,
    #[serde(default)]
    pub license: String,
    #[serde(default)]
    pub attribution: String,
}

/// Collects verses while a file is read, in any order.
#[derive(Default)]
struct Collector {
    /// code -> (name, chapter -> verse -> text)
    books: BTreeMap<String, (String, BTreeMap<usize, BTreeMap<usize, String>>)>,
    order: Vec<String>,
    title: String,
    abbreviation: String,
    language: String,
}

impl Collector {
    fn book(&mut self, code: &str, name: &str) {
        if !self.books.contains_key(code) {
            self.order.push(code.to_string());
            self.books.insert(code.to_string(), (name.to_string(), BTreeMap::new()));
        } else if !name.is_empty() {
            let entry = self.books.get_mut(code).unwrap();
            if entry.0.is_empty() {
                entry.0 = name.to_string();
            }
        }
    }
    fn verse(&mut self, code: &str, chapter: usize, verse: usize, text: &str) {
        if chapter == 0 || verse == 0 {
            return;
        }
        self.book(code, "");
        let slot = self.books.get_mut(code).unwrap().1.entry(chapter).or_default().entry(verse).or_default();
        let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
        if slot.is_empty() {
            *slot = text;
        } else if !text.is_empty() {
            slot.push(' ');
            slot.push_str(&text);
        }
    }
    fn finish(self, meta: &ImportMeta, fallback_name: &str) -> Result<Bible, AppError> {
        let language = first_non_empty(&[&meta.language, &self.language, "en"]);
        let mut out = Vec::new();
        for code in &self.order {
            let (name, chapters) = &self.books[code];
            let last = chapters.keys().max().copied().unwrap_or(0);
            let mut list = vec![Vec::new(); last];
            for (c, verses) in chapters {
                let n = verses.keys().max().copied().unwrap_or(0);
                let mut v = vec![String::new(); n];
                for (i, t) in verses {
                    v[i - 1] = t.trim().to_string();
                }
                list[c - 1] = v;
            }
            let name = if name.trim().is_empty() {
                books::name_in(code, &language).unwrap_or(code).to_string()
            } else {
                name.trim().to_string()
            };
            out.push(BibleBook { code: code.clone(), name, chapters: list });
        }
        if out.iter().map(|b| b.chapters.iter().map(Vec::len).sum::<usize>()).sum::<usize>() == 0 {
            return Err(AppError::BadRequest("no verses were found in the file".into()));
        }
        let name = first_non_empty(&[&meta.name, &self.title, fallback_name, "Imported Bible"]);
        let abbreviation = first_non_empty(&[&meta.abbreviation, &self.abbreviation, &abbreviate(&name)]);
        let id = first_non_empty(&[&meta.id, &abbreviation]);
        let mut bible = new_bible(&super::clean_id(&id), &abbreviation, &name, &language, out);
        bible.license = meta.license.clone();
        bible.attribution = meta.attribution.clone();
        bible.source = "Imported".into();
        Ok(bible)
    }
}

fn first_non_empty(values: &[&str]) -> String {
    values.iter().map(|v| v.trim()).find(|v| !v.is_empty()).unwrap_or("").to_string()
}

fn abbreviate(name: &str) -> String {
    let a: String = name
        .split_whitespace()
        .filter_map(|w| w.chars().next())
        .filter(|c| c.is_alphanumeric())
        .collect::<String>()
        .to_uppercase();
    a.chars().take(8).collect()
}

/// Reads any supported format. `file_name` helps to pick the format.
pub fn read(bytes: &[u8], file_name: &str, meta: &ImportMeta) -> Result<Bible, AppError> {
    let lower = file_name.to_lowercase();
    let stem = file_name.rsplit(['/', '\\']).next().unwrap_or(file_name);
    let stem = stem.split('.').next().unwrap_or(stem);
    // OpenPres files (gzip JSON).
    if bytes.starts_with(&[0x1f, 0x8b]) {
        let mut bible = super::read_bible(bytes)?;
        apply_meta(&mut bible, meta);
        return Ok(bible);
    }
    let text = decode_text(bytes);
    let trimmed = text.trim_start_matches('\u{feff}').trim_start();
    if trimmed.starts_with('{') || trimmed.starts_with('[') {
        let value: Value = serde_json::from_str(trimmed).map_err(|e| AppError::BadRequest(format!("invalid JSON: {e}")))?;
        return read_json(&value, meta, stem);
    }
    if trimmed.starts_with('<') {
        let head: String = trimmed.chars().take(4000).collect::<String>().to_lowercase();
        let mut c = Collector::default();
        if head.contains("<xmlbible") {
            read_zefania(trimmed, &mut c)?;
        } else if head.contains("<osis") {
            read_osis(trimmed, &mut c)?;
        } else if head.contains("<bible") {
            read_opensong(trimmed, &mut c)?;
        } else {
            return Err(AppError::BadRequest("unknown XML Bible format (Zefania, OSIS and OpenSong are supported)".into()));
        }
        return c.finish(meta, stem);
    }
    if trimmed.contains("\\id ") || trimmed.contains("\\c ") || lower.ends_with(".usfm") || lower.ends_with(".sfm") {
        let mut c = Collector::default();
        read_usfm(trimmed, &mut c);
        return c.finish(meta, stem);
    }
    Err(AppError::BadRequest(
        "unsupported file: use Zefania/OSIS/OpenSong XML, USFM or JSON".into(),
    ))
}

fn apply_meta(bible: &mut Bible, meta: &ImportMeta) {
    for (field, value) in [
        (&mut bible.id, &meta.id),
        (&mut bible.abbreviation, &meta.abbreviation),
        (&mut bible.name, &meta.name),
        (&mut bible.language, &meta.language),
        (&mut bible.license, &meta.license),
        (&mut bible.attribution, &meta.attribution),
    ] {
        if !value.trim().is_empty() {
            *field = value.trim().to_string();
        }
    }
}

/// UTF-8 (with or without BOM), UTF-16 with BOM, or Latin-1 as a last resort.
fn decode_text(bytes: &[u8]) -> String {
    if bytes.starts_with(&[0xff, 0xfe]) || bytes.starts_with(&[0xfe, 0xff]) {
        let le = bytes[0] == 0xff;
        let units: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|c| if le { u16::from_le_bytes([c[0], c[1]]) } else { u16::from_be_bytes([c[0], c[1]]) })
            .collect();
        return String::from_utf16_lossy(&units);
    }
    match std::str::from_utf8(bytes) {
        Ok(s) => s.to_string(),
        Err(_) => bytes.iter().map(|b| *b as char).collect(),
    }
}

// ---------- JSON ----------

fn read_json(value: &Value, meta: &ImportMeta, stem: &str) -> Result<Bible, AppError> {
    let mut c = Collector::default();
    // Free Use Bible API: {"translation": {...}, "books": [{"id": "GEN", "chapters": [...]}]}
    if let Some(t) = value.get("translation").filter(|t| t.is_object()) {
        c.title = t.get("name").or(t.get("englishName")).and_then(Value::as_str).unwrap_or("").into();
        c.abbreviation = t.get("shortName").or(t.get("id")).and_then(Value::as_str).unwrap_or("").into();
        c.language = t.get("language").and_then(Value::as_str).unwrap_or("").into();
    } else if let Some(t) = value.get("translation").and_then(Value::as_str) {
        // scrollmapper: "KJV: King James Version (1769) ..."
        match t.split_once(':') {
            Some((abbr, name)) => {
                c.abbreviation = abbr.trim().into();
                c.title = name.trim().into();
            }
            None => c.title = t.into(),
        }
    }
    let list = value
        .get("books")
        .and_then(Value::as_array)
        .or_else(|| value.as_array())
        .ok_or_else(|| AppError::BadRequest("JSON without a list of books".into()))?;
    for (i, book) in list.iter().enumerate() {
        let name = book.get("name").or(book.get("commonName")).and_then(Value::as_str).unwrap_or("");
        let code = book
            .get("code")
            .or(book.get("id"))
            .and_then(Value::as_str)
            .and_then(|c| books::info(c).map(|b| b.code))
            .or_else(|| books::by_any_name(name))
            .or_else(|| book.get("abbrev").and_then(Value::as_str).and_then(books::by_any_name))
            .or_else(|| (list.len() == 66 || list.len() == 73).then(|| books::from_number(i + 1)).flatten())
            .ok_or_else(|| AppError::BadRequest(format!("cannot tell which book `{name}` is")))?;
        c.book(code, name);
        let chapters = book.get("chapters").and_then(Value::as_array).cloned().unwrap_or_default();
        for (ci, chapter) in chapters.iter().enumerate() {
            match chapter {
                // [["v1", "v2"], ...]
                Value::Array(verses) => {
                    for (vi, v) in verses.iter().enumerate() {
                        c.verse(code, ci + 1, vi + 1, v.as_str().unwrap_or(""));
                    }
                }
                Value::Object(_) => {
                    // scrollmapper: {"chapter": 1, "verses": [{"verse": 1, "text": ""}]}
                    if let Some(verses) = chapter.get("verses").and_then(Value::as_array) {
                        let n = chapter.get("chapter").and_then(Value::as_u64).map(|n| n as usize).unwrap_or(ci + 1);
                        for (vi, v) in verses.iter().enumerate() {
                            let vn = v.get("verse").and_then(Value::as_u64).map(|n| n as usize).unwrap_or(vi + 1);
                            c.verse(code, n, vn, v.get("text").and_then(Value::as_str).unwrap_or(""));
                        }
                        continue;
                    }
                    // Free Use Bible API: {"chapter": {"number": 1, "content": [...]}}
                    let inner = chapter.get("chapter").filter(|x| x.is_object()).unwrap_or(chapter);
                    let n = inner.get("number").and_then(Value::as_u64).map(|n| n as usize).unwrap_or(ci + 1);
                    for item in inner.get("content").and_then(Value::as_array).into_iter().flatten() {
                        if item.get("type").and_then(Value::as_str) != Some("verse") {
                            continue;
                        }
                        let vn = item.get("number").and_then(Value::as_u64).unwrap_or(0) as usize;
                        let mut text = String::new();
                        collect_helloao_text(item.get("content").unwrap_or(&Value::Null), &mut text);
                        c.verse(code, n, vn, &text);
                    }
                }
                _ => {}
            }
        }
    }
    c.finish(meta, stem)
}

fn collect_helloao_text(v: &Value, out: &mut String) {
    match v {
        Value::String(s) => {
            out.push_str(s);
            out.push(' ');
        }
        Value::Array(items) => items.iter().for_each(|i| collect_helloao_text(i, out)),
        Value::Object(o) => {
            if o.contains_key("noteId") || o.get("lineBreak").is_some() {
                return;
            }
            if let Some(t) = o.get("text") {
                collect_helloao_text(t, out);
            }
        }
        _ => {}
    }
}

// ---------- XML ----------

fn attr(e: &quick_xml::events::BytesStart, names: &[&[u8]]) -> Option<String> {
    for name in names {
        if let Ok(Some(a)) = e.try_get_attribute(*name) {
            if let Ok(v) = a.unescape_value() {
                return Some(v.into_owned());
            }
        }
    }
    None
}

fn local_name(e: &quick_xml::events::BytesStart) -> String {
    String::from_utf8_lossy(e.local_name().as_ref()).to_lowercase()
}

fn xml_error(e: impl std::fmt::Display) -> AppError {
    AppError::BadRequest(format!("invalid XML: {e}"))
}

/// <XMLBIBLE biblename=""><BIBLEBOOK bnumber="1" bname=""><CHAPTER cnumber="1"><VERS vnumber="1">
fn read_zefania(text: &str, c: &mut Collector) -> Result<(), AppError> {
    let mut reader = Reader::from_str(text);
    let (mut book, mut chapter, mut verse): (Option<String>, usize, usize) = (None, 0, 0);
    let mut in_verse = false;
    let mut skip = 0usize;
    let mut buf = String::new();
    loop {
        match reader.read_event().map_err(xml_error)? {
            Event::Start(e) => match local_name(&e).as_str() {
                "xmlbible" => {
                    c.title = attr(&e, &[b"biblename"]).unwrap_or_default();
                    c.language = attr(&e, &[b"xml:lang", b"lang"]).unwrap_or_default();
                }
                "biblebook" => {
                    let name = attr(&e, &[b"bname"]).unwrap_or_default();
                    let code = attr(&e, &[b"bnumber"])
                        .and_then(|n| n.trim().parse::<usize>().ok())
                        .and_then(books::from_number)
                        .or_else(|| books::by_any_name(&name))
                        .or_else(|| attr(&e, &[b"bsname"]).and_then(|s| books::by_any_name(&s)));
                    if let Some(code) = code {
                        c.book(code, &name);
                    }
                    book = code.map(str::to_string);
                }
                "chapter" => chapter = attr(&e, &[b"cnumber"]).and_then(|n| n.trim().parse().ok()).unwrap_or(0),
                "vers" => {
                    verse = attr(&e, &[b"vnumber"]).and_then(|n| n.trim().parse().ok()).unwrap_or(0);
                    in_verse = true;
                    buf.clear();
                }
                "note" | "xref" => skip += 1,
                _ => {}
            },
            Event::Empty(e) => {
                if local_name(&e) == "br" && in_verse {
                    buf.push(' ');
                }
            }
            Event::Text(t) => {
                if in_verse && skip == 0 {
                    buf.push_str(&t.unescape().map_err(xml_error)?);
                }
            }
            Event::End(e) => match String::from_utf8_lossy(e.local_name().as_ref()).to_lowercase().as_str() {
                "vers" => {
                    if let Some(b) = &book {
                        c.verse(b, chapter, verse, &buf);
                    }
                    in_verse = false;
                }
                "note" | "xref" => skip = skip.saturating_sub(1),
                _ => {}
            },
            Event::Eof => break,
            _ => {}
        }
    }
    Ok(())
}

/// OSIS: <verse osisID="Gen.1.1">text</verse> or milestones
/// <verse sID="Gen.1.1" osisID="Gen.1.1"/>text<verse eID="Gen.1.1"/>.
fn read_osis(text: &str, c: &mut Collector) -> Result<(), AppError> {
    let mut reader = Reader::from_str(text);
    let mut current: Option<(String, usize, usize)> = None;
    let mut skip = 0usize;
    let mut buf = String::new();
    let parse_id = |id: &str| -> Option<(String, usize, usize)> {
        let first = id.split_whitespace().next()?; // "Gen.1.1 Gen.1.2" (combined verses)
        let mut parts = first.split('.');
        let book = books::from_osis(parts.next()?)?;
        let ch = parts.next()?.parse().ok()?;
        let v = parts.next()?.parse().ok()?;
        Some((book.to_string(), ch, v))
    };
    let flush = |c: &mut Collector, current: &Option<(String, usize, usize)>, buf: &mut String| {
        if let Some((b, ch, v)) = current {
            c.verse(b, *ch, *v, buf);
        }
        buf.clear();
    };
    loop {
        match reader.read_event().map_err(xml_error)? {
            Event::Start(e) => match local_name(&e).as_str() {
                "osistext" => {
                    c.language = attr(&e, &[b"xml:lang", b"lang"]).unwrap_or_default();
                    c.abbreviation = attr(&e, &[b"osisIDWork"]).unwrap_or_default();
                }
                "title" if current.is_none() && c.title.is_empty() => skip += 1,
                "verse" => {
                    flush(c, &current, &mut buf);
                    current = attr(&e, &[b"osisID", b"sID"]).and_then(|id| parse_id(&id));
                }
                "note" | "title" | "reference" if current.is_some() => skip += 1,
                "div" => {
                    if attr(&e, &[b"type"]).as_deref() == Some("book") {
                        if let Some(code) = attr(&e, &[b"osisID"]).and_then(|id| books::from_osis(&id)) {
                            c.book(code, "");
                        }
                    }
                }
                _ => {}
            },
            Event::Empty(e) => {
                if local_name(&e) == "verse" {
                    if attr(&e, &[b"eID"]).is_some() {
                        flush(c, &current, &mut buf);
                        current = None;
                    } else if let Some(id) = attr(&e, &[b"sID", b"osisID"]) {
                        flush(c, &current, &mut buf);
                        current = parse_id(&id);
                    }
                } else if local_name(&e) == "lb" {
                    buf.push(' ');
                }
            }
            Event::Text(t) => {
                if current.is_some() && skip == 0 {
                    buf.push_str(&t.unescape().map_err(xml_error)?);
                }
            }
            Event::End(e) => match String::from_utf8_lossy(e.local_name().as_ref()).to_lowercase().as_str() {
                "verse" => {
                    flush(c, &current, &mut buf);
                    current = None;
                }
                "note" | "title" | "reference" => skip = skip.saturating_sub(1),
                _ => {}
            },
            Event::Eof => break,
            _ => {}
        }
    }
    flush(c, &current, &mut buf);
    Ok(())
}

/// OpenSong: <bible><b n="Genesis"><c n="1"><v n="1">text</v></c></b></bible>
fn read_opensong(text: &str, c: &mut Collector) -> Result<(), AppError> {
    let mut reader = Reader::from_str(text);
    let (mut book, mut chapter, mut verse, mut index): (Option<String>, usize, usize, usize) = (None, 0, 0, 0);
    let mut in_verse = false;
    let mut buf = String::new();
    loop {
        match reader.read_event().map_err(xml_error)? {
            Event::Start(e) => match local_name(&e).as_str() {
                "b" => {
                    index += 1;
                    let name = attr(&e, &[b"n"]).unwrap_or_default();
                    let code = books::by_any_name(&name).or_else(|| books::from_number(index));
                    if let Some(code) = code {
                        c.book(code, &name);
                    }
                    book = code.map(str::to_string);
                }
                "c" => chapter = attr(&e, &[b"n"]).and_then(|n| n.trim().parse().ok()).unwrap_or(0),
                "v" => {
                    verse = attr(&e, &[b"n"]).and_then(|n| n.trim().split('-').next()?.parse().ok()).unwrap_or(0);
                    in_verse = true;
                    buf.clear();
                }
                _ => {}
            },
            Event::Text(t) => {
                if in_verse {
                    buf.push_str(&t.unescape().map_err(xml_error)?);
                }
            }
            Event::End(e) => {
                if e.local_name().as_ref().eq_ignore_ascii_case(b"v") {
                    if let Some(b) = &book {
                        c.verse(b, chapter, verse, &buf);
                    }
                    in_verse = false;
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    Ok(())
}

// ---------- USFM ----------

/// Removes footnotes, cross references and character markers, keeping the words.
fn strip_usfm(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(pos) = rest.find('\\') {
        out.push_str(&rest[..pos]);
        rest = &rest[pos + 1..];
        let marker: String = rest.chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '+' || *c == '*').collect();
        rest = &rest[marker.len()..];
        let base = marker.trim_start_matches('+').trim_end_matches('*');
        if !marker.ends_with('*') && (base == "f" || base == "fe" || base == "x") {
            // Skip the whole note up to its closing marker.
            let close = format!("\\{base}*");
            match rest.find(&close) {
                Some(end) => rest = &rest[end + close.len()..],
                None => rest = "",
            }
            continue;
        }
        if base == "w" && !marker.ends_with('*') {
            // \w word|lemma="..."\w*  -> word
            if let Some(end) = rest.find("\\w*") {
                let inner = &rest[..end];
                out.push_str(inner.split('|').next().unwrap_or(""));
                rest = &rest[end + 3..];
            }
            continue;
        }
        if rest.starts_with(' ') {
            rest = &rest[1..];
        }
    }
    out.push_str(rest);
    out
}

fn read_usfm(text: &str, c: &mut Collector) {
    let (mut book, mut chapter, mut verse): (Option<String>, usize, usize) = (None, 0, 0);
    let mut buf = String::new();
    let flush = |c: &mut Collector, book: &Option<String>, chapter: usize, verse: usize, buf: &mut String| {
        if let (Some(b), true) = (book, verse > 0) {
            c.verse(b, chapter, verse, &strip_usfm(buf));
        }
        buf.clear();
    };
    for line in text.lines() {
        let line = line.trim();
        let (marker, rest) = match line.strip_prefix('\\') {
            Some(l) => {
                let m: String = l.chars().take_while(|ch| !ch.is_whitespace()).collect();
                (m.clone(), l[m.len()..].trim().to_string())
            }
            None => (String::new(), line.to_string()),
        };
        match marker.as_str() {
            "id" => {
                flush(c, &book, chapter, verse, &mut buf);
                let code = rest.split_whitespace().next().unwrap_or("");
                book = books::info(code).map(|b| b.code.to_string());
                if let Some(b) = &book {
                    c.book(b, "");
                }
                chapter = 0;
                verse = 0;
            }
            "h" | "toc2" | "toc1" => {
                if let Some(b) = &book {
                    if c.books.get(b).is_some_and(|x| x.0.is_empty()) {
                        c.book(b, "");
                        c.books.get_mut(b).unwrap().0 = rest.clone();
                    }
                }
            }
            "c" => {
                flush(c, &book, chapter, verse, &mut buf);
                chapter = rest.split_whitespace().next().and_then(|n| n.parse().ok()).unwrap_or(0);
                verse = 0;
            }
            "v" => {
                flush(c, &book, chapter, verse, &mut buf);
                let mut parts = rest.splitn(2, char::is_whitespace);
                let number = parts.next().unwrap_or("");
                verse = number.split('-').next().and_then(|n| n.parse().ok()).unwrap_or(0);
                buf = parts.next().unwrap_or("").to_string();
            }
            // Headings and introductions are not verse text.
            m if m.starts_with('s') || m.starts_with("ms") || m.starts_with("mt") || m.starts_with("i") || m == "r" || m == "d" || m == "cl" || m == "rem" || m == "ide" || m.starts_with("toc") => {}
            _ => {
                if verse > 0 {
                    buf.push(' ');
                    buf.push_str(&rest);
                }
            }
        }
    }
    flush(c, &book, chapter, verse, &mut buf);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_zefania() {
        let xml = r#"<?xml version="1.0"?><XMLBIBLE biblename="Test Bible"><BIBLEBOOK bnumber="43" bname="Juan"><CHAPTER cnumber="3"><VERS vnumber="16">Porque de tal <STYLE>manera</STYLE> amó</VERS><VERS vnumber="17">Otro<NOTE>nota</NOTE> verso</VERS></CHAPTER></BIBLEBOOK></XMLBIBLE>"#;
        let b = read(xml.as_bytes(), "x.xml", &ImportMeta { language: "es".into(), ..Default::default() }).unwrap();
        assert_eq!(b.name, "Test Bible");
        let jhn = b.book("JHN").unwrap();
        assert_eq!(jhn.chapters[2][15], "Porque de tal manera amó");
        assert_eq!(jhn.chapters[2][16], "Otro verso");
    }

    #[test]
    fn reads_osis_milestones() {
        let xml = r#"<osis><osisText osisIDWork="TST" xml:lang="en"><div type="book" osisID="John"><chapter osisID="John.3"><verse sID="John.3.16" osisID="John.3.16"/>For God<note>n</note> so loved<verse eID="John.3.16"/></chapter></div></osisText></osis>"#;
        let b = read(xml.as_bytes(), "x.osis.xml", &ImportMeta::default()).unwrap();
        assert_eq!(b.book("JHN").unwrap().chapters[2][15], "For God so loved");
        assert_eq!(b.abbreviation, "TST");
    }

    #[test]
    fn reads_usfm() {
        let usfm = "\\id JHN\n\\h Ioan\n\\c 3\n\\p\n\\v 16 Fiindcă \\w atât|strong=\"G1\"\\w* de mult\\f + \\ft nota\\f* a iubit\n\\v 17 Altul\n";
        let b = read(usfm.as_bytes(), "43JHN.usfm", &ImportMeta { language: "ro".into(), ..Default::default() }).unwrap();
        let jhn = b.book("JHN").unwrap();
        assert_eq!(jhn.name, "Ioan");
        assert_eq!(jhn.chapters[2][15], "Fiindcă atât de mult a iubit");
    }

    #[test]
    fn reads_opensong_and_json() {
        let xml = r#"<bible><b n="Genesis"><c n="1"><v n="1">In the beginning</v></c></b></bible>"#;
        let b = read(xml.as_bytes(), "x.xmm", &ImportMeta { name: "OS".into(), ..Default::default() }).unwrap();
        assert_eq!(b.book("GEN").unwrap().chapters[0][0], "In the beginning");
        let json = r#"{"translation":{"id":"tst","name":"Test","language":"eng"},"books":[{"id":"GEN","name":"Genesis","chapters":[{"chapter":{"number":1,"content":[{"type":"heading","content":["x"]},{"type":"verse","number":1,"content":["In the", {"noteId":0}, {"text":"beginning","wordsOfJesus":false}]}]}}]}]}"#;
        let b = read(json.as_bytes(), "complete.json", &ImportMeta::default()).unwrap();
        assert_eq!(b.book("GEN").unwrap().chapters[0][0], "In the beginning");
        assert_eq!(b.name, "Test");
    }
}
