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
    /// Counts down to the start or the end of a church service (the next one, or the one
    /// in progress), taken from the weekly schedule.
    Service {
        #[serde(default)]
        target: ServiceTarget,
        /// A specific service; None = whichever comes next.
        #[serde(default, deserialize_with = "crate::storage::ids::opt")]
        service_id: Option<Uuid>,
    },
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ServiceTarget {
    #[default]
    Start,
    End,
}

/// A recurring service, e.g. Sunday 10:00-12:30.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Service {
    #[serde(default = "Uuid::new_v4", deserialize_with = "crate::storage::ids::new_if_empty")]
    pub id: Uuid,
    pub name: String,
    /// Days of the week, 0 = Sunday .. 6 = Saturday.
    pub days: Vec<u8>,
    /// "HH:MM"
    pub start: String,
    /// "HH:MM"
    pub end: String,
}

fn valid_time(time: &str) -> bool {
    time.split_once(':')
        .and_then(|(h, m)| Some((h.parse::<u8>().ok()?, m.parse::<u8>().ok()?)))
        .is_some_and(|(h, m)| h < 24 && m < 60)
}

pub fn validate_services(services: &[Service]) -> Result<(), AppError> {
    for s in services {
        if s.name.trim().is_empty() || s.name.len() > 60 {
            return Err(AppError::BadRequest("service names must be 1-60 characters".into()));
        }
        if s.days.is_empty() || s.days.iter().any(|d| *d > 6) {
            return Err(AppError::BadRequest(format!("`{}`: choose at least one day", s.name)));
        }
        if !valid_time(&s.start) || !valid_time(&s.end) {
            return Err(AppError::BadRequest(format!("`{}`: times must be HH:MM", s.name)));
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimerDef {
    #[serde(default = "Uuid::new_v4", deserialize_with = "crate::storage::ids::new_if_empty")]
    pub id: Uuid,
    pub name: String,
    pub kind: TimerKind,
    /// Countdowns keep counting into negative time instead of stopping at zero.
    #[serde(default)]
    pub allow_overrun: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TimersFile {
    #[serde(default)]
    pub timers: Vec<TimerDef>,
    #[serde(default)]
    pub services: Vec<Service>,
}

#[derive(Debug, Clone, Copy, Default, Serialize)]
pub struct TimerRun {
    pub running: bool,
    /// Milliseconds elapsed before `started_at`.
    pub elapsed_ms: i64,
    /// Epoch ms when it last started running.
    pub started_at: Option<i64>,
    /// Clock-based timers (to a time, to a service) show their value at this moment
    /// while paused.
    pub paused_at: Option<i64>,
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
        if !valid_time(time) {
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
        run.paused_at = None;
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
        if run.paused_at.is_none() {
            run.paused_at = Some(now_ms());
        }
        Ok(())
    }
    pub fn services(&self) -> Vec<Service> {
        self.doc.value.services.clone()
    }
    pub fn set_services(&mut self, mut services: Vec<Service>) -> Result<(), AppError> {
        for s in services.iter_mut() {
            s.name = s.name.trim().to_string();
            s.days.sort();
            s.days.dedup();
        }
        validate_services(&services)?;
        self.doc.value.services = services;
        self.doc.save()
    }
    pub fn reset(&mut self, id: Uuid) -> Result<(), AppError> {
        self.exists(id)?;
        self.runs.insert(id, TimerRun::default());
        Ok(())
    }
}
