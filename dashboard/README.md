# Dashboard

React + Vite telemetry dashboard for the boat. This is the richer operator-facing UI with live MQTT telemetry, map and 3D views, power and thermal panels, and teleop controls.

## Commands

```bash
bun install
bun run dev
bun run build
bun run preview
```

Use `bun` here so the checked-in `bun.lock` stays authoritative.

## Environment

Create `dashboard/.env.local` with:

```bash
VITE_MQTT_HOST=your-hivemq-host.s1.eu.hivemq.cloud
VITE_MQTT_WS_PORT=8884
VITE_MQTT_USER=your_user
VITE_MQTT_PASS=your_pass
```

The MQTT connection is created in `src/hooks/useBoatMqtt.ts`.

## Important Paths

- `src/App.tsx` - dashboard shell
- `src/components/` - telemetry panels, map, 3D view, and teleop UI
- `src/hooks/useBoatMqtt.ts` - MQTT connection, subscriptions, and client-side interpolation
- `public/` - static assets served by Vite

See the repo root [README](../README.md) for the full boat setup flow.
