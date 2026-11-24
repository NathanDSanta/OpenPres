//! Live content that is not a presentation: the video input on layer 1 and the props that
//! are on. Like slides, this is global; screens choose which layers (and props) to show.

use crate::theme::DesignRef;
use serde::Serialize;

#[derive(Debug, Clone, Default, Serialize)]
pub struct LiveLayers {
    /// Namespaced video device id shown on the video input layer.
    pub video_input: Option<String>,
    /// The props that are on (each collection says whether it's for the Stage or the
    /// Livestream; each screen's Props layer chooses which it shows).
    pub props: Vec<DesignRef>,
}

impl LiveLayers {
    /// Turns a prop on/off (`active: None` toggles). Returns the new state.
    pub fn set_prop(&mut self, r: DesignRef, active: Option<bool>) -> bool {
        let present = self.props.contains(&r);
        let want = active.unwrap_or(!present);
        if want && !present {
            self.props.push(r);
        } else if !want {
            self.props.retain(|x| x != &r);
        }
        want
    }
}
