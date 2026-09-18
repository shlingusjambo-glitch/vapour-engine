import {
  GameRuntime,
  VoxelWorld,
  composeMatrix,
  composeTranslation,
  meshVoxelChunk,
  quaternionFromEuler,
  type GameContext,
  type InputActionDefinition,
} from "@vapour/engine";
import { FirstPersonVoxelPlayer } from "./player.js";
import { BLOCK, generateTerrainChunk, palette, terrainHeight } from "./terrain.js";

const CHUNK_RADIUS = 3;
const world = new VoxelWorld({ chunkSize: 16, height: 48 });
const player = new FirstPersonVoxelPlayer(world, palette, [0.5, terrainHeight(0, 0) + 2, 0.5]);
const activeChunks = new Map<string, { readonly x: number; readonly z: number; readonly matrix: Float32Array }>();
const cameraMatrix = new Float32Array(16);
let capturePointer: (() => void) | undefined;
let suppressContextMenu: ((event: Event) => void) | undefined;

const actions: readonly InputActionDefinition[] = [
  { name: "MoveX", kind: "axis", bindings: [
    { device: "keyboard", code: "KeyA", scale: -1 },
    { device: "keyboard", code: "KeyD" },
    { device: "gamepad", gamepad: 0, control: "axis", index: 0, deadZone: 0.16 },
  ] },
  { name: "MoveForward", kind: "axis", bindings: [
    { device: "keyboard", code: "KeyS", scale: -1 },
    { device: "keyboard", code: "KeyW" },
    { device: "gamepad", gamepad: 0, control: "axis", index: 1, scale: -1, deadZone: 0.16 },
  ] },
  { name: "LookX", kind: "axis", bindings: [
    { device: "pointer", axis: "x", scale: 0.0022 },
    { device: "gamepad", gamepad: 0, control: "axis", index: 2, scale: 0.045, deadZone: 0.14 },
  ] },
  { name: "LookY", kind: "axis", bindings: [
    { device: "pointer", axis: "y", scale: 0.0022 },
    { device: "gamepad", gamepad: 0, control: "axis", index: 3, scale: 0.045, deadZone: 0.14 },
  ] },
  { name: "Jump", kind: "button", bindings: [
    { device: "keyboard", code: "Space" },
    { device: "gamepad", gamepad: 0, control: "button", index: 0 },
  ] },
  { name: "Break", kind: "button", bindings: [{ device: "pointer", button: 0 }] },
  { name: "Place", kind: "button", bindings: [{ device: "pointer", button: 2 }] },
];

const canvas = document.querySelector<HTMLCanvasElement>("#vapour-game");
if (canvas === null) throw new Error("CubeGame port needs the Vapour game canvas.");
canvas.style.cursor = "crosshair";

const runtime = new GameRuntime(canvas, {
  start(game) {
    for (let chunkZ = -CHUNK_RADIUS; chunkZ <= CHUNK_RADIUS; chunkZ += 1) {
      for (let chunkX = -CHUNK_RADIUS; chunkX <= CHUNK_RADIUS; chunkX += 1) {
        world.setChunk(chunkX, chunkZ, generateTerrainChunk(world, chunkX, chunkZ));
      }
    }
    remeshDirty(game);
    capturePointer = () => { void game.lockPointer(); };
    suppressContextMenu = (event) => event.preventDefault();
    canvas.addEventListener("click", capturePointer);
    canvas.addEventListener("contextmenu", suppressContextMenu);
  },
  fixedUpdate(game, deltaSeconds) {
    player.fixedUpdate(game, deltaSeconds);
  },
  update(game) {
    player.updateLook(game);
    editTargetedBlock(game);
    remeshDirty(game);

    const eye = player.eye();
    const cameraRotation = quaternionFromEuler([
      player.pitch * 180 / Math.PI,
      player.yaw * 180 / Math.PI,
      0,
    ]);
    composeMatrix(cameraMatrix, eye, cameraRotation, [1, 1, 1]);
    game.frame.setCamera(cameraMatrix, 74, 0.08, 240);
    game.frame.setLight([-0.42, -0.84, -0.34], [1, 0.94, 0.82], 3.2);
    for (const [meshId, chunk] of activeChunks) {
      game.frame.draw(meshId, chunk.matrix, { roughness: 0.92 });
    }
  },
  stop() {
    if (capturePointer !== undefined) canvas.removeEventListener("click", capturePointer);
    if (suppressContextMenu !== undefined) canvas.removeEventListener("contextmenu", suppressContextMenu);
  },
}, { actions, fixedHz: 60, onError: showFatalError });

void runtime.start().catch(showFatalError);

function editTargetedBlock(game: GameContext): void {
  if (!game.pointerLocked) return;
  const target = player.target();
  if (target === undefined) return;
  if (game.input.action("Break").justPressed) {
    world.setBlock(target.x, target.y, target.z, 0);
  }
  if (game.input.action("Place").justPressed) {
    const x = target.x + target.normal[0];
    const y = target.y + target.normal[1];
    const z = target.z + target.normal[2];
    if (!player.overlapsBlock(x, y, z)) world.setBlock(x, y, z, BLOCK.dirt);
  }
}

function remeshDirty(game: GameContext): void {
  for (const coordinate of world.takeDirtyChunks()) {
    const id = meshId(coordinate.x, coordinate.z);
    const chunk = world.chunk(coordinate.x, coordinate.z);
    if (chunk === undefined) {
      activeChunks.delete(id);
      game.releaseMesh(id);
      continue;
    }
    const mesh = meshVoxelChunk(world, palette, coordinate.x, coordinate.z);
    if (mesh.indices.length === 0) {
      activeChunks.delete(id);
      game.releaseMesh(id);
      continue;
    }
    game.uploadMesh(id, mesh);
    const matrix = new Float32Array(16);
    composeTranslation(matrix, coordinate.x * world.chunkSize, 0, coordinate.z * world.chunkSize);
    activeChunks.set(id, { x: coordinate.x, z: coordinate.z, matrix });
  }
}

function meshId(x: number, z: number): string {
  return `cubegame:chunk:${String(x)}:${String(z)}`;
}

function showFatalError(error: unknown): void {
  console.error("CubeGame Vapour port stopped:", error);
  const message = error instanceof Error ? error.message : String(error);
  canvas.replaceWith(Object.assign(document.createElement("pre"), {
    textContent: `CubeGame port could not start.\n\n${message}`,
    style: "margin:0;padding:32px;min-height:100%;box-sizing:border-box;color:#ffb4a0;background:#101315;font:14px/1.6 ui-monospace,monospace;white-space:pre-wrap",
  }));
}
