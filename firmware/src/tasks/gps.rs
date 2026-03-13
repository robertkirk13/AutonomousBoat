//! GPS task: reads NMEA from EG25-G module over USB serial.
//! Sends AT+QGPS=1 on the AT port to enable GPS, then reads NMEA from the NMEA port.

use crate::config::{GPS_AT_DEV, GPS_BAUD, GPS_NMEA_DEV};
use crate::types::GpsPosition;
use tokio::sync::watch;
use tokio_util::sync::CancellationToken;

pub async fn run(
    gps_tx: watch::Sender<GpsPosition>,
    cancel: CancellationToken,
) {
    #[cfg(feature = "hw")]
    {
        let cancel_clone = cancel.clone();
        let handle = tokio::task::spawn_blocking(move || {
            run_blocking(gps_tx, cancel_clone);
        });

        cancel.cancelled().await;
        let _ = handle.await;
    }

    #[cfg(not(feature = "hw"))]
    {
        drop(gps_tx);
        tracing::info!("GPS task disabled (sim mode)");
        cancel.cancelled().await;
    }

    tracing::info!("GPS task stopped");
}

#[cfg(feature = "hw")]
fn enable_gps() {
    use std::io::{BufRead, BufReader, Write};
    use std::time::Duration;

    let port = serialport::new(GPS_AT_DEV, GPS_BAUD)
        .timeout(Duration::from_secs(2))
        .open();

    let mut port = match port {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!("Could not open AT port {GPS_AT_DEV}: {e}");
            return;
        }
    };

    // Send AT+QGPS=1 to enable GPS engine
    if let Err(e) = port.write_all(b"AT+QGPS=1\r\n") {
        tracing::warn!("Failed to send AT+QGPS=1: {e}");
        return;
    }

    // Read response (OK or ERROR if already enabled)
    let mut reader = BufReader::new(port);
    let mut line = String::new();
    for _ in 0..5 {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => break,
            Ok(_) => {
                let trimmed = line.trim();
                if !trimmed.is_empty() {
                    tracing::debug!("AT response: {trimmed}");
                }
                if trimmed == "OK" || trimmed.contains("ERROR") {
                    break;
                }
            }
            Err(_) => break,
        }
    }

    tracing::info!("GPS enable command sent (AT+QGPS=1)");
}

#[cfg(feature = "hw")]
fn run_blocking(
    gps_tx: watch::Sender<GpsPosition>,
    cancel: CancellationToken,
) {
    use std::io::{BufRead, BufReader};
    use std::time::Duration;

    // Enable GPS via AT command port
    enable_gps();

    // Open NMEA port
    let port = match serialport::new(GPS_NMEA_DEV, GPS_BAUD)
        .timeout(Duration::from_secs(2))
        .open()
    {
        Ok(p) => p,
        Err(e) => {
            tracing::error!("Failed to open GPS NMEA port {GPS_NMEA_DEV}: {e}");
            return;
        }
    };

    tracing::info!("GPS reading NMEA from {GPS_NMEA_DEV}");

    let mut reader = BufReader::new(port);
    let mut line = String::new();
    let mut fix_count: u64 = 0;

    while !cancel.is_cancelled() {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => continue,
            Ok(_) => {
                let trimmed = line.trim();
                // Parse $GNRMC or $GPRMC sentences
                if trimmed.starts_with("$GNRMC") || trimmed.starts_with("$GPRMC") {
                    if let Some(pos) = parse_rmc(trimmed) {
                        fix_count += 1;
                        if fix_count == 1 {
                            tracing::info!(
                                "GPS first fix: {:.6}, {:.6} ({:.1} m/s)",
                                pos.lat, pos.lon, pos.speed_mps
                            );
                        }
                        let _ = gps_tx.send(pos);
                    }
                }
            }
            Err(e) => {
                // Timeout is normal (no data yet), other errors are notable
                if e.kind() != std::io::ErrorKind::TimedOut {
                    tracing::warn!("GPS serial read error: {e}");
                    std::thread::sleep(Duration::from_secs(1));
                }
            }
        }
    }
}

/// Parse a $GPRMC or $GNRMC sentence.
/// Format: $GNRMC,time,status,lat,N/S,lon,E/W,speed_knots,course,date,...
/// Returns None if no valid fix (status != 'A').
fn parse_rmc(sentence: &str) -> Option<GpsPosition> {
    // Strip checksum
    let data = sentence.split('*').next()?;
    let fields: Vec<&str> = data.split(',').collect();

    if fields.len() < 8 {
        return None;
    }

    // fields[2] = status: A=active, V=void
    if fields[2] != "A" {
        return None;
    }

    let lat = parse_nmea_coord(fields[3], fields[4])?;
    let lon = parse_nmea_coord(fields[5], fields[6])?;

    // Speed in knots -> m/s (1 knot = 0.514444 m/s)
    let speed_knots: f64 = fields[7].parse().unwrap_or(0.0);
    let speed_mps = speed_knots * 0.514444;

    Some(GpsPosition {
        lat,
        lon,
        speed_mps,
    })
}

/// Parse NMEA coordinate (DDMM.MMMMM format) with N/S or E/W hemisphere.
fn parse_nmea_coord(coord: &str, hemisphere: &str) -> Option<f64> {
    if coord.is_empty() || hemisphere.is_empty() {
        return None;
    }

    let dot_pos = coord.find('.')?;
    if dot_pos < 3 {
        return None;
    }

    // Degrees are everything before the last 2 digits before the decimal
    let deg_end = dot_pos - 2;
    let degrees: f64 = coord[..deg_end].parse().ok()?;
    let minutes: f64 = coord[deg_end..].parse().ok()?;

    let mut result = degrees + minutes / 60.0;

    if hemisphere == "S" || hemisphere == "W" {
        result = -result;
    }

    Some(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_rmc_valid() {
        let sentence = "$GNRMC,123456.00,A,4740.12345,N,12219.98765,W,5.2,270.0,120326,,,A*00";
        let pos = parse_rmc(sentence).unwrap();
        assert!((pos.lat - 47.668724).abs() < 0.001);
        assert!((pos.lon - (-122.333127)).abs() < 0.001);
        assert!((pos.speed_mps - 2.675).abs() < 0.01);
    }

    #[test]
    fn test_parse_rmc_void() {
        let sentence = "$GNRMC,123456.00,V,,,,,,,120326,,,N*00";
        assert!(parse_rmc(sentence).is_none());
    }

    #[test]
    fn test_parse_nmea_coord() {
        // 47 degrees 40.12345 minutes N
        let lat = parse_nmea_coord("4740.12345", "N").unwrap();
        assert!((lat - 47.668724).abs() < 0.0001);

        // 122 degrees 19.98765 minutes W
        let lon = parse_nmea_coord("12219.98765", "W").unwrap();
        assert!((lon - (-122.333127)).abs() < 0.0001);
    }
}
