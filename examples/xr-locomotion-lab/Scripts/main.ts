import { GameRuntime, XrArmLocomotionSolver, XrHandCollisionResolver, XrSessionManager, composeMatrix, createPhysicsWorld3d, quaternionFromEuler, type GameContext, type PhysicsWorld3dBridge, type XrFrameSnapshot, type XrHand, type XrVector3 } from "@vapour/engine";

const canvas = document.querySelector<HTMLCanvasElement>("#vapour-game");
if (canvas === null) throw new Error("XR Locomotion Lab requires #vapour-game.");
const xr = new XrSessionManager();
const locomotion = new XrArmLocomotionSolver({ maxArmLength: 1.5, maxSpeed: 9, maxLaunchSpeed: 7, velocitySamples: 8 });
const camera = new Float32Array(16), model = new Float32Array(16);
let physics: PhysicsWorld3dBridge, collision: XrHandCollisionResolver, latestFrame: XrFrameSnapshot | undefined;
let rig: [number, number, number] = [0, 0, 4], velocity: [number, number, number] = [0, 0, 0], previousFrame = 0, contacts = 0;
const previousHands = new Map<XrHand, XrVector3>(), constrainedHands = new Map<XrHand, XrVector3>();

const enter = document.createElement("button"); enter.textContent = "ENTER VR";
Object.assign(enter.style, { position: "fixed", left: "50%", bottom: "32px", transform: "translateX(-50%)", zIndex: "10", padding: "16px 28px", borderRadius: "12px", border: "1px solid #57d6ff", color: "white", background: "#123349", font: "700 18px system-ui" }); document.body.append(enter);
const status = document.createElement("pre"); Object.assign(status.style, { position: "fixed", left: "16px", top: "16px", zIndex: "10", margin: "0", padding: "12px", color: "#bcecff", background: "#07101dcc", font: "13px monospace", pointerEvents: "none" }); document.body.append(status);

enter.addEventListener("click", async () => { try { enter.disabled = true; enter.textContent = "STARTING XR…"; await xr.start({ mode: "immersive-vr", referenceSpace: "local-floor", optionalFeatures: ["hand-tracking", "bounded-floor"], webGpuPresentation: { clearColor: [0.025, 0.055, 0.08, 1], scaleFactor: 0.8, fallbackToWebGl: true, compatibilitySourceCanvas: canvas } }); await runtime.audio?.unlock(); enter.hidden = true; locomotion.reset(); previousHands.clear(); constrainedHands.clear(); xr.startFrameLoop(processXrFrame); } catch (error) { enter.disabled = false; enter.textContent = "XR FAILED — TAP FOR DETAILS"; showError(error, true); } });
xr.onEnd(() => { enter.hidden = false; enter.textContent = "RE-ENTER VR"; latestFrame = undefined; });

const runtime = new GameRuntime(canvas, {
  async start(game) {
    defineMaterials(game); physics = await createPhysicsWorld3d({ moduleUrl: new URL("vapour_runtime.js", document.baseURI).href });
    collision = new XrHandCollisionResolver(physics, { surfaceSlip: (id) => id === 4 ? 0.7 : id === 5 ? 0.02 : 0.08 });
    for (const body of [
      { id: 1, position: [0, -0.5, 0], halfExtents: [18, 0.5, 18], friction: 0.9 },
      { id: 2, position: [-3, 2, 0], halfExtents: [0.7, 2.5, 0.7], friction: 1 },
      { id: 3, position: [3, 2, -2], halfExtents: [0.8, 3, 0.8], friction: 1 },
      { id: 4, position: [0, 0.2, -5], halfExtents: [3.5, 0.25, 2], friction: 0.05 },
      { id: 5, position: [0, 2.5, -9], halfExtents: [4, 2.5, 0.35], friction: 1 },
    ] as const) physics.insert({ id: body.id, bodyType: "static", position: body.position, rotation: [0, 0, 0, 1], shape: { type: "box", halfExtents: body.halfExtents }, friction: body.friction });
    physics.flush(); game.audio?.defineBus({ id: "contacts", volume: 0.45, compressor: true }); await game.audio?.loadClip("contact", contactTone()).catch(error => console.warn("Contact sound unavailable", error));
  },
  fixedUpdate(_game, dt) { if (!xr.active) return; velocity[1] -= 9.81 * dt; rig = [rig[0] + velocity[0] * dt, Math.max(0, rig[1] + velocity[1] * dt), rig[2] + velocity[2] * dt]; if (rig[1] === 0) velocity[1] = 0; },
  update(game) {
    const orbit = game.time.elapsedSeconds * 7; composeMatrix(camera, [Math.sin(orbit * Math.PI / 180) * 13, 7, Math.cos(orbit * Math.PI / 180) * 13], quaternionFromEuler([-22, orbit, 0]), [1, 1, 1]);
    game.frame.setCamera(camera, 62, 0.05, 100); game.frame.setEnvironment({ clearColor: [0.025, 0.055, 0.08, 1], fog: { color: [0.08, 0.18, 0.2], mode: "linear", near: 18, far: 55 } }); game.frame.lights.addAmbient([0.18, 0.3, 0.36], 1.4); game.frame.lights.addDirectional([-0.4, -0.8, -0.2], [1, 0.83, 0.6], 4);
    draw(game, [0, -0.5, 0], [36, 1, 36], "ground"); draw(game, [-3, 2, 0], [1.4, 5, 1.4], "bark"); draw(game, [3, 2, -2], [1.6, 6, 1.6], "bark"); draw(game, [0, 0.2, -5], [7, 0.5, 4], "ice", [0, 0, -18]); draw(game, [0, 2.5, -9], [8, 5, 0.7], "grip"); draw(game, [rig[0], rig[1] + 1, rig[2]], [0.55, 1.4, 0.4], "player");
    for (const [hand, position] of constrainedHands) draw(game, add(position, rig), [0.14, 0.14, 0.14], hand);
    status.textContent = `VAPOUR XR LOCOMOTION LAB\nXR: ${xr.active ? "ACTIVE" : "READY"}\nSpace: ${xr.referenceSpaceType ?? "none"}\nWebGPU: ${navigator.gpu ? "YES" : "NO"}\nViews: ${latestFrame?.views.length ?? 0}\nControllers: ${latestFrame?.inputs.length ?? 0}\nContacts: ${contacts}\nRig: ${rig.map(v => v.toFixed(2)).join(", ")}\n\nPush against the floor, trunks, ice ramp,\nand high-grip wall. Errors appear here.`;
  }, stop() { void xr.end(); physics?.destroy(); },
}, { moduleUrl: new URL("vapour_runtime.js", document.baseURI).href, fixedHz: 72, onError: showError }); void runtime.start();

function processXrFrame(frame: XrFrameSnapshot): void {
  latestFrame = frame; const head = translation(frame.viewerTransform), hands: { hand: XrHand; position: XrVector3; tracked: boolean }[] = [], contactMap: Partial<Record<XrHand, { touching: boolean; point?: XrVector3; normal?: XrVector3; bodyId?: number }>> = {};
  for (const input of frame.inputs) { if (input.handedness !== "left" && input.handedness !== "right") continue; const matrix = input.gripTransform ?? input.targetRayTransform; if (matrix === undefined) continue; const hand = input.handedness, position = translation(matrix), previous = previousHands.get(hand) ?? position, delta = subtract(position, previous); hands.push({ hand, position, tracked: true }); const hit = collision.resolve(previous, delta, 0.055, hands.length < 2); previousHands.set(hand, position); constrainedHands.set(hand, hit?.constrainedPosition ?? position); if (hit !== undefined) { contactMap[hand] = hit; contacts++; if (contacts % 8 === 1) { void xr.pulse(hand, 0.35, 18); try { runtime.audio?.play("contact", { bus: "contacts", volume: 0.2, pitch: 0.9 + Math.min(0.5, Math.hypot(...delta) * 8), position: add(hit.constrainedPosition, rig), distanceModel: "linear", minDistance: 0.2, maxDistance: 8 }); } catch { /* optional audio is independently diagnosed */ } } } }
  const dt = previousFrame === 0 ? 1 / 72 : Math.max(1 / 120, Math.min(1 / 30, (frame.time - previousFrame) / 1000)); previousFrame = frame.time;
  const movement = locomotion.sample({ deltaSeconds: dt, headPosition: head, hands, contacts: contactMap }); rig = add(rig, movement.translation); if (movement.launchVelocity.some(v => v !== 0)) velocity = [...movement.launchVelocity];
}
function draw(game: GameContext, position: XrVector3, scale: XrVector3, material: string, rotation: XrVector3 = [0, 0, 0]): void { composeMatrix(model, position, quaternionFromEuler([rotation[0], rotation[1], rotation[2]]), scale); game.frame.draw("builtin:cube", model, { material: `lab:${material}`, roughness: material === "ice" ? 0.12 : 0.85, metallic: material === "ice" ? 0.2 : 0 }); }
function defineMaterials(game: GameContext): void { const colors: Record<string, readonly [number, number, number, number]> = { ground: [0.1, 0.28, 0.18, 1], bark: [0.34, 0.16, 0.06, 1], ice: [0.24, 0.72, 0.9, 0.8], grip: [0.5, 0.22, 0.12, 1], player: [0.45, 0.2, 0.75, 1], left: [0.2, 0.75, 1, 1], right: [1, 0.35, 0.18, 1] }; for (const [id, color] of Object.entries(colors)) game.defineMaterial(`lab:${id}`, { baseColor: color, alphaMode: id === "ice" ? "blend" : "opaque", depthWrite: id !== "ice" }); }
function translation(m: Float32Array): XrVector3 { return [m[12]!, m[13]!, m[14]!]; } function add(a: XrVector3, b: XrVector3): [number, number, number] { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; } function subtract(a: XrVector3, b: XrVector3): [number, number, number] { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function showError(error: unknown, notify = false): void { const message = error instanceof Error ? error.stack ?? error.message : String(error); status.textContent = `VAPOUR XR ERROR\n\n${message}`; console.error(error); if (notify) alert(`Vapour XR could not enter immersive mode:\n\n${message}`); }
function contactTone(): string { const rate = 8000, samples = 240, bytes = new Uint8Array(44 + samples * 2), view = new DataView(bytes.buffer), text = (at: number, value: string) => [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0))); text(0, "RIFF"); view.setUint32(4, 36 + samples * 2, true); text(8, "WAVEfmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, samples * 2, true); for (let i = 0; i < samples; i++) view.setInt16(44 + i * 2, Math.sin(i / rate * Math.PI * 2 * 150) * 6000 * (1 - i / samples), true); return URL.createObjectURL(new Blob([bytes], { type: "audio/wav" })); }
