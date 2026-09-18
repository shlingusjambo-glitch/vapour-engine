/** Header (as Int32 words): generation, active buffer index, tick, body count. */
var Header;
(function (Header) {
    Header[Header["GENERATION"] = 0] = "GENERATION";
    Header[Header["ACTIVE"] = 1] = "ACTIVE";
    Header[Header["TICK"] = 2] = "TICK";
    Header[Header["BODY_COUNT"] = 3] = "BODY_COUNT";
})(Header || (Header = {}));
const HEADER_INT32_LENGTH = 4;
const HEADER_BYTE_LENGTH = HEADER_INT32_LENGTH * Int32Array.BYTES_PER_ELEMENT;
/** Floats per body: id, position(3), rotation(4), linearVelocity(3), angularVelocity(3), sleeping(1). */
export const PHYSICS_WORKER_BODY_STRIDE = 15;
/** Total byte length a channel over `maxBodies` bodies needs. */
export function physicsWorkerBufferByteLength(maxBodies) {
    if (!Number.isInteger(maxBodies) || maxBodies < 1)
        throw new Error("physicsWorkerBufferByteLength requires a positive whole body capacity.");
    const bufferBytes = maxBodies * PHYSICS_WORKER_BODY_STRIDE * Float32Array.BYTES_PER_ELEMENT;
    return HEADER_BYTE_LENGTH + bufferBytes * 2;
}
/**
 * Whether a real cross-thread channel can be used: the runtime has
 * `SharedArrayBuffer` at all, and — where the flag exists — the page is
 * cross-origin isolated. Node and older/unflagged browser contexts fail this,
 * which is exactly when {@link physicsWorkerBufferByteLength}'s buffer should
 * be a plain `ArrayBuffer` and the worker skipped in favour of stepping
 * physics synchronously on the main thread.
 */
export function isSharedPhysicsBufferAvailable() {
    if (typeof SharedArrayBuffer === "undefined")
        return false;
    const flag = globalThis.crossOriginIsolated;
    return flag === undefined || flag === true;
}
/** Allocates the right buffer type for this runtime: `SharedArrayBuffer` when
 * {@link isSharedPhysicsBufferAvailable}, otherwise a plain `ArrayBuffer` for
 * the same-thread fallback — same layout, same {@link PhysicsWorkerChannel}. */
export function createPhysicsWorkerBuffer(maxBodies) {
    const bytes = physicsWorkerBufferByteLength(maxBodies);
    return isSharedPhysicsBufferAvailable() ? new SharedArrayBuffer(bytes) : new ArrayBuffer(bytes);
}
/**
 * One channel over one shared buffer. A worker (or, in the fallback, the same
 * thread) calls {@link publish} once per physics step; the main thread calls
 * {@link consume} once per render frame. Both sides construct the same class
 * over the same buffer — there is no separate "producer" or "consumer" type,
 * because there is no behavioural difference between them beyond which
 * method gets called.
 */
export class PhysicsWorkerChannel {
    #maxBodies;
    #header;
    #buffers;
    constructor(buffer, maxBodies) {
        if (buffer.byteLength !== physicsWorkerBufferByteLength(maxBodies)) {
            throw new Error(`Physics worker buffer is the wrong size for ${String(maxBodies)} bodies: expected ${String(physicsWorkerBufferByteLength(maxBodies))} bytes, got ${String(buffer.byteLength)}.`);
        }
        this.#maxBodies = maxBodies;
        this.#header = new Int32Array(buffer, 0, HEADER_INT32_LENGTH);
        const bodyFloats = maxBodies * PHYSICS_WORKER_BODY_STRIDE;
        const bufferBytes = bodyFloats * Float32Array.BYTES_PER_ELEMENT;
        this.#buffers = [
            new Float32Array(buffer, HEADER_BYTE_LENGTH, bodyFloats),
            new Float32Array(buffer, HEADER_BYTE_LENGTH + bufferBytes, bodyFloats),
        ];
    }
    get maxBodies() {
        return this.#maxBodies;
    }
    /** Writes one step's bodies into the buffer the reader is not using, then
     * publishes it. `bodies.length` must not exceed {@link maxBodies}. */
    publish(tick, bodies) {
        if (bodies.length > this.#maxBodies) {
            throw new Error(`Physics worker channel holds at most ${String(this.#maxBodies)} bodies, got ${String(bodies.length)}.`);
        }
        const generation = Atomics.load(this.#header, Header.GENERATION);
        const target = Atomics.load(this.#header, Header.ACTIVE) === 0 ? 1 : 0;
        const view = this.#buffers[target];
        for (const [index, body] of bodies.entries())
            writeBody(view, index * PHYSICS_WORKER_BODY_STRIDE, body);
        // Odd generation marks "publish in progress" for a reader that happens to
        // sample it mid-write; even marks a complete, consistent publish.
        Atomics.store(this.#header, Header.GENERATION, generation + 1);
        Atomics.store(this.#header, Header.TICK, tick);
        Atomics.store(this.#header, Header.BODY_COUNT, bodies.length);
        Atomics.store(this.#header, Header.ACTIVE, target);
        Atomics.store(this.#header, Header.GENERATION, generation + 2);
    }
    /** Reads the most recently published step, retrying on a torn read (the
     * generation moved while copying). Returns `undefined` only if nothing has
     * ever been published, or `maxRetries` is exhausted — the latter would mean
     * a writer publishing faster than this reader can copy, which a single
     * physics-step producer should never sustain. */
    consume(maxRetries = 8) {
        for (let attempt = 0; attempt < maxRetries; attempt += 1) {
            const before = Atomics.load(this.#header, Header.GENERATION);
            if (before === 0 || before % 2 !== 0)
                continue; // nothing published yet, or a publish is in flight
            const active = Atomics.load(this.#header, Header.ACTIVE);
            const tick = Atomics.load(this.#header, Header.TICK);
            const count = Atomics.load(this.#header, Header.BODY_COUNT);
            const view = this.#buffers[active];
            const bodies = new Array(count);
            for (let index = 0; index < count; index += 1)
                bodies[index] = readBody(view, index * PHYSICS_WORKER_BODY_STRIDE);
            const after = Atomics.load(this.#header, Header.GENERATION);
            if (before === after)
                return { tick, bodies };
            // Torn: the writer published again while this read was in flight.
        }
        return undefined;
    }
}
function writeBody(view, offset, body) {
    view[offset] = body.id;
    view[offset + 1] = body.position[0];
    view[offset + 2] = body.position[1];
    view[offset + 3] = body.position[2];
    view[offset + 4] = body.rotation[0];
    view[offset + 5] = body.rotation[1];
    view[offset + 6] = body.rotation[2];
    view[offset + 7] = body.rotation[3];
    view[offset + 8] = body.linearVelocity[0];
    view[offset + 9] = body.linearVelocity[1];
    view[offset + 10] = body.linearVelocity[2];
    view[offset + 11] = body.angularVelocity[0];
    view[offset + 12] = body.angularVelocity[1];
    view[offset + 13] = body.angularVelocity[2];
    view[offset + 14] = body.sleeping ? 1 : 0;
}
function readBody(view, offset) {
    return {
        id: view[offset],
        position: [view[offset + 1], view[offset + 2], view[offset + 3]],
        rotation: [view[offset + 4], view[offset + 5], view[offset + 6], view[offset + 7]],
        linearVelocity: [view[offset + 8], view[offset + 9], view[offset + 10]],
        angularVelocity: [view[offset + 11], view[offset + 12], view[offset + 13]],
        sleeping: view[offset + 14] !== 0,
    };
}
//# sourceMappingURL=physics-worker-protocol.js.map