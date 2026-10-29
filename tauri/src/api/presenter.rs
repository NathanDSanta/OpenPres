use crate::{
    error::AppError,
    layers::{content::LayerContent, LayerKind},
    presentation::{Presentation, PresentationLayer},
    presenter::{LiveState, PresenterEngine},
    state::SharedState,
};
use axum::{
    extract::{Path, Query, State},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;
pub fn routes() -> Router<SharedState> {
    Router::new()
        .route("/presenter/state", get(get_state))
        .route("/presenter/load", post(load))
        .route("/presenter/next", post(next))
        .route("/presenter/previous", post(previous))
        .route("/presenter/goto", post(goto))
        .route("/presenter/clear", post(clear))
        .route("/screens/:id/render", get(render))
}
#[derive(Deserialize)]
struct LayerQuery {
    layer: Option<PresentationLayer>,
}
impl LayerQuery {
    /// `?layer=announcements`; defaults to slides.
    fn target(&self) -> PresentationLayer {
        self.layer.unwrap_or(PresentationLayer::Slides)
    }
}
#[derive(Deserialize)]
struct LoadBody {
    presentation_id: Uuid,
    arrangement: Option<String>,
}
#[derive(Deserialize)]
struct GotoBody {
    index: usize,
}
// ---------- helpers ----------
/// Writes the live slide onto the layer of every screen.
async fn push(
    s: &SharedState,
    layer: PresentationLayer,
    content: LayerContent,
) -> Result<(), AppError> {
    s.screens.write().await.set_layer_all(layer.into(), content)
}
/// The slide at `index` of the live arrangement, as JSON.
fn describe(p: &Presentation, live: &LiveState) -> Result<Value, AppError> {
    let arrangement = p.find_arrangement(live.arrangement.as_deref())?;
    let slides = p.expand(&arrangement)?;
    let at = |i: usize| {
        slides
            .get(i)
            .map(|sl| json!({ "index": i, "group": sl.group, "text": sl.text }))
    };
    let current = at(live.slide_index);
    let previous = live.slide_index.checked_sub(1).and_then(|i| at(i));
    let next = at(live.slide_index + 1);
    Ok(json!({
    "presentation_id": p.id,
    "title": p.title(),
    "arrangement": arrangement.name,
    "slide_index": live.slide_index,
    "total_slides": live.total_slides,
    "current": current,
    "previous": previous,
    "next": next
    }))
}
/// The state of both presentation layers, with slide text resolved.
async fn state_json(s: &SharedState) -> Result<Value, AppError> {
    let (slides, announcements) = {
        let engine = s.presenter.read().await;
        (engine.slides.clone(), engine.announcements.clone())
    };
    let libs = s.libraries.read().await;
    let describe_live = |live: Option<LiveState>| -> Result<Value, AppError> {
        match live {
            None => Ok(Value::Null),
            Some(l) => {
                let p = libs.get_presentation(l.presentation_id)?;
                describe(&p, &l)
            }
        }
    };
    Ok(json!({
    "slides": describe_live(slides)?,
    "announcements": describe_live(announcements)?
    }))
}
/// Applies a stepping operation, then mirrors the result onto the screens.
async fn step<F>(s: &SharedState, layer: PresentationLayer, op: F) -> Result<Json<Value>, AppError>
where
    F: FnOnce(&mut PresenterEngine) -> Result<usize, AppError>,
{
    let (presentation_id, index) = {
        let mut engine = s.presenter.write().await;
        let index = op(&mut engine)?;
        let live = engine
            .get(layer)
            .ok_or_else(|| AppError::Internal("live state disappeared".into()))?;
        (live.presentation_id, index)
    };
    push(
        s,
        layer,
        LayerContent::Presentation {
            presentation_id,
            slide_index: index,
        },
    )
    .await?;
    Ok(Json(state_json(s).await?))
}
// ---------- handlers ----------
async fn get_state(State(s): State<SharedState>) -> Result<Json<Value>, AppError> {
    Ok(Json(state_json(&s).await?))
}
/// Body: {"presentation_id": "...", "arrangement": "Long"} (arrangement optional)
/// The target layer comes from the presentation's `layer` metadata.
async fn load(
    State(s): State<SharedState>,
    Json(body): Json<LoadBody>,
) -> Result<Json<Value>, AppError> {
    let p = s
        .libraries
        .read()
        .await
        .get_presentation(body.presentation_id)?;
    let layer = p.layer()?;
    let arrangement = p.find_arrangement(body.arrangement.as_deref())?;
    let total = p.expand(&arrangement)?.len();
    if total == 0 {
        return Err(AppError::BadRequest(
            "this presentation has no slides".into(),
        ));
    }
    s.presenter.write().await.load(
        layer,
        LiveState {
            presentation_id: p.id,
            arrangement: body.arrangement,
            slide_index: 0,
            total_slides: total,
        },
    );
    push(
        &s,
        layer,
        LayerContent::Presentation {
            presentation_id: p.id,
            slide_index: 0,
        },
    )
    .await?;
    Ok(Json(state_json(&s).await?))
}
async fn next(
    State(s): State<SharedState>,
    Query(q): Query<LayerQuery>,
) -> Result<Json<Value>, AppError> {
    let layer = q.target();
    step(&s, layer, |engine| engine.next(layer)).await
}
async fn previous(
    State(s): State<SharedState>,
    Query(q): Query<LayerQuery>,
) -> Result<Json<Value>, AppError> {
    let layer = q.target();
    step(&s, layer, |engine| engine.previous(layer)).await
}
/// Body: {"index": 3}
async fn goto(
    State(s): State<SharedState>,
    Query(q): Query<LayerQuery>,
    Json(body): Json<GotoBody>,
) -> Result<Json<Value>, AppError> {
    let layer = q.target();
    step(&s, layer, |engine| engine.goto(layer, body.index)).await
}
async fn clear(
    State(s): State<SharedState>,
    Query(q): Query<LayerQuery>,
) -> Result<Json<Value>, AppError> {
    let layer = q.target();
    s.presenter.write().await.clear(layer);
    s.screens.write().await.clear_layer_all(layer.into());
    Ok(Json(state_json(&s).await?))
}
/// Everything the frontend needs to draw one screen: the screen with its layers,
/// and for each live presentation layer the resolved theme and slide values.
async fn render(
    State(s): State<SharedState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    let screen = s.screens.read().await.get(id)?.clone();
    let mut presentations = serde_json::Map::new();
    for (layer, key) in [
        (PresentationLayer::Slides, "slides"),
        (PresentationLayer::Announcements, "announcements"),
    ] {
        let kind: LayerKind = layer.into();
        let state = screen.layers.get(kind);
        let live = s.presenter.read().await.get(layer).cloned();
        let value = match (&state.content, live) {
            (
                LayerContent::Presentation {
                    presentation_id, ..
                },
                Some(live),
            ) if state.visible => {
                let p = s
                    .libraries
                    .read()
                    .await
                    .get_presentation(*presentation_id)?;
                // screen override first, then the presentation's own theme
                let theme_id = screen.theme_id.or(p.theme_id());
                let theme = match theme_id {
                    Some(tid) => s.themes.read().await.get(tid).ok().cloned(),
                    None => None,
                };
                json!({ "slide": describe(&p, &live)?, "theme": theme })
            }
            _ => Value::Null,
        };
        presentations.insert(key.to_string(), value);
    }
    Ok(Json(json!({
    "screen": screen,
    "presentations": Value::Object(presentations)
    })))
}
