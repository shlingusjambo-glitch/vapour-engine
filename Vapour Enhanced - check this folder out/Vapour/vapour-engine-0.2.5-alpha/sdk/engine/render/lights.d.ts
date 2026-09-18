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
export declare const LIGHT_STRIDE = 16;
/** Lights one view may carry, matching the shader's uniform array. */
export declare const MAX_LIGHTS = 64;
export declare const LIGHT_KIND_AMBIENT = 0;
export declare const LIGHT_KIND_DIRECTIONAL = 1;
export declare const LIGHT_KIND_POINT = 2;
export declare const LIGHT_KIND_HEMISPHERE = 3;
export declare const LIGHT_KIND_SPOT = 4;
export type Vector3 = readonly [number, number, number];
/**
 * Accumulates a frame's lights into the packed wire format.
 *
 * Like [`FrameBuilder`], this reuses one growable buffer so a scene that
 * re-submits its lights every frame allocates nothing in steady state.
 */
export declare class LightRig {
    #private;
    constructor(initialCapacity?: number);
    /** Lights recorded so far. */
    get count(): number;
    /** Discards every light. Retains the buffer. */
    reset(): void;
    /** Uniform light from every direction. The cheapest way to stop surfaces
     * facing away from the key light reading as black holes. */
    addAmbient(color: Vector3, intensity: number): this;
    /** Sky above, ground below, blended by the surface normal. This is what
     * gives outdoor geometry its sense of up without a second directional light. */
    addHemisphere(skyColor: Vector3, groundColor: Vector3, intensity: number): this;
    /** A light infinitely far away. `direction` is the direction light travels,
     * so a midday sun points roughly down. */
    addDirectional(direction: Vector3, color: Vector3, intensity: number): this;
    /**
     * An omnidirectional light at a world position.
     *
     * `range` bounds its influence in metres; 0 means unbounded. Bounding it
     * matters: a world with a torch in every room needs each one to stop
     * mattering a few metres away, or every light is evaluated for every pixel.
     */
    addPoint(position: Vector3, color: Vector3, intensity: number, range?: number): this;
    /**
     * A cone of light from a world position.
     *
     * `angleRadians` is the half-angle of the outer cone and `penumbra` in
     * `[0, 1]` is how much of that cone is falloff rather than full brightness.
     */
    addSpot(position: Vector3, direction: Vector3, color: Vector3, intensity: number, range?: number, angleRadians?: number, penumbra?: number): this;
    /** The packed rig, as a view over this builder's buffer. Valid until the
     * next `reset` or `add*`; the renderer copies it during submission. */
    pack(): Float32Array;
}
/**
 * Normalizes a submitted light array into whole packed records.
 *
 * The original single-light submission was seven floats, and games written
 * against it must keep working, so that shape is widened here into one
 * directional light rather than being rejected.
 */
export declare function normalizeLightRig(light: Float32Array): Float32Array;
/** How many whole lights a normalized submission holds. */
export declare function lightCount(light: Float32Array): number;
//# sourceMappingURL=lights.d.ts.map