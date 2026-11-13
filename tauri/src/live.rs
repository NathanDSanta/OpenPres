//! Live content that is not a presentation: the video input on layer 1 and the active
//! props / complements. Like slides, this is global; screens choose which layers to show.

use crate::theme::DesignRef;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PropsLayer {
    Props,
    Complements,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct LiveLayers {
    /// Namespaced video device id shown on the video input layer.
    pub video_input: Option<String>,
    pub props: Vec<DesignRef>,
    pub complements: Vec<DesignRef>,
}

impl LiveLayers {
    pub fn list_mut(&mut self, layer: PropsLayer) -> &mut Vec<DesignRef> {
        match layer {
            PropsLayer::Props => &mut self.props,
            PropsLayer::Complements => &mut self.complements,
        }
    }
    /// Turns a prop on/off (`active: None` toggles). Returns the new state.
    pub fn set_prop(&mut self, layer: PropsLayer, r: DesignRef, active: Option<bool>) -> bool {
        let list = self.list_mut(layer);
        let present = list.contains(&r);
        let want = active.unwrap_or(!present);
        if want && !present {
            list.push(r);
        } else if !want {
            list.retain(|x| x != &r);
        }
        want
    }
}
