//! Network telemetry: detects which uplink owns the default route and
//! collects signal info for it. Polls /proc and /sys (microseconds) plus a
//! best-effort `iwgetid` to read the SSID. Cellular signal is left blank
//! to avoid contending with the GPS task for the EG25-G AT port.

use crate::config::NETWORK_INTERVAL;
use crate::types::{NetworkKind, NetworkState};
use tokio::sync::watch;
use tokio_util::sync::CancellationToken;

pub async fn run(network_tx: watch::Sender<NetworkState>, cancel: CancellationToken) {
    let mut interval = tokio::time::interval(NETWORK_INTERVAL);
    loop {
        tokio::select! {
            _ = cancel.cancelled() => break,
            _ = interval.tick() => {
                let state = sample_network();
                let _ = network_tx.send(state);
            }
        }
    }
    tracing::info!("Network task stopped");
}

fn sample_network() -> NetworkState {
    let iface = default_route_iface().unwrap_or_default();
    if iface.is_empty() {
        return NetworkState::default();
    }

    let kind = classify_iface(&iface);
    let ip_addr = read_ipv4(&iface);

    match kind {
        NetworkKind::Wifi => {
            let (signal_dbm, signal_pct, link_speed_mbps) = wifi_signal(&iface);
            NetworkState {
                kind,
                interface: Some(iface.clone()),
                ssid: read_ssid(&iface),
                signal_dbm,
                signal_pct,
                link_speed_mbps,
                ip_addr,
                operator: None,
            }
        }
        _ => NetworkState {
            kind,
            interface: Some(iface),
            ssid: None,
            signal_dbm: None,
            signal_pct: None,
            link_speed_mbps: None,
            ip_addr,
            operator: None,
        },
    }
}

/// Pick the interface that owns the default IPv4 route by parsing
/// `/proc/net/route`. The kernel writes a row per route; the default route
/// has Destination=00000000 and Gateway != 0.
fn default_route_iface() -> Option<String> {
    let contents = std::fs::read_to_string("/proc/net/route").ok()?;
    for line in contents.lines().skip(1) {
        let mut fields = line.split_whitespace();
        let iface = fields.next()?;
        let dest = fields.next()?;
        let _gateway = fields.next()?;
        let flags = fields.next()?;
        if dest == "00000000" {
            // RTF_UP (0x1) and RTF_GATEWAY (0x2) — both must be set for a usable default route.
            if let Ok(f) = u32::from_str_radix(flags, 16) {
                if f & 0x3 == 0x3 {
                    return Some(iface.to_string());
                }
            }
        }
    }
    None
}

fn classify_iface(iface: &str) -> NetworkKind {
    if iface.starts_with("wlan") || iface.starts_with("wlp") {
        NetworkKind::Wifi
    } else if iface.starts_with("wwan")
        || iface.starts_with("ppp")
        || iface.starts_with("usb")
        || iface == "rmnet0"
    {
        NetworkKind::Cellular
    } else if iface.starts_with("eth") || iface.starts_with("enp") || iface.starts_with("end") {
        NetworkKind::Ethernet
    } else {
        NetworkKind::None
    }
}

/// Read /proc/net/wireless. Format (header lines skipped):
///   iface: status link_quality signal_dbm noise_dbm ...
/// Quality is 0..70 typical, signal is dBm (-100..-30 typical).
fn wifi_signal(iface: &str) -> (Option<i32>, Option<u8>, Option<f64>) {
    let contents = std::fs::read_to_string("/proc/net/wireless").ok();
    let mut signal_dbm: Option<i32> = None;
    let mut quality: Option<f64> = None;

    if let Some(contents) = contents {
        for line in contents.lines() {
            let line = line.trim_start();
            let prefix = format!("{iface}:");
            if let Some(rest) = line.strip_prefix(&prefix) {
                let fields: Vec<&str> = rest.split_whitespace().collect();
                if fields.len() >= 4 {
                    quality = fields[1].trim_end_matches('.').parse::<f64>().ok();
                    signal_dbm = fields[2].trim_end_matches('.').parse::<f64>().ok().map(|v| v as i32);
                }
                break;
            }
        }
    }

    let signal_pct = signal_dbm.map(dbm_to_pct).or_else(|| {
        // Fall back to driver-reported link quality if dBm is missing.
        quality.map(|q| ((q / 70.0) * 100.0).clamp(0.0, 100.0) as u8)
    });

    let link_speed_mbps = std::fs::read_to_string(format!("/sys/class/net/{iface}/speed"))
        .ok()
        .and_then(|s| s.trim().parse::<f64>().ok())
        .filter(|v| *v > 0.0);

    (signal_dbm, signal_pct, link_speed_mbps)
}

/// Map dBm to a 0..100 percentage. -50 dBm or stronger = 100%, -100 dBm or
/// weaker = 0%, linear in between. Matches what most consumer OSes show.
fn dbm_to_pct(dbm: i32) -> u8 {
    if dbm >= -50 {
        100
    } else if dbm <= -100 {
        0
    } else {
        (2 * (dbm + 100)) as u8
    }
}

fn read_ssid(iface: &str) -> Option<String> {
    let output = std::process::Command::new("iwgetid")
        .args(["-r", iface])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let ssid = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if ssid.is_empty() {
        None
    } else {
        Some(ssid)
    }
}

fn read_ipv4(iface: &str) -> Option<String> {
    // `ip -4 -o addr show dev <iface>` is the most portable path. Fall back
    // to None if the binary or interface is missing.
    let output = std::process::Command::new("ip")
        .args(["-4", "-o", "addr", "show", "dev", iface])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    for line in text.lines() {
        // Format: "2: wlan0    inet 192.168.1.42/24 ..."
        let mut tokens = line.split_whitespace();
        while let Some(tok) = tokens.next() {
            if tok == "inet" {
                if let Some(addr) = tokens.next() {
                    return Some(addr.split('/').next()?.to_string());
                }
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dbm_mapping_clamps() {
        assert_eq!(dbm_to_pct(-30), 100);
        assert_eq!(dbm_to_pct(-50), 100);
        assert_eq!(dbm_to_pct(-75), 50);
        assert_eq!(dbm_to_pct(-100), 0);
        assert_eq!(dbm_to_pct(-120), 0);
    }

    #[test]
    fn classify_known_interfaces() {
        assert_eq!(classify_iface("wlan0"), NetworkKind::Wifi);
        assert_eq!(classify_iface("wlp3s0"), NetworkKind::Wifi);
        assert_eq!(classify_iface("wwan0"), NetworkKind::Cellular);
        assert_eq!(classify_iface("ppp0"), NetworkKind::Cellular);
        assert_eq!(classify_iface("usb0"), NetworkKind::Cellular);
        assert_eq!(classify_iface("eth0"), NetworkKind::Ethernet);
        assert_eq!(classify_iface("lo"), NetworkKind::None);
    }
}
