# Simulator

Small Vite app for a lighter-weight boat visualization loop. It connects to MQTT over WebSocket, renders a simplified boat state view on canvas, and dead-reckons motion from incoming telemetry.

## Commands

```bash
bun install
bun run dev
bun run build
bun run preview
```

## Connection Model

The simulator does not use a checked-in `.env` file. MQTT host, port, username, and password are entered in the browser UI and cached in `localStorage`.

## Important Paths

- `src/main.ts` - UI wiring and render loop
- `src/mqtt-subscriber.ts` - MQTT client and topic parsing
- `src/renderer.ts` - canvas rendering and trail drawing
- `src/types.ts` - simulator state types

Use the main [`../dashboard/`](../dashboard/README.md) app for the full operator dashboard.
