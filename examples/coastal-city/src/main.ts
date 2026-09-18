import {
  ArcadeVehicleController3d,
  GameRuntime,
  ThirdPersonMotor3d,
  createPhysicsWorld3d,
  captureScreenshot,
  importGltf,
  uploadGltfAsset,
  type GameContext,
  type GltfAsset,
  type PhysicsWorld3dBridge,
} from "@vapour/engine";
import { compose, type Mat4 } from "@vapour/math";
import { DISTRICT, drawCell, visibleCells } from "./world.js";

interface ManifestAsset { id: string; file: string; lodFile: string; colliders: readonly { center: readonly [number, number, number]; halfExtents: readonly [number, number, number] }[]; }
interface Manifest { assets: readonly ManifestAsset[]; }

const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const loading = document.querySelector<HTMLDivElement>("#loading")!;
const loadingText = loading.querySelector("span")!;
const modeLabel = document.querySelector<HTMLSpanElement>("#mode")!;
const speedLabel = document.querySelector<HTMLDivElement>("#speed")!;
const statsLabel = document.querySelector<HTMLDivElement>("#stats")!;
const captureImage = document.querySelector<HTMLImageElement>("#capture")!;
const assets = new Map<string, GltfAsset>();
let physics: PhysicsWorld3dBridge;
let player: ThirdPersonMotor3d;
let vehicle: ArcadeVehicleController3d;
let driving = false;
let viewYaw = 0;
let viewPitch = -0.17;
let daylight = 0;
let lastEnter = false;
let runtime!: GameRuntime;
let captureRequested = new URLSearchParams(location.search).has("capture");
let capturePending = false;

const hooks = {
  async start(game: GameContext) {
    runtime.host.setPostProcess({ exposure: 1.08, toneMapping: "aces", bloom: { intensity: 0.18, threshold: 1.4, scatter: 0.52 }, saturation: 1.06, contrast: 1.04, vignette: 0.12, chromaticAberration: 0 });
    const manifest = await fetch("/assets/manifest.json").then(response => response.json()) as Manifest;
    let completed = 0;
    for (const asset of manifest.assets) {
      loadingText.textContent = `Importing ${asset.id} · ${completed}/${manifest.assets.length}`;
      const model = await importGltf(await fetch(`/assets/${asset.file}`).then(response => response.arrayBuffer()), { sourceName: asset.file });
      assets.set(asset.id, await uploadGltfAsset(runtime.host, model, { id: `solace:${asset.id}`, maxTextureSize: 4096 }));
      completed++;
    }
    physics = await createPhysicsWorld3d({ moduleUrl: "/vapour_runtime.js" });
    physics.insert({ id: 1, bodyType: "static", position: [0, -0.5, 0], rotation: [0, 0, 0, 1], shape: { type: "box", halfExtents: [44, 0.5, 145] }, friction: 1 });
    // Broad-phase architecture colliders retain driveable streets while the
    // generated manifest remains the detailed asset-specific collision source.
    const buildings = [
      [-23, 8, -3, 6.8, 8, 11.7], [21, 3.7, -7, 4.1, 3.7, 6.2],
      [-23, 5, -69, 8.1, 5, 10.6], [23, 5, -91, 8.1, 5, 10.6],
      [23, 8, 70, 6.8, 8, 11.7], [-21, 3.7, 91, 4.1, 3.7, 6.2],
    ] as const;
    buildings.forEach((body, index) => physics.insert({ id: index + 2, bodyType: "static", position: [body[0], body[1], body[2]], rotation: [0, 0, 0, 1], shape: { type: "box", halfExtents: [body[3], body[4], body[5]] } }));
    physics.flush();
    player = new ThirdPersonMotor3d(physics, { position: [2, 0.04, 6], yaw: 0 });
    vehicle = new ArcadeVehicleController3d(physics, { position: [0, 0.76, 4], yaw: Math.PI, maxSpeed: 28 });
    if (game.audio) {
      game.audio.defineBus({ id: "ambience", volume: 0.55 });
      await Promise.all([
        game.audio.loadClip("city", "/assets/audio/city-night.mp3").catch(error => console.warn(error)),
        game.audio.loadClip("ocean", "/assets/audio/ocean-waves.mp3").catch(error => console.warn(error)),
      ]);
      try { game.audio.play("city", { bus: "ambience", loop: true, volume: 0.55 }); game.audio.play("ocean", { bus: "ambience", loop: true, volume: 0.36, position: [36, 0, 0], minDistance: 12, maxDistance: 100 }); } catch { /* optional decoded ambience may still be loading */ }
    }
    loading.classList.add("ready");
    canvas.addEventListener("click", () => void game.lockPointer());
  },
  fixedUpdate(game: GameContext, dt: number) {
    const forward = game.input.action("Forward").value - game.input.action("Backward").value;
    const right = game.input.action("Right").value - game.input.action("Left").value;
    const enter = game.input.action("Enter").pressed;
    if (enter && !lastEnter) {
      if (!driving) {
        const p = player.state.position, v = vehicle.state.position;
        if (Math.hypot(p[0] - v[0], p[2] - v[2]) < 4) driving = true;
      } else {
        const exit = vehicle.findExitPosition();
        if (exit) { player.teleport(exit, vehicle.state.yaw); driving = false; }
      }
    }
    lastEnter = enter;
    if (driving) vehicle.update(dt, { throttle: forward, steer: -right, brake: game.input.action("Brake").pressed ? 1 : 0, handbrake: game.input.action("Handbrake").pressed });
    else {
      const sin = Math.sin(viewYaw), cos = Math.cos(viewYaw);
      player.update(dt, { move: [right * cos - forward * sin, -right * sin - forward * cos], sprint: game.input.action("Sprint").pressed, jump: game.input.action("Jump").pressed });
    }
    if (game.input.action("Time").justPressed) daylight = (daylight + 1) % 3;
  },
  update(game: GameContext) {
    viewYaw -= game.input.action("LookX").value * 0.0022;
    viewPitch = Math.max(-0.55, Math.min(0.16, viewPitch - game.input.action("LookY").value * 0.0018));
    const focus = driving ? vehicle.state.position : player.state.position;
    const distance = driving ? 8.8 : 5.2;
    const height = driving ? 3.5 : 2.6;
    const camera = cameraMatrix(focus, viewYaw + (driving ? vehicle.state.yaw : player.state.yaw), viewPitch, distance, height);
    game.frame.setCamera(camera, driving ? 68 : 62, 0.08, 320);
    const light = daylight === 0
      ? { direction: [-0.42, -0.8, -0.35] as const, color: [1, 0.88, 0.68] as const, intensity: 5.2, sky: [[0.05, 0.24, 0.62], [1.05, 0.42, 0.18], [0.035, 0.03, 0.028]] as const }
      : daylight === 1
        ? { direction: [-0.25, -0.94, 0.12] as const, color: [1, 0.98, 0.91] as const, intensity: 7.5, sky: [[0.12, 0.42, 1.05], [0.65, 0.83, 1.1], [0.06, 0.08, 0.07]] as const }
        : { direction: [0.3, -0.45, 0.55] as const, color: [0.22, 0.32, 0.62] as const, intensity: 1.3, sky: [[0.004, 0.012, 0.045], [0.04, 0.075, 0.14], [0.006, 0.009, 0.014]] as const };
    game.frame.lights.addHemisphere(light.sky[0], light.sky[2], daylight === 2 ? 0.35 : 1.15);
    game.frame.lights.addDirectional(light.direction, light.color, light.intensity);
    if (daylight === 2) {
      for (const z of [-80, -48, -16, 16, 48, 80]) game.frame.lights.addPoint([8, 5.5, z], [1, 0.52, 0.18], 18, 24);
    }
    const clearProbe = new URLSearchParams(location.search).has("clearprobe");
    game.frame.setEnvironment({
      clearColor: clearProbe ? [1, 0, 0, 1] as const : [light.sky[2][0], light.sky[2][1], light.sky[2][2], 1],
      fog: { mode: "exponential", color: light.sky[1], density: daylight === 2 ? 0.009 : 0.0045 },
      ...(clearProbe ? {} : { sky: { mode: "procedural", zenithColor: light.sky[0], horizonColor: light.sky[1], groundColor: light.sky[2], horizonCurve: 0.7, sunAngularRadius: 0.006 } as const }),
    });
    for (const cell of visibleCells(focus, 58)) drawCell(cell, assets, (asset, matrix) => asset.draw(game.frame, matrix));
    const car = assets.get("sedan");
    if (car) {
      const state = vehicle.state;
      const root = compose([state.position[0], state.position[1] - 0.73, state.position[2]], [0, Math.sin(state.yaw / 2), 0, Math.cos(state.yaw / 2)], [1, 1, 1]);
      car.draw(game.frame, root);
      // A deterministic ambient lane loop exercises traffic density and
      // renderer instancing while the reusable TrafficSpawner owns population
      // budgets in a full game simulation.
      for (let index = 0; index < 6; index++) {
        const direction = index % 2 === 0 ? 1 : -1;
        const z = ((((game.time.elapsedSeconds * (5 + index * 0.35) * direction + index * 29) % 260) + 260) % 260) - 130;
        const yaw = direction > 0 ? Math.PI : 0;
        car.draw(game.frame, compose([direction * 3.2, 0.03, z], [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)], [1, 1, 1]), undefined, index % 3 === 0 ? [0.22, 0.34, 0.48, 1] : index % 3 === 1 ? [0.58, 0.16, 0.1, 1] : [0.12, 0.13, 0.15, 1]);
      }
    }
    if (game.audio) game.audio.setListener(camera.slice(12, 15) as [number, number, number], [0, 0, 0], [0, 0, -1], [0, 1, 0]);
    modeLabel.textContent = driving ? "DRIVING" : "ON FOOT";
    speedLabel.textContent = driving ? `${Math.round(Math.abs(vehicle.state.speed) * 3.6)} km/h` : "";
    if (game.stats) statsLabel.textContent = `${game.stats.fps} FPS\n${game.stats.drawCalls} draws · ${game.stats.triangles.toLocaleString()} tris\n${visibleCells(focus, 58).length}/${DISTRICT.length} cells active`;
  },
  afterRender(game: GameContext) {
    if (game.input.action("Capture").justPressed) captureRequested = true;
    if (!captureRequested || capturePending || game.time.frame < 3) return;
    captureRequested = false; capturePending = true;
    void captureScreenshot(game.canvas).then(blob => {
      captureImage.src = URL.createObjectURL(blob);
      captureImage.classList.add("visible");
    }).catch(error => console.warn("Frame capture failed", error)).finally(() => { capturePending = false; });
  },
  stop() { for (const asset of assets.values()) asset.dispose(); assets.clear(); physics?.destroy(); }
};

runtime = new GameRuntime(canvas, hooks, {
  moduleUrl: "/vapour_runtime.js",
  actions: [
    { name: "Forward", kind: "button", bindings: [{ device: "keyboard", code: "KeyW" }] },
    { name: "Backward", kind: "button", bindings: [{ device: "keyboard", code: "KeyS" }] },
    { name: "Left", kind: "button", bindings: [{ device: "keyboard", code: "KeyA" }] },
    { name: "Right", kind: "button", bindings: [{ device: "keyboard", code: "KeyD" }] },
    { name: "Sprint", kind: "button", bindings: [{ device: "keyboard", code: "ShiftLeft" }] },
    { name: "Jump", kind: "button", bindings: [{ device: "keyboard", code: "Space" }] },
    { name: "Enter", kind: "button", bindings: [{ device: "keyboard", code: "KeyE" }] },
    { name: "Brake", kind: "button", bindings: [{ device: "keyboard", code: "KeyS" }] },
    { name: "Handbrake", kind: "button", bindings: [{ device: "keyboard", code: "Space" }] },
    { name: "Time", kind: "button", bindings: [{ device: "keyboard", code: "KeyN" }] },
    { name: "Capture", kind: "button", bindings: [{ device: "keyboard", code: "KeyP" }] },
    { name: "LookX", kind: "delta", bindings: [{ device: "pointer", axis: "x" }] },
    { name: "LookY", kind: "delta", bindings: [{ device: "pointer", axis: "y" }] }
  ],
  onError(error) { loadingText.textContent = error instanceof Error ? error.message : String(error); loading.classList.remove("ready"); console.error(error); }
});
void runtime.start();

function cameraMatrix(focus: readonly [number, number, number], yaw: number, pitch: number, distance: number, height: number): Mat4 {
  const x = focus[0] + Math.sin(yaw) * Math.cos(pitch) * distance;
  const y = focus[1] + height - Math.sin(pitch) * distance;
  const z = focus[2] + Math.cos(yaw) * Math.cos(pitch) * distance;
  return compose([x, y, z], yawPitch(yaw, pitch), [1, 1, 1]);
}
function yawPitch(yaw: number, pitch: number): readonly [number, number, number, number] {
  const sy = Math.sin(yaw / 2), cy = Math.cos(yaw / 2), sx = Math.sin(pitch / 2), cx = Math.cos(pitch / 2);
  return [cy * sx, sy * cx, -sy * sx, cy * cx];
}
