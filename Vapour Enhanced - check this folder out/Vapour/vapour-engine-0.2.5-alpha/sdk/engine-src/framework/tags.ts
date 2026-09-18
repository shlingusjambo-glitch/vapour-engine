/** Tags, layers, and groups: the three ways games classify entities.
 *
 * They look similar and are not interchangeable, which is why all three exist:
 *
 * - **Layers** are a small fixed set (32) packed into a bitmask. They answer
 *   "should these two things interact?" — physics collision matrices, render
 *   layers, raycast filters — where the test runs thousands of times a frame
 *   and must be a single bitwise AND.
 * - **Tags** are an open set of strings. They answer "what kind of thing is
 *   this?" — `"enemy"`, `"flammable"`, `"objective"` — where new kinds appear
 *   during development and no fixed budget is acceptable.
 * - **Groups** are named collections maintained by hand. They answer "which
 *   things belong to this?" — a squad, a puzzle's levers, the objects a
 *   cutscene moves — where membership is authored rather than derived.
 */

/** The number of distinct layers, fixed by the 32-bit mask. */
export const LAYER_COUNT = 32;

/** A bitmask over layer indices. */
export type LayerMask = number;

export const LAYER_MASK_NONE: LayerMask = 0;
/** All 32 layers. Written as an unsigned value so it prints readably. */
export const LAYER_MASK_ALL: LayerMask = 0xffff_ffff;

function requireLayerIndex(layer: number): number {
  if (!Number.isInteger(layer) || layer < 0 || layer >= LAYER_COUNT) {
    throw new Error(`Layer index ${layer} is out of range. Layers are whole numbers in [0, ${LAYER_COUNT - 1}].`);
  }
  return layer;
}

export function layerMask(...layers: readonly number[]): LayerMask {
  let mask = 0;
  for (const layer of layers) mask |= 1 << requireLayerIndex(layer);
  return mask >>> 0;
}

export function maskHasLayer(mask: LayerMask, layer: number): boolean {
  return (mask & (1 << requireLayerIndex(layer))) !== 0;
}

export function maskWithLayer(mask: LayerMask, layer: number): LayerMask {
  return (mask | (1 << requireLayerIndex(layer))) >>> 0;
}

export function maskWithoutLayer(mask: LayerMask, layer: number): LayerMask {
  return (mask & ~(1 << requireLayerIndex(layer))) >>> 0;
}

/** True when the two masks share any layer — the interaction test. */
export function masksOverlap(a: LayerMask, b: LayerMask): boolean {
  return ((a & b) >>> 0) !== 0;
}

export function layersInMask(mask: LayerMask): readonly number[] {
  const layers: number[] = [];
  for (let layer = 0; layer < LAYER_COUNT; layer += 1) {
    if ((mask & (1 << layer)) !== 0) layers.push(layer);
  }
  return layers;
}

/**
 * Names for layer indices, so gameplay reads `layers.mask("player", "enemy")`
 * rather than carrying magic numbers that silently shift when someone inserts
 * a layer.
 */
export class LayerRegistry {
  readonly #byName = new Map<string, number>();
  readonly #byIndex = new Array<string | undefined>(LAYER_COUNT).fill(undefined);

  define(name: string, layer: number): void {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("A layer name must not be empty.");
    requireLayerIndex(layer);
    const existingIndex = this.#byName.get(trimmed);
    if (existingIndex !== undefined && existingIndex !== layer) {
      throw new Error(`Layer "${trimmed}" is already defined as ${existingIndex}.`);
    }
    const existingName = this.#byIndex[layer];
    if (existingName !== undefined && existingName !== trimmed) {
      throw new Error(`Layer ${layer} is already named "${existingName}".`);
    }
    this.#byName.set(trimmed, layer);
    this.#byIndex[layer] = trimmed;
  }

  index(name: string): number {
    const layer = this.#byName.get(name.trim());
    if (layer === undefined) {
      const known = [...this.#byName.keys()].sort();
      throw new Error(`Layer "${name}" is not defined.${known.length > 0 ? ` Defined layers: ${known.join(", ")}.` : ""}`);
    }
    return layer;
  }

  name(layer: number): string | undefined {
    return this.#byIndex[requireLayerIndex(layer)];
  }

  mask(...names: readonly string[]): LayerMask {
    return layerMask(...names.map((name) => this.index(name)));
  }

  /** Human-readable mask, for diagnostics and collision-matrix debugging. */
  describe(mask: LayerMask): string {
    const layers = layersInMask(mask);
    if (layers.length === 0) return "(none)";
    return layers.map((layer) => this.#byIndex[layer] ?? String(layer)).join(", ");
  }

  get defined(): readonly { readonly name: string; readonly layer: number }[] {
    return [...this.#byName.entries()].map(([name, layer]) => ({ name, layer })).sort((a, b) => a.layer - b.layer);
  }
}

/**
 * Bidirectional tag index over entity ids.
 *
 * Both directions are maintained because both queries are common and both are
 * hot: "what tags does this entity have?" during a per-entity check, and "which
 * entities are flammable?" when an explosion goes off.
 */
export class TagIndex {
  readonly #byEntity = new Map<string, Set<string>>();
  readonly #byTag = new Map<string, Set<string>>();

  add(entityId: string, ...tags: readonly string[]): void {
    for (const raw of tags) {
      const tag = requireTag(raw);
      let entityTags = this.#byEntity.get(entityId);
      if (!entityTags) {
        entityTags = new Set();
        this.#byEntity.set(entityId, entityTags);
      }
      entityTags.add(tag);
      let tagged = this.#byTag.get(tag);
      if (!tagged) {
        tagged = new Set();
        this.#byTag.set(tag, tagged);
      }
      tagged.add(entityId);
    }
  }

  remove(entityId: string, ...tags: readonly string[]): void {
    const entityTags = this.#byEntity.get(entityId);
    if (!entityTags) return;
    for (const raw of tags) {
      const tag = requireTag(raw);
      entityTags.delete(tag);
      const tagged = this.#byTag.get(tag);
      tagged?.delete(entityId);
      if (tagged?.size === 0) this.#byTag.delete(tag);
    }
    if (entityTags.size === 0) this.#byEntity.delete(entityId);
  }

  /** Drops an entity entirely. Call when an entity is destroyed, or the index
   * keeps it alive in every tag it held. */
  forget(entityId: string): void {
    const entityTags = this.#byEntity.get(entityId);
    if (!entityTags) return;
    for (const tag of entityTags) {
      const tagged = this.#byTag.get(tag);
      tagged?.delete(entityId);
      if (tagged?.size === 0) this.#byTag.delete(tag);
    }
    this.#byEntity.delete(entityId);
  }

  has(entityId: string, tag: string): boolean {
    return this.#byEntity.get(entityId)?.has(requireTag(tag)) ?? false;
  }

  hasAll(entityId: string, ...tags: readonly string[]): boolean {
    return tags.every((tag) => this.has(entityId, tag));
  }

  hasAny(entityId: string, ...tags: readonly string[]): boolean {
    return tags.some((tag) => this.has(entityId, tag));
  }

  tagsOf(entityId: string): readonly string[] {
    return [...(this.#byEntity.get(entityId) ?? [])].sort();
  }

  entitiesWith(tag: string): readonly string[] {
    return [...(this.#byTag.get(requireTag(tag)) ?? [])];
  }

  /** Entities carrying every listed tag. Starts from the smallest tag set, so
   * the cost is proportional to the rarest tag rather than the commonest. */
  entitiesWithAll(...tags: readonly string[]): readonly string[] {
    if (tags.length === 0) return [];
    const sets = tags.map((tag) => this.#byTag.get(requireTag(tag)) ?? new Set<string>());
    sets.sort((a, b) => a.size - b.size);
    const [smallest, ...rest] = sets as [Set<string>, ...Set<string>[]];
    return [...smallest].filter((entityId) => rest.every((set) => set.has(entityId)));
  }

  get tags(): readonly string[] {
    return [...this.#byTag.keys()].sort();
  }

  clear(): void {
    this.#byEntity.clear();
    this.#byTag.clear();
  }
}

/** Named, hand-maintained collections of entity ids. */
export class GroupRegistry {
  readonly #groups = new Map<string, Set<string>>();

  add(group: string, ...entityIds: readonly string[]): void {
    const name = requireTag(group);
    let members = this.#groups.get(name);
    if (!members) {
      members = new Set();
      this.#groups.set(name, members);
    }
    for (const entityId of entityIds) members.add(entityId);
  }

  remove(group: string, ...entityIds: readonly string[]): void {
    const members = this.#groups.get(requireTag(group));
    if (!members) return;
    for (const entityId of entityIds) members.delete(entityId);
    if (members.size === 0) this.#groups.delete(requireTag(group));
  }

  /** Removes an entity from every group it belongs to. */
  forget(entityId: string): void {
    for (const [name, members] of [...this.#groups]) {
      members.delete(entityId);
      if (members.size === 0) this.#groups.delete(name);
    }
  }

  members(group: string): readonly string[] {
    return [...(this.#groups.get(requireTag(group)) ?? [])];
  }

  contains(group: string, entityId: string): boolean {
    return this.#groups.get(requireTag(group))?.has(entityId) ?? false;
  }

  groupsOf(entityId: string): readonly string[] {
    return [...this.#groups.entries()].filter(([, members]) => members.has(entityId)).map(([name]) => name).sort();
  }

  get names(): readonly string[] {
    return [...this.#groups.keys()].sort();
  }

  clear(): void {
    this.#groups.clear();
  }
}

function requireTag(value: string): string {
  const tag = value.trim();
  if (!tag) throw new Error("A tag or group name must not be empty.");
  return tag;
}
