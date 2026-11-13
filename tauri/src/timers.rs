//! Timers that design elements can show (countdowns, stopwatches, countdown to a time).
//! Definitions are saved; running state is live only.

use crate::{error::AppError, storage::{now_ms, JsonDoc}};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, path::PathBuf};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TimerKind {
    Countdown { seconds: u32 },
    CountUp,
    /// Counts down to a time of day, "HH:MM" (local time of the device showing it).
    ToTime { time: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimerDef {
    #[serde(default = "Uuid::new_v4")]
    pub id: Uuid,
    pub name: String,
    pub kind: TimerKind,
    /// Countdowns keep counting into negative time instead of stopping at zero.
    #[serde(default)]
    pub allow_overrun: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TimersFile {
    pub timers: Vec<TimerDef>,
}

#[derive(Debug, Clone, Copy, Default, Serialize)]
pub struct TimerRun {
    pub running: bool,
    /// Milliseconds elapsed before `started_at`.
    pub elapsed_ms: i64,
    /// Epoch ms when it last started running.
    pub started_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TimerView {
    #[serde(flatten)]
    pub def: TimerDef,
    #[serde(flatten)]
    pub run: TimerRun,
}

pub struct TimerManager {
    doc: JsonDoc<TimersFile>,
    runs: HashMap<Uuid, TimerRun>,
}

fn validate(def: &TimerDef) -> Result<(), AppError> {
    if def.name.trim().is_empty() || def.name.len() > 60 {
        return Err(AppError::BadRequest("timer name must be 1-60 characters".into()));
    }
    if let TimerKind::ToTime { time } = &def.kind {
        let ok = time
            .split_once(':')
            .and_then(|(h, m)| Some((h.parse::<u8>().ok()?, m.parse::<u8>().ok()?)))
            .is_some_and(|(h, m)| h < 24 && m < 60);
        if !ok {
            return Err(AppError::BadRequest("time must be HH:MM".into()));
        }
    }
    Ok(())
}

impl TimerManager {
    pub fn load(path: PathBuf) -> Result<Self, AppError> {
        Ok(Self {
            doc: JsonDoc::load(path)?,
            runs: HashMap::new(),
        })
    }
    pub fn list(&self) -> Vec<TimerView> {
        self.doc
            .value
            .timers
            .iter()
            .map(|def| TimerView {
                def: def.clone(),
                run: self.runs.get(&def.id).copied().unwrap_or_default(),
            })
            .collect()
    }
    pub fn create(&mut self, mut def: TimerDef) -> Result<TimerDef, AppError> {
        def.id = Uuid::new_v4();
        validate(&def)?;
        self.doc.value.timers.push(def.clone());
        self.doc.save()?;
        Ok(def)
    }
    pub fn update(&mut self, id: Uuid, mut def: TimerDef) -> Result<TimerDef, AppError> {
        def.id = id;
        validate(&def)?;
        let slot = self
            .doc
            .value
            .timers
            .iter_mut()
            .find(|t| t.id == id)
            .ok_or_else(|| AppError::NotFound(format!("timer {id}")))?;
        *slot = def.clone();
        self.doc.save()?;
        Ok(def)
    }
    pub fn delete(&mut self, id: Uuid) -> Result<(), AppError> {
        let before = self.doc.value.timers.len();
        self.doc.value.timers.retain(|t| t.id != id);
        if before == self.doc.value.timers.len() {
            return Err(AppError::NotFound(format!("timer {id}")));
        }
        self.runs.remove(&id);
        self.doc.save()
    }
    fn exists(&self, id: Uuid) -> Result<(), AppError> {
        if self.doc.value.timers.iter().any(|t| t.id == id) {
            Ok(())
        } else {
            Err(AppError::NotFound(format!("timer {id}")))
        }
    }
    pub fn start(&mut self, id: Uuid) -> Result<(), AppError> {
        self.exists(id)?;
        let run = self.runs.entry(id).or_default();
        if !run.running {
            run.running = true;
            run.started_at = Some(now_ms());
        }
        Ok(())
    }
    pub fn pause(&mut self, id: Uuid) -> Result<(), AppError> {
        self.exists(id)?;
        let run = self.runs.entry(id).or_default();
        if let (true, Some(started)) = (run.running, run.started_at) {
            run.elapsed_ms += now_ms() - started;
        }
        run.running = false;
        run.started_at = None;
        Ok(())
    }
    pub fn reset(&mut self, id: Uuid) -> Result<(), AppError> {
        self.exists(id)?;
        self.runs.insert(id, TimerRun::default());
        Ok(())
    }
}
