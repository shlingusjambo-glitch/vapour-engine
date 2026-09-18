/** The XR rig: reference spaces, player height, floor, and per-eye cameras.
 *
 * WebXR hands the engine a viewer pose in a reference space and leaves the
 * rest to the game: where the floor is, how tall the player is, whether they
 * are sitting, and how a tracked pose becomes a world-space camera. This
 * module owns those decisions as pure data so they are the same in a test as
 * on a headset.
 *
 * The rig transform is the key idea. Tracking is in *tracking space* (metres
 * from the reference-space origin); the game moves a *rig* through the world
 * (teleporting, riding a vehicle, walking with a thumbstick); the camera the
 * renderer uses is `rig × tracked`. Floor calibration, seated offsets, and
 * height scaling are all adjustments to the rig, never to the tracked pose,
 * which keeps the headset's own motion untouched.
 *
 * Height has two sources: `local-floor` spaces measure it (the viewer's
 * tracked Y is height above the floor), while `local` and `viewer` spaces do
 * not know the floor and need a configured height. Reporting which source is
 * in use lets a game decide whether to trust it for scaling the world.
 */
import { type Mat4, type Quat, type Vec3, type Vec3Like } from "@vapour/math";
import type { XrFrameSnapshot, XrReferenceSpaceType, XrViewSnapshot } from "./xr.js";
export type XrPlayMode = "standing" | "seated";
export interface XrRigOptions {
    readonly referenceSpace: XrReferenceSpaceType;
    readonly mode?: XrPlayMode;
    /** Height in metres to assume when the reference space does not know the floor. */
    readonly configuredHeight?: number;
    /** Eye height a seated player's view is lifted to, so a seated session sees standing height. */
    readonly seatedEyeHeight?: number;
    /** Manual floor offset in metres, added to whatever the space provides. */
    readonly floorOffset?: number;
}
export interface XrHeightReport {
    readonly metres: number;
    readonly source: "measured" | "configured";
}
/** One eye's camera, ready for a renderer: world transform, view, projection. */
export interface XrEyeCamera {
    readonly eye: XrViewSnapshot["eye"];
    readonly world: Mat4;
    readonly view: Mat4;
    readonly projection: Mat4;
    readonly position: Vec3;
}
export interface XrRigFrame {
    readonly eyes: readonly XrEyeCamera[];
    /** The viewer (head) in world space. */
    readonly head: Mat4;
    readonly headPosition: Vec3;
    readonly height: XrHeightReport;
    /** Distance between the left and right eye positions, or 0 for mono. */
    readonly interpupillaryDistance: number;
}
/**
 * Tracks a rig through the world and turns frames into cameras.
 *
 * Calibration is explicit: {@link calibrateFloor} samples the current head
 * height, so a game can offer "recentre" or "set floor" without the engine
 * guessing when that should happen.
 */
export declare class XrRig {
    #private;
    constructor(options: XrRigOptions);
    get referenceSpace(): XrReferenceSpaceType;
    get mode(): XrPlayMode;
    get position(): Vec3;
    get rotation(): Quat;
    /** Whether the reference space itself puts y = 0 on the floor. */
    get floorAware(): boolean;
    setMode(mode: XrPlayMode): void;
    /**
     * Fixes the seated lift from the current head height. Called lazily on the
     * first seated frame; call it explicitly for a "recentre" button.
     */
    calibrateSeat(frame: XrFrameSnapshot): void;
    setConfiguredHeight(metres: number): void;
    setFloorOffset(metres: number): void;
    /** Moves the rig in the world; the tracked pose is untouched. */
    setPose(position: Vec3Like, rotation?: Quat): void;
    /**
     * Uses the current head height as the player's standing height.
     *
     * In a floor-aware space this measures the player; elsewhere it defines the
     * floor as `height` metres below the head, which is what "set floor" does
     * in a `local` space that started at eye level.
     */
    calibrateFloor(frame: XrFrameSnapshot, height?: number): XrHeightReport;
    /** Resets to the space's own floor and forgets any measured height. */
    resetCalibration(): void;
    height(): XrHeightReport;
    /**
     * The rig transform: world from tracking space.
     *
     * A seated player is lifted so their eyes sit at `seatedEyeHeight`; the
     * lift is the difference between where their head was when seated play
     * began and where a standing head would be, and it stays fixed so leaning
     * still moves the view. In a non-floor-aware space the floor offset moves
     * tracking space so the calibrated floor lands on y = 0.
     */
    rigMatrix(frame?: XrFrameSnapshot): Mat4;
    /** World-space cameras for every view in the frame. */
    resolve(frame: XrFrameSnapshot): XrRigFrame;
}
/**
 * A synthetic frame for tests, replays, and desktop preview.
 *
 * Views are placed `ipd / 2` either side of the head along its local X with a
 * symmetric perspective projection, which is what a real headset reports up
 * to lens asymmetry.
 */
export declare function syntheticXrFrame(options: {
    readonly headPosition: Vec3Like;
    readonly headRotation?: Quat;
    readonly ipd?: number;
    readonly time?: number;
    readonly projection?: Mat4;
}): XrFrameSnapshot;
//# sourceMappingURL=xr-rig.d.ts.map