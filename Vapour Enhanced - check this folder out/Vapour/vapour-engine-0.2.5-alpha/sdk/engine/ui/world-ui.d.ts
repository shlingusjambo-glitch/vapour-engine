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
import { type Mat4, type Quat, type Ray, type Vec3, type Vec3Like } from "@vapour/math";
import type { UiDocument, UiLayoutNode, UiRect } from "./ui.js";
/** How a world canvas orients itself each frame. */
export type WorldUiBillboard = "none" | "full" | "upright";
export interface WorldUiCanvasOptions {
    readonly position?: Vec3Like;
    /** Ignored while `billboard` is not `none`. */
    readonly rotation?: Quat;
    /** Layout pixels per world metre. 100 means a 400px-wide document is 4 m wide. */
    readonly pixelsPerUnit?: number;
    readonly billboard?: WorldUiBillboard;
    /** Layout size in pixels. Defaults to the document's last viewport. */
    readonly size?: readonly [number, number];
}
/** One document node, placed in the world. */
export interface WorldUiQuad {
    readonly id: string;
    readonly role: UiLayoutNode["role"];
    readonly depth: number;
    readonly visible: boolean;
    /** Corners in world space: top-left, top-right, bottom-right, bottom-left. */
    readonly corners: readonly [Vec3, Vec3, Vec3, Vec3];
    /** The same node's rect in canvas pixels, for atlas/text lookups. */
    readonly rect: UiRect;
}
/** Where a world ray meets the canvas, if it does. */
export interface WorldUiHit {
    /** Canvas pixel coordinates, origin top-left, matching {@link UiDocument} layout. */
    readonly x: number;
    readonly y: number;
    /** Distance along the ray to the canvas plane. */
    readonly distance: number;
    /** The node under the hit, if any. */
    readonly nodeId: string | undefined;
}
/**
 * A `UiDocument` positioned in the world.
 *
 * The canvas's local frame has +X to the right, +Y up, and its front normal
 * along +Z, so an identity rotation at the origin is a panel a camera at +Z
 * looks straight at. Canvas pixel (0, 0) is
 * the top-left corner and the document's layout size spans the quad.
 */
export declare class WorldUiCanvas {
    #private;
    readonly document: UiDocument;
    constructor(document: UiDocument, options?: WorldUiCanvasOptions);
    get position(): Vec3;
    get rotation(): Quat;
    get pixelsPerUnit(): number;
    get billboard(): WorldUiBillboard;
    /** Layout size in pixels. */
    get size(): readonly [number, number];
    /** World size in metres. */
    get worldSize(): readonly [number, number];
    setPosition(position: Vec3Like): void;
    setRotation(rotation: Quat): void;
    setBillboard(mode: WorldUiBillboard): void;
    /** Re-runs the document's layout at the canvas size. */
    layout(): readonly UiLayoutNode[];
    /**
     * Orients a billboarded canvas toward a viewer. A no-op for `none`, so it is
     * safe to call every frame for every canvas.
     */
    face(viewerPosition: Vec3Like): void;
    /** Canvas → world transform. Canvas pixels map to metres via pixelsPerUnit. */
    worldMatrix(): Mat4;
    /** Converts a canvas pixel to a world point on the quad. */
    toWorld(x: number, y: number): Vec3;
    /**
     * Casts a world-space ray against the canvas plane.
     *
     * Only front-facing hits count: a menu should not respond to a controller
     * pointing at it from behind. Hits outside the quad return `undefined` even
     * though the plane was crossed, because the caller wants "did I point at the
     * panel", not "did I point at its infinite plane".
     */
    hitTest(worldRay: Ray): WorldUiHit | undefined;
    /** Forwards a ray "press" to the document exactly as a pointer press. */
    pointerDown(worldRay: Ray): string | undefined;
    pointerUp(worldRay: Ray): void;
    /** Every laid-out node as a world quad, in draw order (depth then document order). */
    quads(): readonly WorldUiQuad[];
}
/** A view matrix's inverse — the camera's world transform — from a view matrix. */
export declare function cameraWorldFromView(view: Mat4): Mat4;
/** The world ray through a screen pixel, for mouse-driven world UI. */
export declare function screenPointToWorldRay(viewProjectionInverse: Mat4, screenX: number, screenY: number, viewportWidth: number, viewportHeight: number): Ray;
/** Composes a canvas transform with a parent (e.g. a wrist or a vehicle dash). */
export declare function attachedCanvasMatrix(parentWorld: Mat4, localOffset: Mat4): Mat4;
//# sourceMappingURL=world-ui.d.ts.map