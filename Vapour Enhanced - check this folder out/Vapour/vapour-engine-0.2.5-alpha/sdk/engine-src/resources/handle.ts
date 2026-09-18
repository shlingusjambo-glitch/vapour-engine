/** Typed, reference-counted handles to loaded resources.
 *
 * A handle is **one owned reference**, not a shared pointer that can be copied
 * freely: whoever obtains a handle is responsible for releasing it exactly
 * once, and a second reference is minted explicitly with {@link
 * ResourceHandle.retain}. Making sharing explicit is what lets the manager know
 * when a resource is genuinely unused, which is the whole point — a long-running
 * game that never learns this leaks until the tab dies.
 */

export type ResourceType = string;

/** A resource's identity: its loader type plus an id unique within that type. */
export interface ResourceKey {
  readonly type: ResourceType;
  readonly id: string;
}

/** Formats a key for logs, diagnostics, and error messages. */
export function formatResourceKey(key: ResourceKey): string {
  return `${key.type}:${key.id}`;
}

/** Implemented by {@link ResourceManager}; kept separate so handles do not need
 * a concrete manager type and cannot reach into its internals. */
export interface ResourceOwner {
  releaseHandle(key: ResourceKey): void;
  retainHandle(key: ResourceKey): void;
  resolveValue(key: ResourceKey): unknown;
}

/**
 * A live reference to a loaded resource.
 *
 * Reading {@link value} after {@link release} throws rather than returning a
 * disposed object, because use-after-release is a bug that is far cheaper to
 * find at the access than three frames later inside the renderer.
 */
export class ResourceHandle<T> {
  readonly #owner: ResourceOwner;
  readonly #key: ResourceKey;
  #released = false;

  /** @internal Handles are minted by the manager, never constructed directly. */
  constructor(owner: ResourceOwner, key: ResourceKey) {
    this.#owner = owner;
    this.#key = key;
  }

  get type(): ResourceType {
    return this.#key.type;
  }

  get id(): string {
    return this.#key.id;
  }

  get key(): ResourceKey {
    return this.#key;
  }

  get released(): boolean {
    return this.#released;
  }

  get value(): T {
    if (this.#released) {
      throw new Error(`Resource ${formatResourceKey(this.#key)} was used after its handle was released.`);
    }
    return this.#owner.resolveValue(this.#key) as T;
  }

  /** Mints a second independent reference. Both must be released. */
  retain(): ResourceHandle<T> {
    if (this.#released) {
      throw new Error(`Resource ${formatResourceKey(this.#key)} cannot be retained after its handle was released.`);
    }
    this.#owner.retainHandle(this.#key);
    return new ResourceHandle<T>(this.#owner, this.#key);
  }

  /**
   * Drops this reference. Releasing twice throws: a double release corrupts the
   * reference count, which would let a resource still in use be disposed.
   */
  release(): void {
    if (this.#released) {
      throw new Error(`Resource ${formatResourceKey(this.#key)} was released twice.`);
    }
    this.#released = true;
    this.#owner.releaseHandle(this.#key);
  }
}

/** Releases a group of handles, tolerating ones already released. Useful in
 * teardown paths where partial construction may have occurred. */
export function releaseAll(handles: Iterable<ResourceHandle<unknown>>): void {
  for (const handle of handles) {
    if (!handle.released) handle.release();
  }
}
