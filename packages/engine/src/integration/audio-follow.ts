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
import { computeWorldMatrices } from "../render/render-world.js";

/** What a follower drives: `AudioSource` or `AudioVoice`. */
export interface Positionable {
  setPosition(position: readonly [number, number, number]): void;
  setVelocity(velocity: readonly [number, number, number]): void;
}

export class AudioEntityFollower {
  readonly #scene: SceneDocument;
  readonly #followers = new Map<Positionable, { entityId: string; last?: readonly [number, number, number] }>();

  constructor(scene: SceneDocument) {
    this.#scene = scene;
  }

  /** Starts a sound following an entity. Re-attaching moves it to the new entity. */
  attach(sound: Positionable, entityId: string): void {
    if (!this.#scene.entity(entityId)) throw new Error(`Cannot attach audio to missing entity '${entityId}'.`);
    this.#followers.set(sound, { entityId });
  }

  detach(sound: Positionable): boolean {
    return this.#followers.delete(sound);
  }

  get size(): number {
    return this.#followers.size;
  }

  /**
   * Pushes every followed entity's world position to its sound. A follower
   * whose entity was removed is dropped rather than left at a stale position.
   */
  update(deltaSeconds: number): void {
    if (!(deltaSeconds >= 0) || !Number.isFinite(deltaSeconds)) throw new Error("Audio follow update requires a finite, non-negative delta.");
    if (this.#followers.size === 0) return;
    const matrices = computeWorldMatrices(this.#scene.data);
    for (const [sound, follower] of this.#followers) {
      const matrix = matrices.get(follower.entityId);
      if (!matrix) {
        this.#followers.delete(sound);
        continue;
      }
      const position: readonly [number, number, number] = [matrix[12]!, matrix[13]!, matrix[14]!];
      sound.setPosition(position);
      if (follower.last && deltaSeconds > 0) {
        sound.setVelocity([(position[0] - follower.last[0]) / deltaSeconds, (position[1] - follower.last[1]) / deltaSeconds, (position[2] - follower.last[2]) / deltaSeconds]);
      }
      follower.last = position;
    }
  }
}
