import type { BoatState } from "./types";

const WATER_COLOR = "#0a1628";
const GRID_COLOR = "#0f2040";
const BOAT_COLOR = "#3b82f6";
const TRAIL_COLOR = "#1e3a5f";
const TEXT_COLOR = "#e0e6f0";
const MUTED_COLOR = "#6b7a94";

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private width: number;
  private height: number;
  private trail: { x: number; y: number }[] = [];
  private pixelsPerMeter = 10;

  constructor(canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    this.width = canvas.width;
    this.height = canvas.height;
  }

  resize(w: number, h: number) {
    this.width = w;
    this.height = h;
  }

  render(state: BoatState) {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const ppm = this.pixelsPerMeter;

    // Record trail
    this.trail.push({ x: state.x, y: state.y });
    if (this.trail.length > 2000) this.trail.shift();

    // Camera follows boat
    const camX = w / 2 - state.x * ppm;
    const camY = h / 2 + state.y * ppm; // +y is north (up on screen)

    // Clear
    ctx.fillStyle = WATER_COLOR;
    ctx.fillRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 1;
    const gridSpacing = 50; // pixels
    const offsetX = camX % gridSpacing;
    const offsetY = camY % gridSpacing;
    for (let x = offsetX; x < w; x += gridSpacing) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = offsetY; y < h; y += gridSpacing) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Trail
    if (this.trail.length > 1) {
      ctx.strokeStyle = TRAIL_COLOR;
      ctx.lineWidth = 2;
      ctx.beginPath();
      const first = this.trail[0];
      ctx.moveTo(camX + first.x * ppm, camY - first.y * ppm);
      for (let i = 1; i < this.trail.length; i++) {
        const p = this.trail[i];
        ctx.lineTo(camX + p.x * ppm, camY - p.y * ppm);
      }
      ctx.stroke();
    }

    // Boat
    const bx = camX + state.x * ppm;
    const by = camY - state.y * ppm;
    const headingRad = (state.heading * Math.PI) / 180;

    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(headingRad);

    // Hull
    ctx.fillStyle = BOAT_COLOR;
    ctx.beginPath();
    ctx.moveTo(0, -18); // bow (forward)
    ctx.lineTo(8, 10);
    ctx.lineTo(6, 14); // stern
    ctx.lineTo(-6, 14);
    ctx.lineTo(-8, 10);
    ctx.closePath();
    ctx.fill();

    // Heading line
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -18);
    ctx.lineTo(0, -28);
    ctx.stroke();

    // Motor thrust indicators
    const thrustLen = 20;
    // Left motor
    ctx.strokeStyle = `rgba(34, 197, 94, ${0.3 + state.leftThrust * 0.7})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-6, 14);
    ctx.lineTo(-6, 14 + state.leftThrust * thrustLen);
    ctx.stroke();
    // Right motor
    ctx.strokeStyle = `rgba(34, 197, 94, ${0.3 + state.rightThrust * 0.7})`;
    ctx.beginPath();
    ctx.moveTo(6, 14);
    ctx.lineTo(6, 14 + state.rightThrust * thrustLen);
    ctx.stroke();

    ctx.restore();

    // HUD overlay
    ctx.fillStyle = TEXT_COLOR;
    ctx.font = "13px monospace";
    const hud = [
      `HDG ${state.heading.toFixed(1)}°`,
      `SPD ${state.speed.toFixed(2)} m/s`,
      `POS (${state.x.toFixed(1)}, ${state.y.toFixed(1)})`,
      `BAT L:${state.leftBatteryV.toFixed(1)}V R:${state.rightBatteryV.toFixed(1)}V`,
      `TMP ${state.boardTemp1.toFixed(1)}°C  FAN ${(state.fanDuty * 100).toFixed(0)}%`,
      `THR L:${(state.leftThrust * 100).toFixed(0)}% R:${(state.rightThrust * 100).toFixed(0)}%`,
    ];
    for (let i = 0; i < hud.length; i++) {
      ctx.fillText(hud[i], 12, 24 + i * 18);
    }

    // Source label
    ctx.fillStyle = MUTED_COLOR;
    ctx.font = "12px monospace";
    ctx.fillText("SIL — live MQTT telemetry", 12, h - 12);
  }
}
