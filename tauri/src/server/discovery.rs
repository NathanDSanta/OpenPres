//! Servers announce themselves on the local network (mDNS / Bonjour, `_openpres._tcp`):
//! name, id, port and power state. Managers (the Manager program, OpenPres-M) and the apps
//! listen and list them. A server also answers as `openpres.local`, so a browser can open
//! http://openpres.local:8787 without knowing its address.

use crate::{config::Power, state::SharedState};
use mdns_sd::{ServiceDaemon, ServiceInfo};
use std::time::Duration;

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
        ("oldest_manager", crate::compatibility::COMPATIBILITY.oldest_manager.as_str()),
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
}
