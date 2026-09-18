/** Typed, reference-counted handles to loaded resources.
 *
 * A handle is **one owned reference**, not a shared pointer that can be copied
 * freely: whoever obtains a handle is responsible for releasing it exactly
 * once, and a second reference is minted explicitly with {@link
 * ResourceHandle.retain}. Making sharing explicit is what lets the manager know
 * when a resource is genuinely unused, which is the whole point — a long-running
 * game that never learns this leaks until the tab dies.
 */
/** Formats a key for logs, diagnostics, and error messages. */
export function formatResourceKey(key) {
    return `${key.type}:${key.id}`;
}
/**
 * A live reference to a loaded resource.
 *
 * Reading {@link value} after {@link release} throws rather than returning a
 * disposed object, because use-after-release is a bug that is far cheaper to
 * find at the access than three frames later inside the renderer.
 */
export class ResourceHandle {
    #owner;
    #key;
    #released = false;
    /** @internal Handles are minted by the manager, never constructed directly. */
    constructor(owner, key) {
        this.#owner = owner;
        this.#key = key;
    }
    get type() {
        return this.#key.type;
    }
    get id() {
        return this.#key.id;
    }
    get key() {
        return this.#key;
    }
    get released() {
        return this.#released;
    }
    get value() {
        if (this.#released) {
            throw new Error(`Resource ${formatResourceKey(this.#key)} was used after its handle was released.`);
        }
        return this.#owner.resolveValue(this.#key);
    }
    /** Mints a second independent reference. Both must be released. */
    retain() {
        if (this.#released) {
            throw new Error(`Resource ${formatResourceKey(this.#key)} cannot be retained after its handle was released.`);
        }
        this.#owner.retainHandle(this.#key);
        return new ResourceHandle(this.#owner, this.#key);
    }
    /**
     * Drops this reference. Releasing twice throws: a double release corrupts the
     * reference count, which would let a resource still in use be disposed.
     */
    release() {
        if (this.#released) {
            throw new Error(`Resource ${formatResourceKey(this.#key)} was released twice.`);
        }
        this.#released = true;
        this.#owner.releaseHandle(this.#key);
    }
}
/** Releases a group of handles, tolerating ones already released. Useful in
 * teardown paths where partial construction may have occurred. */
export function releaseAll(handles) {
    for (const handle of handles) {
        if (!handle.released)
            handle.release();
    }
}
//# sourceMappingURL=handle.js.map