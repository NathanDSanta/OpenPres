//! History of the Bible passages that were shown, and saved lists of passages.
//!
//! A history entry is one "showing": it starts with the passage that was put on screen and
//! grows while the presenter steps to the next/previous verse (or shows a neighbouring verse),
//! so it records both where the reading started and where it ended.

use super::{books, Bible, Reference};
use crate::{error::AppError, storage};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Most entries kept; older ones are dropped.
pub const MAX_HISTORY: usize = 300;
/// Showing the very same passage again within this time does not add a new entry.
const REPEAT_MS: i64 = 2 * 60 * 1000;

/// One verse.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VersePoint {
    pub book: String,
    pub chapter: usize,
    pub verse: usize,
}

impl VersePoint {
    fn key(&self) -> (usize, usize, usize) {
        (books::order(&self.book), self.chapter, self.verse)
    }
    fn reference(&self) -> Reference {
        Reference { book: self.book.clone(), chapter: self.chapter, verse_start: self.verse, verse_end: self.verse }
    }
}

/// A stretch of verses, possibly over several chapters or books.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Span {
    pub from: VersePoint,
    pub to: VersePoint,
}

impl Span {
    pub fn of(r: &Reference) -> Self {
        let end = r.verse_end.max(r.verse_start);
        Self {
            from: VersePoint { book: r.book.clone(), chapter: r.chapter, verse: r.verse_start },
            to: VersePoint { book: r.book.clone(), chapter: r.chapter, verse: end },
        }
    }

    /// Puts `from` before `to`.
    pub fn normalized(mut self) -> Self {
        if self.to.key() < self.from.key() {
            std::mem::swap(&mut self.from, &mut self.to);
        }
        self
    }

    /// Grows the span so it also covers `r`.
    pub fn extend(&mut self, r: &Reference) {
        let other = Span::of(r);
        if other.from.key() < self.from.key() {
            self.from = other.from;
        }
        if other.to.key() > self.to.key() {
            self.to = other.to;
        }
    }

    /// The span as one reference, when it is inside one chapter.
    pub fn as_reference(&self) -> Option<Reference> {
        (self.from.book == self.to.book && self.from.chapter == self.to.chapter).then(|| Reference {
            book: self.from.book.clone(),
            chapter: self.from.chapter,
            verse_start: self.from.verse,
            verse_end: self.to.verse,
        })
    }

    /// True when `r` overlaps the span or is right next to it (the verse before or after,
    /// also across chapters and books).
    fn touches(&self, r: &Reference, bible: &Bible) -> bool {
        let other = Span::of(r);
        let overlaps = other.from.key() <= self.to.key() && other.to.key() >= self.from.key();
        let after = bible.step(&self.to.reference(), true).map(|n| Span::of(&n).from);
        let before = bible.step(&self.from.reference(), false).map(|p| Span::of(&p).to);
        overlaps || after.as_ref() == Some(&other.from) || before.as_ref() == Some(&other.to)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub id: Uuid,
    /// What was put on screen first (showing the entry again starts here).
    pub first: Reference,
    /// Everything that was on screen during this showing.
    pub span: Span,
    pub shown_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct History {
    /// Newest first.
    #[serde(default)]
    pub entries: Vec<HistoryEntry>,
}

impl History {
    /// Records that `r` was shown. When `current` (the entry being shown) touches `r` it is
    /// extended; otherwise a new entry starts. Returns the id of the entry for `r`.
    pub fn record(&mut self, r: &Reference, current: Option<Uuid>, bible: &Bible, now: i64) -> Uuid {
        if let Some(entry) = current.and_then(|id| self.entries.iter_mut().find(|e| e.id == id)) {
            if entry.span.touches(r, bible) {
                entry.span.extend(r);
                entry.updated_at = now;
                return entry.id;
            }
        }
        if let Some(entry) = self.entries.first_mut() {
            if entry.first == *r && entry.span == Span::of(r) && now - entry.updated_at < REPEAT_MS {
                entry.updated_at = now;
                return entry.id;
            }
        }
        let entry = HistoryEntry { id: Uuid::new_v4(), first: r.clone(), span: Span::of(r), shown_at: now, updated_at: now };
        let id = entry.id;
        self.entries.insert(0, entry);
        self.entries.truncate(MAX_HISTORY);
        id
    }
}

/// One passage in a saved list.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListItem {
    #[serde(default = "Uuid::new_v4", deserialize_with = "storage::ids::new_if_empty")]
    pub id: Uuid,
    pub span: Span,
    /// Show the whole passage at once (only for passages inside one chapter); otherwise it is
    /// shown verse by verse, starting at the first one.
    #[serde(default)]
    pub whole: bool,
    #[serde(default)]
    pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BibleList {
    #[serde(default = "Uuid::new_v4", deserialize_with = "storage::ids::new_if_empty")]
    pub id: Uuid,
    pub name: String,
    #[serde(default)]
    pub items: Vec<ListItem>,
}

impl BibleList {
    pub fn validate(mut self) -> Result<Self, AppError> {
        self.name = self.name.trim().chars().take(80).collect();
        if self.name.is_empty() {
            return Err(AppError::BadRequest("a list needs a name".into()));
        }
        if self.items.len() > 1000 {
            return Err(AppError::BadRequest("a list can hold up to 1000 passages".into()));
        }
        for item in &mut self.items {
            item.span = item.span.clone().normalized();
            if item.span.from.verse == 0 || item.span.from.chapter == 0 {
                return Err(AppError::BadRequest("verses and chapters start at 1".into()));
            }
            if item.whole && item.span.as_reference().is_none() {
                item.whole = false;
            }
            item.note = item.note.chars().take(200).collect();
        }
        Ok(self)
    }
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct Lists {
    #[serde(default)]
    pub lists: Vec<BibleList>,
}

/// "Juan 3:16", "Juan 3:16-21", "Juan 3:16 – 4:2", "Juan 21:25 – Hechos 1:3".
pub fn span_label(bible: &Bible, span: &Span) -> String {
    if let Some(r) = span.as_reference() {
        return bible.format_reference(&r);
    }
    let from = bible.format_reference(&span.from.reference());
    if span.from.book == span.to.book {
        format!("{from} – {}:{}", span.to.chapter, span.to.verse)
    } else {
        format!("{from} – {}", bible.format_reference(&span.to.reference()))
    }
}

pub fn point_label(bible: &Bible, p: &VersePoint) -> String {
    bible.format_reference(&p.reference())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bible::{new_bible, BibleBook};

    fn bible() -> Bible {
        let book = |code: &str, name: &str, chapters: &[usize]| BibleBook {
            code: code.into(),
            name: name.into(),
            chapters: chapters.iter().map(|&n| (1..=n).map(|v| format!("v{v}")).collect()).collect(),
        };
        new_bible("t", "T", "Test", "en", vec![book("JHN", "John", &[3, 4]), book("ACT", "Acts", &[2])])
    }

    fn r(book: &str, chapter: usize, a: usize, b: usize) -> Reference {
        Reference { book: book.into(), chapter, verse_start: a, verse_end: b }
    }

    #[test]
    fn stepping_extends_the_current_entry() {
        let b = bible();
        let mut h = History::default();
        let id = h.record(&r("JHN", 1, 2, 2), None, &b, 0);
        assert_eq!(h.record(&r("JHN", 1, 3, 3), Some(id), &b, 10), id);
        // Across a chapter and then a book.
        assert_eq!(h.record(&r("JHN", 2, 1, 1), Some(id), &b, 20), id);
        assert_eq!(h.entries.len(), 1);
        let e = &h.entries[0];
        assert_eq!(e.first, r("JHN", 1, 2, 2));
        assert_eq!((e.span.from.chapter, e.span.from.verse, e.span.to.chapter, e.span.to.verse), (1, 2, 2, 1));
        assert_eq!(span_label(&b, &e.span), "John 1:2 – 2:1");
        // Going back before the start moves the start.
        h.record(&r("JHN", 1, 1, 1), Some(id), &b, 30);
        assert_eq!(h.entries[0].span.from.verse, 1);
    }

    #[test]
    fn a_far_passage_starts_a_new_entry() {
        let b = bible();
        let mut h = History::default();
        let id = h.record(&r("JHN", 1, 1, 1), None, &b, 0);
        let other = h.record(&r("ACT", 1, 1, 2), Some(id), &b, 10);
        assert_ne!(id, other);
        assert_eq!(h.entries[0].id, other);
        assert_eq!(span_label(&b, &h.entries[0].span), "Acts 1:1-2");
        // The same passage again right away is not a new entry.
        assert_eq!(h.record(&r("ACT", 1, 1, 2), None, &b, 20), other);
        assert_eq!(h.entries.len(), 2);
    }

    #[test]
    fn whole_needs_one_chapter() {
        let list = BibleList {
            id: Uuid::nil(),
            name: " Sermon ".into(),
            items: vec![ListItem {
                id: Uuid::nil(),
                span: Span {
                    from: VersePoint { book: "JHN".into(), chapter: 2, verse: 1 },
                    to: VersePoint { book: "JHN".into(), chapter: 1, verse: 2 },
                },
                whole: true,
                note: String::new(),
            }],
        }
        .validate()
        .unwrap();
        assert_eq!(list.name, "Sermon");
        assert_eq!(list.items[0].span.from.chapter, 1, "from/to put in order");
        assert!(!list.items[0].whole);
    }
}
