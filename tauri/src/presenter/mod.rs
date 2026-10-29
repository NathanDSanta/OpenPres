use crate::{error::AppError, presentation::PresentationLayer};
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
    pub fn load(&mut self, layer: PresentationLayer, live: LiveState) {
        *self.slot(layer) = Some(live);
    }
    fn live_mut(&mut self, layer: PresentationLayer) -> Result<&mut LiveState, AppError> {
        self.slot(layer)
            .as_mut()
            .ok_or_else(|| AppError::Conflict(format!("nothing is live on the {:?} layer", layer)))
    }
    /// Returns the new slide index. At the last slide it stays where it is.
    pub fn next(&mut self, layer: PresentationLayer) -> Result<usize, AppError> {
        let live = self.live_mut(layer)?;
        if live.slide_index + 1 < live.total_slides {
            live.slide_index += 1;
        }
        Ok(live.slide_index)
    }
    /// Returns the new slide index. At the first slide it stays where it is.
    pub fn previous(&mut self, layer: PresentationLayer) -> Result<usize, AppError> {
        let live = self.live_mut(layer)?;
        if live.slide_index > 0 {
            live.slide_index -= 1;
        }
        Ok(live.slide_index)
    }
    pub fn goto(&mut self, layer: PresentationLayer, index: usize) -> Result<usize, AppError> {
        let live = self.live_mut(layer)?;
        if index >= live.total_slides {
            return Err(AppError::BadRequest(format!(
                "slide index {} is out of range (0-{})",
                index,
                live.total_slides.saturating_sub(1)
            )));
        }
        live.slide_index = index;
        Ok(index)
    }
    pub fn clear(&mut self, layer: PresentationLayer) {
        *self.slot(layer) = None;
    }
}
