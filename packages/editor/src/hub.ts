import { projectTemplate, projectTemplates, serializeScene } from "@vapour/engine";

const RECENTS_KEY = "vapour.hub.recents.v1";
const HANDLE_DATABASE = "vapour-hub";
const HANDLE_STORE = "project-handles";

interface ProjectManifest {
  readonly formatVersion: 1;
  readonly id: string;
  readonly name: string;
  readonly editorVersion: string;
  readonly startupScene: string;
  readonly scriptEntry: string;
  readonly rendering: {
    readonly preferredCanvasFormat: "auto";
    readonly powerPreference: "high-performance";
  };
}

interface RecentProject {
  readonly id: string;
  readonly name: string;
  readonly editorVersion: string;
  readonly location: string;
  readonly lastOpened: string;
}

interface PermissionDirectoryHandle extends FileSystemDirectoryHandle {
  queryPermission(options: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission(options: { mode: "readwrite" }): Promise<PermissionState>;
}

export interface HubProject {
  readonly manifest: ProjectManifest;
  readonly location: string;
  readonly directory: FileSystemDirectoryHandle;
}

export class HubController {
  readonly #root = requireElement<HTMLElement>("#hub-root");
  readonly #editor = requireElement<HTMLElement>("#app");
  readonly #recentGrid = requireElement<HTMLElement>("#recent-projects");
  readonly #empty = requireElement<HTMLElement>("#hub-empty");
  readonly #dialog = requireElement<HTMLDialogElement>("#new-project-dialog");
  readonly #name = requireElement<HTMLInputElement>("#new-project-name");
  readonly #template = requireElement<HTMLSelectElement>("#new-project-template");
  readonly #storage = requireElement<HTMLSelectElement>("#new-project-storage");
  readonly #create = requireElement<HTMLButtonElement>("#create-project");
  readonly #error = requireElement<HTMLElement>("#hub-error");
  readonly #onOpen: (project: HubProject) => void | Promise<void>;

  constructor(onOpen: (project: HubProject) => void | Promise<void>) {
    this.#onOpen = onOpen;
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-hub-page]")) {
      button.addEventListener("click", () => this.#showPage(button.dataset.hubPage ?? "projects"));
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-hub-action='new']")) {
      button.addEventListener("click", () => this.#openNewProject());
    }
    requireElement<HTMLButtonElement>("[data-hub-action='open']").addEventListener("click", () => void this.#openFromDisk());
    requireElement<HTMLButtonElement>("#cancel-project").addEventListener("click", () => this.#dialog.close());
    this.#create.addEventListener("click", () => void this.#createProject());
    this.#name.addEventListener("input", () => { this.#create.disabled = this.#name.value.trim() === ""; });
    this.#populateTemplates();
    this.renderRecents();
  }

  /** Template choices come from the engine's template registry, so the Hub can
   * never offer one the CLI does not also know how to create. */
  #populateTemplates(): void {
    this.#template.replaceChildren();
    for (const template of projectTemplates()) {
      const option = document.createElement("option");
      option.value = template.id;
      option.textContent = template.label;
      option.title = template.description;
      this.#template.append(option);
    }
    this.#template.value = "empty-3d";
  }

  show(): void {
    this.#editor.hidden = true;
    this.#root.hidden = false;
    this.#showPage("projects");
    this.renderRecents();
  }

  hide(): void {
    this.#root.hidden = true;
    this.#editor.hidden = false;
  }

  renderRecents(): void {
    const recents = loadRecents();
    this.#recentGrid.replaceChildren();
    this.#empty.hidden = recents.length !== 0;
    for (const recent of recents) {
      const row = document.createElement("article");
      row.className = "project-card";
      row.innerHTML = `<span class="project-thumbnail"><span>V</span></span><span class="project-card-copy"><strong></strong><small></small><em></em></span><span class="project-actions"><button class="project-forget" title="Remove from recent projects">Forget</button><button class="project-open">Open</button></span>`;
      row.querySelector("strong")!.textContent = recent.name;
      row.querySelector("small")!.textContent = recent.location;
      row.querySelector("em")!.textContent = `Editor ${recent.editorVersion} · ${formatRelativeDate(recent.lastOpened)}`;
      row.querySelector<HTMLButtonElement>(".project-open")!.addEventListener("click", () => void this.#openRecent(recent));
      row.querySelector<HTMLButtonElement>(".project-forget")!.addEventListener("click", () => { forgetRecent(recent.id); this.renderRecents(); });
      this.#recentGrid.append(row);
    }
  }

  #showPage(page: string): void {
    for (const button of document.querySelectorAll<HTMLElement>("[data-hub-page]")) button.classList.toggle("active", button.dataset.hubPage === page);
    for (const panel of document.querySelectorAll<HTMLElement>("[data-hub-panel]")) panel.hidden = panel.dataset.hubPanel !== page;
  }

  #openNewProject(): void {
    this.#error.hidden = true;
    this.#name.value = "";
    this.#template.value = "empty-3d";
    this.#create.disabled = true;
    this.#dialog.showModal();
    this.#name.focus();
  }

  async #createProject(): Promise<void> {
    const name = this.#name.value.trim();
    if (name === "") return;
    this.#setBusy(true);
    try {
      const id = crypto.randomUUID();
      const root = await this.#chooseProjectRoot(name, this.#storage.value);
      if (await hasFile(root.directory, ".vapourproject")) throw new Error("That folder already contains a Vapour project.");
      const manifest = createManifest(id, name);
      await writeProject(root.directory, manifest, this.#template.value);
      await saveHandle(id, root.directory);
      saveRecent(manifest, root.location);
      this.#dialog.close();
      await this.#launch({ manifest, location: root.location, directory: root.directory });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      this.#error.textContent = messageOf(error);
      this.#error.hidden = false;
    } finally {
      this.#setBusy(false);
    }
  }

  async #chooseProjectRoot(name: string, storage: string): Promise<{ directory: FileSystemDirectoryHandle; location: string }> {
    if (storage === "disk") {
      const picker = (window as Window & { showDirectoryPicker?: (options?: { mode: "readwrite" }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
      if (picker === undefined) throw new Error("This browser does not support disk project folders. Use Browser workspace or a Chromium-based browser.");
      const parent = await picker({ mode: "readwrite" });
      return { directory: await parent.getDirectoryHandle(safeDirectoryName(name), { create: true }), location: `${parent.name}/${safeDirectoryName(name)}` };
    }
    const originRoot = await navigator.storage.getDirectory();
    const projects = await originRoot.getDirectoryHandle("Vapour Projects", { create: true });
    return { directory: await projects.getDirectoryHandle(safeDirectoryName(name), { create: true }), location: `Browser workspace/${safeDirectoryName(name)}` };
  }

  async #openFromDisk(): Promise<void> {
    try {
      const picker = (window as Window & { showDirectoryPicker?: (options?: { mode: "readwrite" }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
      if (picker === undefined) throw new Error("Opening disk projects requires the File System Access API in a Chromium-based browser.");
      const directory = await picker({ mode: "readwrite" });
      const manifest = await readManifest(directory);
      await saveHandle(manifest.id, directory);
      const location = directory.name;
      saveRecent(manifest, location);
      await this.#launch({ manifest, location, directory });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      this.#showHubError(messageOf(error));
    }
  }

  async #openRecent(recent: RecentProject): Promise<void> {
    try {
      const directory = await loadHandle(recent.id);
      if (directory === undefined) throw new Error("The browser no longer has this project folder. Use Open to grant access again.");
      const permissionHandle = directory as PermissionDirectoryHandle;
      const permission = await permissionHandle.queryPermission({ mode: "readwrite" });
      if (permission !== "granted" && await permissionHandle.requestPermission({ mode: "readwrite" }) !== "granted") throw new Error("Write access is required to edit this project.");
      const manifest = await readManifest(directory);
      saveRecent(manifest, recent.location);
      await this.#launch({ manifest, location: recent.location, directory });
    } catch (error) {
      this.#showHubError(messageOf(error));
    }
  }

  async #launch(project: HubProject): Promise<void> {
    this.hide();
    try {
      await this.#onOpen(project);
    } catch (error) {
      this.show();
      this.#showHubError(`Could not open ${project.manifest.name}: ${messageOf(error)}`);
    }
  }

  #setBusy(busy: boolean): void {
    this.#create.disabled = busy || this.#name.value.trim() === "";
    this.#create.textContent = busy ? "Creating…" : "Create project";
  }

  #showHubError(message: string): void {
    this.#error.textContent = message;
    this.#error.hidden = false;
    this.#showPage("projects");
  }
}

function createManifest(id: string, name: string): ProjectManifest {
  return {
    formatVersion: 1,
    id,
    name,
    editorVersion: "0.2.0-alpha",
    startupScene: "Assets/Scenes/Main.scene.json",
    scriptEntry: "Scripts/main.ts",
    rendering: { preferredCanvasFormat: "auto", powerPreference: "high-performance" },
  };
}

async function writeProject(root: FileSystemDirectoryHandle, manifest: ProjectManifest, template: string): Promise<void> {
  const assets = await root.getDirectoryHandle("Assets", { create: true });
  const scenes = await assets.getDirectoryHandle("Scenes", { create: true });
  const scripts = await root.getDirectoryHandle("Scripts", { create: true });
  const settings = await root.getDirectoryHandle("Settings", { create: true });
  await root.getDirectoryHandle("Plugins", { create: true });
  await Promise.all([
    writeText(root, ".vapourproject", `${JSON.stringify(manifest, null, 2)}\n`),
    writeText(root, ".gitignore", ".vapour/\ndist/\nnode_modules/\n"),
    writeText(root, "AGENTS.md", agentGuide()),
    writeText(scenes, "Main.scene.json", serializeScene(projectTemplate(template).buildScene())),
    writeText(scripts, "main.ts", projectTemplate(template).script()),
    writeText(settings, "input.json", `${JSON.stringify({ formatVersion: 1, actions: [] }, null, 2)}\n`),
  ]);
}

async function writeText(directory: FileSystemDirectoryHandle, name: string, value: string): Promise<void> {
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  try { await writable.write(value); } finally { await writable.close(); }
}

async function hasFile(directory: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try { await directory.getFileHandle(name); return true; } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") return false;
    throw error;
  }
}

async function readManifest(directory: FileSystemDirectoryHandle): Promise<ProjectManifest> {
  const file = await (await directory.getFileHandle(".vapourproject")).getFile();
  const value = JSON.parse(await file.text()) as Partial<ProjectManifest>;
  if (value.formatVersion !== 1 || typeof value.id !== "string" || typeof value.name !== "string") throw new Error("The selected folder does not contain a valid Vapour project manifest.");
  if (typeof value.editorVersion !== "string") throw new Error("The project does not declare an editorVersion.");
  return value as ProjectManifest;
}

function agentGuide(): string {
  return `# Vapour project guidance\n\nGameplay code is Vapour Script (\`.vs\`) and/or TypeScript in \`Scripts/\`. Both languages use the same engine APIs. Keep scenes and settings deterministic JSON, preserve stable UUID references, and never edit \`.vapour/\`, \`dist/\`, or generated WASM bindings.\n\nBefore handing work back, run:\n\n\`\`\`sh\npnpm vapour validate . --json\npnpm vapour build . --json\n\`\`\`\n\nUse Vapour engine APIs instead of sample-only browser code. Do not add a WebGL primary path.\n`;
}

function loadRecents(): RecentProject[] {
  try {
    const value = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]") as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is RecentProject => typeof item === "object" && item !== null && typeof (item as Partial<RecentProject>).id === "string");
  } catch { return []; }
}

function saveRecent(manifest: ProjectManifest, location: string): void {
  const next: RecentProject = { id: manifest.id, name: manifest.name, editorVersion: manifest.editorVersion, location, lastOpened: new Date().toISOString() };
  localStorage.setItem(RECENTS_KEY, JSON.stringify([next, ...loadRecents().filter((item) => item.id !== next.id)].slice(0, 20)));
}

function forgetRecent(id: string): void {
  localStorage.setItem(RECENTS_KEY, JSON.stringify(loadRecents().filter((item) => item.id !== id)));
}

async function saveHandle(id: string, handle: FileSystemDirectoryHandle): Promise<void> {
  const database = await openHandleDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(HANDLE_STORE, "readwrite");
    transaction.objectStore(HANDLE_STORE).put(handle, id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not save project access."));
  });
  database.close();
}

async function loadHandle(id: string): Promise<FileSystemDirectoryHandle | undefined> {
  const database = await openHandleDatabase();
  const handle = await new Promise<FileSystemDirectoryHandle | undefined>((resolve, reject) => {
    const request = database.transaction(HANDLE_STORE).objectStore(HANDLE_STORE).get(id);
    request.onsuccess = () => resolve(request.result as FileSystemDirectoryHandle | undefined);
    request.onerror = () => reject(request.error ?? new Error("Could not load project access."));
  });
  database.close();
  return handle;
}

function openHandleDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(HANDLE_DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(HANDLE_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open the project database."));
  });
}

function safeDirectoryName(value: string): string {
  const safe = value.replace(/[\\/:*?"<>|]/g, "-").trim();
  if (safe === "" || safe === "." || safe === "..") throw new Error("Project name cannot be used as a folder name.");
  return safe;
}

function formatRelativeDate(value: string): string {
  const elapsed = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 60_000) return "just now";
  if (elapsed < 3_600_000) return `${String(Math.floor(elapsed / 60_000))}m ago`;
  if (elapsed < 86_400_000) return `${String(Math.floor(elapsed / 3_600_000))}h ago`;
  return `${String(Math.floor(elapsed / 86_400_000))}d ago`;
}

function requireElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) throw new Error(`Hub shell is missing '${selector}'.`);
  return element;
}

function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error); }
