//! Finding servers on the local network (mDNS / Bonjour, `_openpres._tcp`): servers
//! announce their name, id, port and power state; managers listen and list them. A server
//! also answers as `openpres.local`, so a browser (or the website's manager page) can open
//! http://openpres.local:8787 without knowing its address.

use crate::{config::Power, state::SharedState};
use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use serde::Serialize;
use std::{
    collections::HashMap,
    net::IpAddr,
    sync::{Arc, Mutex},
    time::Duration,
};

pub const SERVICE: &str = "_openpres._tcp.local.";
/// The name every server answers to (with two servers on the network, either may answer).
pub const LOCAL_NAME: &str = "openpres.local";
/// Web pages, for browsers that list them (and the name `openpres.local`).
const WEB_SERVICE: &str = "_http._tcp.local.";

/// What a server announces.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Announcement {
    id: String,
    name: String,
    port: u16,
    power: Power,
}

fn power_name(p: Power) -> &'static str {
    match p {
        Power::Active => "active",
        Power::Standby => "standby",
        Power::Sleep => "sleep",
    }
}

/// mDNS names: letters, digits and dashes.
fn dns_label(s: &str) -> String {
    let label: String = s
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .chars()
        .take(40)
        .collect();
    if label.is_empty() {
        "openpres".into()
    } else {
        label
    }
}

/// What is announced: the server for managers, and its web pages as openpres.local.
fn service_infos(a: &Announcement) -> Vec<ServiceInfo> {
    let web = ServiceInfo::new(WEB_SERVICE, &format!("OpenPres-{}", &a.id[..8.min(a.id.len())]), &format!("{LOCAL_NAME}."), "", a.port, &[("path", "/")][..])
        .map(ServiceInfo::enable_addr_auto)
        .map_err(|e| tracing::warn!("discovery: {e}"))
        .ok();
    service_info(a).into_iter().chain(web).collect()
}

fn service_info(a: &Announcement) -> Option<ServiceInfo> {
    let host = format!("{}.local.", dns_label(&crate::config::host_name()));
    // Unique even when two servers share a name; managers show the name from the TXT record.
    let instance = format!("{}-{}", dns_label(&a.name), &a.id[..8.min(a.id.len())]);
    let properties = [
        ("id", a.id.as_str()),
        ("name", a.name.as_str()),
        ("power", power_name(a.power)),
        ("version", env!("CARGO_PKG_VERSION")),
    ];
    ServiceInfo::new(SERVICE, &instance, &host, "", a.port, &properties[..])
        .map(ServiceInfo::enable_addr_auto)
        .map_err(|e| tracing::warn!("discovery: {e}"))
        .ok()
}

/// Announces this server while it accepts managers from other devices, and keeps the
/// announcement up to date (name, power).
pub fn spawn_announcer(s: SharedState) {
    tokio::spawn(async move {
        let daemon = match ServiceDaemon::new() {
            Ok(d) => d,
            Err(e) => {
                tracing::warn!("discovery unavailable: {e}");
                return;
            }
        };
        let mut rx = s.events.subscribe();
        let mut current: Option<(Announcement, Vec<String>)> = None;
        loop {
            let wanted = {
                let c = s.config.read().await;
                c.remote_access.then(|| Announcement {
                    id: c.server_id.to_string(),
                    name: c.display_name(),
                    port: c.api_port,
                    power: c.power,
                })
            };
            if current.as_ref().map(|(a, _)| a) != wanted.as_ref() {
                if let Some((_, fullnames)) = current.take() {
                    for fullname in fullnames {
                        let _ = daemon.unregister(&fullname);
                    }
                }
                if let Some(a) = wanted {
                    let mut fullnames = Vec::new();
                    for info in service_infos(&a) {
                        let fullname = info.get_fullname().to_string();
                        match daemon.register(info) {
                            Ok(()) => fullnames.push(fullname),
                            Err(e) => tracing::warn!("discovery: could not announce: {e}"),
                        }
                    }
                    current = Some((a, fullnames));
                }
            }
            tokio::select! {
                _ = rx.recv() => {}
                _ = tokio::time::sleep(Duration::from_secs(10)) => {}
            }
        }
    });
}

/// A server a manager found.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct FoundServer {
    pub id: String,
    pub name: String,
    pub host: String,
    pub addresses: Vec<IpAddr>,
    pub port: u16,
    pub power: String,
    pub version: String,
}

/// Listens for servers in the background (managers); `list` gives the ones seen so far.
pub struct Browser {
    found: Arc<Mutex<HashMap<String, FoundServer>>>,
    _daemon: Option<ServiceDaemon>,
}

impl Browser {
    pub fn start() -> Self {
        let found: Arc<Mutex<HashMap<String, FoundServer>>> = Arc::default();
        let daemon = ServiceDaemon::new().map_err(|e| tracing::warn!("discovery unavailable: {e}")).ok();
        if let Some(rx) = daemon.as_ref().and_then(|d| d.browse(SERVICE).ok()) {
            let found = found.clone();
            std::thread::Builder::new()
                .name("discovery".into())
                .spawn(move || {
                    while let Ok(event) = rx.recv() {
                        let mut found = found.lock().unwrap_or_else(|e| e.into_inner());
                        match event {
                            ServiceEvent::ServiceResolved(info) => {
                                let text = |k: &str| info.get_property_val_str(k).unwrap_or("").to_string();
                                let mut addresses: Vec<IpAddr> = info.get_addresses().iter().copied().collect();
                                // IPv4 first: the friendliest to show and type.
                                addresses.sort_by_key(|a| (a.is_ipv6(), *a));
                                found.insert(
                                    info.get_fullname().to_string(),
                                    FoundServer {
                                        id: text("id"),
                                        name: text("name"),
                                        host: info.get_hostname().trim_end_matches('.').to_string(),
                                        addresses,
                                        port: info.get_port(),
                                        power: text("power"),
                                        version: text("version"),
                                    },
                                );
                            }
                            ServiceEvent::ServiceRemoved(_, fullname) => {
                                found.remove(&fullname);
                            }
                            _ => {}
                        }
                    }
                })
                .ok();
        }
        Self { found, _daemon: daemon }
    }

    /// The servers seen, one per id (a server reachable several ways is listed once).
    pub fn list(&self) -> Vec<FoundServer> {
        let found = self.found.lock().unwrap_or_else(|e| e.into_inner());
        let mut by_id: HashMap<String, FoundServer> = HashMap::new();
        for s in found.values() {
            by_id.entry(s.id.clone()).or_insert_with(|| s.clone());
        }
        let mut list: Vec<FoundServer> = by_id.into_values().collect();
        list.sort_by_key(|s| s.name.to_lowercase());
        list
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_valid_dns_labels() {
        assert_eq!(dns_label("Main hall (2)"), "Main-hall--2");
        assert_eq!(dns_label("¡¡"), "openpres");
        let a = Announcement { id: uuid::Uuid::nil().to_string(), name: "Sala principal".into(), port: 8787, power: Power::Active };
        let info = service_info(&a).unwrap();
        assert!(info.get_fullname().starts_with("Sala-principal-00000000."));
        assert_eq!(info.get_property_val_str("name"), Some("Sala principal"));
    }

    #[test]
    fn servers_also_answer_as_openpres_local() {
        let a = Announcement { id: uuid::Uuid::nil().to_string(), name: "Main hall".into(), port: 8787, power: Power::Active };
        let infos = service_infos(&a);
        assert_eq!(infos.len(), 2);
        let web = infos.iter().find(|i| i.get_type() == WEB_SERVICE).unwrap();
        assert_eq!(web.get_hostname(), "openpres.local.");
        assert_eq!(web.get_port(), 8787);
    }

    /// A server announced on this computer is found by a manager's browser.
    #[test]
    #[ignore = "needs multicast on the network interfaces"]
    fn managers_find_announced_servers() {
        let id = uuid::Uuid::new_v4().to_string();
        let a = Announcement { id: id.clone(), name: "Test hall".into(), port: 8799, power: Power::Standby };
        let daemon = ServiceDaemon::new().unwrap();
        daemon.register(service_info(&a).unwrap()).unwrap();
        let browser = Browser::start();
        let started = std::time::Instant::now();
        let found = loop {
            if let Some(s) = browser.list().into_iter().find(|s| s.id == id) {
                break s;
            }
            assert!(started.elapsed() < Duration::from_secs(10), "not found");
            std::thread::sleep(Duration::from_millis(100));
        };
        assert_eq!((found.name.as_str(), found.port, found.power.as_str()), ("Test hall", 8799, "standby"));
        assert!(!found.addresses.is_empty());
        let _ = daemon.shutdown();
    }
}
