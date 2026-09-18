import { computeWorldMatrices } from "../render/render-world.js";
export class AudioEntityFollower {
    #scene;
    #followers = new Map();
    constructor(scene) {
        this.#scene = scene;
    }
    /** Starts a sound following an entity. Re-attaching moves it to the new entity. */
    attach(sound, entityId) {
        if (!this.#scene.entity(entityId))
            throw new Error(`Cannot attach audio to missing entity '${entityId}'.`);
        this.#followers.set(sound, { entityId });
    }
    detach(sound) {
        return this.#followers.delete(sound);
    }
    get size() {
        return this.#followers.size;
    }
    /**
     * Pushes every followed entity's world position to its sound. A follower
     * whose entity was removed is dropped rather than left at a stale position.
     */
    update(deltaSeconds) {
        if (!(deltaSeconds >= 0) || !Number.isFinite(deltaSeconds))
            throw new Error("Audio follow update requires a finite, non-negative delta.");
        if (this.#followers.size === 0)
            return;
        const matrices = computeWorldMatrices(this.#scene.data);
        for (const [sound, follower] of this.#followers) {
            const matrix = matrices.get(follower.entityId);
            if (!matrix) {
                this.#followers.delete(sound);
                continue;
            }
            const position = [matrix[12], matrix[13], matrix[14]];
            sound.setPosition(position);
            if (follower.last && deltaSeconds > 0) {
                sound.setVelocity([(position[0] - follower.last[0]) / deltaSeconds, (position[1] - follower.last[1]) / deltaSeconds, (position[2] - follower.last[2]) / deltaSeconds]);
            }
            follower.last = position;
        }
    }
}
//# sourceMappingURL=audio-follow.js.map