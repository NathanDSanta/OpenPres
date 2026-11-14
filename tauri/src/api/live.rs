use crate::{
    error::AppError,
    live::PropsLayer,
    media::Slot,
    presentation::PresentationLayer,
    state::SharedState,
    theme::{DesignRef, ThemeKind},
};
use axum::{
    extract::State,
    routing::{get, post, put},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};

pub fn routes() -> Router<SharedState> {
    Router::new()
        .route("/live", get(get_live))
        .route("/live/video_input", put(set_video_input))
        .route("/live/props", post(set_prop))
        .route("/live/props/clear", post(clear_props))
        .route("/live/clear", post(clear))
}

async fn live_json(s: &SharedState) -> Value {
    json!(*s.live.read().await)
}

async fn get_live(State(s): State<SharedState>) -> Json<Value> {
    Json(live_json(&s).await)
}

#[derive(Deserialize)]
struct VideoInputBody {
    device_id: Option<String>,
}

/// Body: {"device_id": "nokhwa:0"} or {"device_id": null} to clear the video input layer.
async fn set_video_input(
    State(s): State<SharedState>,
    Json(body): Json<VideoInputBody>,
) -> Result<Json<Value>, AppError> {
    if let Some(device) = &body.device_id {
        let known = s.devices.video_devices().await.iter().any(|d| &d.id == device);
        if !known {
            return Err(AppError::BadRequest(format!(
                "unknown video device `{device}` (refresh the device list)"
            )));
        }
    }
    s.live.write().await.video_input = body.device_id;
    Ok(Json(live_json(&s).await))
}

#[derive(Deserialize)]
struct PropBody {
    layer: PropsLayer,
    theme_id: uuid::Uuid,
    design_id: uuid::Uuid,
    /// true = show, false = hide, absent = toggle.
    active: Option<bool>,
}

async fn set_prop(State(s): State<SharedState>, Json(body): Json<PropBody>) -> Result<Json<Value>, AppError> {
    {
        let themes = s.themes.read().await;
        let theme = themes.get(body.theme_id)?;
        if theme.kind != ThemeKind::Props {
            return Err(AppError::BadRequest("only designs from a props collection can be shown as props".into()));
        }
        if theme.design(body.design_id).is_none() {
            return Err(AppError::NotFound(format!("design {}", body.design_id)));
        }
    }
    let r = DesignRef {
        theme_id: body.theme_id,
        design_id: body.design_id,
    };
    s.live.write().await.set_prop(body.layer, r, body.active);
    Ok(Json(live_json(&s).await))
}

#[derive(Deserialize)]
struct ClearPropsBody {
    layer: Option<PropsLayer>,
}

async fn clear_props(State(s): State<SharedState>, Json(body): Json<ClearPropsBody>) -> Json<Value> {
    {
        let mut live = s.live.write().await;
        match body.layer {
            Some(layer) => live.list_mut(layer).clear(),
            None => {
                live.props.clear();
                live.complements.clear();
            }
        }
    }
    Json(live_json(&s).await)
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum ClearScope {
    /// Every visual layer (slides, announcements, media, video input, props, complements).
    All,
    /// Everything, including audio playback.
    Everything,
}

#[derive(Deserialize)]
struct ClearBody {
    scope: ClearScope,
}

/// Body: {"scope": "all"} or {"scope": "everything"}.
async fn clear(State(s): State<SharedState>, Json(body): Json<ClearBody>) -> Json<Value> {
    {
        let mut presenter = s.presenter.write().await;
        presenter.clear(PresentationLayer::Slides);
        presenter.clear(PresentationLayer::Announcements);
    }
    *s.bible_live.write().await = None;
    {
        let mut live = s.live.write().await;
        live.video_input = None;
        live.props.clear();
        live.complements.clear();
    }
    s.player.clear(Slot::Visual);
    if matches!(body.scope, ClearScope::Everything) {
        s.player.clear(Slot::Audio);
    }
    Json(json!({ "cleared": true }))
}
