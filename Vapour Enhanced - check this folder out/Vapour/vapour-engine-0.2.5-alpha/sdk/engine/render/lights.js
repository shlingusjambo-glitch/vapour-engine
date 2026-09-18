/**
 * The lighting a frame submits.
 *
 * A single directional light is enough for a product shot and nothing else. A
 * real scene mixes a key light with sky fill and local sources — a voxel world
 * needs sun, sky, and a torch in every cave — so the renderer takes a rig
 * rather than one light, and this module is the authoring side of the packed
 * format the shader reads.
 *
 * Records are 16 floats: four `vec4` lanes matching the shader's array stride,
 * so a rig uploads without repacking and a future light type can claim the
 * reserved lanes without moving the existing ones.
 */
/** Floats per packed light. Four `vec4` lanes. */
export const LIGHT_STRIDE = 16;
/** Lights one view may carry, matching the shader's uniform array. */
export const MAX_LIGHTS = 64;
export const LIGHT_KIND_AMBIENT = 0;
export const LIGHT_KIND_DIRECTIONAL = 1;
export const LIGHT_KIND_POINT = 2;
export const LIGHT_KIND_HEMISPHERE = 3;
export const LIGHT_KIND_SPOT = 4;
/**
 * Accumulates a frame's lights into the packed wire format.
 *
 * Like [`FrameBuilder`], this reuses one growable buffer so a scene that
 * re-submits its lights every frame allocates nothing in steady state.
 */
export class LightRig {
    #values;
    #count = 0;
    constructor(initialCapacity = 8) {
        if (!Number.isInteger(initialCapacity) || initialCapacity < 1) {
            throw new Error("A light rig capacity must be a positive integer.");
        }
        this.#values = new Float32Array(initialCapacity * LIGHT_STRIDE);
    }
    /** Lights recorded so far. */
    get count() {
        return this.#count;
    }
    /** Discards every light. Retains the buffer. */
    reset() {
        this.#count = 0;
    }
    /** Uniform light from every direction. The cheapest way to stop surfaces
     * facing away from the key light reading as black holes. */
    addAmbient(color, intensity) {
        const at = this.#claim();
        this.#values[at] = LIGHT_KIND_AMBIENT;
        this.#writeColor(at, color, intensity);
        return this;
    }
    /** Sky above, ground below, blended by the surface normal. This is what
     * gives outdoor geometry its sense of up without a second directional light. */
    addHemisphere(skyColor, groundColor, intensity) {
        const at = this.#claim();
        this.#values[at] = LIGHT_KIND_HEMISPHERE;
        this.#writeColor(at, skyColor, intensity);
        this.#writeSecondary(at, groundColor);
        return this;
    }
    /** A light infinitely far away. `direction` is the direction light travels,
     * so a midday sun points roughly down. */
    addDirectional(direction, color, intensity) {
        const at = this.#claim();
        this.#values[at] = LIGHT_KIND_DIRECTIONAL;
        this.#writeVector(at, direction);
        this.#writeColor(at, color, intensity);
        return this;
    }
    /**
     * An omnidirectional light at a world position.
     *
     * `range` bounds its influence in metres; 0 means unbounded. Bounding it
     * matters: a world with a torch in every room needs each one to stop
     * mattering a few metres away, or every light is evaluated for every pixel.
     */
    addPoint(position, color, intensity, range = 0) {
        const at = this.#claim();
        this.#values[at] = LIGHT_KIND_POINT;
        this.#writeVector(at, position);
        this.#writeColor(at, color, intensity);
        this.#values[at + 11] = Math.max(range, 0);
        return this;
    }
    /**
     * A cone of light from a world position.
     *
     * `angleRadians` is the half-angle of the outer cone and `penumbra` in
     * `[0, 1]` is how much of that cone is falloff rather than full brightness.
     */
    addSpot(position, direction, color, intensity, range = 0, angleRadians = Math.PI / 6, penumbra = 0) {
        const at = this.#claim();
        const outer = Math.min(Math.max(angleRadians, 1e-4), Math.PI / 2);
        const inner = outer * (1 - Math.min(Math.max(penumbra, 0), 1));
        this.#values[at] = LIGHT_KIND_SPOT;
        this.#writeVector(at, position);
        this.#writeColor(at, color, intensity);
        this.#writeSecondary(at, direction);
        this.#values[at + 11] = Math.max(range, 0);
        // Cosines are packed here so the shader needs no trigonometry per pixel.
        this.#values[at + 12] = Math.cos(inner);
        this.#values[at + 13] = Math.cos(outer);
        return this;
    }
    /** The packed rig, as a view over this builder's buffer. Valid until the
     * next `reset` or `add*`; the renderer copies it during submission. */
    pack() {
        return this.#values.subarray(0, this.#count * LIGHT_STRIDE);
    }
    #claim() {
        if (this.#count === MAX_LIGHTS) {
            throw new Error(`A view may carry at most ${String(MAX_LIGHTS)} lights.`);
        }
        if ((this.#count + 1) * LIGHT_STRIDE > this.#values.length) {
            const grown = new Float32Array(this.#values.length * 2);
            grown.set(this.#values);
            this.#values = grown;
        }
        const at = this.#count * LIGHT_STRIDE;
        // Reused storage must not leak a previous light's range or cone.
        this.#values.fill(0, at, at + LIGHT_STRIDE);
        this.#count += 1;
        return at;
    }
    #writeVector(at, vector) {
        this.#values[at + 1] = vector[0];
        this.#values[at + 2] = vector[1];
        this.#values[at + 3] = vector[2];
    }
    #writeColor(at, color, intensity) {
        this.#values[at + 4] = color[0];
        this.#values[at + 5] = color[1];
        this.#values[at + 6] = color[2];
        this.#values[at + 7] = Math.max(intensity, 0);
    }
    #writeSecondary(at, vector) {
        this.#values[at + 8] = vector[0];
        this.#values[at + 9] = vector[1];
        this.#values[at + 10] = vector[2];
    }
}
/**
 * Normalizes a submitted light array into whole packed records.
 *
 * The original single-light submission was seven floats, and games written
 * against it must keep working, so that shape is widened here into one
 * directional light rather than being rejected.
 */
export function normalizeLightRig(light) {
    if (light.length === 0)
        return light;
    if (light.length === 7) {
        const rig = new LightRig(1);
        rig.addDirectional([light[0], light[1], light[2]], [light[3], light[4], light[5]], light[6]);
        // A lone directional light leaves back faces pure black; the renderer adds
        // the same token fill for this shape, so the two paths agree.
        rig.addAmbient([light[3], light[4], light[5]], light[6] * 0.04);
        return rig.pack();
    }
    if (light.length % LIGHT_STRIDE !== 0) {
        throw new Error(`A light submission must be 7 floats or a multiple of ${String(LIGHT_STRIDE)}, received ${String(light.length)}.`);
    }
    return light;
}
/** How many whole lights a normalized submission holds. */
export function lightCount(light) {
    return light.length === 0
        ? 0
        : normalizeLightRig(light).length / LIGHT_STRIDE;
}
//# sourceMappingURL=lights.js.map