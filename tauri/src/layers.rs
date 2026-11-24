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
    Bible,
    Announcements,
    /// Before the props were one layer, "complements" was a second props layer.
    #[serde(alias = "complements")]
    Props,
}

impl LayerKind {
    pub const ORDER: [LayerKind; 6] = [
        LayerKind::VideoInput,
        LayerKind::Media,
        LayerKind::Slides,
        LayerKind::Bible,
        LayerKind::Announcements,
        LayerKind::Props,
    ];
}

/// Who a props collection is for: the room (the Stage operator's screens) or the stream.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PropsSide {
    #[default]
    Stage,
    Livestream,
}

/// Which props a screen's Props layer shows.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PropsShown {
    Stage,
    Livestream,
    #[default]
    Both,
}

impl PropsShown {
    pub fn shows(self, side: PropsSide) -> bool {
        match self {
            PropsShown::Both => true,
            PropsShown::Stage => side == PropsSide::Stage,
            PropsShown::Livestream => side == PropsSide::Livestream,
        }
    }
}

/// Which layers a screen shows.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(from = "LayerTogglesFile")]
pub struct LayerToggles {
    pub video_input: bool,
    pub media: bool,
    pub slides: bool,
    pub bible: bool,
    pub announcements: bool,
    pub props: bool,
    /// The props the Props layer shows: the Stage's, the Livestream's or both.
    pub props_shown: PropsShown,
}

/// As stored: older files have a second props layer, `complements`.
#[derive(Deserialize)]
struct LayerTogglesFile {
    video_input: Option<bool>,
    media: Option<bool>,
    slides: Option<bool>,
    bible: Option<bool>,
    announcements: Option<bool>,
    props: Option<bool>,
    complements: Option<bool>,
    props_shown: Option<PropsShown>,
}

impl From<LayerTogglesFile> for LayerToggles {
    fn from(f: LayerTogglesFile) -> Self {
        let on = |v: Option<bool>| v.unwrap_or(true);
        // A screen that showed either props layer shows every prop now (props used to go
        // on either layer; now their collection says who they're for).
        let props = match (f.props_shown, f.complements) {
            (None, Some(complements)) => on(f.props) || complements,
            _ => on(f.props),
        };
        Self {
            video_input: on(f.video_input),
            media: on(f.media),
            slides: on(f.slides),
            bible: on(f.bible),
            announcements: on(f.announcements),
            props,
            props_shown: f.props_shown.unwrap_or_default(),
        }
    }
}

impl Default for LayerToggles {
    fn default() -> Self {
        Self {
            video_input: true,
            media: true,
            slides: true,
            bible: true,
            announcements: true,
            props: true,
            props_shown: PropsShown::Both,
        }
    }
}

impl LayerToggles {
    pub fn get(&self, kind: LayerKind) -> bool {
        match kind {
            LayerKind::VideoInput => self.video_input,
            LayerKind::Media => self.media,
            LayerKind::Slides => self.slides,
            LayerKind::Bible => self.bible,
            LayerKind::Announcements => self.announcements,
            LayerKind::Props => self.props,
        }
    }
    pub fn set(&mut self, kind: LayerKind, on: bool) {
        let slot = match kind {
            LayerKind::VideoInput => &mut self.video_input,
            LayerKind::Media => &mut self.media,
            LayerKind::Slides => &mut self.slides,
            LayerKind::Bible => &mut self.bible,
            LayerKind::Announcements => &mut self.announcements,
            LayerKind::Props => &mut self.props,
        };
        *slot = on;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn the_complements_layer_becomes_part_of_props() {
        let old: LayerToggles = serde_json::from_value(json!({"props": false, "complements": true, "media": false})).unwrap();
        assert!(old.props && !old.media);
        assert_eq!(old.props_shown, PropsShown::Both);
        let none: LayerToggles = serde_json::from_value(json!({"props": false, "complements": false})).unwrap();
        assert!(!none.props);
        let new: LayerToggles = serde_json::from_value(json!({"props": true, "props_shown": "livestream"})).unwrap();
        assert_eq!(new.props_shown, PropsShown::Livestream);
        assert!(serde_json::to_value(&new).unwrap().get("complements").is_none());
    }

    #[test]
    fn props_shown_filters_by_side() {
        assert!(PropsShown::Both.shows(PropsSide::Livestream));
        assert!(PropsShown::Stage.shows(PropsSide::Stage) && !PropsShown::Stage.shows(PropsSide::Livestream));
        assert!(PropsShown::Livestream.shows(PropsSide::Livestream) && !PropsShown::Livestream.shows(PropsSide::Stage));
    }
}
