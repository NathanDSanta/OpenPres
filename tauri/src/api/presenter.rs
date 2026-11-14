use crate::{
    error::AppError,
    layers::LayerKind,
    presentation::{FlatSlide, Presentation, PresentationLayer},
    presenter::{LiveState, Step},
    screens::virtual_screen::VirtualScreen,
    state::SharedState,
    theme::{Design, Theme},
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

/// `?layer=slides|announcements|all`; defaults to slides.
#[derive(Deserialize)]
struct LayerQuery {
    layer: Option<String>,
}

impl LayerQuery {
    fn targets(&self) -> Result<Vec<PresentationLayer>, AppError> {
        match self.layer.as_deref().unwrap_or("slides") {
            "slides" => Ok(vec![PresentationLayer::Slides]),
            "announcements" => Ok(vec![PresentationLayer::Announcements]),
            "all" | "both" => Ok(vec![PresentationLayer::Slides, PresentationLayer::Announcements]),
            other => Err(AppError::BadRequest(format!("unknown layer `{other}`"))),
        }
    }
}

#[derive(Deserialize)]
struct LoadBody {
    presentation_id: Uuid,
    arrangement: Option<String>,
    /// Slide to start on (default 0), e.g. when double-clicking a slide.
    #[serde(default)]
    index: usize,
}

#[derive(Deserialize)]
struct GotoBody {
    index: usize,
}

// ---------- helpers ----------

fn slides_of(p: &Presentation, arrangement: Option<&str>) -> Result<(Option<String>, Vec<FlatSlide>), AppError> {
    // A live arrangement may have been deleted meanwhile: fall back to the default.
    match p.find_arrangement(arrangement) {
        Ok(a) => Ok((arrangement.map(str::to_string), p.expand(&a)?)),
        Err(_) => Ok((None, p.expand(&p.default_arrangement())?)),
    }
}

fn slide_json(index: usize, slide: &FlatSlide) -> Value {
    json!({ "index": index, "group": slide.group, "text": slide.text })
}

/// The live slide with its neighbours. The current slide comes from the snapshot taken
/// when it went live; previous/next are read fresh so edits show up when moving on.
fn describe(p: &Presentation, live: &LiveState) -> Result<Value, AppError> {
    let (arrangement, slides) = slides_of(p, live.arrangement.as_deref())?;
    let i = live.slide_index;
    Ok(json!({
        "presentation_id": p.id,
        "title": p.title().unwrap_or("Untitled"),
        "arrangement": arrangement.unwrap_or_else(|| "default".into()),
        "slide_index": i,
        "total_slides": slides.len(),
        "current": slide_json(i, &live.snapshot),
        "previous": i.checked_sub(1).and_then(|j| slides.get(j)).map(|sl| slide_json(i - 1, sl)),
        "next": slides.get(i + 1).map(|sl| slide_json(i + 1, sl)),
    }))
}

async fn state_json(s: &SharedState) -> Result<Value, AppError> {
    let (slides, announcements) = {
        let engine = s.presenter.read().await;
        (engine.slides.clone(), engine.announcements.clone())
    };
    let libs = s.libraries.read().await;
    let describe_live = |live: Option<LiveState>| -> Value {
        live.and_then(|l| {
            let p = libs.get_presentation(l.presentation_id).ok()?;
            describe(&p, &l).ok()
        })
        .unwrap_or(Value::Null)
    };
    Ok(json!({
        "slides": describe_live(slides),
        "announcements": describe_live(announcements),
    }))
}

/// Moves one layer, reading the presentation again so edits are picked up.
async fn go(s: &SharedState, layer: PresentationLayer, step: Step) -> Result<(), AppError> {
    let live = s.presenter.read().await.require(layer)?.clone();
    let p = s.libraries.read().await.get_presentation(live.presentation_id)?;
    let (arrangement, slides) = slides_of(&p, live.arrangement.as_deref())?;
    let current = live.slide_index.min(slides.len().saturating_sub(1));
    let index = step.apply(current, slides.len())?;
    s.presenter.write().await.set(
        layer,
        LiveState {
            presentation_id: p.id,
            arrangement,
            slide_index: index,
            total_slides: slides.len(),
            snapshot: slides[index].clone(),
        },
    );
    Ok(())
}

/// Applies a step to every requested layer that has something live. With `all`, the
/// presentation controls move the Bible passage instead of the slides when the Bible was
/// put on screen last.
async fn step_targets(s: &SharedState, q: &LayerQuery, step: Step) -> Result<Json<Value>, AppError> {
    let mut targets = q.targets()?;
    let single = targets.len() == 1;
    if !single && *s.focus.read().await == crate::state::Focus::Bible && s.bible_live.read().await.is_some() {
        if let Step::Next | Step::Previous = step {
            super::bible::step(s, matches!(step, Step::Next)).await?;
            targets.retain(|l| *l != PresentationLayer::Slides);
        }
    }
    for layer in targets {
        match go(s, layer, step).await {
            Ok(()) => {}
            // With `all`, layers with nothing live are simply skipped.
            Err(AppError::Conflict(_)) if !single => {}
            Err(e) => return Err(e),
        }
    }
    Ok(Json(state_json(s).await?))
}

// ---------- handlers ----------

async fn get_state(State(s): State<SharedState>) -> Result<Json<Value>, AppError> {
    Ok(Json(state_json(&s).await?))
}

/// Body: {"presentation_id": "...", "arrangement": "Long", "index": 0}
/// The target layer comes from the presentation's `layer` metadata.
pub async fn load_presentation(
    s: &SharedState,
    presentation_id: Uuid,
    arrangement: Option<String>,
    index: usize,
) -> Result<(), AppError> {
    let p = s.libraries.read().await.get_presentation(presentation_id)?;
    let layer = p.layer()?;
    let arrangement = arrangement.filter(|a| a != "default");
    let (arrangement, slides) = slides_of(&p, arrangement.as_deref())?;
    if slides.is_empty() {
        return Err(AppError::BadRequest("this presentation has no slides".into()));
    }
    let index = Step::Goto(index).apply(0, slides.len())?;
    if layer == PresentationLayer::Slides {
        *s.focus.write().await = crate::state::Focus::Slides;
    }
    s.presenter.write().await.set(
        layer,
        LiveState {
            presentation_id: p.id,
            arrangement,
            slide_index: index,
            total_slides: slides.len(),
            snapshot: slides[index].clone(),
        },
    );
    Ok(())
}

async fn load(State(s): State<SharedState>, Json(body): Json<LoadBody>) -> Result<Json<Value>, AppError> {
    load_presentation(&s, body.presentation_id, body.arrangement, body.index).await?;
    Ok(Json(state_json(&s).await?))
}

async fn next(State(s): State<SharedState>, Query(q): Query<LayerQuery>) -> Result<Json<Value>, AppError> {
    step_targets(&s, &q, Step::Next).await
}

async fn previous(State(s): State<SharedState>, Query(q): Query<LayerQuery>) -> Result<Json<Value>, AppError> {
    step_targets(&s, &q, Step::Previous).await
}

/// Body: {"index": 3}
async fn goto(
    State(s): State<SharedState>,
    Query(q): Query<LayerQuery>,
    Json(body): Json<GotoBody>,
) -> Result<Json<Value>, AppError> {
    step_targets(&s, &q, Step::Goto(body.index)).await
}

async fn clear(State(s): State<SharedState>, Query(q): Query<LayerQuery>) -> Result<Json<Value>, AppError> {
    for layer in q.targets()? {
        s.presenter.write().await.clear(layer);
    }
    Ok(Json(state_json(&s).await?))
}

// ---------- render ----------

fn theme_info(theme: &Theme) -> Value {
    json!({ "id": theme.id, "name": theme.name, "width": theme.width, "height": theme.height })
}

fn design_json(theme: &Theme, design: &Design) -> Value {
    json!({ "theme": theme_info(theme), "design": design })
}

/// Picks the theme/design for the live slide on a screen: the screen's design, its older
/// override theme (matching the design by name) or the presentation's own design.
fn slide_design(
    themes: &crate::theme::ThemeManager,
    p: &Presentation,
    group: &str,
    screen_design: Option<&crate::theme::DesignRef>,
    screen_theme: Option<Uuid>,
) -> Value {
    if let Some((t, d)) = screen_design.and_then(|r| themes.resolve(r)) {
        return design_json(t, d);
    }
    let own_theme = p.theme_id().and_then(|id| themes.get(id).ok());
    let own_design = own_theme.and_then(|t| t.pick_design(p.design_id(Some(group)), None));
    if let Some(theme) = screen_theme.and_then(|id| themes.get(id).ok()) {
        if let Some(design) = theme.pick_design(None, own_design.map(|d| d.name.as_str())) {
            return design_json(theme, design);
        }
    }
    match (own_theme, own_design) {
        (Some(t), Some(d)) => design_json(t, d),
        _ => Value::Null,
    }
}

async fn presentation_layer(
    s: &SharedState,
    screen: &VirtualScreen,
    layer: PresentationLayer,
) -> Result<Value, AppError> {
    let kind: LayerKind = layer.into();
    if !screen.layers.get(kind) {
        return Ok(Value::Null);
    }
    let Some(live) = s.presenter.read().await.get(layer).cloned() else {
        return Ok(Value::Null);
    };
    let Ok(p) = s.libraries.read().await.get_presentation(live.presentation_id) else {
        return Ok(Value::Null);
    };
    // Announcements always use their own design; screens only override the slides.
    let (screen_design, screen_theme) = match layer {
        PresentationLayer::Slides => (screen.slides_design.as_ref(), screen.theme_id),
        PresentationLayer::Announcements => (None, None),
    };
    let themes = s.themes.read().await;
    Ok(json!({
        "slide": describe(&p, &live)?,
        "look": slide_design(&themes, &p, &live.snapshot.group, screen_design, screen_theme),
    }))
}

/// Everything a window needs to draw one screen: settings, every enabled layer, the mask
/// and the timers. Disabled or empty layers are null / empty.
pub async fn render_scene(s: &SharedState, id: Uuid) -> Result<Value, AppError> {
    let screen = s.screens.read().await.get(id)?.clone();
    let live = s.live.read().await.clone();
    let themes = s.themes.read().await;

    let video_input = match (&live.video_input, screen.layers.video_input) {
        (Some(device), true) => json!({ "device_id": device }),
        _ => Value::Null,
    };

    let media = if screen.layers.media {
        match s.player.state(crate::media::Slot::Visual) {
            Some(state) => {
                let item = s.media.read().await.get(state.media_id).ok().cloned();
                json!({ "state": state, "item": item })
            }
            None => Value::Null,
        }
    } else {
        Value::Null
    };

    let designs = |list: &[crate::theme::DesignRef], on: bool| -> Vec<Value> {
        if !on {
            return vec![];
        }
        list.iter()
            .filter_map(|r| themes.resolve(r).map(|(t, d)| design_json(t, d)))
            .collect()
    };
    let complements = designs(&live.complements, screen.layers.complements);
    let props = designs(&live.props, screen.layers.props);
    let mask = screen
        .mask
        .as_ref()
        .and_then(|r| themes.resolve(r))
        .map(|(t, d)| design_json(t, d))
        .unwrap_or(Value::Null);
    drop(themes);

    let bible = if screen.layers.bible {
        let passage = super::bible::live_json(s).await;
        if passage.is_null() {
            Value::Null
        } else {
            let design = screen.bible_design.or(s.bibles.read().await.settings.value.design);
            let themes = s.themes.read().await;
            let look = design
                .as_ref()
                .and_then(|r| themes.resolve(r))
                .map(|(t, d)| design_json(t, d))
                .unwrap_or(Value::Null);
            json!({ "passage": passage, "look": look })
        }
    } else {
        Value::Null
    };
    let slides = presentation_layer(s, &screen, PresentationLayer::Slides).await?;
    let announcements = presentation_layer(s, &screen, PresentationLayer::Announcements).await?;
    let timers = s.timers.read().await.list();
    let services = s.timers.read().await.services();
    let background_items = match &screen.background {
        crate::screens::virtual_screen::ScreenBackground::Folder { folder_id, .. } => s
            .media_playlists
            .read()
            .await
            .value
            .playlists
            .iter()
            .find(|p| p.id == *folder_id)
            .map(|p| p.items.clone())
            .unwrap_or_default(),
        _ => vec![],
    };

    Ok(json!({
        "screen": screen,
        "now_ms": crate::storage::now_ms(),
        "layers": {
            "video_input": video_input,
            "media": media,
            "slides": slides,
            "bible": bible,
            "announcements": announcements,
            "complements": complements,
            "props": props,
        },
        "mask": mask,
        "timers": timers,
        "services": services,
        "background_items": background_items,
    }))
}

async fn render(State(s): State<SharedState>, Path(id): Path<Uuid>) -> Result<Json<Value>, AppError> {
    Ok(Json(render_scene(&s, id).await?))
}
