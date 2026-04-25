import { MqttRecorder } from "./recorder";
import { getGpsHistory, getHistory, listSessions } from "./api";

export interface Env {
  DB: D1Database;
  RECORDER: DurableObjectNamespace;
  MQTT_HOST: string;
  MQTT_PORT: string;
  MQTT_USER: string;
  MQTT_PASS: string;
  BOAT_ID: string;
  ALLOWED_ORIGIN: string;
  ENSURE_RECORDER_RUNNING?: string;
  API_TOKEN?: string;
}

export { MqttRecorder };

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function intParam(url: URL, name: string, fallback: number): number {
  const raw = url.searchParams.get(name);
  if (raw == null) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

async function ensureRecorder(env: Env): Promise<void> {
  if (env.ENSURE_RECORDER_RUNNING !== "true") return;
  // Touch the singleton DO so its constructor runs and its alarm chain
  // is in place. Idempotent: subsequent /status calls are cheap.
  const id = env.RECORDER.idFromName("singleton");
  const stub = env.RECORDER.get(id);
  await stub.fetch(new Request("https://recorder/status"));
}

const handler: ExportedHandler<Env> = {
  async fetch(req, env): Promise<Response> {
    const url = new URL(req.url);
    const cors = corsHeaders(env.ALLOWED_ORIGIN || "*");

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    const json = (data: unknown, status = 200): Response =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json", ...cors },
      });

    try {
      // Light side-effect: kick the recorder on every cold start so an
      // evicted DO comes back without waiting for the cron tick.
      await ensureRecorder(env);

      if (url.pathname === "/health") {
        return new Response("ok", { headers: cors });
      }

      if (url.pathname === "/recorder/status") {
        const id = env.RECORDER.idFromName("singleton");
        const resp = await env.RECORDER.get(id).fetch(new Request("https://recorder/status"));
        const body = await resp.json();
        return json(body);
      }

      if (url.pathname === "/recorder/start") {
        if (env.API_TOKEN && req.headers.get("Authorization") !== `Bearer ${env.API_TOKEN}`) {
          return json({ error: "unauthorized" }, 401);
        }
        const id = env.RECORDER.idFromName("singleton");
        await env.RECORDER.get(id).fetch(new Request("https://recorder/start"));
        return json({ ok: true });
      }

      if (url.pathname === "/sessions") {
        const fromTs = intParam(url, "from", 0);
        const toTs = intParam(url, "to", Date.now());
        const gapMs = intParam(url, "gap_ms", 600_000);
        const sessions = await listSessions(env, fromTs, toTs, gapMs);
        return json({ sessions });
      }

      if (url.pathname === "/history/gps") {
        const fromTs = intParam(url, "from", 0);
        const toTs = intParam(url, "to", Date.now());
        const decimate = Math.max(1, intParam(url, "decimate", 1));
        const points = await getGpsHistory(env, fromTs, toTs, decimate);
        return json({ points });
      }

      if (url.pathname === "/history") {
        const topic = url.searchParams.get("topic");
        if (!topic) return json({ error: "missing topic" }, 400);
        const fromTs = intParam(url, "from", 0);
        const toTs = intParam(url, "to", Date.now());
        const limit = Math.min(100_000, Math.max(1, intParam(url, "limit", 50_000)));
        const points = await getHistory(env, topic, fromTs, toTs, limit);
        return json({ points });
      }

      return json({ error: "not found" }, 404);
    } catch (e) {
      console.error("worker error", e);
      return json({ error: String(e) }, 500);
    }
  },

  async scheduled(_event, env, _ctx): Promise<void> {
    // Backstop for the alarm chain — if it ever breaks (DO storage
    // hiccup, eviction during alarm execution), this hourly tick gets
    // ingestion back on its feet.
    const id = env.RECORDER.idFromName("singleton");
    await env.RECORDER.get(id).fetch(new Request("https://recorder/start"));
  },
};

export default handler;
