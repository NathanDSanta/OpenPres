//! Translation: language tracks that phones listen to (the OpenPres Translation app).
//!
//! A track is one language, and it gets its sound one of two ways:
//! - **manual**: someone interprets live into a microphone plugged into this computer. That
//!   input goes to a bus like any other (Audio page), and the track plays the bus.
//! - **automatic**: the computer translates another bus by itself (speech recognition, machine
//!   translation and a voice). Not available yet: the track says so and plays nothing.
//!
//! Phones hear a track's bus through the shared bus feeds (audio::listen), at 24 kHz mono by
//! default. What a track carries is meant to grow: today its sound; later captions from the
//! automatic mode, for the phones and the screens (`Track::captions`).

use crate::{audio::BUSES, error::AppError, storage::JsonDoc};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tokio::sync::{watch, RwLock};

/// A language a track can be in.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct Language {
    /// ISO 639-1 (es).
    pub code: &'static str,
    /// In the language itself, as phones show it.
    pub name: &'static str,
    /// In English, as the manager shows it.
    pub english: &'static str,
}

/// The languages there are tracks for. One for now.
pub const LANGUAGES: &[Language] = &[Language { code: "es", name: "Español", english: "Spanish" }];

pub fn language(code: &str) -> Option<&'static Language> {
    LANGUAGES.iter().find(|l| l.code == code)
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    /// An interpreter speaks into a microphone on `bus`.
    #[default]
    Manual,
    /// Made by the computer from `source_bus`. Not available yet.
    Automatic,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Track {
    /// A code from LANGUAGES.
    pub language: String,
    /// Phones can listen while it's on.
    #[serde(default)]
    pub on: bool,
    #[serde(default)]
    pub mode: Mode,
    /// Manual: the bus the interpreter's microphone goes to (1-16).
    #[serde(default)]
    pub bus: Option<u8>,
    /// Automatic: the bus to translate, usually the preacher's microphone (1-16). Kept while
    /// the mode is manual, so switching back and forth keeps both choices.
    #[serde(default)]
    pub source_bus: Option<u8>,
}

impl Track {
    fn new(language: &str) -> Self {
        Self { language: language.into(), on: false, mode: Mode::Manual, bus: None, source_bus: None }
    }

    /// The bus phones hear now, or why they hear nothing.
    pub fn sound(&self) -> Result<u8, String> {
        if !self.on {
            return Err("off".into());
        }
        match self.mode {
            Mode::Manual => self.bus.ok_or_else(|| "no interpreter's bus chosen".into()),
            Mode::Automatic => Err("automatic translation isn't available yet".into()),
        }
    }

    /// Whether phones get captions (text) too. Only the automatic mode will make them.
    pub fn captions(&self) -> bool {
        false
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TranslationSettings {
    /// One per language, in the order of LANGUAGES.
    pub tracks: Vec<Track>,
}

impl Default for TranslationSettings {
    fn default() -> Self {
        Self { tracks: LANGUAGES.iter().map(|l| Track::new(l.code)).collect() }
    }
}

impl TranslationSettings {
    /// Refuses unknown languages, repeats and buses that don't exist; adds a track (off) for
    /// every language without one.
    pub fn validate(&mut self) -> Result<(), AppError> {
        let mut tracks = Vec::new();
        for lang in LANGUAGES {
            let mut same = self.tracks.iter().filter(|t| t.language == lang.code);
            let track = same.next().cloned().unwrap_or_else(|| Track::new(lang.code));
            if same.next().is_some() {
                return Err(AppError::BadRequest(format!("two {} tracks", lang.english)));
            }
            for bus in [track.bus, track.source_bus].into_iter().flatten() {
                if !(1..=BUSES).contains(&bus) {
                    return Err(AppError::BadRequest(format!("{}: there's no bus {bus}", lang.english)));
                }
            }
            tracks.push(track);
        }
        if let Some(other) = self.tracks.iter().find(|t| language(&t.language).is_none()) {
            return Err(AppError::BadRequest(format!("no {:?} translation yet", other.language)));
        }
        self.tracks = tracks;
        Ok(())
    }

    pub fn track(&self, code: &str) -> Option<&Track> {
        self.tracks.iter().find(|t| t.language == code)
    }
}

/// The settings (translation.json), and a signal for listeners when they change: a phone
/// listening to a track that goes off, or moves to another bus, is cut off and reconnects.
pub struct Translation {
    doc: RwLock<JsonDoc<TranslationSettings>>,
    changes: watch::Sender<TranslationSettings>,
}

impl Translation {
    pub fn load(path: PathBuf) -> Result<Self, AppError> {
        let mut doc = JsonDoc::<TranslationSettings>::load(path)?;
        // A file from a newer version with a language this one doesn't know: start over.
        if doc.value.validate().is_err() {
            doc.value = TranslationSettings::default();
        }
        let (changes, _) = watch::channel(doc.value.clone());
        Ok(Self { doc: RwLock::new(doc), changes })
    }

    pub async fn settings(&self) -> TranslationSettings {
        self.doc.read().await.value.clone()
    }

    pub async fn replace(&self, mut settings: TranslationSettings) -> Result<TranslationSettings, AppError> {
        settings.validate()?;
        self.doc.write().await.replace(settings.clone())?;
        self.changes.send_replace(settings.clone());
        Ok(settings)
    }

    /// Follows the settings as they change.
    pub fn watch(&self) -> watch::Receiver<TranslationSettings> {
        self.changes.subscribe()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_track_per_language_with_valid_buses() {
        let mut s = TranslationSettings { tracks: vec![] };
        s.validate().unwrap();
        assert_eq!(s.tracks, vec![Track::new("es")]);

        let mut bad = TranslationSettings { tracks: vec![Track { bus: Some(17), ..Track::new("es") }] };
        assert!(bad.validate().is_err());
        let mut twice = TranslationSettings { tracks: vec![Track::new("es"), Track::new("es")] };
        assert!(twice.validate().is_err());
        let mut unknown = TranslationSettings { tracks: vec![Track::new("es"), Track::new("xx")] };
        assert!(unknown.validate().is_err());
    }

    #[test]
    fn what_phones_hear() {
        let off = Track { bus: Some(9), ..Track::new("es") };
        assert_eq!(off.sound(), Err("off".into()));
        let manual = Track { on: true, ..off.clone() };
        assert_eq!(manual.sound(), Ok(9));
        let no_bus = Track { on: true, ..Track::new("es") };
        assert!(no_bus.sound().is_err());
        let automatic = Track { mode: Mode::Automatic, source_bus: Some(1), ..manual };
        assert_eq!(automatic.sound(), Err("automatic translation isn't available yet".into()));
        assert!(!automatic.captions());
    }
}
