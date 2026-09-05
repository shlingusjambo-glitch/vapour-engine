export const SCENE_FORMAT_VERSION = 1 as const;

export interface TransformData {
  position: [number, number, number];
  rotation: [number, number, number, number];
  scale: [number, number, number];
}

export interface ComponentRecord {
  typeName: string;
  version: number;
  data: unknown;
}

export interface SceneEntityData {
  id: string;
  name: string;
  parent?: string;
  enabled: boolean;
  components: ComponentRecord[];
}

export interface SceneData {
  formatVersion: typeof SCENE_FORMAT_VERSION;
  id: string;
  name: string;
  entities: SceneEntityData[];
}

export type SceneChange =
  | { type: "entity-added"; id: string }
  | { type: "entity-removed"; id: string }
  | { type: "entity-changed"; id: string }
  | { type: "scene-replaced" };

export function defaultTransform(): TransformData {
  return { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };
}

export class SceneDocument extends EventTarget {
  #data: SceneData;

  constructor(data: SceneData = SceneDocument.empty("Untitled")) {
    super();
    validateScene(data);
    this.#data = structuredClone(data);
  }

  static empty(name: string): SceneData {
    return { formatVersion: SCENE_FORMAT_VERSION, id: crypto.randomUUID(), name, entities: [] };
  }

  get data(): Readonly<SceneData> {
    return this.#data;
  }

  replace(data: SceneData): void {
    validateScene(data);
    this.#data = structuredClone(data);
    this.#emit({ type: "scene-replaced" });
  }

  entity(id: string): SceneEntityData | undefined {
    return this.#data.entities.find((entity) => entity.id === id);
  }

  addEntity(name = "Entity", parent?: string): SceneEntityData {
    if (parent !== undefined && this.entity(parent) === undefined) {
      throw new Error(`Cannot parent new entity to missing entity '${parent}'.`);
    }
    const entity: SceneEntityData = {
      id: crypto.randomUUID(),
      name: uniqueName(this.#data.entities, name),
      ...(parent === undefined ? {} : { parent }),
      enabled: true,
      components: [{ typeName: "vapour.Transform", version: 1, data: defaultTransform() }],
    };
    this.#data.entities.push(entity);
    this.#emit({ type: "entity-added", id: entity.id });
    return entity;
  }

  updateEntity(id: string, update: Partial<Pick<SceneEntityData, "name" | "enabled">>): void {
    const entity = this.#requireEntity(id);
    if (update.name !== undefined) entity.name = update.name.trim() || entity.name;
    if (update.enabled !== undefined) entity.enabled = update.enabled;
    this.#emit({ type: "entity-changed", id });
  }

  setTransform(id: string, transform: TransformData): void {
    const entity = this.#requireEntity(id);
    const component = entity.components.find((value) => value.typeName === "vapour.Transform");
    if (component === undefined) throw new Error(`Entity '${id}' has no Transform component.`);
    component.data = structuredClone(transform);
    this.#emit({ type: "entity-changed", id });
  }

  addComponent(id: string, component: ComponentRecord): void {
    const entity = this.#requireEntity(id);
    validateComponent(component, id);
    if (entity.components.some((value) => value.typeName === component.typeName)) {
      throw new Error(`Entity '${id}' already has a '${component.typeName}' component.`);
    }
    entity.components.push(structuredClone(component));
    this.#emit({ type: "entity-changed", id });
  }

  updateComponentData(id: string, typeName: string, data: unknown): void {
    const entity = this.#requireEntity(id);
    const component = entity.components.find((value) => value.typeName === typeName);
    if (component === undefined) throw new Error(`Entity '${id}' has no '${typeName}' component.`);
    component.data = structuredClone(data);
    this.#emit({ type: "entity-changed", id });
  }

  removeComponent(id: string, typeName: string): void {
    if (typeName === "vapour.Transform") throw new Error("Transform is required and cannot be removed.");
    const entity = this.#requireEntity(id);
    const index = entity.components.findIndex((value) => value.typeName === typeName);
    if (index < 0) throw new Error(`Entity '${id}' has no '${typeName}' component.`);
    entity.components.splice(index, 1);
    this.#emit({ type: "entity-changed", id });
  }

  setParent(id: string, parent?: string): void {
    const entity = this.#requireEntity(id);
    if (parent === id) throw new Error("An entity cannot parent itself.");
    let cursor = parent;
    while (cursor !== undefined) {
      if (cursor === id) throw new Error("Parenting would create a hierarchy cycle.");
      cursor = this.#requireEntity(cursor).parent;
    }
    if (parent === undefined) delete entity.parent;
    else entity.parent = parent;
    this.#emit({ type: "entity-changed", id });
  }

  removeEntity(id: string): void {
    this.#requireEntity(id);
    const descendants = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const entity of this.#data.entities) {
        if (entity.parent !== undefined && descendants.has(entity.parent) && !descendants.has(entity.id)) {
          descendants.add(entity.id);
          changed = true;
        }
      }
    }
    this.#data.entities = this.#data.entities.filter((entity) => !descendants.has(entity.id));
    this.#emit({ type: "entity-removed", id });
  }

  duplicateEntity(id: string): SceneEntityData {
    const source = this.#requireEntity(id);
    const clone = structuredClone(source);
    clone.id = crypto.randomUUID();
    clone.name = uniqueName(this.#data.entities, `${source.name} Copy`);
    this.#data.entities.push(clone);
    this.#emit({ type: "entity-added", id: clone.id });
    return clone;
  }

  serialize(): string {
    const copy = structuredClone(this.#data);
    copy.entities.sort((a, b) => a.id.localeCompare(b.id));
    for (const entity of copy.entities) {
      entity.components.sort((a, b) => a.typeName.localeCompare(b.typeName));
    }
    return `${JSON.stringify(copy, null, 2)}\n`;
  }

  #requireEntity(id: string): SceneEntityData {
    const entity = this.entity(id);
    if (entity === undefined) throw new Error(`Scene entity '${id}' does not exist.`);
    return entity;
  }

  #emit(change: SceneChange): void {
    this.dispatchEvent(new CustomEvent<SceneChange>("change", { detail: change }));
  }
}

export function validateScene(data: SceneData): void {
  if (data.formatVersion !== SCENE_FORMAT_VERSION) {
    throw new Error(`Unsupported scene version ${String(data.formatVersion)}.`);
  }
  const ids = new Set<string>();
  for (const entity of data.entities) {
    if (ids.has(entity.id)) throw new Error(`Duplicate entity ID '${entity.id}'.`);
    ids.add(entity.id);
    const types = new Set<string>();
    for (const component of entity.components) {
      validateComponent(component, entity.id);
      if (types.has(component.typeName)) {
        throw new Error(`Entity '${entity.id}' has duplicate '${component.typeName}' components.`);
      }
      types.add(component.typeName);
    }
  }
  for (const entity of data.entities) {
    if (entity.parent !== undefined && !ids.has(entity.parent)) {
      throw new Error(`Entity '${entity.id}' references missing parent '${entity.parent}'.`);
    }
    const visited = new Set<string>();
    let cursor: SceneEntityData | undefined = entity;
    while (cursor !== undefined) {
      if (visited.has(cursor.id)) throw new Error(`Scene hierarchy contains a cycle at '${cursor.id}'.`);
      visited.add(cursor.id);
      cursor = cursor.parent === undefined ? undefined : data.entities.find((value) => value.id === cursor!.parent);
    }
  }
}

function validateComponent(component: ComponentRecord, entityId: string): void {
  if (component.typeName.trim() === "") throw new Error(`Entity '${entityId}' has a component with an empty typeName.`);
  if (!Number.isInteger(component.version) || component.version < 1) {
    throw new Error(`Component '${component.typeName}' on entity '${entityId}' requires a positive integer version.`);
  }
  try {
    JSON.stringify(component.data);
  } catch (error) {
    throw new Error(`Component '${component.typeName}' on entity '${entityId}' is not serializable.`, { cause: error });
  }
}

function uniqueName(entities: readonly SceneEntityData[], desired: string): string {
  const names = new Set(entities.map((entity) => entity.name));
  if (!names.has(desired)) return desired;
  let suffix = 2;
  while (names.has(`${desired} ${String(suffix)}`)) suffix += 1;
  return `${desired} ${String(suffix)}`;
}
