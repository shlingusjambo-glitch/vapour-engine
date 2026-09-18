import { GameRuntime, GradientNoise, TerrainHeightfield, UiDocument, composeMatrix, composeUi2D, createPhysicsWorld3d, importBrowserFont, importGltf, quaternionFromEuler, type FontAtlas, type GameContext, type PhysicsBodySnapshot3d, type PhysicsWorld3dBridge, type SpriteAsset, type UiRenderBatch2D } from "@vapour/engine";
import { pulse } from "./heartbeat.vs";

const canvas = document.querySelector<HTMLCanvasElement>("#vapour-game");
if (canvas === null) throw new Error("Alpha 0.2 acceptance project requires #vapour-game.");
const noise = new GradientNoise("vapour-alpha-0.2");
const terrain = TerrainHeightfield.generate(33, 33, [48, 5, 48], (x, z) => noise.fbm2D(x * 3.2, z * 3.2, { octaves: 5, gain: 0.52 }) * 0.5 + Math.sin(x * Math.PI * 2) * 0.08, [12, 12]);
const cameraMatrix = new Float32Array(16), modelMatrix = new Float32Array(16);
const overlayCamera = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 8, 1]);
const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
let physics: PhysicsWorld3dBridge, bodies: readonly PhysicsBodySnapshot3d[] = [], font: FontAtlas, uiBatches: readonly UiRenderBatch2D[] = [];
let uiWidth = 0, uiHeight = 0, cameraYaw = 0, cameraDistance = 22, lastImpact = "Native heightfield ready";

const runtime = new GameRuntime(canvas, {
  async start(game) {
    game.uploadMesh("acceptance:terrain", terrain.mesh()); uploadPalette(game); await uploadImportedTriangle(game);
    const imported = await importBrowserFont({ id: "font:acceptance", material: "material:font", family: "sans-serif", characters: "Vapour Alpha 0.2Native terrain + physicsTypeScript + VS togetherWheel zoom + arrow orbitCollision callback at 0123456789.s", designSize: 44, atlasWidth: 1024, sdfRadius: 7, fallbackCharacter: " " });
    font = imported.font; game.uploadTexture(imported.textureId, imported.texture); game.defineMaterial(font.material, imported.material);
    physics = await createPhysicsWorld3d({ moduleUrl: new URL("vapour_runtime.js", document.baseURI).href });
    physics.insert({ id: 1, bodyType: "static", position: [0, 0, 0], rotation: [0, 0, 0, 1], shape: terrain.collider(), friction: 0.85 });
    physics.insert({ id: 2, bodyType: "dynamic", position: [0, 9, 0], rotation: [0, 0, 0, 1], shape: { type: "sphere", radius: 0.75 }, restitution: 0.72, continuousCollisionDetection: true }); physics.flush();
    game.audio?.defineBus({ id: "impacts", volume: 0.35, compressor: true }); try { await game.audio?.loadClip("impact", toneUrl()); } catch (error) { console.warn("Optional acceptance sound could not load", error); }
  },
  fixedUpdate(game, delta) {
    const step = physics.step(delta); bodies = step.bodies;
    for (const event of step.events) if (event.kind === "collisionEnter" && (event.bodyA === 2 || event.bodyB === 2)) { lastImpact = `Collision callback at ${game.time.elapsedSeconds.toFixed(2)}s`; try { const voice = game.audio?.play("impact", { bus: "impacts", volume: 0.25, pitch: 0.8 }); voice?.setPitch(0.8 + pulse(game.time.elapsedSeconds) * 0.4); } catch { /* browser audio policy */ } uiWidth = 0; }
  },
  update(game) {
    cameraYaw += game.input.action("Orbit").value; cameraDistance = Math.max(10, Math.min(36, cameraDistance + game.input.action("Zoom").value));
    composeMatrix(cameraMatrix, [Math.sin(cameraYaw * Math.PI / 180) * cameraDistance, 10, Math.cos(cameraYaw * Math.PI / 180) * cameraDistance], quaternionFromEuler([-22, cameraYaw, 0]), [1, 1, 1]);
    game.frame.setCamera(cameraMatrix, 58, 0.1, 150); game.frame.setEnvironment({ clearColor: [0.025, 0.035, 0.065, 1], fog: { color: [0.1, 0.18, 0.28], mode: "linear", near: 30, far: 90 } }); game.frame.lights.addAmbient([0.2, 0.34, 0.55], 1.1); game.frame.lights.addDirectional([-0.35, -0.82, -0.44], [1, 0.83, 0.62], 4.2);
    game.frame.draw("acceptance:terrain", IDENTITY, { material: "material:terrain", roughness: 0.96 });
    const ball = bodies.find((body) => body.id === 2); if (ball !== undefined) { composeMatrix(modelMatrix, ball.position, ball.rotation, [1.5, 1.5, 1.5]); game.frame.draw("builtin:sphere", modelMatrix, { color: [0.28, 0.72, 1, 1], metallic: 0.55, roughness: 0.2, emissive: pulse(game.time.elapsedSeconds) * 0.12 }); }
    composeMatrix(modelMatrix, [0, 4.5, -4], quaternionFromEuler([0, game.time.elapsedSeconds * 35, 0]), [3, 3, 3]); game.frame.draw("acceptance:gltf-triangle", modelMatrix, { material: "material:signal", emissive: pulse(game.time.elapsedSeconds) * 1.5 });
    rebuildUi(game); game.overlay.setOrthographicCamera(overlayCamera, game.height / 100, 0.1, 100); game.overlay.lights.addAmbient([1, 1, 1], 2); for (const batch of uiBatches) game.overlay.draw(batch.id, IDENTITY, { material: batch.material, roughness: 1 });
  },
  stop() { physics?.destroy(); },
}, { moduleUrl: new URL("vapour_runtime.js", document.baseURI).href, fixedHz: 60, actions: [{ name: "Orbit", kind: "axis", bindings: [{ device: "keyboard", code: "ArrowLeft", scale: -1 }, { device: "keyboard", code: "ArrowRight" }] }, { name: "Zoom", kind: "delta", bindings: [{ device: "pointer", axis: "wheelY", scale: 0.012 }] }], onError(error) { const message = error instanceof Error ? error.stack ?? error.message : String(error); canvas.replaceWith(Object.assign(document.createElement("pre"), { textContent: `Vapour Alpha 0.2 acceptance failed\n\n${message}` })); } });
void runtime.start();

function rebuildUi(game: GameContext): void {
  if (game.width === uiWidth && game.height === uiHeight) return; uiWidth = game.width; uiHeight = game.height;
  const ui = new UiDocument({ id: "root", role: "panel", style: { padding: 22, align: "start" }, children: [{ id: "card", role: "panel", style: { width: "content", height: "content", padding: 15, gap: 7 }, children: [{ id: "title", role: "text", intrinsicSize: [330, 34] }, { id: "runtime", role: "text", intrinsicSize: [330, 25] }, { id: "script", role: "text", intrinsicSize: [330, 25] }, { id: "input", role: "text", intrinsicSize: [330, 25] }, { id: "event", role: "text", intrinsicSize: [330, 25] }] }] }); ui.layout(game.width, game.height);
  const panel: SpriteAsset = { id: "panel", material: "material:panel", textureSize: [1, 1], rect: [0, 0, 1, 1] };
  uiBatches = composeUi2D(ui, { card: { background: panel, backgroundColor: [0.035, 0.055, 0.1, 0.94] }, title: { text: "Vapour Alpha 0.2", font, fontSize: 27, textColor: [0.4, 0.84, 1, 1] }, runtime: { text: "Native terrain + physics", font, fontSize: 17 }, script: { text: "TypeScript + VS together", font, fontSize: 17 }, input: { text: "Wheel zoom + arrow orbit", font, fontSize: 17 }, event: { text: lastImpact, font, fontSize: 15, textColor: [1, 0.73, 0.4, 1] } }, [game.width, game.height], 100, "acceptance-ui"); for (const batch of uiBatches) game.uploadMesh(batch.id, batch.mesh);
}
function uploadPalette(game: GameContext): void { for (const [id, color, blend] of [["terrain", [44, 112, 86, 255], false], ["signal", [45, 185, 255, 255], false], ["panel", [10, 18, 34, 240], true]] as const) { game.uploadTexture(`texture:${id}`, { width: 1, height: 1, pixels: Uint8Array.from(color), colorSpace: "srgb" }); game.defineMaterial(`material:${id}`, { textures: { baseColor: `texture:${id}` }, alphaMode: blend ? "blend" : "opaque", depthWrite: !blend, doubleSided: true, addressMode: "repeat" }); } }
async function uploadImportedTriangle(game: GameContext): Promise<void> { const bytes = new ArrayBuffer(36), view = new DataView(bytes); [-1, -1, 0, 1, -1, 0, 0, 1, 0].forEach((value, index) => view.setFloat32(index * 4, value, true)); const encoded = btoa(String.fromCharCode(...new Uint8Array(bytes))); const model = await importGltf(JSON.stringify({ asset: { version: "2.0" }, buffers: [{ uri: `data:application/octet-stream;base64,${encoded}`, byteLength: 36 }], bufferViews: [{ buffer: 0, byteLength: 36 }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3" }], meshes: [{ name: "Acceptance", primitives: [{ attributes: { POSITION: 0 } }] }] }), { sourceName: "acceptance-inline.gltf" }); game.uploadMesh("acceptance:gltf-triangle", model.primitives[0]!.mesh); }
function toneUrl(): string { const rate = 8000, samples = 520, bytes = new Uint8Array(44 + samples * 2), view = new DataView(bytes.buffer); const text = (offset: number, value: string) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0))); text(0, "RIFF"); view.setUint32(4, 36 + samples * 2, true); text(8, "WAVEfmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, samples * 2, true); for (let index = 0; index < samples; index += 1) view.setInt16(44 + index * 2, Math.sin(index / rate * Math.PI * 2 * 220) * 7000 * (1 - index / samples), true); return URL.createObjectURL(new Blob([bytes], { type: "audio/wav" })); }
