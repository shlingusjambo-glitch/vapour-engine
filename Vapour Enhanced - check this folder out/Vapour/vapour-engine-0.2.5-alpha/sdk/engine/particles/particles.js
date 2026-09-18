/** Particle simulation.
 *
 * Explosions, smoke, sparks, weather, dust, fire, magic — all of them are the
 * same thing: many short-lived points with a position, a velocity, and
 * properties that change over their lifetime. The design consequence is that a
 * particle system is a *data layout* problem before it is a visual one.
 *
 * So particles live in flat typed arrays, not objects. Ten thousand particle
 * objects allocate ten thousand times, scatter across the heap, and hand the
 * garbage collector a frame-time spike exactly when the explosion goes off. The
 * arrays here are allocated once at the emitter's capacity and reused forever;
 * a running system allocates nothing.
 *
 * Simulation is deterministic given a seed, so an effect looks the same on
 * every machine and can be replicated by seed rather than by particle.
 */
import { evaluateCurve, evaluateGradient } from "@vapour/math";
const DEFAULTS = {
    capacity: 1024,
    rate: 50,
    burst: 0,
    lifetime: [1, 2],
    speed: [1, 3],
    gravity: [0, -9.81, 0],
    drag: 1,
    angularSpeed: [0, 0],
    space: "world",
    seed: 1,
    loop: true,
};
/**
 * One particle system.
 *
 * `update` advances the simulation; `buffers()` exposes the result for a
 * renderer. Nothing here draws, which is what lets the same emitter feed the
 * WebGPU renderer, a 2D canvas, or a test.
 */
export class ParticleEmitter {
    capacity;
    #options;
    #rate;
    #burst;
    #lifetime;
    #speed;
    #gravity;
    #drag;
    #angularSpeed;
    #space;
    #duration;
    #loop;
    #collision;
    #trailSegments;
    #trailMinDistance;
    // Flat, reused, never reallocated.
    #position;
    #velocity;
    #age;
    #life;
    #rotation;
    #spin;
    #outSize;
    #outColor;
    #outAge;
    #trailPosition;
    #trailCount;
    #count = 0;
    #emissionDebt = 0;
    #elapsed = 0;
    #playing = false;
    #emitted = 0;
    #expired = 0;
    #dropped = 0;
    #collisions = 0;
    #origin = [0, 0, 0];
    #random;
    constructor(options = {}) {
        const capacity = options.capacity ?? DEFAULTS.capacity;
        if (!Number.isInteger(capacity) || capacity < 1)
            throw new Error("A particle emitter needs a capacity of at least 1.");
        const rate = options.rate ?? DEFAULTS.rate;
        if (!(rate >= 0))
            throw new Error("A particle emission rate must not be negative.");
        const burst = options.burst ?? DEFAULTS.burst;
        if (!Number.isInteger(burst) || burst < 0)
            throw new Error("A particle burst must be a non-negative whole number.");
        const lifetime = options.lifetime ?? DEFAULTS.lifetime;
        if (!(lifetime[0] > 0) || lifetime[1] < lifetime[0])
            throw new Error("A particle lifetime must be a positive [min, max] range.");
        const speed = options.speed ?? DEFAULTS.speed;
        if (speed[1] < speed[0])
            throw new Error("A particle speed must be an ordered [min, max] range.");
        const drag = options.drag ?? DEFAULTS.drag;
        if (!(drag >= 0))
            throw new Error("Particle drag must not be negative.");
        if (options.duration !== undefined && !(options.duration > 0))
            throw new Error("A particle duration must be positive.");
        const trailSegments = options.trail?.segments ?? 0;
        if (!Number.isInteger(trailSegments) || trailSegments < 0 || trailSegments > 256)
            throw new Error("Particle trail segments must be a whole number in [0, 256].");
        const trailMinDistance = options.trail?.minDistance ?? 0.02;
        if (!Number.isFinite(trailMinDistance) || trailMinDistance < 0)
            throw new Error("Particle trail minimum distance must be finite and non-negative.");
        if (options.collision?.restitution !== undefined && (!Number.isFinite(options.collision.restitution) || options.collision.restitution < 0 || options.collision.restitution > 1))
            throw new Error("Particle collision restitution must lie in [0, 1].");
        this.capacity = capacity;
        this.#options = options;
        this.#rate = rate;
        this.#burst = burst;
        this.#lifetime = lifetime;
        this.#speed = speed;
        this.#gravity = options.gravity ?? DEFAULTS.gravity;
        this.#drag = drag;
        this.#angularSpeed = options.angularSpeed ?? DEFAULTS.angularSpeed;
        this.#space = options.space ?? DEFAULTS.space;
        this.#loop = options.loop ?? DEFAULTS.loop;
        this.#collision = options.collision;
        this.#trailSegments = trailSegments;
        this.#trailMinDistance = trailMinDistance;
        if (options.duration !== undefined)
            this.#duration = options.duration;
        this.#position = new Float32Array(capacity * 3);
        this.#velocity = new Float32Array(capacity * 3);
        this.#age = new Float32Array(capacity);
        this.#life = new Float32Array(capacity);
        this.#rotation = new Float32Array(capacity);
        this.#spin = new Float32Array(capacity);
        this.#outSize = new Float32Array(capacity);
        this.#outColor = new Float32Array(capacity * 4);
        this.#outAge = new Float32Array(capacity);
        this.#trailPosition = new Float32Array(capacity * trailSegments * 3);
        this.#trailCount = new Uint16Array(capacity);
        this.#random = seededRandom(options.seed ?? DEFAULTS.seed);
    }
    get playing() {
        return this.#playing;
    }
    get aliveCount() {
        return this.#count;
    }
    /** Where new particles appear. Moved each frame to follow an entity. */
    setOrigin(origin) {
        if (this.#space === "local") {
            // Local space: existing particles move with the emitter, which is what
            // makes a torch flame stay attached rather than trailing behind.
            const [dx, dy, dz] = [origin[0] - this.#origin[0], origin[1] - this.#origin[1], origin[2] - this.#origin[2]];
            for (let index = 0; index < this.#count; index += 1) {
                this.#position[index * 3] = this.#position[index * 3] + dx;
                this.#position[index * 3 + 1] = this.#position[index * 3 + 1] + dy;
                this.#position[index * 3 + 2] = this.#position[index * 3 + 2] + dz;
                const trailStart = index * this.#trailSegments * 3;
                for (let point = 0; point < this.#trailCount[index]; point += 1) {
                    this.#trailPosition[trailStart + point * 3] = this.#trailPosition[trailStart + point * 3] + dx;
                    this.#trailPosition[trailStart + point * 3 + 1] = this.#trailPosition[trailStart + point * 3 + 1] + dy;
                    this.#trailPosition[trailStart + point * 3 + 2] = this.#trailPosition[trailStart + point * 3 + 2] + dz;
                }
            }
        }
        this.#origin = [origin[0], origin[1], origin[2]];
    }
    play() {
        this.#playing = true;
        this.#elapsed = 0;
        if (this.#burst > 0)
            this.emit(this.#burst);
    }
    /** Stops emitting. Live particles finish their lifetimes. */
    stop() {
        this.#playing = false;
    }
    /** Stops and removes every particle immediately. */
    clear() {
        this.#playing = false;
        this.#count = 0;
        this.#emissionDebt = 0;
        this.#elapsed = 0;
    }
    /** Emits a burst now, regardless of the rate. */
    burst(count = this.#burst) {
        if (!Number.isInteger(count) || count < 0)
            throw new Error("A burst count must be a non-negative whole number.");
        return this.emit(count);
    }
    /** Emits particles, returning how many actually fit. */
    emit(count) {
        let emitted = 0;
        for (let index = 0; index < count; index += 1) {
            if (this.#count >= this.capacity) {
                // Dropping is the right failure: growing the buffer mid-explosion is
                // the allocation spike the flat layout exists to avoid.
                this.#dropped += count - index;
                break;
            }
            this.#spawn(this.#count);
            this.#count += 1;
            emitted += 1;
        }
        this.#emitted += emitted;
        return emitted;
    }
    /** Advances the simulation. */
    update(deltaSeconds) {
        if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0)
            throw new Error("A particle update requires a finite, non-negative delta.");
        if (deltaSeconds === 0)
            return;
        if (this.#playing) {
            this.#elapsed += deltaSeconds;
            if (this.#duration !== undefined && this.#elapsed >= this.#duration) {
                if (this.#loop)
                    this.#elapsed -= this.#duration;
                else
                    this.#playing = false;
            }
        }
        if (this.#playing && this.#rate > 0) {
            // Fractional emission is accumulated, so a rate below one per frame still
            // emits at the right average instead of never emitting at all.
            this.#emissionDebt += this.#rate * deltaSeconds;
            const whole = Math.floor(this.#emissionDebt);
            if (whole > 0) {
                this.#emissionDebt -= whole;
                this.emit(whole);
            }
        }
        const decay = this.#drag === 1 ? 1 : this.#drag ** deltaSeconds;
        for (let index = 0; index < this.#count;) {
            const age = this.#age[index] + deltaSeconds;
            if (age >= this.#life[index]) {
                // Swap-remove: order does not matter to a renderer, and this keeps the
                // live range contiguous without shifting the whole array.
                this.#count -= 1;
                this.#expired += 1;
                if (index !== this.#count)
                    this.#moveParticle(this.#count, index);
                continue;
            }
            this.#age[index] = age;
            const from = [this.#position[index * 3], this.#position[index * 3 + 1], this.#position[index * 3 + 2]];
            const to = [...from];
            for (let axis = 0; axis < 3; axis += 1) {
                const slot = index * 3 + axis;
                const velocity = (this.#velocity[slot] + this.#gravity[axis] * deltaSeconds) * decay;
                this.#velocity[slot] = velocity;
                to[axis] = this.#position[slot] + velocity * deltaSeconds;
            }
            const hit = this.#collision?.query(from, to);
            if (hit) {
                validateCollisionHit(hit);
                this.#collisions += 1;
                const response = this.#collision?.response ?? "bounce";
                if (response === "kill") {
                    this.#count -= 1;
                    this.#expired += 1;
                    if (index !== this.#count)
                        this.#moveParticle(this.#count, index);
                    continue;
                }
                to[0] = hit.point[0];
                to[1] = hit.point[1];
                to[2] = hit.point[2];
                if (response === "stop") {
                    this.#velocity.fill(0, index * 3, index * 3 + 3);
                }
                else {
                    const normal = normalize3(hit.normal);
                    const dot = this.#velocity[index * 3] * normal[0] + this.#velocity[index * 3 + 1] * normal[1] + this.#velocity[index * 3 + 2] * normal[2];
                    const restitution = this.#collision?.restitution ?? 0.5;
                    for (let axis = 0; axis < 3; axis += 1)
                        this.#velocity[index * 3 + axis] = this.#velocity[index * 3 + axis] - (1 + restitution) * dot * normal[axis];
                }
            }
            this.#recordTrail(index, from, to);
            this.#position.set(to, index * 3);
            this.#rotation[index] = this.#rotation[index] + this.#spin[index] * deltaSeconds;
            index += 1;
        }
    }
    /** The current frame's render data. Valid until the next `update`. */
    buffers() {
        for (let index = 0; index < this.#count; index += 1) {
            const t = this.#age[index] / this.#life[index];
            this.#outAge[index] = t;
            this.#outSize[index] = this.#options.size ? evaluateCurve(this.#options.size, t) : 1;
            if (this.#options.color) {
                const color = evaluateGradient(this.#options.color, t);
                this.#outColor.set(color, index * 4);
            }
            else {
                this.#outColor.set([1, 1, 1, 1 - t], index * 4);
            }
        }
        return {
            count: this.#count,
            positions: this.#position,
            sizes: this.#outSize,
            colors: this.#outColor,
            rotations: this.#rotation,
            ages: this.#outAge,
            trailPositions: this.#trailPosition,
            trailCounts: this.#trailCount,
            trailSegments: this.#trailSegments,
        };
    }
    stats() {
        return { alive: this.#count, capacity: this.capacity, emitted: this.#emitted, expired: this.#expired, dropped: this.#dropped, collisions: this.#collisions };
    }
    /** Restarts the sequence, so a replay produces identical particles. */
    reseed(seed) {
        this.#random = seededRandom(seed);
    }
    #spawn(index) {
        const [offset, direction] = this.#sampleShape();
        const speed = this.#speed[0] + this.#random() * (this.#speed[1] - this.#speed[0]);
        for (let axis = 0; axis < 3; axis += 1) {
            this.#position[index * 3 + axis] = this.#origin[axis] + offset[axis];
            this.#velocity[index * 3 + axis] = direction[axis] * speed;
        }
        this.#age[index] = 0;
        this.#life[index] = this.#lifetime[0] + this.#random() * (this.#lifetime[1] - this.#lifetime[0]);
        this.#rotation[index] = this.#random() * Math.PI * 2;
        this.#spin[index] = this.#angularSpeed[0] + this.#random() * (this.#angularSpeed[1] - this.#angularSpeed[0]);
        this.#trailCount[index] = this.#trailSegments > 0 ? 1 : 0;
        if (this.#trailSegments > 0)
            this.#trailPosition.set(this.#position.subarray(index * 3, index * 3 + 3), index * this.#trailSegments * 3);
    }
    #sampleShape() {
        const shape = this.#options.shape ?? { kind: "point" };
        const size = shape.size ?? [1, 1, 1];
        const unit = () => {
            // Rejection-free spherical sampling; uniform on the sphere, unlike
            // normalizing three uniform components which clusters at the corners.
            const z = this.#random() * 2 - 1;
            const theta = this.#random() * Math.PI * 2;
            const r = Math.sqrt(Math.max(0, 1 - z * z));
            return [Math.cos(theta) * r, z, Math.sin(theta) * r];
        };
        switch (shape.kind) {
            case "sphere": {
                const direction = unit();
                const radius = size[0] * Math.cbrt(this.#random());
                return [[direction[0] * radius, direction[1] * radius, direction[2] * radius], direction];
            }
            case "box": {
                const offset = [0, 1, 2].map((axis) => (this.#random() * 2 - 1) * size[axis]);
                return [offset, unit()];
            }
            case "cone": {
                const angle = ((shape.angle ?? 25) * Math.PI) / 180;
                const theta = this.#random() * Math.PI * 2;
                const spread = Math.tan(angle) * this.#random();
                const direction = [Math.cos(theta) * spread, 1, Math.sin(theta) * spread];
                const length = Math.hypot(direction[0], direction[1], direction[2]);
                const radius = size[0] * this.#random();
                return [
                    [Math.cos(theta) * radius, 0, Math.sin(theta) * radius],
                    [direction[0] / length, direction[1] / length, direction[2] / length],
                ];
            }
            default:
                return [[0, 0, 0], unit()];
        }
    }
    #moveParticle(from, to) {
        for (let axis = 0; axis < 3; axis += 1) {
            this.#position[to * 3 + axis] = this.#position[from * 3 + axis];
            this.#velocity[to * 3 + axis] = this.#velocity[from * 3 + axis];
        }
        this.#age[to] = this.#age[from];
        this.#life[to] = this.#life[from];
        this.#rotation[to] = this.#rotation[from];
        this.#spin[to] = this.#spin[from];
        this.#trailCount[to] = this.#trailCount[from];
        if (this.#trailSegments > 0) {
            const stride = this.#trailSegments * 3;
            this.#trailPosition.copyWithin(to * stride, from * stride, from * stride + stride);
        }
    }
    #recordTrail(index, from, to) {
        if (this.#trailSegments === 0 || Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]) < this.#trailMinDistance)
            return;
        const stride = this.#trailSegments * 3;
        const start = index * stride;
        const count = Math.min(this.#trailSegments, this.#trailCount[index] + 1);
        this.#trailPosition.copyWithin(start + 3, start, start + (count - 1) * 3);
        this.#trailPosition.set(to, start);
        this.#trailCount[index] = count;
    }
}
function normalize3(value) {
    const length = Math.hypot(...value);
    if (length < 1e-6)
        throw new Error("A particle collision normal cannot be zero.");
    return value.map((component) => component / length);
}
function validateCollisionHit(hit) {
    if (!hit.point.every(Number.isFinite) || !hit.normal.every(Number.isFinite))
        throw new Error("A particle collision query returned non-finite hit data.");
    normalize3(hit.normal);
}
function seededRandom(seed) {
    let state = (seed >>> 0) || 0x9e3779b9;
    return () => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        return ((state >>> 0) % 1_000_000) / 1_000_000;
    };
}
/**
 * A pool of emitters, so an explosion does not allocate one.
 *
 * Effects are spawned at exactly the moments a game is already busy — an
 * impact, a death, a spell — which is the worst possible time to allocate a
 * thousand-particle buffer.
 */
export class ParticleSystemPool {
    #idle = [];
    #active = new Set();
    #factory;
    #limit;
    constructor(factory, options = {}) {
        const prewarm = options.prewarm ?? 0;
        if (!Number.isInteger(prewarm) || prewarm < 0)
            throw new Error("A particle pool prewarm must be a non-negative whole number.");
        this.#limit = options.maxActive ?? 32;
        if (!Number.isInteger(this.#limit) || this.#limit < 1)
            throw new Error("A particle pool needs room for at least one system.");
        this.#factory = factory;
        for (let index = 0; index < prewarm; index += 1)
            this.#idle.push(factory());
    }
    get activeCount() {
        return this.#active.size;
    }
    get idleCount() {
        return this.#idle.length;
    }
    /** Takes an emitter and plays it at a position, or `undefined` when full. */
    spawn(origin) {
        if (this.#active.size >= this.#limit)
            return undefined;
        const emitter = this.#idle.pop() ?? this.#factory();
        emitter.clear();
        emitter.setOrigin(origin);
        emitter.play();
        this.#active.add(emitter);
        return emitter;
    }
    /** Advances every active system, retiring those that have finished. */
    update(deltaSeconds) {
        for (const emitter of [...this.#active]) {
            emitter.update(deltaSeconds);
            if (!emitter.playing && emitter.aliveCount === 0) {
                this.#active.delete(emitter);
                this.#idle.push(emitter);
            }
        }
    }
    /** Every active system, for a renderer to draw. */
    active() {
        return [...this.#active];
    }
    clear() {
        for (const emitter of this.#active) {
            emitter.clear();
            this.#idle.push(emitter);
        }
        this.#active.clear();
    }
}
//# sourceMappingURL=particles.js.map