use crate::{
    error::AppError,
    presentation::{FlatSlide, PresentationLayer},
};
use serde::Serialize;
use uuid::Uuid;

/// What is live on one presentation layer.
#[derive(Debug, Clone, Serialize)]
pub struct LiveState {
    pub presentation_id: Uuid,
    /// None = the implicit `default` arrangement.
    pub arrangement: Option<String>,
    pub slide_index: usize,
    pub total_slides: usize,
    /// The slide exactly as it was when it went live. Editing the presentation (e.g. in
    /// Reflow) does not change what is on screen until the operator moves to another slide.
    pub snapshot: FlatSlide,
}

#[derive(Debug, Default)]
pub struct PresenterEngine {
    pub slides: Option<LiveState>,
    pub announcements: Option<LiveState>,
}

impl PresenterEngine {
    fn slot(&mut self, layer: PresentationLayer) -> &mut Option<LiveState> {
        match layer {
            PresentationLayer::Slides => &mut self.slides,
            PresentationLayer::Announcements => &mut self.announcements,
        }
    }
    pub fn get(&self, layer: PresentationLayer) -> Option<&LiveState> {
        match layer {
            PresentationLayer::Slides => self.slides.as_ref(),
            PresentationLayer::Announcements => self.announcements.as_ref(),
        }
    }
    pub fn set(&mut self, layer: PresentationLayer, live: LiveState) {
        *self.slot(layer) = Some(live);
    }
    pub fn require(&self, layer: PresentationLayer) -> Result<&LiveState, AppError> {
        self.get(layer)
            .ok_or_else(|| AppError::Conflict(format!("nothing is live on the {:?} layer", layer)))
    }
    pub fn clear(&mut self, layer: PresentationLayer) {
        *self.slot(layer) = None;
    }
}

/// How a step moves through the slides.
#[derive(Debug, Clone, Copy)]
pub enum Step {
    Next,
    Previous,
    Goto(usize),
}

impl Step {
    /// The target index, given the current one and the (freshly read) total.
    pub fn apply(self, current: usize, total: usize) -> Result<usize, AppError> {
        if total == 0 {
            return Err(AppError::Conflict("this presentation has no slides".into()));
        }
        let last = total - 1;
        Ok(match self {
            Step::Next => (current + 1).min(last),
            Step::Previous => current.saturating_sub(1).min(last),
            Step::Goto(index) => {
                if index > last {
                    return Err(AppError::BadRequest(format!(
                        "slide index {index} is out of range (0-{last})"
                    )));
                }
                index
            }
        })
    }
}
