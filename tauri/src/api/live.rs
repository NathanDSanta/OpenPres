use crate::{
    clear_groups::{self, ClearGroupsFile, ClearLayer},
    error::AppError,
    media::Slot,
    presentation::PresentationLayer,
    state::SharedState,
    theme::{DesignRef, ThemeKind},
};
use axum::{
    extract::{Path, State},
    routing::{get, post, put},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

pub fn routes() -> Router<SharedState> {
    Router::new()
        .route("/live", get(get_live))
        .route("/live/video_input", put(set_video_input))
        .route("/live/props", post(set_prop))
        .route("/live/props/clear", post(clear_props))
        .route("/live/clear", post(clear))
        .route("/live/clear-layers", post(clear_layers_route))
        .route("/clear-groups", get(get_clear_groups).put(put_clear_groups))
        .route("/clear-groups/:id/run", post(run_clear_group))
}

async fn live_json(s: &SharedState) -> Value {
    let mut v = json!(*s.live.read().await);
    // Managers from before the props were one layer still read `complements`.
    v["complements"] = json!([]);
    v
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
    /// Ignored: older clients still send which props layer ("props" / "complements").
    #[serde(default, rename = "layer")]
    _layer: Option<String>,
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
    s.live.write().await.set_prop(r, body.active);
    Ok(Json(live_json(&s).await))
}

/// Turns every prop off (a `layer` sent by older clients is ignored).
async fn clear_props(State(s): State<SharedState>) -> Json<Value> {
    s.live.write().await.props.clear();
    Json(live_json(&s).await)
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum ClearScope {
    /// Every visual layer (slides, announcements, media, video input, props).
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
    let layers = match body.scope {
        ClearScope::All => ClearLayer::visual(),
        ClearScope::Everything => ClearLayer::ALL.to_vec(),
    };
    clear_layers(&s, &layers).await;
    Json(json!({ "cleared": true }))
}

/// Takes what is live off the given layers.
pub async fn clear_layers(s: &SharedState, layers: &[ClearLayer]) {
    {
        let mut presenter = s.presenter.write().await;
        if layers.contains(&ClearLayer::Slides) {
            presenter.clear(PresentationLayer::Slides);
        }
        if layers.contains(&ClearLayer::Announcements) {
            presenter.clear(PresentationLayer::Announcements);
        }
    }
    if layers.contains(&ClearLayer::Bible) {
        *s.bible_live.write().await = None;
    }
    {
        let mut live = s.live.write().await;
        if layers.contains(&ClearLayer::VideoInput) {
            live.video_input = None;
        }
        if layers.contains(&ClearLayer::Props) {
            live.props.clear();
        }
    }
    if layers.contains(&ClearLayer::Media) {
        s.player.clear(Slot::Visual);
    }
    if layers.contains(&ClearLayer::Audio) {
        s.player.clear(Slot::Audio);
    }
}

#[derive(Deserialize)]
struct ClearLayersBody {
    layers: Vec<ClearLayer>,
}

/// Body: {"layers": ["slides", "bible", …]}: clears just those (the Clear widget's buttons).
async fn clear_layers_route(State(s): State<SharedState>, Json(body): Json<ClearLayersBody>) -> Json<Value> {
    clear_layers(&s, &body.layers).await;
    Json(json!({ "cleared": body.layers }))
}

async fn get_clear_groups(State(s): State<SharedState>) -> Json<ClearGroupsFile> {
    Json(s.clear_groups.read().await.value.clone())
}

/// Admin only (auth.rs).
async fn put_clear_groups(
    State(s): State<SharedState>,
    Json(body): Json<ClearGroupsFile>,
) -> Result<Json<ClearGroupsFile>, AppError> {
    clear_groups::validate(&body)?;
    s.clear_groups.write().await.replace(body.clone())?;
    Ok(Json(body))
}

async fn run_clear_group(State(s): State<SharedState>, Path(id): Path<Uuid>) -> Result<Json<Value>, AppError> {
    let layers = s
        .clear_groups
        .read()
        .await
        .value
        .groups
        .iter()
        .find(|g| g.id == id)
        .map(|g| g.layers.clone())
        .ok_or_else(|| AppError::NotFound(format!("clear group {id}")))?;
    clear_layers(&s, &layers).await;
    // The path's topic is "clear-groups"; what changed is what's live.
    s.events.changed_topics(vec!["live".to_string()]);
    Ok(Json(json!({ "cleared": layers })))
}
