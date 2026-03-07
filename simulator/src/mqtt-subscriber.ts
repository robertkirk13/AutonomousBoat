import mqtt from "mqtt";
import type { BoatState, PowerChannel } from "./types";

// Motor max amps — used to infer thrust percentage from current
const MOTOR_MAX_AMPS = 15;
const IDLE_AMPS = 0.5;
// Approximate max speed in m/s at full thrust
const MAX_SPEED = 2.0;

export class MqttSubscriber {
  private client: mqtt.MqttClient | null = null;
  private _connected = false;

  /** Called on every MQTT message with updated state fields. */
  onUpdate: ((patch: Partial<BoatState>) => void) | null = null;
  onConnect: (() => void) | null = null;
  onDisconnect: (() => void) | null = null;

  connect(host: string, port: string, username: string, password: string) {
    if (this.client) {
      this.client.end(true);
    }

    const url = `wss://${host}:${port}/mqtt`;
    this.client = mqtt.connect(url, {
      username,
      password,
      protocolVersion: 5,
      clientId: "boat-visualizer-" + Math.random().toString(36).slice(2, 8),
      reconnectPeriod: 5000,
    });

    this.client.on("connect", () => {
      this._connected = true;
      this.client!.subscribe("boat/#");
      this.onConnect?.();
    });

    this.client.on("close", () => {
      this._connected = false;
      this.onDisconnect?.();
    });

    this.client.on("error", (err) => {
      console.warn("MQTT error:", err.message);
    });

    this.client.on("message", (topic: string, payload: Buffer) => {
      try {
        const data = JSON.parse(payload.toString());
        this.handleMessage(topic, data);
      } catch {
        console.warn("Failed to parse MQTT message on", topic);
      }
    });
  }

  isConnected(): boolean {
    return this._connected;
  }

  private handleMessage(topic: string, data: unknown) {
    if (!this.onUpdate) return;

    switch (topic) {
      case "boat/imu": {
        const imu = data as { heading: number; roll: number; pitch: number };
        this.onUpdate({
          heading: imu.heading,
          roll: imu.roll,
          pitch: imu.pitch,
        });
        break;
      }
      case "boat/power": {
        const power = data as { channels: PowerChannel[] };
        const patch: Partial<BoatState> = {};

        for (const ch of power.channels) {
          switch (ch.label) {
            case "left_motor": {
              const thrust = Math.max(0, Math.min(1, (ch.current_a - IDLE_AMPS) / MOTOR_MAX_AMPS));
              patch.leftThrust = thrust;
              break;
            }
            case "right_motor": {
              const thrust = Math.max(0, Math.min(1, (ch.current_a - IDLE_AMPS) / MOTOR_MAX_AMPS));
              patch.rightThrust = thrust;
              break;
            }
            case "left_battery":
              patch.leftBatteryV = ch.voltage_v;
              patch.leftBatteryAh = ch.charge_ah;
              break;
            case "right_battery":
              patch.rightBatteryV = ch.voltage_v;
              patch.rightBatteryAh = ch.charge_ah;
              break;
          }
        }

        // Infer speed from average thrust
        const lt = patch.leftThrust ?? 0;
        const rt = patch.rightThrust ?? 0;
        patch.speed = ((lt + rt) / 2) * MAX_SPEED;

        this.onUpdate(patch);
        break;
      }
      case "boat/thermal": {
        const thermal = data as {
          temps: { label: string; temp_c: number }[];
          fan_duty: number;
        };
        const patch: Partial<BoatState> = { fanDuty: thermal.fan_duty };
        if (thermal.temps[0]) patch.boardTemp1 = thermal.temps[0].temp_c;
        if (thermal.temps[1]) patch.boardTemp2 = thermal.temps[1].temp_c;
        this.onUpdate(patch);
        break;
      }
      case "boat/status": {
        const status = data as { uptime_secs: number };
        this.onUpdate({ uptime: status.uptime_secs });
        break;
      }
    }
  }

  disconnect() {
    this.client?.end();
  }
}
