//! Macros: named lists of steps (things to do, and pauses) that the server runs in order.
//! They start from a button (the Macros widget, the command bar, a keyboard shortcut, the
//! Stream Deck) or by themselves: some minutes before a service, or when a presentation goes
//! live or comes off. Set up by the admin; anyone runs them.
//!
//! A step asks the server's own API, in-process (as the server's windows do), so it does
//! exactly what the same button in a manager does.

use crate::{
    audio::BUSES,
    clear_groups::ClearLayer,
    config::Power,
    error::AppError,
    state::SharedState,
    storage::{now_ms, JsonDoc},
    theme::style::is_valid_color,
    timers::{self, Occurrence},
};
use axum::{
    body::Body,
    http::{header, Method, Request},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    time::Duration,
};
use tokio::sync::{broadcast::error::RecvError, watch};
use tower::ServiceExt;
use uuid::Uuid;

pub const MAX_MACROS: usize = 64;
pub const MAX_STEPS: usize = 50;
pub const MAX_TRIGGERS: usize = 8;
/// The longest pause between steps (an hour).
pub const MAX_WAIT_SECONDS: f64 = 3600.0;
/// How long before a service a macro can start (a day).
pub const MAX_MINUTES_BEFORE: u32 = 24 * 60;
/// How many runs are kept for the "Last runs" list.
const MAX_RECENT: usize = 30;
/// What changes about macros (the list, which are running, the last runs) is announced as.
pub const TOPIC: &str = "macros";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Macro {
    pub id: Uuid,
    pub name: String,
    /// A Lucide icon name ("Church", "Radio"...), for buttons and Stream Deck keys.
    #[serde(default = "default_icon")]
    pub icon: String,
    #[serde(default = "default_color")]
    pub color: String,
    #[serde(default)]
    pub steps: Vec<Step>,
    /// When it starts by itself (it can always be started by hand).
    #[serde(default)]
    pub triggers: Vec<Trigger>,
}

fn default_icon() -> String {
    "Zap".into()
}

fn default_color() -> String {
    "#B49AFF".into()
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MacrosFile {
    #[serde(default)]
    pub macros: Vec<Macro>,
}

/// One thing a macro does.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Step {
    /// Waits before the next step.
    Wait { seconds: f64 },
    /// Presents a song or presentation from its first slide.
    Present {
        presentation_id: Uuid,
        #[serde(default)]
        arrangement: Option<String>,
    },
    Next { layer: MoveLayer },
    Previous { layer: MoveLayer },
    /// Shows a Bible passage ("John 3:16").
    Bible { reference: String },
    Clear { layers: Vec<ClearLayer> },
    ClearGroup { group_id: Uuid },
    Prop { theme_id: Uuid, design_id: Uuid, show: bool },
    /// Puts a video input on its layer (None: clears it).
    Camera {
        #[serde(default)]
        device_id: Option<String>,
    },
    /// Plays a media folder (`audio`: on the audio player).
    MediaFolder {
        playlist_id: Uuid,
        #[serde(default)]
        audio: bool,
    },
    Mute { bus: u8, muted: bool },
    Timer { timer_id: Uuid, action: TimerAction },
    ScreenPreset { screen_id: Uuid, preset_id: Uuid },
    /// Starts or stops streaming / recording (as set in the Live page).
    Stream { start: bool },
    Power { power: Power },
}

/// What Next / Previous moves (`all`: like the arrow keys).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MoveLayer {
    All,
    Slides,
    Announcements,
    Bible,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TimerAction {
    Start,
    Pause,
    Reset,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PresentationEvent {
    Begins,
    Ends,
}

/// When a macro starts by itself.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Trigger {
    /// Some minutes before a service starts (0: when it starts). No service: any of them.
    Service {
        #[serde(default)]
        service_id: Option<Uuid>,
        #[serde(default)]
        minutes_before: u32,
    },
    /// When a presentation goes live or comes off. No presentation: any song or
    /// presentation on the slides layer.
    Presentation {
        #[serde(default)]
        presentation_id: Option<Uuid>,
        when: PresentationEvent,
    },
}

/// An API request: method, path (inside /api) and JSON body.
struct Call {
    method: Method,
    path: String,
    body: Option<Value>,
}

impl MoveLayer {
    fn query(self) -> &'static str {
        match self {
            MoveLayer::All | MoveLayer::Bible => "all",
            MoveLayer::Slides => "slides",
            MoveLayer::Announcements => "announcements",
        }
    }
}

impl TimerAction {
    fn name(self) -> &'static str {
        match self {
            TimerAction::Start => "start",
            TimerAction::Pause => "pause",
            TimerAction::Reset => "reset",
        }
    }
}

impl Step {
    /// The request that does it (None for a pause).
    fn call(&self) -> Option<Call> {
        let post = |path: String, body: Option<Value>| Call { method: Method::POST, path, body };
        let put = |path: String, body: Value| Call { method: Method::PUT, path, body: Some(body) };
        Some(match self {
            Step::Wait { .. } => return None,
            Step::Present { presentation_id, arrangement } => post(
                "/presenter/load".into(),
                Some(json!({ "presentation_id": presentation_id, "arrangement": arrangement })),
            ),
            Step::Next { layer: MoveLayer::Bible } => post("/bible/next".into(), None),
            Step::Previous { layer: MoveLayer::Bible } => post("/bible/previous".into(), None),
            Step::Next { layer } => post(format!("/presenter/next?layer={}", layer.query()), None),
            Step::Previous { layer } => post(format!("/presenter/previous?layer={}", layer.query()), None),
            Step::Bible { reference } => post("/bible/show".into(), Some(json!({ "query": reference }))),
            Step::Clear { layers } => post("/live/clear-layers".into(), Some(json!({ "layers": layers }))),
            Step::ClearGroup { group_id } => post(format!("/clear-groups/{group_id}/run"), None),
            // `layer`: for servers that still have a second props layer.
            Step::Prop { theme_id, design_id, show } => post(
                "/live/props".into(),
                Some(json!({ "layer": "props", "theme_id": theme_id, "design_id": design_id, "active": show })),
            ),
            Step::Camera { device_id } => put("/live/video_input".into(), json!({ "device_id": device_id })),
            Step::MediaFolder { playlist_id, audio } => post(
                format!("/player/{}/play", if *audio { "audio" } else { "visual" }),
                Some(json!({ "playlist_id": playlist_id })),
            ),
            Step::Mute { bus, muted } => put(format!("/audio/buses/{bus}/levels"), json!({ "muted": muted })),
            Step::Timer { timer_id, action } => post(format!("/timers/{timer_id}/{}", action.name()), None),
            Step::ScreenPreset { screen_id, preset_id } => {
                put(format!("/screens/{screen_id}/preset"), json!({ "preset_id": preset_id }))
            }
            Step::Stream { start } => post(if *start { "/stream/start" } else { "/stream/stop" }.into(), None),
            Step::Power { power } => put("/power".into(), json!({ "power": power })),
        })
    }
}

pub fn load(path: PathBuf) -> Result<JsonDoc<MacrosFile>, AppError> {
    JsonDoc::load(path)
}

pub fn validate(file: &MacrosFile) -> Result<(), AppError> {
    let bad = |m: &Macro, what: &str| Err(AppError::BadRequest(format!("`{}`: {what}", m.name.trim())));
    if file.macros.len() > MAX_MACROS {
        return Err(AppError::BadRequest(format!("up to {MAX_MACROS} macros")));
    }
    let mut ids = HashSet::new();
    for m in &file.macros {
        if !ids.insert(m.id) {
            return bad(m, "two macros have the same id");
        }
        let name = m.name.trim();
        if name.is_empty() || name.chars().count() > 40 {
            return Err(AppError::BadRequest("macro names must be 1-40 characters".into()));
        }
        if !is_valid_color(&m.color) {
            return bad(m, "the colour must be like #B49AFF");
        }
        if m.icon.is_empty() || m.icon.len() > 40 || !m.icon.chars().all(|c| c.is_ascii_alphanumeric()) {
            return bad(m, "unknown icon");
        }
        if m.steps.len() > MAX_STEPS {
            return bad(m, &format!("up to {MAX_STEPS} steps"));
        }
        if m.triggers.len() > MAX_TRIGGERS {
            return bad(m, &format!("up to {MAX_TRIGGERS} ways to start by itself"));
        }
        for step in &m.steps {
            match step {
                Step::Wait { seconds } if !(0.0..=MAX_WAIT_SECONDS).contains(seconds) => {
                    return bad(m, "pauses are 0 to 3600 seconds");
                }
                Step::Bible { reference } if reference.trim().is_empty() => {
                    return bad(m, "type the Bible passage to show");
                }
                Step::Clear { layers } if layers.is_empty() => return bad(m, "choose what to clear"),
                Step::Mute { bus, .. } if !(1..=BUSES).contains(bus) => {
                    return bad(m, &format!("buses are 1-{BUSES}"));
                }
                _ => {}
            }
        }
        for trigger in &m.triggers {
            if let Trigger::Service { minutes_before, .. } = trigger {
                if *minutes_before > MAX_MINUTES_BEFORE {
                    return bad(m, "a macro can start up to a day (1440 minutes) before a service");
                }
            }
        }
    }
    Ok(())
}

// ---------- runs ----------

/// One time a macro ran.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunRecord {
    pub run_id: Uuid,
    pub macro_id: Uuid,
    pub name: String,
    /// What started it: "By hand", "30 minutes before Sunday morning", "Amazing Grace went live".
    pub why: String,
    pub at_ms: i64,
    #[serde(default)]
    pub finished: bool,
    #[serde(default)]
    pub stopped: bool,
    /// Steps that didn't work ("Step 2: nothing is live on the slides layer").
    #[serde(default)]
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RunsFile {
    /// The service times macros already ran for ("<macro>|<minutes>|<service>@<date>"), so a
    /// restart doesn't run them again.
    #[serde(default)]
    pub fired: Vec<String>,
    /// The latest runs, newest first.
    #[serde(default)]
    pub recent: Vec<RunRecord>,
    /// When the service times were last checked (saved about once a minute). After a restart,
    /// a macro catches up on a moment that came while the server was off, not on one that
    /// passed while it was running.
    #[serde(default)]
    pub checked_ms: Option<i64>,
}

struct Running {
    run_id: Uuid,
    stop: watch::Sender<bool>,
}

/// What macros are doing: the ones running now, and what they did lately.
pub struct MacroRuns {
    doc: tokio::sync::Mutex<JsonDoc<RunsFile>>,
    running: std::sync::Mutex<HashMap<Uuid, Running>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MacrosStatus {
    /// Macros running now.
    pub running: Vec<Uuid>,
    pub recent: Vec<RunRecord>,
}

pub fn load_runs(path: PathBuf) -> Result<MacroRuns, AppError> {
    Ok(MacroRuns {
        doc: tokio::sync::Mutex::new(JsonDoc::load(path)?),
        running: Default::default(),
    })
}

impl MacroRuns {
    fn running(&self) -> std::sync::MutexGuard<'_, HashMap<Uuid, Running>> {
        self.running.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub async fn status(&self) -> MacrosStatus {
        let mut running: Vec<Uuid> = self.running().keys().copied().collect();
        running.sort();
        MacrosStatus { running, recent: self.doc.lock().await.value.recent.clone() }
    }

    async fn edit(&self, change: impl FnOnce(&mut RunsFile)) {
        let mut doc = self.doc.lock().await;
        change(&mut doc.value);
        if let Err(e) = doc.save() {
            tracing::warn!("could not save the macro runs: {e}");
        }
    }

    async fn last_check(&self) -> Option<i64> {
        self.doc.lock().await.value.checked_ms
    }

    async fn checked(&self, now: i64) {
        let mut doc = self.doc.lock().await;
        if doc.value.checked_ms.map_or(true, |t| now - t >= 60_000 || now < t) {
            doc.value.checked_ms = Some(now);
            if let Err(e) = doc.save() {
                tracing::warn!("could not save the macro runs: {e}");
            }
        }
    }

    /// Marks a service time as done; false if it already was.
    async fn fire_once(&self, key: String) -> bool {
        let mut doc = self.doc.lock().await;
        if doc.value.fired.contains(&key) {
            return false;
        }
        // Keys of services more than a few days old aren't needed any more.
        let oldest = (chrono::Local::now().date_naive() - chrono::Days::new(3)).format("%Y-%m-%d").to_string();
        doc.value.fired.retain(|k| k.rsplit('@').next().is_some_and(|date| date >= oldest.as_str()));
        doc.value.fired.push(key);
        if let Err(e) = doc.save() {
            tracing::warn!("could not save the macro runs: {e}");
        }
        true
    }
}

/// Starts a macro. Returns at once; the steps run in the background.
pub async fn start(state: &SharedState, id: Uuid, why: String) -> Result<(), AppError> {
    let m = state
        .macros
        .read()
        .await
        .value
        .macros
        .iter()
        .find(|m| m.id == id)
        .cloned()
        .ok_or_else(|| AppError::NotFound(format!("macro {id}")))?;
    let run_id = Uuid::new_v4();
    let (tx, rx) = watch::channel(false);
    {
        let mut running = state.macro_runs.running();
        if running.contains_key(&id) {
            return Err(AppError::Conflict(format!("“{}” is already running", m.name)));
        }
        running.insert(id, Running { run_id, stop: tx });
    }
    tracing::info!("macro “{}” starts: {why}", m.name);
    let record = RunRecord {
        run_id,
        macro_id: id,
        name: m.name.clone(),
        why,
        at_ms: now_ms(),
        finished: false,
        stopped: false,
        errors: Vec::new(),
    };
    state.macro_runs.edit(|f| {
        f.recent.insert(0, record);
        f.recent.truncate(MAX_RECENT);
    })
    .await;
    state.events.changed_topics(vec![TOPIC.into()]);

    let state = state.clone();
    tokio::spawn(async move {
        let done = Done { state: state.clone(), macro_id: id, run_id };
        let (errors, stopped) = run_steps(&state, &m.steps, rx).await;
        for e in &errors {
            tracing::warn!("macro “{}”: {e}", m.name);
        }
        state
            .macro_runs
            .edit(|f| {
                if let Some(r) = f.recent.iter_mut().find(|r| r.run_id == run_id) {
                    r.finished = true;
                    r.stopped = stopped;
                    r.errors = errors;
                }
            })
            .await;
        drop(done);
    });
    Ok(())
}

/// Stops a running macro before its next step (a pause ends at once).
pub fn stop(state: &SharedState, id: Uuid) -> Result<(), AppError> {
    match state.macro_runs.running().get(&id) {
        Some(r) => {
            let _ = r.stop.send(true);
            Ok(())
        }
        None => Err(AppError::Conflict("this macro isn't running".into())),
    }
}

/// When a run ends (also if its task is dropped): it is no longer running.
struct Done {
    state: SharedState,
    macro_id: Uuid,
    run_id: Uuid,
}

impl Drop for Done {
    fn drop(&mut self) {
        {
            let mut running = self.state.macro_runs.running();
            if running.get(&self.macro_id).is_some_and(|r| r.run_id == self.run_id) {
                running.remove(&self.macro_id);
            }
        }
        self.state.events.changed_topics(vec![TOPIC.into()]);
    }
}

/// Does the steps in order. A step that doesn't work is noted and the rest still run.
async fn run_steps(state: &SharedState, steps: &[Step], mut stop: watch::Receiver<bool>) -> (Vec<String>, bool) {
    let mut errors = Vec::new();
    for (i, step) in steps.iter().enumerate() {
        if *stop.borrow() {
            return (errors, true);
        }
        if let Step::Wait { seconds } = step {
            let pause = Duration::from_secs_f64(seconds.clamp(0.0, MAX_WAIT_SECONDS));
            tokio::select! {
                _ = tokio::time::sleep(pause) => {}
                _ = stop.changed() => return (errors, true),
            }
        } else if let Some(call) = step.call() {
            if let Err(e) = send(state, call).await {
                errors.push(format!("Step {}: {e}", i + 1));
            }
        }
    }
    (errors, false)
}

/// Asks the server's own API, with the internal key (as the server's windows do).
async fn send(state: &SharedState, call: Call) -> Result<(), String> {
    let mut builder = Request::builder()
        .method(call.method)
        .uri(format!("/api{}", call.path))
        .header(crate::auth::INTERNAL_HEADER, state.auth.internal_key.as_str());
    let body = match call.body {
        Some(value) => {
            builder = builder.header(header::CONTENT_TYPE, "application/json");
            Body::from(value.to_string())
        }
        None => Body::empty(),
    };
    let request = builder.body(body).map_err(|e| e.to_string())?;
    let response = crate::api::build_router(state.clone())
        .oneshot(request)
        .await
        .map_err(|e| e.to_string())?;
    let status = response.status();
    if status.is_success() {
        return Ok(());
    }
    let bytes = axum::body::to_bytes(response.into_body(), 64 * 1024).await.unwrap_or_default();
    let message = serde_json::from_slice::<Value>(&bytes)
        .ok()
        .and_then(|v| v.get("error").and_then(Value::as_str).map(str::to_string))
        .unwrap_or_else(|| status.to_string());
    // "conflict: nothing is live…" reads better as "nothing is live…".
    let plain = ["conflict: ", "invalid input: ", "not allowed: "].iter().find_map(|kind| message.strip_prefix(kind));
    Err(plain.map(str::to_string).unwrap_or(message))
}

// ---------- starting by themselves ----------

/// "30 minutes", "1 hour", "1 h 30 min".
fn lead_time(minutes: u32) -> String {
    let (h, m) = (minutes / 60, minutes % 60);
    let plural = |n: u32, one: &str, many: &str| format!("{n} {}", if n == 1 { one } else { many });
    match (h, m) {
        (0, m) => plural(m, "minute", "minutes"),
        (h, 0) => plural(h, "hour", "hours"),
        (h, m) => format!("{h} h {m} min"),
    }
}

/// A service trigger is due from its moment until the service starts (for "when it starts",
/// for a minute), and only if that moment came since the last check (`since`; None: never
/// checked). A service that has begun never sets it off, and neither does an edit made after
/// its moment.
pub fn due(o: &Occurrence, minutes_before: u32, since: Option<i64>, now: i64) -> bool {
    let at = o.start_ms - minutes_before as i64 * 60_000;
    let until = o.start_ms.max(at + 60_000);
    at <= now && now < until && since.map_or(true, |since| since < at)
}

async fn check_services(state: &SharedState, since: Option<i64>, now: i64) {
    let wanted: Vec<(Uuid, Option<Uuid>, u32)> = state
        .macros
        .read()
        .await
        .value
        .macros
        .iter()
        .flat_map(|m| {
            m.triggers.iter().filter_map(move |t| match t {
                Trigger::Service { service_id, minutes_before } => Some((m.id, *service_id, *minutes_before)),
                _ => None,
            })
        })
        .collect();
    if wanted.is_empty() {
        return;
    }
    let services = state.timers.read().await.services();
    let today = chrono::Local::now().date_naive();
    let occurrences = timers::occurrences(&services, today - chrono::Days::new(1), today + chrono::Days::new(2));
    for (macro_id, service_id, minutes) in wanted {
        for o in occurrences.iter().filter(|o| service_id.map_or(true, |id| id == o.service_id)) {
            if !due(o, minutes, since, now) || !state.macro_runs.fire_once(format!("{macro_id}|{minutes}|{}", o.key)).await {
                continue;
            }
            let name = services.iter().find(|s| s.id == o.service_id).map(|s| s.name.trim().to_string()).unwrap_or_default();
            let why = if minutes == 0 { format!("{name} started") } else { format!("{} before {name}", lead_time(minutes)) };
            if let Err(e) = start(state, macro_id, why).await {
                tracing::warn!("a macro could not start for {name}: {e}");
            }
        }
    }
}

/// What is live on the presentation layers.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct Live {
    slides: Option<Uuid>,
    announcements: Option<Uuid>,
}

async fn live_now(state: &SharedState) -> Live {
    let p = state.presenter.read().await;
    Live {
        slides: p.slides.as_ref().map(|l| l.presentation_id),
        announcements: p.announcements.as_ref().map(|l| l.presentation_id),
    }
}

/// What came off, then what went live: (presentation, event, on the slides layer).
fn live_changes(before: Live, after: Live) -> Vec<(Uuid, PresentationEvent, bool)> {
    let mut out = Vec::new();
    for (b, a, slides) in [(before.slides, after.slides, true), (before.announcements, after.announcements, false)] {
        if b != a {
            out.extend(b.map(|id| (id, PresentationEvent::Ends, slides)));
            out.extend(a.map(|id| (id, PresentationEvent::Begins, slides)));
        }
    }
    out
}

async fn on_live_change(state: &SharedState, before: Live, after: Live) {
    let wanted: Vec<(Uuid, Option<Uuid>, PresentationEvent)> = state
        .macros
        .read()
        .await
        .value
        .macros
        .iter()
        .flat_map(|m| {
            m.triggers.iter().filter_map(move |t| match t {
                Trigger::Presentation { presentation_id, when } => Some((m.id, *presentation_id, *when)),
                _ => None,
            })
        })
        .collect();
    if wanted.is_empty() {
        return;
    }
    for (id, event, slides) in live_changes(before, after) {
        for (macro_id, presentation, when) in &wanted {
            let matches = *when == event && presentation.map_or(slides, |p| p == id);
            if !matches {
                continue;
            }
            let title = state
                .libraries
                .read()
                .await
                .get_presentation(id)
                .ok()
                .and_then(|p| p.title().map(str::to_string))
                .unwrap_or_else(|| "A presentation".into());
            let why = match event {
                PresentationEvent::Begins => format!("{title} went live"),
                PresentationEvent::Ends => format!("{title} came off"),
            };
            if let Err(e) = start(state, *macro_id, why).await {
                tracing::debug!("a macro didn't start: {e}");
            }
        }
    }
}

/// Starts macros by themselves: before services, and when presentations go live or come off.
/// Call once from inside the async runtime.
pub fn spawn_triggers(state: SharedState) {
    tokio::spawn(async move {
        let mut events = state.events.subscribe();
        let mut tick = tokio::time::interval(Duration::from_secs(5));
        let mut checked = state.macro_runs.last_check().await;
        let mut live = live_now(&state).await;
        loop {
            tokio::select! {
                _ = tick.tick() => {
                    let now = now_ms();
                    check_services(&state, checked, now).await;
                    checked = Some(now);
                    state.macro_runs.checked(now).await;
                }
                event = events.recv() => {
                    if let Err(RecvError::Closed) = event {
                        break;
                    }
                }
            }
            let now = live_now(&state).await;
            if now != live {
                on_live_change(&state, live, now).await;
                live = now;
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn occurrence(start_ms: i64) -> Occurrence {
        Occurrence { service_id: Uuid::nil(), start_ms, end_ms: start_ms + 3_600_000, key: "x@2026-11-29".into() }
    }

    #[test]
    fn a_service_trigger_runs_when_its_moment_comes_and_never_once_the_service_began() {
        let min = 60_000;
        let o = occurrence(100 * min);
        // 30 minutes before: at 70.
        assert!(!due(&o, 30, Some(60 * min), 69 * min), "too early");
        assert!(due(&o, 30, Some(69 * min), 70 * min), "its moment came since the last check");
        assert!(!due(&o, 30, Some(71 * min), 72 * min), "edited after its moment: not again");
        assert!(due(&o, 30, Some(65 * min), 90 * min), "the server was off at its moment: it catches up");
        assert!(!due(&o, 30, None, 100 * min), "the service has begun");
        assert!(!due(&o, 30, None, 150 * min), "the service has passed");
        // When it starts: for a minute.
        assert!(due(&o, 0, Some(99 * min), 100 * min + 30_000));
        assert!(!due(&o, 0, None, 101 * min));
    }

    #[test]
    fn presentations_come_off_before_the_next_goes_live() {
        let (a, b) = (Uuid::new_v4(), Uuid::new_v4());
        let none = Live::default();
        let on = |id| Live { slides: Some(id), announcements: None };
        assert_eq!(live_changes(none, on(a)), vec![(a, PresentationEvent::Begins, true)]);
        assert_eq!(
            live_changes(on(a), on(b)),
            vec![(a, PresentationEvent::Ends, true), (b, PresentationEvent::Begins, true)]
        );
        assert_eq!(live_changes(on(a), none), vec![(a, PresentationEvent::Ends, true)]);
        assert!(live_changes(on(a), on(a)).is_empty());
        let ann = Live { slides: Some(a), announcements: Some(b) };
        assert_eq!(live_changes(on(a), ann), vec![(b, PresentationEvent::Begins, false)]);
    }

    #[test]
    fn steps_are_read_and_checked() {
        let file: MacrosFile = serde_json::from_str(
            r##"{"macros":[{"id":"7d8f0c1e-1111-4b8e-9a5e-2c3d4e5f6a7b","name":"Before service","icon":"Church","color":"#B49AFF",
            "steps":[{"type":"power","power":"active"},{"type":"wait","seconds":2},{"type":"next","layer":"bible"},
                     {"type":"mute","bus":2,"muted":false},{"type":"clear","layers":["slides","bible"]}],
            "triggers":[{"type":"service","minutes_before":30},{"type":"presentation","when":"ends"}]}]}"##,
        )
        .unwrap();
        assert!(validate(&file).is_ok());
        let m = &file.macros[0];
        assert_eq!(m.steps[2].call().unwrap().path, "/bible/next");
        assert!(m.steps[1].call().is_none());
        assert_eq!(m.triggers[0], Trigger::Service { service_id: None, minutes_before: 30 });

        let mut bad = file.clone();
        bad.macros[0].steps.push(Step::Mute { bus: 17, muted: true });
        assert!(validate(&bad).is_err());
        let mut bad = file.clone();
        bad.macros[0].triggers.push(Trigger::Service { service_id: None, minutes_before: 2000 });
        assert!(validate(&bad).is_err());
        let mut bad = file;
        bad.macros[0].name = "  ".into();
        assert!(validate(&bad).is_err());
    }

    #[test]
    fn lead_times_read_naturally() {
        assert_eq!(lead_time(1), "1 minute");
        assert_eq!(lead_time(30), "30 minutes");
        assert_eq!(lead_time(60), "1 hour");
        assert_eq!(lead_time(90), "1 h 30 min");
    }
}
