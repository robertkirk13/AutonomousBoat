import { MqttSubscriber } from "./mqtt-subscriber";
import { Renderer } from "./renderer";
import { defaultState, type BoatState } from "./types";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const mqttStatus = document.getElementById("mqtt-status")!;
const connectBtn = document.getElementById("connect-btn") as HTMLButtonElement;
const hostInput = document.getElementById("mqtt-host") as HTMLInputElement;
const portInput = document.getElementById("mqtt-port") as HTMLInputElement;
const userInput = document.getElementById("mqtt-user") as HTMLInputElement;
const passInput = document.getElementById("mqtt-pass") as HTMLInputElement;

const state: BoatState = defaultState();
const subscriber = new MqttSubscriber();
const renderer = new Renderer(canvas);

// Resize canvas to fill panel
function resizeCanvas() {
  const panel = document.getElementById("sim-panel")!;
  canvas.width = panel.clientWidth;
  canvas.height = panel.clientHeight;
  renderer.resize(canvas.width, canvas.height);
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

// Load saved MQTT config
hostInput.value = localStorage.getItem("mqtt_host") || "";
portInput.value = localStorage.getItem("mqtt_port") || "8884";
userInput.value = localStorage.getItem("mqtt_user") || "";
passInput.value = localStorage.getItem("mqtt_pass") || "";

connectBtn.addEventListener("click", () => {
  const host = hostInput.value.trim();
  const port = portInput.value.trim();
  const user = userInput.value.trim();
  const pass = passInput.value.trim();

  if (!host || !user || !pass) {
    mqttStatus.textContent = "Fill in all fields";
    return;
  }

  localStorage.setItem("mqtt_host", host);
  localStorage.setItem("mqtt_port", port);
  localStorage.setItem("mqtt_user", user);
  localStorage.setItem("mqtt_pass", pass);

  subscriber.connect(host, port, user, pass);
  mqttStatus.textContent = "Connecting...";
});

// Apply MQTT patches to local state
subscriber.onUpdate = (patch) => {
  Object.assign(state, patch);
};

subscriber.onConnect = () => {
  mqttStatus.textContent = "Connected";
  mqttStatus.className = "status connected";
};

subscriber.onDisconnect = () => {
  mqttStatus.textContent = "Disconnected";
  mqttStatus.className = "status";
};

// Render loop at 60Hz — dead-reckon position from heading + speed
let lastTick = performance.now();

setInterval(() => {
  const now = performance.now();
  const dt = (now - lastTick) / 1000;
  lastTick = now;

  // Dead-reckon position from heading and inferred speed
  if (state.speed > 0.01) {
    const headingRad = (state.heading * Math.PI) / 180;
    state.x += Math.sin(headingRad) * state.speed * dt;
    state.y += Math.cos(headingRad) * state.speed * dt;
  }

  renderer.render(state);
}, 1000 / 60);
