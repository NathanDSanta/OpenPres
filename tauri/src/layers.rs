//! The visual layers of a screen, bottom to top. Content is global (what is live), and
//! every virtual screen chooses which layers it shows. The mask is drawn above all of
//! them and is configured per screen.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LayerKind {
    VideoInput,
    Media,
    Slides,
    Announcements,
    Complements,
    Props,
}

impl LayerKind {
    pub const ORDER: [LayerKind; 6] = [
        LayerKind::VideoInput,
        LayerKind::Media,
        LayerKind::Slides,
        LayerKind::Announcements,
        LayerKind::Complements,
        LayerKind::Props,
    ];
}

fn yes() -> bool {
    true
}

/// Which layers a screen shows.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayerToggles {
    #[serde(default = "yes")]
    pub video_input: bool,
    #[serde(default = "yes")]
    pub media: bool,
    #[serde(default = "yes")]
    pub slides: bool,
    #[serde(default = "yes")]
    pub announcements: bool,
    #[serde(default = "yes")]
    pub complements: bool,
    #[serde(default = "yes")]
    pub props: bool,
}

impl Default for LayerToggles {
    fn default() -> Self {
        Self {
            video_input: true,
            media: true,
            slides: true,
            announcements: true,
            complements: true,
            props: true,
        }
    }
}

impl LayerToggles {
    pub fn get(&self, kind: LayerKind) -> bool {
        match kind {
            LayerKind::VideoInput => self.video_input,
            LayerKind::Media => self.media,
            LayerKind::Slides => self.slides,
            LayerKind::Announcements => self.announcements,
            LayerKind::Complements => self.complements,
            LayerKind::Props => self.props,
        }
    }
    pub fn set(&mut self, kind: LayerKind, on: bool) {
        let slot = match kind {
            LayerKind::VideoInput => &mut self.video_input,
            LayerKind::Media => &mut self.media,
            LayerKind::Slides => &mut self.slides,
            LayerKind::Announcements => &mut self.announcements,
            LayerKind::Complements => &mut self.complements,
            LayerKind::Props => &mut self.props,
        };
        *slot = on;
    }
}
