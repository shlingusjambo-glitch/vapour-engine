/** World-space and XR UI: a `UiDocument` on a quad in the scene.
 *
 * A screen overlay is hit-tested in pixels; a panel floating over a workbench
 * is hit-tested by a ray from a hand or a mouse. The document does not care
 * which, so this module owns only the difference: a transform placing the
 * canvas in the world, a pixels-per-unit scale relating layout pixels to
 * metres, and the two conversions — world ray → canvas pixel, and canvas rect
 * → world quad — that let the same {@link UiDocument} drive both.
 *
 * Billboarding is a per-canvas mode rather than a scene component because
 * "always face the viewer" is a property of the panel, and XR in particular
 * needs `upright` — face the viewer around the vertical axis only — so a wrist
 * menu does not tilt when the player looks down at it.
 *
 * Nothing here draws. The output is a draw list of world-space quads with the
 * document's own node ids, which the renderer, a sprite batch, or a test can
 * consume; the module stays renderer-independent for the same reason the
 * document does.
 */
import { compose, invert, multiplyMat4, normalize, quatLookRotation, subtract, transformDirection, transformPoint, } from "@vapour/math";
/**
 * A `UiDocument` positioned in the world.
 *
 * The canvas's local frame has +X to the right, +Y up, and its front normal
 * along +Z, so an identity rotation at the origin is a panel a camera at +Z
 * looks straight at. Canvas pixel (0, 0) is
 * the top-left corner and the document's layout size spans the quad.
 */
export class WorldUiCanvas {
    document;
    #position;
    #rotation;
    #pixelsPerUnit;
    #billboard;
    #size;
    constructor(document, options = {}) {
        const pixelsPerUnit = options.pixelsPerUnit ?? 100;
        if (!(pixelsPerUnit > 0) || !Number.isFinite(pixelsPerUnit))
            throw new Error("World UI pixelsPerUnit must be a positive finite number.");
        const size = options.size ?? document.viewport;
        if (!(size[0] > 0 && size[1] > 0))
            throw new Error("World UI canvas size must be positive; lay the document out first or pass `size`.");
        this.document = document;
        this.#position = [...(options.position ?? [0, 0, 0])];
        this.#rotation = options.rotation ?? [0, 0, 0, 1];
        this.#pixelsPerUnit = pixelsPerUnit;
        this.#billboard = options.billboard ?? "none";
        this.#size = [size[0], size[1]];
    }
    get position() { return this.#position; }
    get rotation() { return this.#rotation; }
    get pixelsPerUnit() { return this.#pixelsPerUnit; }
    get billboard() { return this.#billboard; }
    /** Layout size in pixels. */
    get size() { return this.#size; }
    /** World size in metres. */
    get worldSize() {
        return [this.#size[0] / this.#pixelsPerUnit, this.#size[1] / this.#pixelsPerUnit];
    }
    setPosition(position) { this.#position = [position[0], position[1], position[2]]; }
    setRotation(rotation) { this.#rotation = rotation; }
    setBillboard(mode) { this.#billboard = mode; }
    /** Re-runs the document's layout at the canvas size. */
    layout() {
        return this.document.layout(this.#size[0], this.#size[1]);
    }
    /**
     * Orients a billboarded canvas toward a viewer. A no-op for `none`, so it is
     * safe to call every frame for every canvas.
     */
    face(viewerPosition) {
        if (this.#billboard === "none")
            return;
        // The quad's front normal is +Z and `quatLookRotation` points -Z along
        // `forward`, so looking *away* from the viewer turns the front toward them.
        const away = subtract(this.#position, viewerPosition);
        const forward = this.#billboard === "upright" ? [away[0], 0, away[2]] : away;
        // A viewer standing exactly on the canvas's axis has no facing direction;
        // keep the last orientation rather than throwing mid-frame.
        if (Math.hypot(forward[0], forward[1], forward[2]) < 1e-6)
            return;
        this.#rotation = quatLookRotation(normalize(forward));
    }
    /** Canvas → world transform. Canvas pixels map to metres via pixelsPerUnit. */
    worldMatrix() {
        return compose(this.#position, this.#rotation, [1, 1, 1]);
    }
    /** Converts a canvas pixel to a world point on the quad. */
    toWorld(x, y) {
        return transformPoint(this.worldMatrix(), this.#localPoint(x, y));
    }
    /**
     * Casts a world-space ray against the canvas plane.
     *
     * Only front-facing hits count: a menu should not respond to a controller
     * pointing at it from behind. Hits outside the quad return `undefined` even
     * though the plane was crossed, because the caller wants "did I point at the
     * panel", not "did I point at its infinite plane".
     */
    hitTest(worldRay) {
        const toLocal = invert(this.worldMatrix());
        const origin = transformPoint(toLocal, worldRay.origin);
        const direction = transformDirection(toLocal, worldRay.direction);
        // Plane z = 0 in local space; the front is the +Z side, so a front-facing
        // ray comes from +Z and travels toward -Z.
        if (!(direction[2] < -1e-9))
            return undefined;
        const distance = -origin[2] / direction[2];
        if (distance < 0)
            return undefined;
        const localX = origin[0] + direction[0] * distance;
        const localY = origin[1] + direction[1] * distance;
        const [width, height] = this.worldSize;
        const x = (localX + width / 2) * this.#pixelsPerUnit;
        const y = (height / 2 - localY) * this.#pixelsPerUnit;
        if (x < 0 || y < 0 || x > this.#size[0] || y > this.#size[1])
            return undefined;
        return { x, y, distance, nodeId: this.document.hitTest(x, y) };
    }
    /** Forwards a ray "press" to the document exactly as a pointer press. */
    pointerDown(worldRay) {
        const hit = this.hitTest(worldRay);
        return hit === undefined ? undefined : this.document.pointerDown(hit.x, hit.y);
    }
    pointerUp(worldRay) {
        const hit = this.hitTest(worldRay);
        if (hit !== undefined)
            this.document.pointerUp(hit.x, hit.y);
    }
    /** Every laid-out node as a world quad, in draw order (depth then document order). */
    quads() {
        const matrix = this.worldMatrix();
        return this.document.nodes().map((node) => {
            const { x, y, width, height } = node.rect;
            const corner = (px, py) => transformPoint(matrix, this.#localPoint(px, py));
            return {
                id: node.id,
                role: node.role,
                depth: node.depth,
                visible: node.visible,
                corners: [corner(x, y), corner(x + width, y), corner(x + width, y + height), corner(x, y + height)],
                rect: node.rect,
            };
        });
    }
    /** Canvas pixel → local metres, centred on the quad, +Y up. */
    #localPoint(x, y) {
        const [width, height] = this.worldSize;
        return [x / this.#pixelsPerUnit - width / 2, height / 2 - y / this.#pixelsPerUnit, 0];
    }
}
/** A view matrix's inverse — the camera's world transform — from a view matrix. */
export function cameraWorldFromView(view) {
    return invert(view);
}
/** The world ray through a screen pixel, for mouse-driven world UI. */
export function screenPointToWorldRay(viewProjectionInverse, screenX, screenY, viewportWidth, viewportHeight) {
    const ndcX = (screenX / viewportWidth) * 2 - 1;
    const ndcY = 1 - (screenY / viewportHeight) * 2;
    const near = transformPoint(viewProjectionInverse, [ndcX, ndcY, 0]);
    const far = transformPoint(viewProjectionInverse, [ndcX, ndcY, 1]);
    return { origin: near, direction: normalize(subtract(far, near)) };
}
/** Composes a canvas transform with a parent (e.g. a wrist or a vehicle dash). */
export function attachedCanvasMatrix(parentWorld, localOffset) {
    return multiplyMat4(parentWorld, localOffset);
}
//# sourceMappingURL=world-ui.js.map