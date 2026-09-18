/** Renderer-independent UI transitions for DOM, canvas, and world-space UI. */
import { type EasingName, type Rgba } from "@vapour/math";
export interface UiAnimatedState {
    readonly opacity: number;
    readonly scale: number;
    readonly offsetX: number;
    readonly offsetY: number;
    readonly rotation: number;
    readonly color?: Rgba;
}
export type UiAnimatedProperty = keyof UiAnimatedState;
export interface UiAnimationTrack {
    readonly property: UiAnimatedProperty;
    readonly from: number | Rgba;
    readonly to: number | Rgba;
    readonly easing?: EasingName;
}
export interface UiAnimationClip {
    readonly name: string;
    readonly duration: number;
    readonly delay?: number;
    readonly tracks: readonly UiAnimationTrack[];
    readonly loop?: boolean;
    readonly pingPong?: boolean;
}
export interface UiAnimationEvent {
    readonly target: string;
    readonly clip: string;
    readonly type: "complete" | "cancel";
}
export declare const DEFAULT_UI_ANIMATED_STATE: UiAnimatedState;
/** Deterministic UI animation scheduler. It changes plain visual state rather
 * than DOM styles, so the exact same clips animate screen and XR panels. */
export declare class UiAnimator {
    #private;
    reducedMotion: boolean;
    state(target: string): UiAnimatedState;
    setState(target: string, state: Partial<UiAnimatedState>): void;
    play(target: string, clip: UiAnimationClip): void;
    cancel(target: string): boolean;
    update(deltaSeconds: number): void;
    drainEvents(): readonly UiAnimationEvent[];
    get activeCount(): number;
}
export declare function validateUiAnimation(clip: UiAnimationClip): UiAnimationClip;
//# sourceMappingURL=animation.d.ts.map