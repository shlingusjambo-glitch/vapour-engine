import {
  ComponentSchemaRegistry,
  SceneDocument,
  WebGpuRenderHost,
  builtinComponentSchemas,
  computeWorldMatrices,
  createComponentRecord,
  defaultTransform,
  detectBrowserCapabilities,
  diagnoseCapabilities,
  eulerFromQuaternion,
  meshLibrary,
  quaternionFromEuler,
  quaternionFromMatrix,
  type ComponentSchema,
  type RenderStats,
  type RustRenderCapabilities,
  type SceneEntityData,
  type TransformData,
} from "@vapour/engine";
import "./style.css";
import { HubController, type HubProject } from "./hub.js";
import { History } from "./history.js";
import { ComponentInspector } from "./inspector.js";
import { MenuBar, applyTheme, loadTheme, type Theme } from "./menus.js";
import { ViewportController, type TransformSpace, type TransformTool } from "./viewport.js";

type LogLevel = "info" | "warning" | "error";

const AUTOSAVE_INTERVAL_MS = 15_000;
const SCENE_STORAGE_KEY = "vapour.editor.scene";

const registry = new ComponentSchemaRegistry(builtinComponentSchemas());
const history = new History();

let scene = loadInitialScene();
let selection: string[] = [];
let dirty = false;
let playing = false;
let theme: Theme = applyTheme(loadTheme());
let tool: TransformTool = "select";
let space: TransformSpace = "local";
let renderHost: WebGpuRenderHost | undefined;
let currentProject: HubProject | undefined;
let worldMatrices = new Map<string, number[]>();
const collapsed = new Set<string>();

const element = {
  hierarchy: require$<HTMLDivElement>("#hierarchy"),
  inspector: require$<HTMLFormElement>("#inspector"),
  inspectorEmpty: require$<HTMLDivElement>("#inspector-empty"),
  inspectorNote: require$<HTMLElement>("#inspector-note"),
  componentList: require$<HTMLDivElement>("#component-list"),
  entityName: require$<HTMLInputElement>("#entity-name"),
  entityEnabled: require$<HTMLInputElement>("#entity-enabled"),
  saveState: require$<HTMLElement>("#save-state"),
  status: require$<HTMLElement>("#status-message"),
  selectionSummary: require$<HTMLElement>("#selection-summary"),
  search: require$<HTMLInputElement>("#hierarchy-search"),
  consoleTab: require$<HTMLDivElement>("#console-tab"),
  consoleCount: require$<HTMLElement>("#console-count"),
  canvas: require$<HTMLCanvasElement>("#viewport"),
  gizmoLayer: document.querySelector<SVGSVGElement>("#gizmo-layer") ?? missing("#gizmo-layer"),
  assetGrid: require$<HTMLDivElement>("#asset-grid"),
  createEntityDialog: require$<HTMLDialogElement>("#create-entity-dialog"),
  addComponentDialog: require$<HTMLDialogElement>("#add-component-dialog"),
  componentSearch: require$<HTMLInputElement>("#component-search"),
  componentPicker: require$<HTMLDivElement>("#component-picker-list"),
  createSearch: require$<HTMLInputElement>("#create-search"),
  createPicker: require$<HTMLDivElement>("#create-picker-list"),
  spaceToggle: require$<HTMLButtonElement>("#transform-space"),
  snapToggle: require$<HTMLInputElement>("#grid-snap"),
  gridStep: require$<HTMLInputElement>("#grid-step"),
  angleStep: require$<HTMLInputElement>("#angle-step"),
};

const viewport = new ViewportController(element.canvas, element.gizmoLayer, {
  snapshot: () => renderHost?.snapshot(),
  worldMatrix: (entityId) => worldMatrices.get(entityId),
  parentWorldMatrix: (entityId) => {
    const parent = scene.entity(entityId)?.parent;
    return parent === undefined ? undefined : worldMatrices.get(parent);
  },
  localTransform: (entityId) => readTransform(entityId),
  applyTransform: (entityId, transform, gestureKey) => {
    const before = readTransform(entityId);
    if (before === undefined) return;
    history.perform(
      "Transform",
      () => { scene.setTransform(entityId, before); },
      () => { scene.setTransform(entityId, transform); },
      gestureKey,
    );
  },
  endGesture: () => history.endGesture(),
  selection: () => selection,
  select: (entityId, additive) => {
    if (entityId === undefined) setSelection(additive ? selection : []);
    else if (!additive) setSelection([entityId]);
    else setSelection(selection.includes(entityId) ? selection.filter((id) => id !== entityId) : [...selection, entityId]);
  },
  tool: () => tool,
  space: () => space,
  snapping: () => ({
    enabled: element.snapToggle.checked,
    gridStep: Math.max(0.001, Number(element.gridStep.value) || 0.5),
    angleStep: Math.max(1, Number(element.angleStep.value) || 15),
  }),
  onCameraMoved: () => {
    renderHost?.setViewer(viewport.camera.snapshot());
  },
  reportError: (message) => log(message, "error"),
});

const inspector = new ComponentInspector(element.componentList, registry, {
  setComponentData: (entityId, typeName, data, gestureKey) => {
    const before = structuredClone(scene.entity(entityId)?.components.find((c) => c.typeName === typeName)?.data);
    history.perform(
      "Edit component",
      () => { scene.updateComponentData(entityId, typeName, before); },
      () => { scene.updateComponentData(entityId, typeName, data); },
      gestureKey,
    );
  },
  removeComponent: (entityId, typeName) => {
    const component = scene.entity(entityId)?.components.find((c) => c.typeName === typeName);
    if (component === undefined) return;
    const snapshot = structuredClone(component);
    history.perform(
      `Remove ${registry.get(typeName)?.label ?? typeName}`,
      () => { scene.addComponent(entityId, snapshot); },
      () => { scene.removeComponent(entityId, typeName); },
    );
  },
  endGesture: () => history.endGesture(),
  reportError: (message) => log(message, "error"),
});

const menus = new MenuBar(document, (button) => {
  if (button.dataset.createKind !== undefined) createPrimitive(button.dataset.createKind);
  else if (button.dataset.bottomTab !== undefined) showBottomTab(button.dataset.bottomTab);
  else runAction(button.dataset.action ?? "");
});

const hub = new HubController(openProject);

bindScene(scene);
bindInterface();
renderCreateMenus();
refreshAll();
hub.show();

// -- interface wiring -------------------------------------------------------

function bindInterface(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-action]")) {
    if (button.closest(".menu-popup") !== null) continue;
    button.addEventListener("click", () => runAction(button.dataset.action ?? ""));
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-tool]")) {
    button.addEventListener("click", () => selectTool(button.dataset.tool as TransformTool));
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-bottom-tab]")) {
    if (button.closest(".menu-popup") !== null) continue;
    button.addEventListener("click", () => showBottomTab(button.dataset.bottomTab ?? "assets"));
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-view]")) {
    button.addEventListener("click", () => selectView(button.dataset.view === "game" ? "game" : "scene"));
  }
  element.createSearch.addEventListener("input", renderCreatePicker);

  element.spaceToggle.addEventListener("click", () => {
    space = space === "local" ? "world" : "local";
    element.spaceToggle.textContent = space.toUpperCase();
    viewport.draw();
    setStatus(`Gizmo axes: ${space}`);
  });
  for (const input of [element.snapToggle, element.gridStep, element.angleStep]) {
    input.addEventListener("change", () => viewport.draw());
  }

  element.search.addEventListener("input", renderHierarchy);
  element.entityName.addEventListener("change", () => renameSelected(element.entityName.value));
  element.entityEnabled.addEventListener("change", () => toggleSelectedEnabled(element.entityEnabled.checked));
  bindTransformInputs();

  element.componentSearch.addEventListener("input", renderComponentPicker);
  history.addEventListener("change", updateCommandState);

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("beforeunload", () => persistLocally());
  window.addEventListener("resize", () => viewport.draw());
  setInterval(() => { if (dirty) void autosave(); }, AUTOSAVE_INTERVAL_MS);
}

function bindTransformInputs(): void {
  for (const input of element.inspector.querySelectorAll<HTMLInputElement>("[data-transform]")) {
    const property = input.dataset.transform as "position" | "rotation" | "scale";
    const axis = Number(input.dataset.axis);
    input.addEventListener("input", () => {
      const entityId = primarySelection();
      const current = entityId === undefined ? undefined : readTransform(entityId);
      if (entityId === undefined || current === undefined || input.value === "") return;
      const value = Number(input.value);
      if (!Number.isFinite(value)) return;
      const next = structuredClone(current);
      try {
        if (property === "rotation") {
          const euler = eulerFromQuaternion(current.rotation);
          euler[axis] = value;
          next.rotation = quaternionFromEuler(euler);
        } else {
          next[property][axis] = value;
        }
      } catch (error) {
        log(`Transform edit failed: ${messageOf(error)}`, "error");
        return;
      }
      history.perform(
        "Transform",
        () => { scene.setTransform(entityId, current); },
        () => { scene.setTransform(entityId, next); },
        `inspector:${entityId}:${property}:${String(axis)}`,
      );
    });
    input.addEventListener("change", () => history.endGesture());
    input.addEventListener("blur", () => history.endGesture());
  }
}

function onKeyDown(event: KeyboardEvent): void {
  const editing = event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement;
  const accel = event.ctrlKey || event.metaKey;
  if (accel && event.code === "KeyS") { event.preventDefault(); void save(); return; }
  if (accel && event.code === "KeyZ") { event.preventDefault(); runAction(event.shiftKey ? "redo" : "undo"); return; }
  if (accel && event.code === "KeyY") { event.preventDefault(); runAction("redo"); return; }
  if (accel && event.code === "KeyD") { event.preventDefault(); runAction("duplicate"); return; }
  if (accel && event.code === "KeyN") { event.preventDefault(); runAction("new-scene"); return; }
  if (accel && event.code === "KeyP") { event.preventDefault(); runAction("play"); return; }
  if (accel && event.code === "KeyA" && !editing) { event.preventDefault(); runAction("select-all"); return; }
  if (editing) {
    if (event.code === "Escape") (event.target as HTMLElement).blur();
    return;
  }
  if (event.code === "Delete" || event.code === "Backspace") { event.preventDefault(); runAction("delete"); return; }
  if (event.code === "Escape") { runAction("deselect"); return; }
  if (event.code === "KeyF") { runAction("frame-selected"); return; }
  const shortcut = ({ KeyQ: "select", KeyW: "translate", KeyE: "rotate", KeyR: "scale" } as Record<string, TransformTool | undefined>)[event.code];
  if (shortcut !== undefined) selectTool(shortcut);
}

// -- commands ---------------------------------------------------------------

function runAction(action: string): void {
  switch (action) {
    case "hub": return closeProject();
    case "create-child": {
      if (primarySelection() === undefined) { setStatus("Select a parent entity first"); return; }
      createPrimitive("entity", true);
      return;
    }
    case "open-create-entity": {
      element.createSearch.value = "";
      renderCreatePicker();
      element.createEntityDialog.showModal();
      element.createSearch.focus();
      return;
    }
    case "open-add-component": return openAddComponent();
    case "duplicate": return duplicateSelection();
    case "delete": return deleteSelection();
    case "unparent": return unparentSelection();
    case "select-all": return setSelection(scene.data.entities.map((entity) => entity.id));
    case "deselect": return setSelection([]);
    case "frame-selected": return viewport.frameSelection();
    case "reset-view": { viewport.resetView(); setStatus("Scene camera reset"); return; }
    case "toggle-theme": return toggleTheme();
    case "clear-console": { element.consoleTab.replaceChildren(); element.consoleCount.textContent = "0"; return; }
    case "save": return void save();
    case "undo": { const label = history.undo(); setStatus(label === undefined ? "Nothing to undo" : `Undo ${label}`); return; }
    case "redo": { const label = history.redo(); setStatus(label === undefined ? "Nothing to redo" : `Redo ${label}`); return; }
    case "new-scene": return newScene();
    case "play": return togglePlay();
    case "pause": { setStatus(playing ? "Game preview paused" : "Preview is not running"); return; }
    case "build": {
      void save();
      log("Scene validated. Run `pnpm vapour build <project>` for a deployable release.");
      showBottomTab("console");
      return;
    }
    default: return;
  }
}

interface CreatableObject {
  readonly kind: string;
  readonly label: string;
  readonly summary: string;
  /** Mesh to attach, for mesh primitives. */
  readonly mesh?: string;
  readonly component?: string;
}

/**
 * Everything the Create menus offer.
 *
 * Mesh entries are generated from the shared mesh library, so adding a
 * primitive to the engine adds it to both menus with no editor change.
 */
function creatableObjects(): readonly CreatableObject[] {
  return [
    { kind: "entity", label: "Empty Entity", summary: "Transform only" },
    ...meshLibrary().map((mesh) => ({
      kind: `mesh:${mesh.id}`,
      label: mesh.label,
      summary: `${mesh.summary} ${String(mesh.triangles)} triangles.`,
      mesh: mesh.id,
      component: "vapour.MeshRenderer",
    })),
    { kind: "camera", label: "Camera", summary: "Perspective, aligned to the current view", component: "vapour.Camera" },
    { kind: "light", label: "Directional Light", summary: "Scene illumination", component: "vapour.DirectionalLight" },
  ];
}

function createPrimitive(kind: string, asChild = false): void {
  const definition = creatableObjects().find((candidate) => candidate.kind === kind);
  if (definition === undefined) {
    log(`Cannot create unknown object type '${kind}'.`, "error");
    return;
  }
  const pivot = viewport.camera.state.target;
  const before = structuredClone(scene.data);
  // New objects go to the scene root. Parenting to whatever happened to be
  // selected chains each new object under the last one, which is never what
  // creating five cubes in a row is meant to do; "Create Empty Child" is the
  // explicit way to nest.
  const entity = scene.addEntity(definition.label, asChild ? primarySelection() : undefined);

  const transform: TransformData = { ...defaultTransform(), position: [round(pivot[0]), round(pivot[1]), round(pivot[2])] };
  if (kind === "camera") {
    // Match Unity's align-to-view: a new camera frames what you are looking at.
    const world = viewport.camera.worldMatrix();
    transform.position = [round(world[12]!), round(world[13]!), round(world[14]!)];
    transform.rotation = quaternionFromMatrix(world).map(round) as [number, number, number, number];
  } else if (kind === "light") {
    transform.rotation = quaternionFromEuler([50, -30, 0]).map(round) as [number, number, number, number];
  }
  scene.setTransform(entity.id, transform);

  if (definition.component !== undefined) {
    const record = createComponentRecord(registry.require(definition.component));
    if (definition.mesh !== undefined) {
      (record.data as Record<string, unknown>).mesh = definition.mesh;
    }
    scene.addComponent(entity.id, record);
  }

  const after = structuredClone(scene.data);
  const createdId = entity.id;
  history.perform(
    `Create ${definition.label}`,
    () => { scene.replace(before); setSelection([]); },
    () => { scene.replace(after); setSelection([createdId]); },
  );
  setSelection([createdId]);
  setStatus(`Created ${entity.name}`);
}

/** Fills both Create surfaces from one catalogue. */
function renderCreateMenus(): void {
  const meshItems = require$<HTMLDivElement>("#gameobject-mesh-items");
  meshItems.replaceChildren();
  for (const definition of creatableObjects()) {
    if (definition.mesh === undefined) continue;
    const item = document.createElement("button");
    item.type = "button";
    item.setAttribute("role", "menuitem");
    item.dataset.createKind = definition.kind;
    item.textContent = definition.label;
    item.addEventListener("click", () => { menus.closeAll(); createPrimitive(definition.kind); });
    meshItems.append(item);
  }
  renderCreatePicker();
}

function renderCreatePicker(): void {
  const query = element.createSearch.value.trim().toLocaleLowerCase();
  const matches = creatableObjects().filter(
    (definition) => query === "" || definition.label.toLocaleLowerCase().includes(query),
  );
  element.createPicker.replaceChildren();
  if (matches.length === 0) {
    const empty = document.createElement("p");
    empty.className = "picker-empty";
    empty.textContent = "Nothing matches that search.";
    element.createPicker.append(empty);
    return;
  }
  for (const definition of matches) {
    const button = document.createElement("button");
    button.type = "button";
    const title = document.createElement("strong");
    title.textContent = definition.label;
    const summary = document.createElement("small");
    summary.textContent = definition.summary;
    button.append(title, summary);
    button.addEventListener("click", () => {
      element.createEntityDialog.close();
      createPrimitive(definition.kind);
    });
    element.createPicker.append(button);
  }
}

function openAddComponent(): void {
  if (primarySelection() === undefined) { setStatus("Select an entity first"); return; }
  element.componentSearch.value = "";
  renderComponentPicker();
  element.addComponentDialog.showModal();
  element.componentSearch.focus();
}

function renderComponentPicker(): void {
  const entity = selectedEntity();
  element.componentPicker.replaceChildren();
  if (entity === undefined) return;
  const available = registry.list(element.componentSearch.value).filter(
    (schema) => !entity.components.some((component) => component.typeName === schema.typeName),
  );
  if (available.length === 0) {
    const empty = document.createElement("p");
    empty.className = "picker-empty";
    empty.textContent = element.componentSearch.value.trim() === ""
      ? "This entity already has every available component."
      : "No components match that search.";
    element.componentPicker.append(empty);
    return;
  }
  for (const schema of available) element.componentPicker.append(componentPickerRow(entity.id, schema));
}

function componentPickerRow(entityId: string, schema: ComponentSchema): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  const title = document.createElement("strong");
  title.textContent = schema.label;
  const summary = document.createElement("small");
  summary.textContent = schema.summary;
  button.append(title, summary);
  button.addEventListener("click", () => {
    element.addComponentDialog.close();
    const record = createComponentRecord(schema);
    history.perform(
      `Add ${schema.label}`,
      () => { scene.removeComponent(entityId, schema.typeName); },
      () => { scene.addComponent(entityId, record); },
    );
    setStatus(`Added ${schema.label}`);
  });
  return button;
}

function duplicateSelection(): void {
  if (selection.length === 0) { setStatus("Nothing to duplicate"); return; }
  const before = structuredClone(scene.data);
  const created = selection.map((entityId) => scene.duplicateEntity(entityId).id);
  const after = structuredClone(scene.data);
  const previous = [...selection];
  history.perform(
    "Duplicate",
    () => { scene.replace(before); setSelection(previous); },
    () => { scene.replace(after); setSelection(created); },
  );
  setSelection(created);
}

function deleteSelection(): void {
  if (selection.length === 0) { setStatus("Nothing to delete"); return; }
  const before = structuredClone(scene.data);
  const previous = [...selection];
  for (const entityId of previous) if (scene.entity(entityId) !== undefined) scene.removeEntity(entityId);
  const after = structuredClone(scene.data);
  history.perform(
    "Delete",
    () => { scene.replace(before); setSelection(previous); },
    () => { scene.replace(after); setSelection([]); },
  );
  setSelection([]);
}

function unparentSelection(): void {
  const moved = selection.filter((entityId) => scene.entity(entityId)?.parent !== undefined);
  if (moved.length === 0) { setStatus("Selection is already at the scene root"); return; }
  const before = structuredClone(scene.data);
  for (const entityId of moved) scene.setParent(entityId, undefined);
  const after = structuredClone(scene.data);
  history.perform("Move to scene root", () => scene.replace(before), () => scene.replace(after));
}

function reparent(childId: string, parentId: string | undefined): void {
  const before = structuredClone(scene.data);
  try {
    scene.setParent(childId, parentId);
  } catch (error) {
    log(messageOf(error), "error");
    return;
  }
  const after = structuredClone(scene.data);
  history.perform("Reparent", () => scene.replace(before), () => scene.replace(after));
  setStatus(parentId === undefined ? "Moved to scene root" : `Parented to ${scene.entity(parentId)?.name ?? "entity"}`);
}

function renameSelected(value: string): void {
  const entity = selectedEntity();
  if (entity === undefined) return;
  const before = entity.name;
  const after = value.trim() || before;
  if (after === before) return;
  history.perform("Rename", () => scene.updateEntity(entity.id, { name: before }), () => scene.updateEntity(entity.id, { name: after }));
}

function toggleSelectedEnabled(enabled: boolean): void {
  const entity = selectedEntity();
  if (entity === undefined) return;
  const before = entity.enabled;
  history.perform(
    enabled ? "Enable entity" : "Disable entity",
    () => scene.updateEntity(entity.id, { enabled: before }),
    () => scene.updateEntity(entity.id, { enabled }),
  );
}

function newScene(): void {
  if (dirty && !window.confirm("Discard unsaved scene changes?")) return;
  scene = new SceneDocument(SceneDocument.empty("Untitled"));
  bindScene(scene);
  history.clear();
  setSelection([]);
  dirty = true;
  refreshAll();
  log("Created a new scene.");
}

function togglePlay(): void {
  playing = !playing;
  document.body.classList.toggle("is-playing", playing);
  selectView(playing ? "game" : "scene");
  setStatus(playing ? "Game preview running" : "Game preview stopped");
  log(playing ? "Entered game preview." : "Exited game preview.");
}

function selectView(view: "scene" | "game"): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-view]")) {
    button.classList.toggle("active", button.dataset.view === view);
  }
  // The Scene view navigates with the editor camera; the Game view shows the
  // authored camera exactly as a player would see it.
  renderHost?.setViewer(view === "scene" ? viewport.camera.snapshot() : undefined);
  element.gizmoLayer.style.display = view === "game" ? "none" : "";
  require$("#viewport-mode").textContent = view === "game" ? "GAME" : "PERSPECTIVE";
  if (view === "game" && renderHost?.snapshot()?.camera === undefined) {
    log("The Game view has no camera. Add a Camera component to an entity.", "warning");
  }
}

function toggleTheme(): void {
  theme = applyTheme(theme === "dark" ? "light" : "dark");
  const name = document.querySelector("#hub-theme-name");
  if (name !== null) name.textContent = theme === "dark" ? "Dark" : "Light";
  viewport.draw();
  setStatus(`${theme === "dark" ? "Dark" : "Light"} theme`);
}

function closeProject(): void {
  if (dirty && !window.confirm("Return to Projects with unsaved scene changes?")) return;
  renderHost?.destroy();
  renderHost = undefined;
  hub.show();
}

function selectTool(next: TransformTool): void {
  tool = next;
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-tool]")) {
    button.classList.toggle("active", button.dataset.tool === next);
  }
  // Scale is always local: a per-entity scale vector cannot express stretching
  // along a world axis, so the toggle is disabled rather than silently ignored.
  element.spaceToggle.disabled = next === "scale";
  element.spaceToggle.textContent = next === "scale" ? "LOCAL" : space.toUpperCase();
  viewport.draw();
  setStatus(`${next[0]!.toUpperCase()}${next.slice(1)} tool`);
}

// -- project lifecycle ------------------------------------------------------

async function openProject(project: HubProject): Promise<void> {
  const source = await readProjectText(project.directory, project.manifest.startupScene);
  scene = new SceneDocument(JSON.parse(source));
  currentProject = project;
  bindScene(scene);
  history.clear();
  setSelection([]);
  dirty = false;
  setSaveState("saved");
  require$("#project-name").textContent = project.manifest.name;
  refreshAll();
  require$("#viewport-message").hidden = true;
  element.status.classList.remove("status-error");
  setStatus(`Opening ${project.manifest.name}…`);
  reportCapabilities();
  viewport.frameSelection();
  try {
    await initializeRenderer();
  } catch (error) {
    showViewportError(messageOf(error));
  }
  log(`Opened ${project.manifest.name} with Vapour ${project.manifest.editorVersion}.`);
}

async function initializeRenderer(): Promise<void> {
  renderHost?.destroy();
  const host = new WebGpuRenderHost(element.canvas);
  renderHost = host;
  host.setScene(scene.data);
  host.setViewer(viewport.camera.snapshot());
  host.addEventListener("stats", (event) => updateStats((event as CustomEvent<RenderStats>).detail));
  host.addEventListener("capabilities", (event) => {
    const capabilities = (event as CustomEvent<RustRenderCapabilities>).detail;
    const badge = require$<HTMLElement>(".renderer-badge");
    badge.textContent = `WEBGPU · ${capabilities.tier.toUpperCase()}`;
    badge.title = `${capabilities.adapterName} (${capabilities.backend})`;
    log(`Rust renderer: ${capabilities.adapterName}, ${capabilities.tier} tier, ${capabilities.textureCompression.toUpperCase()} textures.`);
  });
  host.addEventListener("device-lost", (event) => showViewportError(`GPU device lost: ${String((event as CustomEvent).detail)}`));
  await host.initialize();
  host.start();
  setStatus("Rust WebGPU viewport ready");
  viewport.draw();
}

function reportCapabilities(): void {
  const capabilities = detectBrowserCapabilities();
  require$("#capability-summary").textContent =
    `${capabilities.crossOriginIsolated ? "WORKERS ISOLATED" : "SINGLE-THREAD"} · ${capabilities.wasmSimd ? "WASM SIMD" : "SCALAR WASM"}`;
  for (const diagnostic of diagnoseCapabilities(capabilities)) log(`${diagnostic.message} ${diagnostic.remediation}`, diagnostic.severity);
}

// -- scene rendering --------------------------------------------------------

function bindScene(document_: SceneDocument): void {
  document_.addEventListener("change", () => {
    if (document_ !== scene) return;
    dirty = true;
    setSaveState("unsaved");
    refreshAll();
  });
}

/** Single refresh path: every mutation funnels through here so the tree,
 * inspector, renderer, and gizmo can never disagree about the scene. */
function refreshAll(): void {
  selection = selection.filter((entityId) => scene.entity(entityId) !== undefined);
  try {
    worldMatrices = computeWorldMatrices(scene.data);
  } catch (error) {
    log(`Scene hierarchy is invalid: ${messageOf(error)}`, "error");
  }
  renderHierarchy();
  renderInspector();
  renderAssets();
  require$("#stat-entities").textContent = String(scene.data.entities.length);
  require$("#scene-name").textContent = `${scene.data.name}.scene`;
  require$("#hierarchy-scene-name").textContent = `${scene.data.name}.scene`;
  require$("#hierarchy-object-count").textContent = `${String(scene.data.entities.length)} ${scene.data.entities.length === 1 ? "OBJECT" : "OBJECTS"}`;
  element.selectionSummary.textContent = selection.length === 0 ? "" : `${String(selection.length)} SELECTED`;
  updateCommandState();
  try {
    renderHost?.setScene(scene.data);
  } catch (error) {
    log(`Render extraction failed: ${messageOf(error)}`, "error");
  }
  viewport.draw();
}

function renderHierarchy(): void {
  element.hierarchy.replaceChildren();
  const filter = element.search.value.trim().toLocaleLowerCase();
  const matching = scene.data.entities.filter((entity) => entity.name.toLocaleLowerCase().includes(filter));
  if (matching.length === 0) {
    const empty = document.createElement("div");
    empty.className = "tree-empty";
    empty.textContent = filter === "" ? "No entities. Use + to create one." : "No matching entities.";
    element.hierarchy.append(empty);
    return;
  }
  // While filtering, show matches as a flat list so results are never hidden
  // inside a collapsed or non-matching ancestor.
  if (filter !== "") {
    for (const entity of matching) element.hierarchy.append(treeRow(entity, 0, false));
    return;
  }
  const roots = scene.data.entities.filter((entity) => entity.parent === undefined);
  for (const root of roots) appendBranch(root, 0);
}

function appendBranch(entity: SceneEntityData, depth: number): void {
  const children = scene.data.entities.filter((candidate) => candidate.parent === entity.id);
  element.hierarchy.append(treeRow(entity, depth, children.length > 0));
  if (collapsed.has(entity.id)) return;
  for (const child of children) appendBranch(child, depth + 1);
}

function treeRow(entity: SceneEntityData, depth: number, hasChildren: boolean): HTMLElement {
  const row = document.createElement("button");
  row.type = "button";
  row.className = `tree-item${selection.includes(entity.id) ? " selected" : ""}${entity.enabled ? "" : " disabled"}`;
  row.style.paddingLeft = `${String(6 + depth * 14)}px`;
  row.setAttribute("role", "treeitem");
  row.draggable = true;
  row.dataset.entity = entity.id;

  const twisty = document.createElement("span");
  twisty.className = "tree-twisty";
  twisty.textContent = hasChildren ? (collapsed.has(entity.id) ? "▸" : "▾") : "";
  if (hasChildren) {
    twisty.addEventListener("click", (event) => {
      event.stopPropagation();
      if (collapsed.has(entity.id)) collapsed.delete(entity.id); else collapsed.add(entity.id);
      renderHierarchy();
    });
  }

  const icon = document.createElement("span");
  icon.className = "tree-icon";
  icon.textContent = iconFor(entity);
  const label = document.createElement("span");
  label.className = "tree-label";
  label.textContent = entity.name;
  row.append(twisty, icon, label);

  row.addEventListener("click", (event) => {
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      setSelection(selection.includes(entity.id) ? selection.filter((id) => id !== entity.id) : [...selection, entity.id]);
    } else {
      setSelection([entity.id]);
    }
  });
  row.addEventListener("dblclick", () => viewport.frameSelection());
  row.addEventListener("dragstart", (event) => event.dataTransfer?.setData("text/vapour-entity", entity.id));
  row.addEventListener("dragover", (event) => {
    if (event.dataTransfer?.types.includes("text/vapour-entity") !== true) return;
    event.preventDefault();
    row.classList.add("drop-target");
  });
  row.addEventListener("dragleave", () => row.classList.remove("drop-target"));
  row.addEventListener("drop", (event) => {
    event.preventDefault();
    row.classList.remove("drop-target");
    const dragged = event.dataTransfer?.getData("text/vapour-entity");
    if (dragged !== undefined && dragged !== "" && dragged !== entity.id) reparent(dragged, entity.id);
  });
  return row;
}

function iconFor(entity: SceneEntityData): string {
  for (const component of entity.components) {
    const schema = registry.get(component.typeName);
    if (schema !== undefined) return schema.icon;
  }
  return "◇";
}

function renderInspector(): void {
  const entity = selectedEntity();
  element.inspector.hidden = entity === undefined;
  element.inspectorEmpty.hidden = entity !== undefined;
  element.inspectorNote.textContent = selection.length > 1 ? `${String(selection.length)} SELECTED` : "";
  if (entity === undefined) return;
  if (document.activeElement !== element.entityName) element.entityName.value = entity.name;
  element.entityEnabled.checked = entity.enabled;
  const transform = readTransform(entity.id);
  if (transform !== undefined) {
    let euler: [number, number, number];
    try {
      euler = eulerFromQuaternion(transform.rotation);
    } catch {
      euler = [0, 0, 0];
    }
    for (const input of element.inspector.querySelectorAll<HTMLInputElement>("[data-transform]")) {
      if (document.activeElement === input) continue;
      const property = input.dataset.transform as "position" | "rotation" | "scale";
      const axis = Number(input.dataset.axis);
      input.value = String(property === "rotation" ? euler[axis] ?? 0 : transform[property][axis] ?? 0);
    }
  }
  inspector.render(entity);
}

function renderAssets(): void {
  element.assetGrid.replaceChildren();
  const card = document.createElement("button");
  card.type = "button";
  card.className = "asset-card";
  const icon = document.createElement("span");
  icon.className = "asset-icon";
  icon.textContent = "◇";
  const name = document.createElement("span");
  name.textContent = `${scene.data.name}.scene`;
  card.append(icon, name);
  card.addEventListener("click", () => setStatus(`${scene.data.name}.scene · ${String(scene.data.entities.length)} entities`));
  element.assetGrid.append(card);
}

function updateCommandState(): void {
  const hasSelection = selection.length > 0;
  menus.setEnabled((action) => {
    if (action === "undo") return history.canUndo;
    if (action === "redo") return history.canRedo;
      if (["duplicate", "delete", "unparent", "open-add-component", "create-child"].includes(action)) return hasSelection;
    return true;
  });
}

function setSelection(next: readonly string[]): void {
  selection = [...new Set(next)].filter((entityId) => scene.entity(entityId) !== undefined);
  history.endGesture();
  renderHierarchy();
  renderInspector();
  element.selectionSummary.textContent = selection.length === 0 ? "" : `${String(selection.length)} SELECTED`;
  updateCommandState();
  viewport.draw();
}

function primarySelection(): string | undefined {
  return selection.at(-1);
}

function selectedEntity(): SceneEntityData | undefined {
  const entityId = primarySelection();
  return entityId === undefined ? undefined : scene.entity(entityId);
}

function readTransform(entityId: string): TransformData | undefined {
  const component = scene.entity(entityId)?.components.find((value) => value.typeName === "vapour.Transform");
  return component === undefined ? undefined : (structuredClone(component.data) as TransformData);
}

// -- persistence ------------------------------------------------------------

function loadInitialScene(): SceneDocument {
  const saved = localStorage.getItem(SCENE_STORAGE_KEY);
  try {
    return new SceneDocument(saved === null ? createStarterScene() : JSON.parse(saved));
  } catch (error) {
    queueMicrotask(() => log(`Recovered from an invalid autosave: ${messageOf(error)}`, "error"));
    return new SceneDocument(createStarterScene());
  }
}

function createStarterScene() {
  const document_ = new SceneDocument(SceneDocument.empty("Main"));
  const camera = document_.addEntity("Main Camera");
  const light = document_.addEntity("Directional Light");
  const cube = document_.addEntity("Cube");
  document_.setTransform(camera.id, { ...defaultTransform(), position: [0, 1.6, 6], rotation: quaternionFromEuler([-6, 0, 0]) });
  document_.setTransform(light.id, { ...defaultTransform(), position: [0, 4, 2], rotation: quaternionFromEuler([50, -30, 0]) });
  document_.addComponent(camera.id, createComponentRecord(registry.require("vapour.Camera")));
  document_.addComponent(light.id, createComponentRecord(registry.require("vapour.DirectionalLight")));
  document_.addComponent(cube.id, createComponentRecord(registry.require("vapour.MeshRenderer")));
  return JSON.parse(document_.serialize());
}

function persistLocally(): string {
  const serialized = scene.serialize();
  try {
    localStorage.setItem(SCENE_STORAGE_KEY, serialized);
  } catch (error) {
    log(`Local recovery copy could not be written: ${messageOf(error)}`, "warning");
  }
  return serialized;
}

async function save(): Promise<void> {
  const serialized = persistLocally();
  try {
    if (currentProject !== undefined) await writeProjectText(currentProject.directory, currentProject.manifest.startupScene, serialized);
    dirty = false;
    setSaveState("saved");
    setStatus(currentProject === undefined ? "Scene saved locally" : "Scene saved to project");
    log(`Saved ${scene.data.name}.scene.`);
  } catch (error) {
    setSaveState("error");
    setStatus("Scene save failed");
    element.status.classList.add("status-error");
    log(`Scene save failed: ${messageOf(error)}`, "error");
  }
}

async function autosave(): Promise<void> {
  const serialized = persistLocally();
  try {
    if (currentProject !== undefined) await writeProjectText(currentProject.directory, currentProject.manifest.startupScene, serialized);
    dirty = false;
    setSaveState("autosaved");
  } catch (error) {
    setSaveState("error");
    log(`Autosave failed: ${messageOf(error)}`, "error");
  }
}

async function readProjectText(root: FileSystemDirectoryHandle, projectPath: string): Promise<string> {
  const parts = safeProjectPath(projectPath);
  let directory = root;
  for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
  return (await (await directory.getFileHandle(parts.at(-1)!)).getFile()).text();
}

async function writeProjectText(root: FileSystemDirectoryHandle, projectPath: string, value: string): Promise<void> {
  const parts = safeProjectPath(projectPath);
  let directory = root;
  for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
  const writable = await (await directory.getFileHandle(parts.at(-1)!)).createWritable();
  try { await writable.write(value); } finally { await writable.close(); }
}

function safeProjectPath(value: string): string[] {
  const parts = value.replaceAll("\\", "/").split("/").filter((part) => part !== "");
  if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) throw new Error(`Invalid project path '${value}'.`);
  return parts;
}

// -- chrome -----------------------------------------------------------------

function showBottomTab(name: string): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>(".panel-tabs [data-bottom-tab]")) {
    button.classList.toggle("active", button.dataset.bottomTab === name);
  }
  for (const tab of ["assets", "console", "profiler"]) require$(`#${tab}-tab`).hidden = tab !== name;
}

function setSaveState(state: "saved" | "unsaved" | "autosaved" | "error"): void {
  element.saveState.dataset.state = state === "autosaved" ? "saved" : state;
  element.saveState.textContent = state.toUpperCase();
}

function setStatus(message: string): void {
  element.status.textContent = message;
}

function log(message: string, level: LogLevel = "info"): void {
  const row = document.createElement("div");
  row.className = `log-entry ${level}`;
  const time = document.createElement("span");
  time.className = "log-time";
  time.textContent = new Date().toLocaleTimeString();
  const text = document.createElement("span");
  text.textContent = message;
  row.append(time, text);
  element.consoleTab.append(row);
  element.consoleTab.scrollTop = element.consoleTab.scrollHeight;
  element.consoleCount.textContent = String(element.consoleTab.childElementCount);
}

function updateStats(stats: RenderStats): void {
  require$("#stat-fps").textContent = String(stats.fps);
  require$("#stat-frame").textContent = `${stats.frameTimeMs.toFixed(2)} ms`;
  require$("#stat-encode").textContent = `${stats.cpuEncodeMs.toFixed(2)} ms`;
  require$("#stat-draws").textContent = String(stats.drawCalls);
  require$("#stat-triangles").textContent = String(stats.triangles);
}

function showViewportError(message: string): void {
  const banner = require$<HTMLElement>("#viewport-message");
  banner.hidden = false;
  banner.textContent = message;
  setStatus("Renderer unavailable");
  element.status.classList.add("status-error");
  log(message, "error");
}

function require$<T extends HTMLElement = HTMLElement>(selector: string): T {
  return document.querySelector<T>(selector) ?? missing(selector);
}

function missing(selector: string): never {
  throw new Error(`Editor shell is missing '${selector}'.`);
}

function round(value: number): number {
  return Math.round(value * 1e5) / 1e5 + 0;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
