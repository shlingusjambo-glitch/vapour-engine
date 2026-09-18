/** Directional focus navigation.
 *
 * A UI that only responds to a pointer is a UI that does not work on a gamepad,
 * does not work in VR, and does not work for anyone navigating by keyboard.
 * Retrofitting that is painful, because it requires knowing which control is
 * "to the left of" another — spatial information the layout already has and
 * that a hand-authored focus order throws away.
 *
 * So navigation here is computed from the laid-out rectangles. Authors do not
 * maintain a focus graph; they lay out their UI, and moving right goes to
 * whatever is on the right.
 *
 * The scoring is the interesting part. Picking the nearest candidate in the
 * chosen direction is the obvious rule and behaves badly: from a wide button,
 * "down" jumps to whichever narrow control happens to be closest diagonally
 * rather than the one directly below. Weighting cross-axis offset far more
 * heavily than along-axis distance fixes it, and matches what every console UI
 * does.
 */
import type { UiLayoutNode } from "./ui.js";
export type NavigationDirection = "up" | "down" | "left" | "right";
export interface NavigationOptions {
    /**
     * How much a candidate's sideways offset counts against it, relative to its
     * distance along the direction of travel. Higher values keep movement in
     * straighter lines.
     */
    readonly crossAxisWeight?: number;
    /** Wrap around at the edges instead of stopping. */
    readonly wrap?: boolean;
    /** Which roles can receive focus. */
    readonly focusableRoles?: readonly string[];
}
export declare const DEFAULT_FOCUSABLE_ROLES: readonly ["button", "toggle", "slider"];
/** Nodes that can take focus: visible, enabled, and of a focusable role. */
export declare function focusableNodes(nodes: readonly UiLayoutNode[], options?: NavigationOptions): readonly UiLayoutNode[];
/**
 * The node focus should move to, or `undefined` at the edge.
 *
 * `from` may be `undefined`, which selects a sensible entry point — the
 * top-left focusable node — so a menu opened with a gamepad starts somewhere
 * rather than nowhere.
 */
export declare function navigate(nodes: readonly UiLayoutNode[], from: string | undefined, direction: NavigationDirection, options?: NavigationOptions): UiLayoutNode | undefined;
export interface NavigationInput {
    /** Horizontal navigation axis, typically a stick or the arrow keys. */
    readonly x?: number;
    readonly y?: number;
    readonly submit?: boolean;
    readonly cancel?: boolean;
}
export interface NavigationEvent {
    readonly type: "focus" | "submit" | "cancel";
    readonly id: string | undefined;
}
export interface FocusNavigatorOptions extends NavigationOptions {
    /** Axis magnitude above which a step is taken. */
    readonly threshold?: number;
    /** Seconds before a held direction begins repeating. */
    readonly repeatDelaySeconds?: number;
    /** Seconds between repeats once repeating. */
    readonly repeatIntervalSeconds?: number;
}
/**
 * Turns continuous input axes into discrete focus steps.
 *
 * The repeat behaviour is what makes a stick usable for menus: without a
 * threshold and a repeat delay, a held stick moves focus every frame and a
 * player overshoots every time.
 */
export declare class FocusNavigator {
    #private;
    constructor(options?: FocusNavigatorOptions);
    get focused(): string | undefined;
    setFocus(id: string | undefined): void;
    /** Advances one frame, returning the events it produced. */
    update(nodes: readonly UiLayoutNode[], input: NavigationInput, deltaSeconds: number): readonly NavigationEvent[];
}
//# sourceMappingURL=navigation.d.ts.map