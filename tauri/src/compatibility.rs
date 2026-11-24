//! Which versions work together: compatibility.json at the top of the repository, set by the
//! maintainer for each release. A manager older than `oldest_manager` can't manage this
//! server; this version's manager can't manage a server older than `oldest_server`.

use serde::Deserialize;
use std::sync::LazyLock;

#[derive(Debug, Deserialize)]
pub struct Compatibility {
    pub oldest_manager: String,
    pub oldest_server: String,
}

pub static COMPATIBILITY: LazyLock<Compatibility> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../compatibility.json")).expect("compatibility.json is valid")
});

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_rules_are_versions() {
        let is_version = |v: &str| v.split('.').count() == 3 && v.split('.').all(|n| n.parse::<u32>().is_ok());
        assert!(is_version(&COMPATIBILITY.oldest_manager), "oldest_manager: {}", COMPATIBILITY.oldest_manager);
        assert!(is_version(&COMPATIBILITY.oldest_server), "oldest_server: {}", COMPATIBILITY.oldest_server);
    }
}
