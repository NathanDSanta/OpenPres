//! Bibles: storage, reference parsing ("Juan 3:16", "1 Co 13:4-7"), keyword search and
//! what is live on the Bible layer (one passage in up to four versions at once).
//!
//! Every translation is one gzip JSON file in `<data>/bibles/<id>.json.gz` (the format
//! produced by `scripts/bibles/build.py`). The public-domain Bibles that ship with the
//! app are written there on first start; deleting one in Settings remembers that, so it
//! does not come back (it can be added again from the list of bundled Bibles).

pub mod books;
pub mod import;

use crate::{error::AppError, storage, theme::DesignRef};
use serde::{Deserialize, Serialize};
use std::{
    io::{Read, Write},
    path::PathBuf,
    sync::{Arc, OnceLock},
};
use unicode_normalization::UnicodeNormalization;

pub const MAX_VERSIONS: usize = 4;

/// The Bibles compiled into the app.
pub const BUNDLED: &[(&str, &[u8])] = &[
    ("rva", include_bytes!("../../resources/bibles/rva.json.gz")),
    ("vdc", include_bytes!("../../resources/bibles/vdc.json.gz")),
    ("kjv", include_bytes!("../../resources/bibles/kjv.json.gz")),
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BibleBook {
    /// USFM code (GEN, EXO, ... REV). Shared by every translation, so verses line up.
    pub code: String,
    pub name: String,
    /// chapters[c][v] = text of chapter c+1, verse v+1 ("" when the verse is missing).
    pub chapters: Vec<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Bible {
    pub id: String,
    pub abbreviation: String,
    pub name: String,
    /// BCP-47 / ISO 639 code ("es", "ro", "en", "spa"...).
    pub language: String,
    #[serde(default)]
    pub license: String,
    /// Text that must be shown with the passage (CC BY / BY-SA texts).
    #[serde(default)]
    pub attribution: String,
    #[serde(default)]
    pub source: String,
    pub books: Vec<BibleBook>,
    /// Normalized verse texts for keyword search, built on first search.
    #[serde(skip)]
    search_index: OnceLock<Vec<(usize, usize, usize, String)>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BookOutline {
    pub code: String,
    pub name: String,
    /// Number of verses of each chapter.
    pub verses: Vec<usize>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BibleSummary {
    pub id: String,
    pub abbreviation: String,
    pub name: String,
    pub language: String,
    pub license: String,
    pub attribution: String,
    pub source: String,
    pub bundled: bool,
}

/// A passage: one chapter, a verse range.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Reference {
    pub book: String,
    pub chapter: usize,
    pub verse_start: usize,
    pub verse_end: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct Passage {
    pub bible_id: String,
    pub abbreviation: String,
    pub version_name: String,
    pub language: String,
    pub attribution: String,
    /// "Juan 3:16-17" in this version's book names.
    pub reference: String,
    pub text: String,
    /// Each verse separately (number, text).
    pub verses: Vec<(usize, String)>,
}

/// Lowercase, no accents, punctuation as spaces ("¡Señor!" -> " senor ").
pub fn normalize(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.nfd() {
        if unicode_normalization::char::is_combining_mark(c) {
            continue;
        }
        if c.is_alphanumeric() {
            out.extend(c.to_lowercase());
        } else {
            out.push(' ');
        }
    }
    out
}

fn squash(text: &str) -> String {
    normalize(text).split_whitespace().collect::<Vec<_>>().join("")
}

impl Bible {
    pub fn summary(&self) -> BibleSummary {
        BibleSummary {
            id: self.id.clone(),
            abbreviation: self.abbreviation.clone(),
            name: self.name.clone(),
            language: self.language.clone(),
            license: self.license.clone(),
            attribution: self.attribution.clone(),
            source: self.source.clone(),
            bundled: BUNDLED.iter().any(|(id, _)| *id == self.id),
        }
    }

    pub fn outline(&self) -> Vec<BookOutline> {
        self.books
            .iter()
            .map(|b| BookOutline {
                code: b.code.clone(),
                name: b.name.clone(),
                verses: b.chapters.iter().map(Vec::len).collect(),
            })
            .collect()
    }

    pub fn book(&self, code: &str) -> Option<&BibleBook> {
        self.books.iter().find(|b| b.code.eq_ignore_ascii_case(code))
    }

    pub fn verse_count(&self, code: &str, chapter: usize) -> usize {
        self.book(code)
            .and_then(|b| b.chapters.get(chapter.checked_sub(1)?))
            .map(Vec::len)
            .unwrap_or(0)
    }

    /// The book name used for references in this version.
    pub fn book_name(&self, code: &str) -> String {
        self.book(code)
            .map(|b| b.name.clone())
            .filter(|n| !n.trim().is_empty())
            .or_else(|| books::name_in(code, &self.language).map(str::to_string))
            .unwrap_or_else(|| code.to_string())
    }

    pub fn format_reference(&self, r: &Reference) -> String {
        let name = self.book_name(&r.book);
        if r.verse_end > r.verse_start {
            format!("{name} {}:{}-{}", r.chapter, r.verse_start, r.verse_end)
        } else {
            format!("{name} {}:{}", r.chapter, r.verse_start)
        }
    }

    pub fn passage(&self, r: &Reference, verse_numbers: bool) -> Passage {
        let verses: Vec<(usize, String)> = self
            .book(&r.book)
            .and_then(|b| b.chapters.get(r.chapter.checked_sub(1)?))
            .map(|ch| {
                (r.verse_start..=r.verse_end.max(r.verse_start))
                    .filter_map(|v| {
                        let text = ch.get(v.checked_sub(1)?)?.trim();
                        (!text.is_empty()).then(|| (v, text.to_string()))
                    })
                    .collect()
            })
            .unwrap_or_default();
        let several = verses.len() > 1;
        let text = verses
            .iter()
            .map(|(n, t)| if verse_numbers && several { format!("{n} {t}") } else { t.clone() })
            .collect::<Vec<_>>()
            .join(" ");
        Passage {
            bible_id: self.id.clone(),
            abbreviation: self.abbreviation.clone(),
            version_name: self.name.clone(),
            language: self.language.clone(),
            attribution: self.attribution.clone(),
            reference: self.format_reference(r),
            text,
            verses,
        }
    }

    /// Parses a reference typed by the operator, using this Bible's book names plus the
    /// names and abbreviations of its language (and English). "Juan" alone is John 1:1;
    /// "Juan 3" is John 3:1.
    pub fn parse_reference(&self, input: &str) -> Option<Reference> {
        let (number, word, numbers, range) = split_reference(input)?;
        let code = self.match_book(number, &word)?;
        let chapters = self.book(&code)?.chapters.len();
        let chapter = numbers.first().copied().unwrap_or(1).clamp(1, chapters.max(1));
        let verses = self.verse_count(&code, chapter).max(1);
        let start = numbers.get(1).copied().unwrap_or(1).clamp(1, verses);
        let end = if range { numbers.get(2).copied().unwrap_or(start).clamp(start, verses) } else { start };
        Some(Reference { book: code, chapter, verse_start: start, verse_end: end })
    }

    fn match_book(&self, number: Option<u32>, word: &str) -> Option<String> {
        let query = format!("{}{}", number.map(|n| n.to_string()).unwrap_or_default(), word);
        let lang = books::short_language(&self.language);
        let mut best: Option<(u8, usize, String)> = None;
        for (order, book) in self.books.iter().enumerate() {
            let info = books::info(&book.code);
            let book_number = book.code.chars().next().filter(char::is_ascii_digit);
            // Book numbers must agree ("1 juan" is never "juan").
            let want = number.and_then(|n| char::from_digit(n, 10));
            if book_number != want {
                continue;
            }
            let prefix = book_number.map(String::from).unwrap_or_default();
            let mut names: Vec<String> = vec![squash(&book.name), squash(&book.code)];
            if let Some(info) = info {
                let local = match lang {
                    "es" => info.es,
                    "ro" => info.ro,
                    _ => info.en,
                };
                names.push(squash(local));
                names.push(squash(info.en));
                names.extend(info.aliases.iter().map(|a| format!("{prefix}{}", squash(a))));
            }
            let score = names
                .iter()
                .map(|n| {
                    if *n == query {
                        3
                    } else if n.starts_with(&query) && query.len() > prefix.len() {
                        2
                    } else {
                        0
                    }
                })
                .max()
                .unwrap_or(0);
            if score > 0 && best.as_ref().is_none_or(|(s, _, _)| score > *s) {
                best = Some((score, order, book.code.clone()));
            }
        }
        best.map(|(_, _, code)| code)
    }

    /// Verses containing every word of `query` (in any order, accents and punctuation
    /// ignored; each word may be the start of a longer word). Returns at most `limit`
    /// hits in Bible order plus the total number of matches.
    pub fn search(&self, query: &str, book: Option<&str>, limit: usize) -> (Vec<(Reference, String)>, usize) {
        let tokens: Vec<String> = normalize(query).split_whitespace().map(|t| format!(" {t}")).collect();
        if tokens.is_empty() {
            return (vec![], 0);
        }
        let index = self.search_index.get_or_init(|| {
            let mut out = Vec::new();
            for (b, book) in self.books.iter().enumerate() {
                for (c, chapter) in book.chapters.iter().enumerate() {
                    for (v, text) in chapter.iter().enumerate() {
                        if !text.is_empty() {
                            out.push((b, c, v, format!(" {}", normalize(text))));
                        }
                    }
                }
            }
            out
        });
        let book_index = book.and_then(|code| self.books.iter().position(|b| b.code.eq_ignore_ascii_case(code)));
        let mut hits = Vec::new();
        let mut total = 0;
        for (b, c, v, text) in index {
            if book_index.is_some_and(|bi| bi != *b) {
                continue;
            }
            if tokens.iter().all(|t| text.contains(t.as_str())) {
                total += 1;
                if hits.len() < limit {
                    let r = Reference { book: self.books[*b].code.clone(), chapter: c + 1, verse_start: v + 1, verse_end: v + 1 };
                    hits.push((r, self.books[*b].chapters[*c][*v].clone()));
                }
            }
        }
        (hits, total)
    }

    /// The reference one verse after/before `r` (moving across chapters and books).
    pub fn step(&self, r: &Reference, forward: bool) -> Option<Reference> {
        let bi = self.books.iter().position(|b| b.code.eq_ignore_ascii_case(&r.book))?;
        let single = |book: usize, chapter: usize, verse: usize| Reference {
            book: self.books[book].code.clone(),
            chapter,
            verse_start: verse,
            verse_end: verse,
        };
        if forward {
            let verses = self.verse_count(&r.book, r.chapter);
            if r.verse_end < verses {
                return Some(single(bi, r.chapter, r.verse_end + 1));
            }
            if r.chapter < self.books[bi].chapters.len() {
                return Some(single(bi, r.chapter + 1, 1));
            }
            (bi + 1 < self.books.len()).then(|| single(bi + 1, 1, 1))
        } else {
            if r.verse_start > 1 {
                return Some(single(bi, r.chapter, r.verse_start - 1));
            }
            if r.chapter > 1 {
                let last = self.verse_count(&r.book, r.chapter - 1).max(1);
                return Some(single(bi, r.chapter - 1, last));
            }
            if bi == 0 {
                return None;
            }
            let prev = &self.books[bi - 1];
            let chapter = prev.chapters.len().max(1);
            let last = prev.chapters.last().map(Vec::len).unwrap_or(1).max(1);
            Some(single(bi - 1, chapter, last))
        }
    }
}

/// "1 Co 13:4-7" -> (Some(1), "co", [13, 4, 7], true). The book word is squashed
/// (lowercase, no accents, no spaces).
fn split_reference(input: &str) -> Option<(Option<u32>, String, Vec<usize>, bool)> {
    let text: String = input.nfd().filter(|c| !unicode_normalization::char::is_combining_mark(*c)).collect();
    let text = text.trim().to_lowercase();
    let first = text.chars().next()?;
    // Leading book number: "1 juan", "1juan", "1. juan".
    if first.is_ascii_digit() {
        let after = text[1..].trim_start_matches([' ', '.']);
        if after.chars().next().is_some_and(char::is_alphabetic) {
            return finish(first.to_digit(10), after);
        }
    }
    finish(None, &text)
}

fn finish(number: Option<u32>, text: &str) -> Option<(Option<u32>, String, Vec<usize>, bool)> {
    // The book word runs until the first digit after at least one letter.
    let mut word = String::new();
    let mut rest = "";
    for (i, c) in text.char_indices() {
        if c.is_ascii_digit() && word.chars().any(char::is_alphabetic) {
            rest = &text[i..];
            break;
        }
        word.push(c);
    }
    let word: String = word.chars().filter(|c| c.is_alphanumeric()).collect();
    if word.is_empty() {
        return None;
    }
    let mut numbers = Vec::new();
    let mut current = String::new();
    for c in rest.chars() {
        if c.is_ascii_digit() {
            current.push(c);
        } else if !current.is_empty() {
            numbers.push(current.parse().ok()?);
            current.clear();
        }
    }
    if !current.is_empty() {
        numbers.push(current.parse().ok()?);
    }
    let range = rest.contains('-') || rest.contains('–');
    Some((number, word, numbers, range))
}

// ---------- storage ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BibleSettings {
    /// Bundled Bibles the user removed (not written again on start).
    #[serde(default)]
    pub removed_bundled: Vec<String>,
    /// Versions shown on the Bible layer, in order (max 4). The first one is the
    /// "primary": its language is used for reference search and stepping.
    #[serde(default)]
    pub versions: Vec<String>,
    /// Design used to show passages (any slides design).
    #[serde(default)]
    pub design: Option<DesignRef>,
    /// Put verse numbers in front of each verse when several are shown.
    #[serde(default = "yes")]
    pub verse_numbers: bool,
}

fn yes() -> bool {
    true
}

impl Default for BibleSettings {
    fn default() -> Self {
        Self { removed_bundled: vec![], versions: vec![], design: None, verse_numbers: true }
    }
}

pub struct BibleStore {
    pub dir: PathBuf,
    bibles: Vec<Arc<Bible>>,
    pub settings: storage::JsonDoc<BibleSettings>,
}

fn read_bible(bytes: &[u8]) -> Result<Bible, AppError> {
    let mut text = String::new();
    flate2::read::GzDecoder::new(bytes)
        .read_to_string(&mut text)
        .map_err(|e| AppError::BadRequest(format!("not a Bible file: {e}")))?;
    serde_json::from_str(&text).map_err(|e| AppError::BadRequest(format!("not a Bible file: {e}")))
}

pub fn write_bible(path: &std::path::Path, bible: &Bible) -> Result<(), AppError> {
    let json = serde_json::to_vec(bible).map_err(|e| AppError::Internal(e.to_string()))?;
    let tmp = path.with_extension("tmp");
    {
        let file = std::fs::File::create(&tmp)?;
        let mut gz = flate2::write::GzEncoder::new(file, flate2::Compression::default());
        gz.write_all(&json)?;
        gz.finish()?;
    }
    std::fs::rename(&tmp, path)?;
    Ok(())
}

/// A file name safe id: lowercase letters, digits and dashes.
pub fn clean_id(raw: &str) -> String {
    let id: String = raw
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let id = id.trim_matches('-').to_string();
    if id.is_empty() {
        "bible".into()
    } else {
        id.chars().take(40).collect()
    }
}

impl BibleStore {
    pub fn load(dir: PathBuf) -> Result<Self, AppError> {
        std::fs::create_dir_all(&dir)?;
        let settings: storage::JsonDoc<BibleSettings> = storage::JsonDoc::load(dir.join("settings.json"))?;
        for (id, bytes) in BUNDLED {
            let path = dir.join(format!("{id}.json.gz"));
            if !path.exists() && !settings.value.removed_bundled.iter().any(|r| r == id) {
                std::fs::write(&path, bytes)?;
            }
        }
        let mut bibles = Vec::new();
        for entry in std::fs::read_dir(&dir)?.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !name.ends_with(".json.gz") {
                continue;
            }
            match std::fs::read(entry.path()).map_err(AppError::from).and_then(|b| read_bible(&b)) {
                Ok(b) => bibles.push(Arc::new(b)),
                Err(e) => tracing::warn!("skipping Bible {name}: {e}"),
            }
        }
        let mut store = Self { dir, bibles, settings };
        store.sort();
        store.fix_versions();
        Ok(store)
    }

    fn sort(&mut self) {
        self.bibles.sort_by(|a, b| (&a.language, &a.abbreviation).cmp(&(&b.language, &b.abbreviation)));
    }

    /// Drops removed versions from the selection; picks one when none is selected.
    fn fix_versions(&mut self) {
        let ids: Vec<String> = self.bibles.iter().map(|b| b.id.clone()).collect();
        let v = &mut self.settings.value.versions;
        v.retain(|id| ids.contains(id));
        v.dedup();
        v.truncate(MAX_VERSIONS);
        if v.is_empty() {
            if let Some(first) = ids.first() {
                v.push(first.clone());
            }
        }
    }

    pub fn list(&self) -> Vec<BibleSummary> {
        self.bibles.iter().map(|b| b.summary()).collect()
    }

    pub fn get(&self, id: &str) -> Result<Arc<Bible>, AppError> {
        self.bibles
            .iter()
            .find(|b| b.id == id)
            .cloned()
            .ok_or_else(|| AppError::NotFound(format!("Bible `{id}`")))
    }

    /// The selected versions (at least one if any Bible is installed).
    pub fn selected(&self) -> Vec<Arc<Bible>> {
        self.settings.value.versions.iter().filter_map(|id| self.get(id).ok()).collect()
    }

    pub fn primary(&self) -> Result<Arc<Bible>, AppError> {
        self.selected()
            .into_iter()
            .next()
            .or_else(|| self.bibles.first().cloned())
            .ok_or_else(|| AppError::Conflict("no Bible is installed; add one in Settings".into()))
    }

    /// Adds (or replaces) a translation. Returns its summary.
    pub fn install(&mut self, mut bible: Bible) -> Result<BibleSummary, AppError> {
        bible.id = clean_id(&bible.id);
        if bible.books.is_empty() || bible.books.iter().all(|b| b.chapters.is_empty()) {
            return Err(AppError::BadRequest("the file has no verses".into()));
        }
        if bible.abbreviation.trim().is_empty() {
            bible.abbreviation = bible.id.to_uppercase();
        }
        if bible.name.trim().is_empty() {
            bible.name = bible.abbreviation.clone();
        }
        bible.books.sort_by_key(|b| books::order(&b.code));
        write_bible(&self.dir.join(format!("{}.json.gz", bible.id)), &bible)?;
        self.settings.value.removed_bundled.retain(|r| *r != bible.id);
        self.settings.save()?;
        let summary = bible.summary();
        self.bibles.retain(|b| b.id != bible.id);
        self.bibles.push(Arc::new(bible));
        self.sort();
        self.fix_versions();
        Ok(summary)
    }

    /// Restores a bundled Bible that was removed.
    pub fn restore_bundled(&mut self, id: &str) -> Result<BibleSummary, AppError> {
        let (_, bytes) = BUNDLED
            .iter()
            .find(|(b, _)| *b == id)
            .ok_or_else(|| AppError::NotFound(format!("bundled Bible `{id}`")))?;
        self.install(read_bible(bytes)?)
    }

    pub fn remove(&mut self, id: &str) -> Result<(), AppError> {
        let path = self.dir.join(format!("{id}.json.gz"));
        if !self.bibles.iter().any(|b| b.id == id) {
            return Err(AppError::NotFound(format!("Bible `{id}`")));
        }
        if path.exists() {
            std::fs::remove_file(path)?;
        }
        self.bibles.retain(|b| b.id != id);
        if BUNDLED.iter().any(|(b, _)| *b == id) && !self.settings.value.removed_bundled.iter().any(|r| r == id) {
            self.settings.value.removed_bundled.push(id.to_string());
        }
        self.fix_versions();
        self.settings.save()
    }

    pub fn save_settings(&mut self, mut settings: BibleSettings) -> Result<(), AppError> {
        settings.removed_bundled = self.settings.value.removed_bundled.clone();
        self.settings.value = settings;
        self.fix_versions();
        self.settings.save()
    }

    /// Bundled Bibles that are not installed (removed earlier).
    pub fn available_bundled(&self) -> Vec<BibleSummary> {
        BUNDLED
            .iter()
            .filter(|(id, _)| !self.bibles.iter().any(|b| b.id == *id))
            .filter_map(|(_, bytes)| read_bible(bytes).ok().map(|b| b.summary()))
            .collect()
    }
}

/// What is on the Bible layer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BibleLive {
    pub reference: Reference,
}

pub fn new_bible(id: &str, abbreviation: &str, name: &str, language: &str, books: Vec<BibleBook>) -> Bible {
    Bible {
        id: id.to_string(),
        abbreviation: abbreviation.to_string(),
        name: name.to_string(),
        language: language.to_string(),
        license: String::new(),
        attribution: String::new(),
        source: String::new(),
        books,
        search_index: OnceLock::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bundled(id: &str) -> Bible {
        read_bible(BUNDLED.iter().find(|(b, _)| *b == id).unwrap().1).unwrap()
    }

    #[test]
    fn parses_references_per_language() {
        let es = bundled("rva");
        let r = es.parse_reference("Juan 3:16").unwrap();
        assert_eq!((r.book.as_str(), r.chapter, r.verse_start, r.verse_end), ("JHN", 3, 16, 16));
        let r = es.parse_reference("1 co 13:4-7").unwrap();
        assert_eq!((r.book.as_str(), r.chapter, r.verse_start, r.verse_end), ("1CO", 13, 4, 7));
        let r = es.parse_reference("jn 3 16").unwrap();
        assert_eq!((r.book.as_str(), r.verse_start), ("JHN", 16));
        let r = es.parse_reference("1jn 1").unwrap();
        assert_eq!((r.book.as_str(), r.chapter, r.verse_start), ("1JN", 1, 1));
        let r = es.parse_reference("salmos 23").unwrap();
        assert_eq!((r.book.as_str(), r.chapter, r.verse_start), ("PSA", 23, 1));
        let r = es.parse_reference("génesis").unwrap();
        assert_eq!((r.book.as_str(), r.chapter), ("GEN", 1));
        let r = es.parse_reference("hechos 2.38").unwrap();
        assert_eq!((r.book.as_str(), r.chapter, r.verse_start), ("ACT", 2, 38));

        let ro = bundled("vdc");
        let r = ro.parse_reference("Ioan 3:16").unwrap();
        assert_eq!((r.book.as_str(), r.chapter, r.verse_start), ("JHN", 3, 16));
        let r = ro.parse_reference("faptele 2:38").unwrap();
        assert_eq!(r.book, "ACT");
        let r = ro.parse_reference("1 imp 3").unwrap();
        assert_eq!(r.book, "1KI");
        assert!(ro.passage(&r, false).reference.starts_with("1 Împăr"));

        let en = bundled("kjv");
        let r = en.parse_reference("Rev 22:21").unwrap();
        assert_eq!((r.book.as_str(), r.chapter, r.verse_start), ("REV", 22, 21));
        assert_eq!(en.passage(&en.parse_reference("john 3:16").unwrap(), false).reference, "John 3:16");
    }

    #[test]
    fn searches_words_in_any_order_without_accents() {
        let es = bundled("rva");
        let (hits, total) = es.search("mundo amo tal manera", None, 10);
        assert!(total >= 1);
        assert!(hits.iter().any(|(r, _)| r.book == "JHN" && r.chapter == 3 && r.verse_start == 16));
        let ro = bundled("vdc");
        let (hits, _) = ro.search("pastorul domnul", None, 10);
        assert!(hits.iter().any(|(r, _)| r.book == "PSA" && r.chapter == 23));
    }

    #[test]
    fn steps_across_chapters_and_books() {
        let en = bundled("kjv");
        let r = en.parse_reference("gen 1:31").unwrap();
        let n = en.step(&r, true).unwrap();
        assert_eq!((n.chapter, n.verse_start), (2, 1));
        let p = en.step(&n, false).unwrap();
        assert_eq!((p.chapter, p.verse_start), (1, 31));
        let last = en.parse_reference("mal 4:6").unwrap();
        assert_eq!(en.step(&last, true).unwrap().book, "MAT");
    }
}
