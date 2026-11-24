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

/// A church service: every week (e.g. Sunday 10:00-12:30), or a special one on one date
/// (a wedding, Christmas Eve) that can cancel that day's weekly services.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Service {
    #[serde(default = "Uuid::new_v4", deserialize_with = "crate::storage::ids::new_if_empty")]
    pub id: Uuid,
    pub name: String,
    /// Days of the week, 0 = Sunday .. 6 = Saturday (weekly services).
    #[serde(default)]
    pub days: Vec<u8>,
    /// "YYYY-MM-DD": a special service on this date only (`days` is then ignored).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub date: Option<String>,
    /// A special service that replaces the weekly services of its day.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub cancels_others: bool,
    /// "HH:MM"
    pub start: String,
    /// "HH:MM"
    pub end: String,
}

/// One time a service happens (local times, as ms since the epoch).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Occurrence {
    pub service_id: Uuid,
    pub start_ms: i64,
    pub end_ms: i64,
    /// The service and its date ("<id>@2026-12-24"): the same occurrence keeps it however the
    /// schedule is edited, so what was done for it isn't done again.
    pub key: String,
}

fn parse_date(date: &str) -> Option<chrono::NaiveDate> {
    chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()
}

fn parse_time(time: &str) -> Option<chrono::NaiveTime> {
    let (h, m) = time.split_once(':')?;
    chrono::NaiveTime::from_hms_opt(h.parse().ok()?, m.parse().ok()?, 0)
}

/// Local date and time to ms (the earlier of two, when the clocks go back; skipped forward
/// when they go forward).
fn local_ms(date: chrono::NaiveDate, time: chrono::NaiveTime) -> Option<i64> {
    use chrono::{Local, TimeZone};
    let naive = date.and_time(time);
    Local
        .from_local_datetime(&naive)
        .earliest()
        .or_else(|| Local.from_local_datetime(&(naive + chrono::Duration::hours(1))).earliest())
        .map(|t| t.timestamp_millis())
}

/// The services that happen on the days from `from` to `to` (inclusive), in order of start.
/// A special service that cancels the others leaves out that day's weekly services.
pub fn occurrences(services: &[Service], from: chrono::NaiveDate, to: chrono::NaiveDate) -> Vec<Occurrence> {
    use chrono::Datelike;
    let mut out = Vec::new();
    let mut day = from;
    while day <= to {
        let iso = day.format("%Y-%m-%d").to_string();
        let specials: Vec<&Service> = services.iter().filter(|s| s.date.as_deref() == Some(iso.as_str())).collect();
        let cancelled = specials.iter().any(|s| s.cancels_others);
        let weekday = day.weekday().num_days_from_sunday() as u8;
        let weekly = services.iter().filter(|s| s.date.is_none() && !cancelled && s.days.contains(&weekday));
        for s in specials.into_iter().chain(weekly) {
            let (Some(start), Some(end)) = (parse_time(&s.start), parse_time(&s.end)) else { continue };
            let (Some(start_ms), Some(mut end_ms)) = (local_ms(day, start), local_ms(day, end)) else { continue };
            if end_ms <= start_ms {
                end_ms += 24 * 3600 * 1000; // ends after midnight
            }
            out.push(Occurrence { service_id: s.id, start_ms, end_ms, key: format!("{}@{iso}", s.id) });
        }
        match day.succ_opt() {
            Some(next) => day = next,
            None => break,
        }
    }
    out.sort_by_key(|o| o.start_ms);
    out
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
        match &s.date {
            Some(date) if parse_date(date).is_none() => {
                return Err(AppError::BadRequest(format!("`{}`: the date must be YYYY-MM-DD", s.name)));
            }
            Some(_) => {}
            None if s.days.is_empty() || s.days.iter().any(|d| *d > 6) => {
                return Err(AppError::BadRequest(format!("`{}`: choose at least one day", s.name)));
            }
            None => {}
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

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    fn service(name: &str, days: &[u8], date: Option<&str>, cancels: bool) -> Service {
        Service {
            id: Uuid::new_v5(&Uuid::NAMESPACE_OID, name.as_bytes()),
            name: name.into(),
            days: days.to_vec(),
            date: date.map(Into::into),
            cancels_others: cancels,
            start: "10:00".into(),
            end: "12:00".into(),
        }
    }

    #[test]
    fn a_special_service_can_cancel_the_days_weekly_services() {
        // 2026-12-20 and 2026-12-27 are Sundays.
        let sunday = service("Sunday", &[0], None, false);
        let carols = service("Carols", &[], Some("2026-12-20"), true);
        let wedding = service("Wedding", &[], Some("2026-12-27"), false);
        let all = [sunday.clone(), carols.clone(), wedding.clone()];
        let from = NaiveDate::from_ymd_opt(2026, 12, 19).unwrap();
        let to = NaiveDate::from_ymd_opt(2026, 12, 27).unwrap();
        let names: Vec<Uuid> = occurrences(&all, from, to).iter().map(|o| o.service_id).collect();
        // The 20th: only the carols (Sunday cancelled). The 27th: Sunday and the wedding.
        assert_eq!(names.iter().filter(|id| **id == carols.id).count(), 1);
        assert_eq!(names.iter().filter(|id| **id == sunday.id).count(), 1);
        assert_eq!(names.iter().filter(|id| **id == wedding.id).count(), 1);
        let keys: Vec<String> = occurrences(&all, from, to).into_iter().map(|o| o.key).collect();
        assert!(keys.contains(&format!("{}@2026-12-27", sunday.id)));
        assert!(!keys.contains(&format!("{}@2026-12-20", sunday.id)));
    }

    #[test]
    fn special_services_need_a_real_date() {
        assert!(validate_services(&[service("Good", &[], Some("2026-12-24"), false)]).is_ok());
        assert!(validate_services(&[service("Bad", &[], Some("24/12/2026"), false)]).is_err());
        assert!(validate_services(&[service("No day", &[], None, false)]).is_err());
    }
}
