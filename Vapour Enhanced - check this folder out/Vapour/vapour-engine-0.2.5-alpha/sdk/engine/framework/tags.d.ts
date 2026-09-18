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
export declare const LAYER_COUNT = 32;
/** A bitmask over layer indices. */
export type LayerMask = number;
export declare const LAYER_MASK_NONE: LayerMask;
/** All 32 layers. Written as an unsigned value so it prints readably. */
export declare const LAYER_MASK_ALL: LayerMask;
export declare function layerMask(...layers: readonly number[]): LayerMask;
export declare function maskHasLayer(mask: LayerMask, layer: number): boolean;
export declare function maskWithLayer(mask: LayerMask, layer: number): LayerMask;
export declare function maskWithoutLayer(mask: LayerMask, layer: number): LayerMask;
/** True when the two masks share any layer — the interaction test. */
export declare function masksOverlap(a: LayerMask, b: LayerMask): boolean;
export declare function layersInMask(mask: LayerMask): readonly number[];
/**
 * Names for layer indices, so gameplay reads `layers.mask("player", "enemy")`
 * rather than carrying magic numbers that silently shift when someone inserts
 * a layer.
 */
export declare class LayerRegistry {
    #private;
    define(name: string, layer: number): void;
    index(name: string): number;
    name(layer: number): string | undefined;
    mask(...names: readonly string[]): LayerMask;
    /** Human-readable mask, for diagnostics and collision-matrix debugging. */
    describe(mask: LayerMask): string;
    get defined(): readonly {
        readonly name: string;
        readonly layer: number;
    }[];
}
/**
 * Bidirectional tag index over entity ids.
 *
 * Both directions are maintained because both queries are common and both are
 * hot: "what tags does this entity have?" during a per-entity check, and "which
 * entities are flammable?" when an explosion goes off.
 */
export declare class TagIndex {
    #private;
    add(entityId: string, ...tags: readonly string[]): void;
    remove(entityId: string, ...tags: readonly string[]): void;
    /** Drops an entity entirely. Call when an entity is destroyed, or the index
     * keeps it alive in every tag it held. */
    forget(entityId: string): void;
    has(entityId: string, tag: string): boolean;
    hasAll(entityId: string, ...tags: readonly string[]): boolean;
    hasAny(entityId: string, ...tags: readonly string[]): boolean;
    tagsOf(entityId: string): readonly string[];
    entitiesWith(tag: string): readonly string[];
    /** Entities carrying every listed tag. Starts from the smallest tag set, so
     * the cost is proportional to the rarest tag rather than the commonest. */
    entitiesWithAll(...tags: readonly string[]): readonly string[];
    get tags(): readonly string[];
    clear(): void;
}
/** Named, hand-maintained collections of entity ids. */
export declare class GroupRegistry {
    #private;
    add(group: string, ...entityIds: readonly string[]): void;
    remove(group: string, ...entityIds: readonly string[]): void;
    /** Removes an entity from every group it belongs to. */
    forget(entityId: string): void;
    members(group: string): readonly string[];
    contains(group: string, entityId: string): boolean;
    groupsOf(entityId: string): readonly string[];
    get names(): readonly string[];
    clear(): void;
}
//# sourceMappingURL=tags.d.ts.map