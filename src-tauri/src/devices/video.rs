use crate::error::AppError;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoDevice {
    pub id: String,
    pub name: String,
    pub resolutions: Vec<(u32, u32)>,
}

/// Implement this for each backend (nokhwa now, BlackMagic DeckLink later).
#[async_trait]
pub trait VideoInputProvider: Send + Sync {
    fn name(&self) -> &'static str;
    async fn list(&self) -> Result<Vec<VideoDevice>, AppError>;
}

/// Generic webcams / UVC capture devices via nokhwa.
pub struct NokhwaProvider;

#[async_trait]
impl VideoInputProvider for NokhwaProvider {
    fn name(&self) -> &'static str { "nokhwa" }
    async fn list(&self) -> Result<Vec<VideoDevice>, AppError> { todo!() }
}

// TODO(later): DeckLinkProvider (BlackMagic SDK)
