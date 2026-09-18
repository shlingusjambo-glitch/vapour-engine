/** Spatial audio follows scene entities.
 *
 * A spatial voice has a position; an entity has a transform, possibly under a
 * parent. Every tick this reads each followed entity's *world* position —
 * through `computeWorldMatrices`, the same resolution rendering uses, so the
 * sound of a lantern on a moving cart comes from the lantern — and pushes it
 * to the voice, along with the velocity implied by the move so Doppler works
 * without the game computing it.
 *
 * Both `AudioSource` and `AudioVoice` expose `setPosition`/`setVelocity`, so
 * either can follow.
 */
import type { SceneDocument } from "../core/scene-document.js";
/** What a follower drives: `AudioSource` or `AudioVoice`. */
export interface Positionable {
    setPosition(position: readonly [number, number, number]): void;
    setVelocity(velocity: readonly [number, number, number]): void;
}
export declare class AudioEntityFollower {
    #private;
    constructor(scene: SceneDocument);
    /** Starts a sound following an entity. Re-attaching moves it to the new entity. */
    attach(sound: Positionable, entityId: string): void;
    detach(sound: Positionable): boolean;
    get size(): number;
    /**
     * Pushes every followed entity's world position to its sound. A follower
     * whose entity was removed is dropped rather than left at a stale position.
     */
    update(deltaSeconds: number): void;
}
//# sourceMappingURL=audio-follow.d.ts.map