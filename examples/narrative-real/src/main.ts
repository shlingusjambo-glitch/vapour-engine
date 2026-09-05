import "./style.css";
import {
  GameRuntime,
  NarrativeRunner,
  SaveDatabase,
  TypewriterText,
  UiDocument,
  composeUi2D,
  importBrowserFont,
  type FontAtlas,
  type GameContext,
  type NarrativeProgram,
  type NarrativeSnapshot,
  type SpriteAsset,
  type UiRenderBatch2D,
} from "@vapour/engine";

const canvas = requireElement<HTMLCanvasElement>("game");
const loading = requireElement<HTMLDivElement>("loading");
const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const CAMERA = new Float32Array(IDENTITY); CAMERA[14] = 10;
const PPU = 100;
const saves = new SaveDatabase<"slots">({ name: "vapour-paper-hearts", version: 1, stores: ["slots"], diagnostic: (message, error) => console.warn(message, error) });
const story = new NarrativeRunner(program());
let typewriter = new TypewriterText(currentText(), 48);
let font: FontAtlas;
let ui: UiDocument;
let batches: readonly UiRenderBatch2D[] = [];
let choiceIndex = 0;
let dirty = true;
let lastWidth = 0;
let lastHeight = 0;
let notice = "";
let noticeUntil = 0;

const runtime = new GameRuntime(canvas, {
  async start(game) {
    uploadPalette(game);
    const characters = [...new Set((allStoryText() + "Paper HeartsSave loaded.Game saved.The End↑↓•—'!?.,:;()0123456789").split(""))].join("");
    const imported = await importBrowserFont({ id: "font:story", material: "material:font", family: "Arial", characters, designSize: 52, atlasWidth: 1024, sdfRadius: 8, fallbackCharacter: "?" });
    font = imported.font; game.uploadTexture(imported.textureId, imported.texture); game.defineMaterial(font.material, imported.material);
    game.audio?.defineBus({ id: "music", volume: 0.35, compressor: true }); game.audio?.defineBus({ id: "ui", volume: 0.7 });
    try { await game.audio?.loadClip("ui:advance", clickSoundUrl()); } catch (error) { console.warn("Optional UI sound could not load", error); }
    await saves.open(); rebuild(game); loading.classList.add("ready");
  },
  update(game, delta) {
    handleInput(game);
    if (story.view.type === "line" && !typewriter.complete) { const before = typewriter.text; typewriter.update(delta); if (before !== typewriter.text) dirty = true; }
    if (game.width !== lastWidth || game.height !== lastHeight) dirty = true;
    if (notice && game.time.elapsedSeconds >= noticeUntil) { notice = ""; dirty = true; }
    if (dirty) rebuild(game);
    game.frame.setOrthographicCamera(CAMERA, game.height / PPU, 0.1, 100);
    game.frame.setEnvironment({ clearColor: [0.035, 0.02, 0.07, 1] });
    game.frame.lights.addAmbient([1, 1, 1], 3);
    for (const batch of batches) game.frame.draw(batch.id, IDENTITY, { material: batch.material, roughness: 1 });
  },
  stop() { saves.close(); },
}, {
  moduleUrl: new URL("vapour_runtime.js", document.baseURI).href,
  actions: [
    { name: "Advance", kind: "button", bindings: [{ device: "keyboard", code: "Space" }, { device: "keyboard", code: "Enter" }] },
    { name: "Pointer", kind: "button", bindings: [{ device: "pointer", button: 0 }] },
    { name: "Previous", kind: "button", bindings: [{ device: "keyboard", code: "ArrowUp" }] },
    { name: "Next", kind: "button", bindings: [{ device: "keyboard", code: "ArrowDown" }] },
    { name: "Rollback", kind: "button", bindings: [{ device: "keyboard", code: "Backspace" }] },
    { name: "Save", kind: "button", bindings: [{ device: "keyboard", code: "KeyS" }] },
    { name: "Load", kind: "button", bindings: [{ device: "keyboard", code: "KeyL" }] },
  ],
  onError(error) { loading.textContent = error instanceof Error ? error.message : String(error); loading.classList.remove("ready"); },
});

void runtime.start();

function handleInput(game: GameContext): void {
  const pointer = pointerInCanvas(game);
  if (game.input.action("Pointer").justPressed) ui.pointerDown(pointer[0], pointer[1]);
  if (game.input.action("Pointer").justReleased) { ui.pointerUp(pointer[0], pointer[1]); for (const action of ui.drainActions()) if (action.type === "click") activate(action.id, game); }
  if (story.view.type === "choice") {
    if (game.input.action("Previous").justPressed) { choiceIndex = (choiceIndex - 1 + story.view.options.length) % story.view.options.length; focusChoice(); dirty = true; }
    if (game.input.action("Next").justPressed) { choiceIndex = (choiceIndex + 1) % story.view.options.length; focusChoice(); dirty = true; }
  }
  if (game.input.action("Advance").justPressed) story.view.type === "choice" ? choose(story.view.options[choiceIndex]!.id, game) : advance(game);
  if (game.input.action("Rollback").justPressed && story.canRollback) { story.rollback(); resetView(); }
  if (game.input.action("Save").justPressed) { void saves.put("slots", "quick", story.snapshot()).then(() => showNotice(game, "Game saved.")); }
  if (game.input.action("Load").justPressed) { void saves.get<NarrativeSnapshot>("slots", "quick").then((snapshot) => { if (snapshot) { story.restore(snapshot); resetView(); showNotice(game, "Save loaded."); } }); }
}

function activate(id: string, game: GameContext): void { if (id.startsWith("choice:")) choose(id.slice(7), game); else if (id === "dialogue") advance(game); }
function advance(game: GameContext): void { if (story.view.type === "line" && !typewriter.complete) { typewriter.completeNow(); dirty = true; return; } if (story.view.type !== "end") story.advance(); resetView(); playClick(game); }
function choose(id: string, game: GameContext): void { story.choose(id); choiceIndex = 0; resetView(); playClick(game); }
function playClick(game: GameContext): void { try { game.audio?.play("ui:advance", { bus: "ui", volume: 0.25 }); } catch { /* optional sound */ } }
function resetView(): void { typewriter = new TypewriterText(currentText(), 48); dirty = true; }
function currentText(): string { const view = story.view; return view.type === "line" ? view.text : view.type === "choice" ? view.prompt ?? "Choose:" : view.type === "end" ? `The End — ${view.ending ?? "Fin"}` : ""; }
function showNotice(game: GameContext, text: string): void { notice = text; noticeUntil = game.time.elapsedSeconds + 2; dirty = true; }

function rebuild(game: GameContext): void {
  lastWidth = Math.max(1, game.width); lastHeight = Math.max(1, game.height);
  const view = story.view; const options = view.type === "choice" ? view.options : [];
  ui = new UiDocument({ id: "root", role: "panel", style: { direction: "column" }, children: [
    { id: "stage", role: "panel", style: { height: "fill", direction: "row", justify: "center", align: "end", padding: [30, 30, 0, 30] }, children: [{ id: "portrait", role: "image", style: { width: Math.min(360, lastWidth * 0.35), height: "fill", maxHeight: 560 } }] },
    { id: "dialogue", role: "button", style: { height: Math.min(270, lastHeight * 0.38), padding: [16, 28, 18, 28], gap: 8 }, children: [
      { id: "speaker", role: "text", style: { height: 32 } },
      { id: "body", role: "text", style: { height: "fill" } },
      ...options.map((option) => ({ id: `choice:${option.id}`, role: "button" as const, style: { height: 38 } })),
    ] },
  ] });
  ui.layout(lastWidth, lastHeight);
  const portrait = portraitFor(view.type === "line" ? view.portrait : undefined);
  const visuals: Record<string, Parameters<typeof composeUi2D>[1][string]> = {
    root: { background: sceneAsset(story.getVariable("scene") === "roof" ? "roof" : "club") },
    portrait: { background: portrait }, dialogue: { background: PANEL },
    speaker: { text: view.type === "line" ? view.speaker ?? "" : notice, font, fontSize: 24, textColor: [1, 0.64, 0.82, 1] },
    body: { text: typewriter.text, font, fontSize: 25, textColor: [1, 0.97, 1, 1], textPadding: 2 },
  };
  options.forEach((option, index) => { visuals[`choice:${option.id}`] = { background: index === choiceIndex ? CHOICE_ACTIVE : CHOICE, text: `${index === choiceIndex ? "•" : ""} ${option.text}`, font, fontSize: 20, textColor: [1, 1, 1, 1], textPadding: 7 }; });
  batches = composeUi2D(ui, visuals, [lastWidth, lastHeight], PPU, "narrative-ui");
  for (const batch of batches) game.uploadMesh(batch.id, batch.mesh);
  focusChoice(); dirty = false;
}

function focusChoice(): void { const view = story.view; if (view.type === "choice") ui.focus(`choice:${view.options[choiceIndex]!.id}`); }
function pointerInCanvas(game: GameContext): [number, number] { const rect = game.canvas.getBoundingClientRect(); return [(game.input.pointerPosition.x - rect.left) * game.width / Math.max(1, rect.width), (game.input.pointerPosition.y - rect.top) * game.height / Math.max(1, rect.height)]; }

const PANEL: SpriteAsset = { id: "panel", material: "material:panel", textureSize: [8, 8], rect: [0, 0, 8, 8], border: [3, 3, 3, 3] };
const CHOICE: SpriteAsset = { id: "choice", material: "material:choice", textureSize: [8, 8], rect: [0, 0, 8, 8], border: [3, 3, 3, 3] };
const CHOICE_ACTIVE: SpriteAsset = { id: "choice-active", material: "material:choice-active", textureSize: [8, 8], rect: [0, 0, 8, 8], border: [3, 3, 3, 3] };
function sceneAsset(id: "club" | "roof"): SpriteAsset { return { id, material: `material:${id}`, textureSize: [1, 1], rect: [0, 0, 1, 1] }; }
function portraitFor(id: string | undefined): SpriteAsset { const name = id === "mira" ? "mira" : "ren"; return { id: name, material: `material:${name}`, textureSize: [64, 128], rect: [0, 0, 64, 128], pixelsPerUnit: 64, pivot: [0.5, 0] }; }

function uploadPalette(game: GameContext): void {
  const definitions: Array<[string, [number, number, number, number], boolean]> = [["club", [62, 43, 92, 255], false], ["roof", [28, 54, 94, 255], false], ["panel", [23, 13, 38, 235], true], ["choice", [84, 49, 103, 225], true], ["choice-active", [190, 76, 139, 245], true]];
  for (const [id, rgba, blend] of definitions) { game.uploadTexture(`texture:${id}`, { width: id === "panel" || id.startsWith("choice") ? 8 : 1, height: id === "panel" || id.startsWith("choice") ? 8 : 1, pixels: solid(id === "panel" || id.startsWith("choice") ? 8 : 1, rgba), colorSpace: "srgb" }); game.defineMaterial(`material:${id}`, { textures: { baseColor: `texture:${id}` }, alphaMode: blend ? "blend" : "opaque", doubleSided: true, depthWrite: !blend, addressMode: "clamp" }); }
  for (const [id, colors] of [["ren", [[67, 46, 92, 255], [244, 177, 196, 255]]], ["mira", [[45, 75, 105, 255], [247, 194, 158, 255]]]] as const) { game.uploadTexture(`texture:${id}`, { width: 64, height: 128, pixels: portraitTexture(colors[0], colors[1]), colorSpace: "srgb" }); game.defineMaterial(`material:${id}`, { textures: { baseColor: `texture:${id}` }, alphaMode: "blend", doubleSided: true, depthWrite: false, addressMode: "clamp", filter: "linear" }); }
}
function solid(size: number, color: readonly number[]): Uint8Array { const output = new Uint8Array(size * size * 4); for (let index = 0; index < size * size; index++) output.set(color, index * 4); return output; }
function portraitTexture(clothes: readonly number[], skin: readonly number[]): Uint8Array { const output = new Uint8Array(64 * 128 * 4); for (let y = 0; y < 128; y++) for (let x = 0; x < 64; x++) { const head = ((x - 32) / 18) ** 2 + ((y - 32) / 25) ** 2 < 1; const body = y > 54 && Math.abs(x - 32) < 18 + (y - 54) * 0.2; const color = head ? skin : body ? clothes : [0, 0, 0, 0]; output.set(color, (y * 64 + x) * 4); } return output; }

function program(): NarrativeProgram { return { id: "paper-hearts", version: 1, start: "welcome", nodes: [
  { id: "welcome", type: "line", speaker: "Ren", portrait: "ren", text: { text: "You came. I wasn't sure the invitation would survive the rain." }, next: "answer" },
  { id: "answer", type: "choice", prompt: { text: "The empty literature room smells like paper and summer rain." }, options: [{ id: "warm", text: { text: "I wouldn't miss it." }, next: "warm-set" }, { id: "guarded", text: { text: "I was only curious." }, next: "guard-set" }] },
  { id: "warm-set", type: "set", variable: "trust", value: 2, next: "warm" }, { id: "guard-set", type: "set", variable: "trust", value: 0, next: "guarded" },
  { id: "warm", type: "line", speaker: "Ren", portrait: "ren", text: { text: "Then maybe this little club has a chance after all." }, next: "mira" },
  { id: "guarded", type: "line", speaker: "Ren", portrait: "ren", text: { text: "Curiosity is enough. Every good story begins there." }, next: "mira" },
  { id: "mira", type: "line", speaker: "Mira", portrait: "mira", text: { text: "Rules meeting on the roof! Bring one honest sentence." }, next: "scene-roof" },
  { id: "scene-roof", type: "set", variable: "scene", value: "roof", next: "roof" },
  { id: "roof", type: "line", speaker: "Mira", portrait: "mira", text: { text: "The city looks editable from up here, doesn't it?" }, next: "final-choice" },
  { id: "final-choice", type: "choice", prompt: { text: "What will your first sentence be?" }, options: [{ id: "together", text: { text: "We can write the next chapter together." }, next: "trust-check" }, { id: "alone", text: { text: "Some stories need a quiet beginning." }, next: "quiet-end" }] },
  { id: "trust-check", type: "branch", condition: { variable: "trust", operator: "greater-or-equal", value: 2 }, then: "bright-end", otherwise: "hope-end" },
  { id: "bright-end", type: "line", speaker: "Ren", portrait: "ren", text: { text: "Together, then. No erased pages." }, next: "end-bright" }, { id: "end-bright", type: "end", ending: "A Shared Chapter" },
  { id: "hope-end", type: "line", speaker: "Ren", portrait: "ren", text: { text: "Maybe not today. But leave a blank page for me." }, next: "end-hope" }, { id: "end-hope", type: "end", ending: "An Open Page" },
  { id: "quiet-end", type: "end", ending: "A Quiet Beginning" },
] }; }
function allStoryText(): string { return program().nodes.flatMap((node) => node.type === "line" ? [node.text.text, node.speaker ?? ""] : node.type === "choice" ? [node.prompt?.text ?? "", ...node.options.map((option) => option.text.text)] : node.type === "end" ? [node.ending ?? ""] : []).join(""); }
function clickSoundUrl(): string { const rate = 8000; const samples = 480; const bytes = new Uint8Array(44 + samples * 2); const view = new DataView(bytes.buffer); const write = (offset: number, text: string) => [...text].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0))); write(0, "RIFF"); view.setUint32(4, 36 + samples * 2, true); write(8, "WAVEfmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, "data"); view.setUint32(40, samples * 2, true); for (let index = 0; index < samples; index++) view.setInt16(44 + index * 2, Math.sin(index / rate * Math.PI * 2 * 520) * 5000 * (1 - index / samples), true); return URL.createObjectURL(new Blob([bytes], { type: "audio/wav" })); }
function requireElement<T extends HTMLElement>(id: string): T { const element = document.getElementById(id); if (element === null) throw new Error(`Narrative sample is missing #${id}.`); return element as T; }
