-- Telemetry archive: every MQTT message the recorder DO receives.
-- payload is the raw JSON the firmware published, kept verbatim so the
-- replay UI doesn't need a schema migration to handle new fields.
CREATE TABLE IF NOT EXISTS telemetry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,            -- unix millis (server clock)
  boat_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_telemetry_topic_ts ON telemetry(boat_id, topic, ts);
CREATE INDEX IF NOT EXISTS idx_telemetry_ts ON telemetry(boat_id, ts);

-- Denormalized GPS track. Avoids parsing JSON on every map render and
-- lets the trail query stay a tight index scan.
CREATE TABLE IF NOT EXISTS gps_track (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  boat_id TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  speed_mps REAL NOT NULL,
  satellites INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_gps_track_ts ON gps_track(boat_id, ts);
