/** Incremental render-world extraction.
 *
 * `extractRenderWorld` rebuilds everything every frame: it revalidates the
 * scene, resolves every world matrix through a chain of matrix multiplies, and
 * allocates a fresh snapshot object per instance. For a demo that is fine. For
 * ten thousand objects it is the single largest cost in the frame, and almost
 * all of it is recomputing values that did not change — a static building does
 * not need its world matrix rebuilt sixty times a second.
 *
 * This extractor keeps the previous frame's results and recomputes only what
 * changed. Both paths call the same {@link extractEntityContribution}, so the
 * incremental output is identical to the full one; the tests assert that
 * equivalence directly rather than trusting it.
 *
 * Change detection is by **content**, not by object identity: `SceneDocument`
 * mutates entity objects in place, so a reference comparison would silently
 * miss edits. Each entity's render-relevant fields are captured in a compact
 * numeric signature and compared element-wise, which is far cheaper than the
 * matrix chain and allocations it avoids.
 */
import {
  validateScene,
  type SceneChange,
  type SceneData,
  type SceneEntityData,
  type SceneDocument,
} from "../core/scene-document.js";
import {
  RENDER_WORLD_VERSION,
  extractEntityContribution,
  type RenderCameraSnapshot,
  type RenderDirectionalLightSnapshot,
  type RenderInstanceSnapshot,
  type RenderWorldSnapshot,
} from "./render-world.js";

export interface IncrementalExtractStats {
  /** Entities examined this frame. */
  readonly entities: number;
  /** Entities whose contribution was recomputed. */
  readonly recomputed: number;
  /** Entities served entirely from the previous frame. */
  readonly reused: number;
  /** True when the scene's structure changed and everything was rebuilt. */
  readonly fullRebuild: boolean;
  /** True when change detection came from observed document events rather than
   * from comparing every entity. */
  readonly observed: boolean;
}

interface CachedEntity {
  /** Render-relevant numeric fields, compared element-wise for change detection. */
  signature: number[];
  parent: string | undefined;
  enabled: boolean;
  worldMatrix: number[];
  active: boolean;
  instances: readonly RenderInstanceSnapshot[];
  camera: RenderCameraSnapshot | undefined;
  directionalLight: RenderDirectionalLightSnapshot | undefined;
}

/**
 * A stateful extractor that reuses unchanged work between frames.
 *
 * One instance per rendered world. Call {@link extract} each frame with the
 * current scene; call {@link invalidate} if the scene was changed in a way the
 * extractor cannot observe (which should not happen, but is cheap insurance).
 */
export class IncrementalRenderWorld {
  readonly #cache = new Map<string, CachedEntity>();
  readonly #validated = new WeakSet<object>();
  readonly #observedDirty = new Set<string>();
  #stats: IncrementalExtractStats = {
    entities: 0,
    recomputed: 0,
    reused: 0,
    fullRebuild: false,
    observed: false,
  };
  #primed = false;
  #observing = false;
  #observedStructuralChange = false;
  #unobserve: (() => void) | undefined;

  get stats(): IncrementalExtractStats {
    return this.#stats;
  }

  /** Forces the next extraction to rebuild everything. */
  invalidate(): void {
    this.#cache.clear();
    this.#primed = false;
    this.#observedDirty.clear();
    this.#observedStructuralChange = true;
  }

  /**
   * Subscribes to a scene document's change events.
   *
   * Comparing every entity every frame is the general solution, and it still
   * costs time proportional to the scene. A document tells the extractor
   * exactly which entities changed, so an observed scene that nothing touched
   * costs nothing at all — which is the case a static open world is in for most
   * of its frames.
   *
   * Returns an unsubscribe function. Observing a second document replaces the
   * first.
   */
  observe(document: SceneDocument): () => void {
    this.#unobserve?.();
    const listener = (event: Event): void => {
      const change = (event as CustomEvent<SceneChange>).detail;
      if (change.type === "entity-changed") this.#observedDirty.add(change.id);
      else this.#observedStructuralChange = true;
    };
    document.addEventListener("change", listener);
    this.#observing = true;
    // Everything is unknown until the first extraction after attaching.
    this.#observedStructuralChange = true;
    this.#unobserve = () => {
      document.removeEventListener("change", listener);
      this.#observing = false;
      this.#unobserve = undefined;
    };
    return this.#unobserve;
  }

  extract(scene: SceneData): RenderWorldSnapshot {
    // Validation walks every entity and component, so do it once per distinct
    // scene object and whenever the entity set changes — not every frame.
    const structural = this.#isStructuralChange(scene);
    if (structural || !this.#validated.has(scene)) {
      validateScene(scene);
      this.#validated.add(scene);
    }
    if (structural) this.#cache.clear();

    const byId = new Map(scene.entities.map((entity) => [entity.id, entity]));
    const observed = this.#observing && !structural;
    const dirty = new Set<string>();

    if (observed) {
      // The document said exactly what changed; no comparison walk needed.
      for (const id of this.#observedDirty) dirty.add(id);
      for (const entity of scene.entities) {
        if (!this.#cache.has(entity.id)) dirty.add(entity.id);
      }
    } else {
      // Pass one: which entities changed in themselves?
      for (const entity of scene.entities) {
        const cached = this.#cache.get(entity.id);
        if (cached === undefined || !this.#matches(cached, entity))
          dirty.add(entity.id);
      }
    }
    this.#observedDirty.clear();

    // Pass two: a changed transform moves every descendant, so dirt inherits.
    if (dirty.size > 0) {
      for (const entity of scene.entities) {
        if (dirty.has(entity.id)) continue;
        let cursor = entity.parent;
        while (cursor !== undefined) {
          if (dirty.has(cursor)) {
            dirty.add(entity.id);
            break;
          }
          cursor = byId.get(cursor)?.parent;
        }
      }
    }

    const instances: RenderInstanceSnapshot[] = [];
    let camera: RenderCameraSnapshot | undefined;
    let directionalLight: RenderDirectionalLightSnapshot | undefined;
    let recomputed = 0;

    for (const entity of scene.entities) {
      let cached = this.#cache.get(entity.id);
      if (cached === undefined || dirty.has(entity.id)) {
        cached = this.#rebuild(entity, byId);
        recomputed += 1;
      }
      if (cached.active) {
        if (camera === undefined && cached.camera !== undefined)
          camera = cached.camera;
        if (
          directionalLight === undefined &&
          cached.directionalLight !== undefined
        )
          directionalLight = cached.directionalLight;
        for (const instance of cached.instances) instances.push(instance);
      }
    }

    this.#primed = true;
    this.#stats = {
      entities: scene.entities.length,
      recomputed,
      reused: scene.entities.length - recomputed,
      fullRebuild: structural,
      observed,
    };
    return {
      version: RENDER_WORLD_VERSION,
      ...(camera === undefined ? {} : { camera }),
      ...(directionalLight === undefined ? {} : { directionalLight }),
      instances,
    };
  }

  #isStructuralChange(scene: SceneData): boolean {
    if (this.#observing) {
      // An observed document reports structural edits directly, so the id scan
      // below — the part that is proportional to scene size — is unnecessary.
      // The flag is consumed here even on the first frame, so the priming
      // rebuild does not leave it set for the frame after.
      const changed = this.#observedStructuralChange || !this.#primed;
      this.#observedStructuralChange = false;
      return changed;
    }
    if (!this.#primed) return true;
    if (scene.entities.length !== this.#cache.size) return true;
    for (const entity of scene.entities) {
      if (!this.#cache.has(entity.id)) return true;
    }
    return false;
  }

  #matches(cached: CachedEntity, entity: SceneEntityData): boolean {
    if (cached.enabled !== entity.enabled || cached.parent !== entity.parent)
      return false;
    // Compared in place against the cached array rather than by building a new
    // signature. For a mostly-static scene this runs for every entity every
    // frame, so it is written to allocate nothing at all: a module-scoped
    // cursor, indexed loops instead of iterators, and `for...in` instead of
    // `Object.entries`. Building a fresh signature here cost more than the
    // extraction work it was meant to save.
    cursor = 0;
    const signature = cached.signature;
    const components = entity.components;
    for (let index = 0; index < components.length; index += 1) {
      const component = components[index]!;
      if (signature[cursor++] !== hashString(component.typeName)) return false;
      if (signature[cursor++] !== component.version) return false;
      if (!compareValue(signature, component.data, 0)) return false;
    }
    return cursor === signature.length;
  }

  #rebuild(
    entity: SceneEntityData,
    byId: ReadonlyMap<string, SceneEntityData>,
  ): CachedEntity {
    const parentCache =
      entity.parent === undefined ? undefined : this.#cache.get(entity.parent);
    // Parents precede children in a valid scene document's entity order, so by
    // the time a child is rebuilt its parent's cache entry is already current.
    const parentMatrix = parentCache?.worldMatrix;
    const parentActive =
      entity.parent === undefined
        ? true
        : (parentCache?.active ?? this.#resolveActive(entity.parent, byId));
    const local = localMatrix(entity);
    const worldMatrix =
      parentMatrix === undefined ? local : multiply(parentMatrix, local);
    const active = entity.enabled && parentActive;
    const contribution = active
      ? extractEntityContribution(entity, worldMatrix)
      : { instances: [] };
    const cached: CachedEntity = {
      signature: entitySignature(entity),
      parent: entity.parent,
      enabled: entity.enabled,
      worldMatrix,
      active,
      instances: contribution.instances,
      camera: contribution.camera,
      directionalLight: contribution.directionalLight,
    };
    this.#cache.set(entity.id, cached);
    return cached;
  }

  /** Fallback for the rare case where a parent has no cache entry yet. */
  #resolveActive(
    id: string,
    byId: ReadonlyMap<string, SceneEntityData>,
  ): boolean {
    const entity = byId.get(id);
    if (!entity) throw new Error(`Entity references missing parent '${id}'.`);
    if (!entity.enabled) return false;
    return entity.parent === undefined
      ? true
      : this.#resolveActive(entity.parent, byId);
  }
}

/**
 * A compact numeric fingerprint of everything the extractor reads.
 *
 * Non-numeric values (mesh and material ids) are folded in as a string hash, so
 * the whole comparison stays a numeric array scan. A hash collision would miss
 * a material change; the 32-bit FNV-1a used here makes that vanishingly
 * unlikely for the short identifier strings involved.
 */
function entitySignature(entity: SceneEntityData): number[] {
  const signature: number[] = [];
  for (const component of entity.components) {
    signature.push(hashString(component.typeName), component.version);
    appendValue(signature, component.data, 0);
  }
  return signature;
}

const MAX_SIGNATURE_DEPTH = 4;

function appendValue(signature: number[], value: unknown, depth: number): void {
  if (depth > MAX_SIGNATURE_DEPTH) return;
  if (typeof value === "number") {
    signature.push(value);
    return;
  }
  if (typeof value === "boolean") {
    signature.push(value ? 1 : 0);
    return;
  }
  if (typeof value === "string") {
    signature.push(hashString(value));
    return;
  }
  if (value === null || value === undefined) {
    signature.push(Number.NEGATIVE_INFINITY);
    return;
  }
  if (Array.isArray(value)) {
    signature.push(value.length);
    for (const element of value) appendValue(signature, element, depth + 1);
    return;
  }
  if (typeof value === "object") {
    // `for...in` to match compareValue's traversal exactly. Key order is stable
    // for a given component shape, and a reordered object with the same values
    // renders identically, so sorting is not needed.
    for (const key in value as Record<string, unknown>) {
      if (!Object.hasOwn(value as object, key)) continue;
      signature.push(hashString(key));
      appendValue(
        signature,
        (value as Record<string, unknown>)[key],
        depth + 1,
      );
    }
  }
}

/** Read cursor for {@link compareValue}. Module scoped so the comparison walk
 * allocates nothing; the extractor is single threaded and never re-enters it. */
let cursor = 0;

/** Compares one value against the cached signature, advancing {@link cursor}. */
function compareValue(
  signature: readonly number[],
  value: unknown,
  depth: number,
): boolean {
  if (depth > MAX_SIGNATURE_DEPTH) return true;
  const type = typeof value;
  if (type === "number") return signature[cursor++] === value;
  if (type === "boolean")
    return signature[cursor++] === (value === true ? 1 : 0);
  if (type === "string")
    return signature[cursor++] === hashString(value as string);
  if (value === null || value === undefined)
    return signature[cursor++] === Number.NEGATIVE_INFINITY;
  if (Array.isArray(value)) {
    if (signature[cursor++] !== value.length) return false;
    for (let index = 0; index < value.length; index += 1) {
      if (!compareValue(signature, value[index], depth + 1)) return false;
    }
    return true;
  }
  if (type === "object") {
    for (const key in value as Record<string, unknown>) {
      if (!Object.hasOwn(value as object, key)) continue;
      if (signature[cursor++] !== hashString(key)) return false;
      if (
        !compareValue(
          signature,
          (value as Record<string, unknown>)[key],
          depth + 1,
        )
      )
        return false;
    }
  }
  return true;
}

/**
 * Cache for {@link hashString}.
 *
 * The strings hashed here are component type names and field keys — a small,
 * fixed set repeated for every entity every frame. Hashing them fresh each time
 * dominated the comparison walk; caching turns it into a map lookup.
 */
const hashCache = new Map<string, number>();

function hashString(value: string): number {
  const cached = hashCache.get(value);
  if (cached !== undefined) return cached;
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  const result = hash >>> 0;
  // Bounded so a game generating unique strings per frame cannot leak here.
  if (hashCache.size < 4096) hashCache.set(value, result);
  return result;
}

function localMatrix(entity: SceneEntityData): number[] {
  const transform = entity.components.find(
    (component) => component.typeName === "vapour.Transform",
  );
  if (transform === undefined)
    throw new Error(
      `Renderable entity '${entity.name}' has no Transform component.`,
    );
  const data = transform.data as {
    position?: number[];
    rotation?: number[];
    scale?: number[];
  };
  const [px, py, pz] = data.position ?? [0, 0, 0];
  const rotation = data.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = data.scale ?? [1, 1, 1];
  const length =
    Math.hypot(
      rotation[0] ?? 0,
      rotation[1] ?? 0,
      rotation[2] ?? 0,
      rotation[3] ?? 1,
    ) || 1;
  const [x, y, z, w] = [
    (rotation[0] ?? 0) / length,
    (rotation[1] ?? 0) / length,
    (rotation[2] ?? 0) / length,
    (rotation[3] ?? 1) / length,
  ];
  const [x2, y2, z2] = [x + x, y + y, z + z];
  const [xx, xy, xz] = [x * x2, x * y2, x * z2];
  const [yy, yz, zz] = [y * y2, y * z2, z * z2];
  const [wx, wy, wz] = [w * x2, w * y2, w * z2];
  return [
    (1 - (yy + zz)) * (sx ?? 1),
    (xy + wz) * (sx ?? 1),
    (xz - wy) * (sx ?? 1),
    0,
    (xy - wz) * (sy ?? 1),
    (1 - (xx + zz)) * (sy ?? 1),
    (yz + wx) * (sy ?? 1),
    0,
    (xz + wy) * (sz ?? 1),
    (yz - wx) * (sz ?? 1),
    (1 - (xx + yy)) * (sz ?? 1),
    0,
    px ?? 0,
    py ?? 0,
    pz ?? 0,
    1,
  ];
}

function multiply(left: readonly number[], right: readonly number[]): number[] {
  const out = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[column * 4 + row] =
        left[row]! * right[column * 4]! +
        left[4 + row]! * right[column * 4 + 1]! +
        left[8 + row]! * right[column * 4 + 2]! +
        left[12 + row]! * right[column * 4 + 3]!;
    }
  }
  return out;
}
