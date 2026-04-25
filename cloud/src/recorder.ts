import {
  encodeConnect,
  encodeDisconnect,
  encodePingreq,
  encodePuback,
  encodeSubscribe,
  tryParse,
  type Packet,
} from "./mqtt";

import type { Env } from "./index";

// Time the DO will tolerate without seeing data before it forces a
// reconnect. Heartbeats land every PINGREQ_INTERVAL_MS, so 90s is
// effectively "missed three heartbeats."
const PINGREQ_INTERVAL_MS = 30_000;
const STALE_RECONNECT_MS = 90_000;
const RECONNECT_DELAY_MS = 5_000;
const FLUSH_INTERVAL_MS = 2_000;
const FLUSH_THRESHOLD = 100;

interface Pending {
  ts: number;
  topic: string;
  payload: string;
}

/**
 * Durable Object that holds a long-lived MQTT-over-WebSocket connection
 * to HiveMQ Cloud, subscribes to `boat/#`, and batch-writes everything
 * it receives into D1.
 *
 * Keep-alive strategy:
 *   - Alarm fires every PINGREQ_INTERVAL_MS. If the WS is up, we send
 *     PINGREQ. If it's down, we reconnect.
 *   - Persistent MQTT session (cleanSession=false, stable clientId)
 *     means HiveMQ buffers QoS≥1 messages while we're gone. We
 *     subscribe at QoS 1 so reconnects backfill anything missed during
 *     a DO eviction.
 */
// Not declared `implements DurableObject` because the workers-types
// interface reserves method names (e.g. `connect`) that we use as
// internal helpers. The runtime only requires `fetch` and `alarm`.
export class MqttRecorder {
  private state: DurableObjectState;
  private env: Env;
  private ws: WebSocket | null = null;
  private buf = new Uint8Array(0);
  private pending: Pending[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private packetIdCounter = 1;
  private connecting = false;
  private connected = false;
  private lastSeenAt = 0;
  private lastError: string | null = null;
  private connectedAt: number | null = null;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    // Block startup until the alarm is scheduled so the heartbeat loop
    // is guaranteed to run even if the constructor's connect() throws.
    this.state.blockConcurrencyWhile(async () => {
      await this.ensureAlarm();
      await this.connect().catch((e) => {
        this.lastError = `init connect failed: ${e}`;
      });
    });
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/status") {
      return Response.json({
        connected: this.connected,
        pending: this.pending.length,
        last_error: this.lastError,
        connected_at: this.connectedAt,
        last_seen_at: this.lastSeenAt,
      });
    }
    if (url.pathname === "/start") {
      // Force a reconnect cycle. Useful as a manual rescue.
      this.connected = false;
      try { this.ws?.close(); } catch { /* ignore */ }
      this.ws = null;
      await this.connect();
      return new Response("ok");
    }
    return new Response("not found", { status: 404 });
  }

  async alarm(): Promise<void> {
    // Reschedule first so a thrown handler doesn't break the chain.
    await this.state.storage.setAlarm(Date.now() + PINGREQ_INTERVAL_MS);

    // If we haven't seen bytes in a while the WS may be wedged with a
    // half-open TCP connection. Force a reconnect.
    const stale =
      this.connected && this.lastSeenAt > 0 && Date.now() - this.lastSeenAt > STALE_RECONNECT_MS;

    if (!this.connected || !this.ws || stale) {
      await this.connect().catch((e) => {
        this.lastError = `alarm reconnect failed: ${e}`;
      });
      return;
    }

    try {
      this.ws.send(encodePingreq());
    } catch (e) {
      this.lastError = `ping send failed: ${e}`;
      this.handleDisconnect();
    }

    // Take this opportunity to flush any tail end of pending messages.
    if (this.pending.length > 0) {
      await this.flush();
    }
  }

  private async ensureAlarm(): Promise<void> {
    const next = await this.state.storage.getAlarm();
    if (next == null) {
      await this.state.storage.setAlarm(Date.now() + PINGREQ_INTERVAL_MS);
    }
  }

  private async connect(): Promise<void> {
    if (this.connecting) return;
    this.connecting = true;
    try {
      if (this.ws) {
        try { this.ws.close(); } catch { /* ignore */ }
        this.ws = null;
      }
      this.connected = false;
      this.buf = new Uint8Array(0);

      const wsUrl = `https://${this.env.MQTT_HOST}:${this.env.MQTT_PORT}/mqtt`;
      const resp = await fetch(wsUrl, {
        headers: {
          Upgrade: "websocket",
          "Sec-WebSocket-Protocol": "mqtt",
        },
      });
      if (resp.status !== 101) {
        this.lastError = `ws upgrade failed: status=${resp.status}`;
        return;
      }
      const ws = resp.webSocket;
      if (!ws) {
        this.lastError = "ws upgrade returned no socket";
        return;
      }
      ws.accept();
      this.ws = ws;

      ws.addEventListener("message", (ev) => {
        const data = ev.data;
        if (typeof data === "string") {
          // Brokers shouldn't send text frames for MQTT — drop them.
          return;
        }
        this.lastSeenAt = Date.now();
        this.onBytes(new Uint8Array(data));
      });
      ws.addEventListener("close", () => {
        this.handleDisconnect();
      });
      ws.addEventListener("error", () => {
        this.lastError = "ws error event";
        this.handleDisconnect();
      });

      // Stable clientId per boat so HiveMQ keeps a persistent session
      // and replays QoS ≥1 messages we missed during eviction.
      const connect = encodeConnect({
        clientId: `cf-recorder-${this.env.BOAT_ID}`,
        username: this.env.MQTT_USER,
        password: this.env.MQTT_PASS,
        cleanSession: false,
        keepAliveSecs: 60,
      });
      ws.send(connect);
    } finally {
      this.connecting = false;
    }
  }

  private handleDisconnect(): void {
    this.connected = false;
    this.ws = null;
    // Pull the next alarm forward so we reconnect quickly instead of
    // waiting up to the full ping interval.
    this.state.storage.setAlarm(Date.now() + RECONNECT_DELAY_MS).catch(() => {
      // Storage failure is fine — the regular ping cadence will retry.
    });
  }

  private onBytes(chunk: Uint8Array): void {
    const merged = new Uint8Array(this.buf.length + chunk.length);
    merged.set(this.buf);
    merged.set(chunk, this.buf.length);
    this.buf = merged;
    while (true) {
      let r: { pkt: Packet; consumed: number } | null;
      try {
        r = tryParse(this.buf);
      } catch (e) {
        this.lastError = `parse error: ${e}`;
        try { this.ws?.close(); } catch { /* ignore */ }
        this.handleDisconnect();
        return;
      }
      if (!r) return;
      this.buf = this.buf.subarray(r.consumed);
      this.handlePacket(r.pkt);
    }
  }

  private handlePacket(pkt: Packet): void {
    switch (pkt.type) {
      case "connack": {
        if (pkt.returnCode !== 0) {
          this.lastError = `connack rc=${pkt.returnCode}`;
          try { this.ws?.close(); } catch { /* ignore */ }
          this.handleDisconnect();
          return;
        }
        this.connected = true;
        this.connectedAt = Date.now();
        this.lastError = null;
        const subId = this.nextPacketId();
        try {
          this.ws!.send(encodeSubscribe(subId, [{ topic: "boat/#", qos: 1 }]));
        } catch (e) {
          this.lastError = `subscribe send failed: ${e}`;
          this.handleDisconnect();
        }
        return;
      }
      case "publish": {
        if (pkt.qos === 1 && pkt.packetId != null) {
          try { this.ws!.send(encodePuback(pkt.packetId)); } catch { /* ignore */ }
        }
        // Drop the dashboard's own ping echoes — we don't want to
        // archive 0.3Hz × users worth of nonces forever.
        if (pkt.topic === "boat/dashboard/ping") return;
        const payloadStr = new TextDecoder().decode(pkt.payload);
        this.pending.push({ ts: Date.now(), topic: pkt.topic, payload: payloadStr });
        if (this.pending.length >= FLUSH_THRESHOLD) {
          this.flush().catch((e) => {
            this.lastError = `inline flush failed: ${e}`;
          });
        } else if (!this.flushTimer) {
          this.flushTimer = setTimeout(() => {
            this.flushTimer = null;
            this.flush().catch((e) => {
              this.lastError = `timer flush failed: ${e}`;
            });
          }, FLUSH_INTERVAL_MS);
        }
        return;
      }
      case "suback":
      case "puback":
      case "pingresp":
      case "unknown":
        return;
    }
  }

  private nextPacketId(): number {
    this.packetIdCounter = (this.packetIdCounter + 1) & 0xffff;
    if (this.packetIdCounter === 0) this.packetIdCounter = 1;
    return this.packetIdCounter;
  }

  private async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.pending.length === 0) return;
    const batch = this.pending;
    this.pending = [];

    const insert = this.env.DB.prepare(
      "INSERT INTO telemetry (ts, boat_id, topic, payload) VALUES (?1, ?2, ?3, ?4)",
    );
    const insertGps = this.env.DB.prepare(
      "INSERT INTO gps_track (ts, boat_id, lat, lon, speed_mps, satellites) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    );

    const stmts: D1PreparedStatement[] = [];
    for (const m of batch) {
      stmts.push(insert.bind(m.ts, this.env.BOAT_ID, m.topic, m.payload));
      if (m.topic === "boat/gps") {
        try {
          const j = JSON.parse(m.payload) as {
            lat?: unknown; lon?: unknown; speed_mps?: unknown; satellites?: unknown;
          };
          if (typeof j.lat === "number" && typeof j.lon === "number") {
            stmts.push(
              insertGps.bind(
                m.ts,
                this.env.BOAT_ID,
                j.lat,
                j.lon,
                typeof j.speed_mps === "number" ? j.speed_mps : 0,
                typeof j.satellites === "number" ? j.satellites : 0,
              ),
            );
          }
        } catch {
          // Malformed GPS payload — telemetry row already preserves the raw bytes.
        }
      }
    }

    try {
      await this.env.DB.batch(stmts);
    } catch (e) {
      // Drop the batch. Telemetry, not commands; better than blocking
      // ingestion with retries that pile up under sustained D1 errors.
      this.lastError = `D1 batch failed: ${e} (dropped ${batch.length})`;
    }
  }
}

// Export so wrangler can find the symbol referenced in [migrations].
export { encodeDisconnect };
