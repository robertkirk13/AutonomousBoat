# Boat Recorder (Cloudflare)

Worker + Durable Object + D1 that subscribes to the boat's MQTT broker
24/7 and archives every telemetry message. Exposes a small read API
the dashboard uses for the rolling live trail and the replay mode.

## What lives where

```
cloud/
├── wrangler.toml          # binding + DO migration config
├── migrations/0001_init.sql
└── src/
    ├── index.ts           # Worker entry: routes + cron backstop
    ├── recorder.ts        # MqttRecorder Durable Object (the persistent subscriber)
    ├── mqtt.ts            # Hand-rolled MQTT 3.1.1 binary helpers
    └── api.ts             # /sessions, /history, /history/gps SQL
```

## One-time deploy

```bash
cd cloud
bun install                                  # or npm install

# 1. Create the D1 database, then paste the printed UUID into wrangler.toml.
bunx wrangler d1 create boat-telemetry
$EDITOR wrangler.toml                        # set database_id

# 2. Apply the schema.
bun run migrate:remote

# 3. Set MQTT secrets (HiveMQ Cloud values).
echo -n "<cluster>.s2.eu.hivemq.cloud" | bunx wrangler secret put MQTT_HOST
echo -n "8884"                              | bunx wrangler secret put MQTT_PORT
echo -n "<user>"                            | bunx wrangler secret put MQTT_USER
echo -n "<pass>"                            | bunx wrangler secret put MQTT_PASS
# Optional: shared bearer token to gate /recorder/start.
echo -n "<random>"                          | bunx wrangler secret put API_TOKEN

# 4. Deploy.
bun run deploy

# 5. Kick the recorder so the DO actually opens its MQTT connection.
curl -X POST -H "Authorization: Bearer <random>" \
  https://boat-recorder.<your-subdomain>.workers.dev/recorder/start

# 6. Verify ingestion.
curl https://boat-recorder.<your-subdomain>.workers.dev/recorder/status
# -> { connected: true, pending: <small>, last_error: null, ... }

curl 'https://boat-recorder.<your-subdomain>.workers.dev/sessions'
# -> { sessions: [...] }   (becomes non-empty once the boat publishes GPS)
```

## Pointing the dashboard at it

Add to the dashboard's `.env` (or your hosting platform's env config):

```
VITE_HISTORY_URL=https://boat-recorder.<your-subdomain>.workers.dev
# Only needed if you set API_TOKEN above:
VITE_HISTORY_TOKEN=<random>
```

Leave both unset to disable the trail + replay UI; the live MQTT path
keeps working.

## How the recorder stays alive

The DO is single-instance (`idFromName('singleton')`). Three things
keep it ingesting:

1. **In-memory event loop.** While the WS sees traffic, the DO instance
   stays warm and messages flow straight to D1.
2. **Alarms.** Every 30 s the DO wakes itself, sends MQTT PINGREQ, and
   reschedules. If the WS is dead, the same alarm reconnects.
3. **Hourly cron + cold-fetch backstop.** A Worker cron runs once an
   hour and any incoming dashboard request also pokes the DO via
   `ENSURE_RECORDER_RUNNING`. If alarms ever break, the next request or
   cron tick brings it back.

Persistent MQTT session (`cleanSession=false`, stable clientId) means
HiveMQ buffers QoS≥1 messages while we're disconnected. The DO
subscribes at QoS 1 so brief eviction doesn't lose data — though the
firmware publishes most topics at QoS 0 today, so plan for some
gappiness during DO restarts.

## Cost ballpark

At the boat's published rates (~5 msgs/s aggregate, 1 Hz GPS) on the
free Workers + D1 plan:

- D1 writes/day: ~430 k (well under 5M/day free tier)
- D1 storage at 200 B/row: ~85 MB/day; months fit in 5 GB free
- DO duration: a hot WebSocket bills ~1 GB-s/min ≈ 1.4 M GB-s/month
  at idle. Past the 400 k GB-s/month included tier, that's ~$12/month
  on the Workers Paid plan.

If you don't want the DO duration line item, see the alternative:
running the same MQTT-to-D1 logic on a fly.io free worker pointed at
the same D1 (D1 is reachable from outside Workers via the HTTP API).

## Useful operational endpoints

```
GET /health                       -> "ok"
GET /recorder/status              -> { connected, pending, last_error, ... }
POST /recorder/start              -> force a reconnect cycle (auth required)

GET /sessions?from=&to=&gap_ms=   -> auto-detected runs, gaps split sessions
GET /history/gps?from=&to=&decimate=
GET /history?topic=boat/imu&from=&to=&limit=
```
