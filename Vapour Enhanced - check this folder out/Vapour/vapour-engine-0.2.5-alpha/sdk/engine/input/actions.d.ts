/** Action maps, contexts, composites, rebinding, and multiple players.
 *
 * `InputSystem` already resolves named actions from device bindings, which is
 * the important half: gameplay asks for `Jump`, not for `KeyC`. This module
 * adds the structure a real game needs on top of that, and it is all structure
 * that games otherwise rewrite badly:
 *
 * - **Action maps** group actions by situation. "Gameplay", "Menu", and
 *   "Vehicle" are different sets, and the same physical key means different
 *   things in each.
 * - **A context stack** decides which maps are live. Opening a menu should
 *   suspend gameplay input without every gameplay system checking `isPaused`.
 * - **Composites** turn four buttons into one vector, so `Move` is a direction
 *   whether it came from WASD, a stick, or a touch pad.
 * - **Rebinding** is serializable, because a player who remaps their controls
 *   expects them to still be remapped tomorrow.
 * - **Player slots** route devices to players, so local multiplayer is a
 *   routing question rather than a parallel input stack.
 */
import type { InputActionDefinition, InputBinding, InputDevice, XrInputDeviceState } from "./input.js";
import { InputSystem } from "./input.js";
/** A named direction pair resolved into a 2D vector. */
export interface CompositeVector2 {
    readonly name: string;
    readonly kind: "vector2";
    /**
     * Actions whose values form the vector.
     *
     * The negative halves are optional: an already-signed axis action (a stick,
     * or a keyboard axis with `scale: -1` bindings) supplies both directions on
     * its own, while four discrete buttons need all four named.
     */
    readonly positiveX: string;
    readonly negativeX?: string;
    readonly positiveY: string;
    readonly negativeY?: string;
    /** Values below this magnitude are treated as zero. */
    readonly deadZone?: number;
    /** Clamp the result to unit length, so diagonals are not faster. */
    readonly normalize?: boolean;
}
export interface Vector2 {
    readonly x: number;
    readonly y: number;
}
export interface ActionMapDefinition {
    readonly name: string;
    readonly actions: readonly InputActionDefinition[];
    readonly composites?: readonly CompositeVector2[];
    /** Maps start enabled unless this says otherwise. */
    readonly enabled?: boolean;
}
/** Serializable rebindings: action name to its bindings. */
export type BindingOverrides = Readonly<Record<string, readonly InputBinding[]>>;
export interface InputActionsOptions {
    /** Sensitivity multiplier applied to `delta` actions, e.g. mouse look. */
    readonly lookSensitivity?: number;
    /** Dead zone applied to every composite that does not set its own. */
    readonly deadZone?: number;
}
export interface InputActionsStats {
    readonly maps: number;
    readonly enabledMaps: number;
    readonly actions: number;
    readonly lastDevice: InputDevice | undefined;
    readonly contextDepth: number;
}
/**
 * Action maps, contexts, and composites over an {@link InputSystem}.
 *
 * Owns the `InputSystem` rather than extending it, so the existing lower-level
 * API stays available and unchanged for games that want it.
 */
export declare class InputActions {
    #private;
    readonly system: InputSystem;
    constructor(maps?: readonly ActionMapDefinition[], options?: InputActionsOptions);
    addMap(definition: ActionMapDefinition): void;
    get maps(): readonly string[];
    hasMap(name: string): boolean;
    setMapEnabled(name: string, enabled: boolean): void;
    isMapEnabled(name: string): boolean;
    /** Pushes a context: only the named maps resolve until it is popped. */
    pushContext(mapNames: readonly string[]): void;
    popContext(): readonly string[] | undefined;
    clearContexts(): void;
    get contextDepth(): number;
    /**
     * Resolves every action for this frame. Call once, early.
     *
     * Pass `navigator.getGamepads()` and the current `XrFrameSnapshot.inputs` to
     * resolve gamepad and XR bindings; keyboard, pointer, and virtual bindings
     * need neither.
     */
    update(gamepads?: readonly (Gamepad | null)[], xrInputs?: readonly XrInputDeviceState[]): void;
    /** An action's analog value, or zero when its map is not live. */
    value(action: string): number;
    /** A `delta` action scaled by look sensitivity — mouse and stick look. */
    look(action: string): number;
    pressed(action: string): boolean;
    justPressed(action: string): boolean;
    justReleased(action: string): boolean;
    /**
     * A composite's 2D value.
     *
     * Normalizing is on by default because the alternative — moving faster
     * diagonally than straight — is a bug players notice immediately and
     * developers rarely think to prevent.
     */
    vector(name: string): Vector2;
    /** The device that most recently produced input, for showing the right prompts. */
    get lastDevice(): InputDevice | undefined;
    /** Replaces an action's bindings. */
    rebind(action: string, bindings: readonly InputBinding[]): void;
    /** Restores one action, or all of them, to the bindings it was defined with. */
    resetBindings(action?: string): void;
    /**
     * Bindings that differ from their defaults.
     *
     * Only overrides are serialized, so a later build changing a default binding
     * still reaches players who never remapped that action.
     */
    overrides(): BindingOverrides;
    /** Applies serialized overrides, ignoring actions this build no longer has. */
    applyOverrides(overrides: BindingOverrides): readonly string[];
    stats(): InputActionsStats;
}
export interface PlayerSlotOptions {
    readonly id: number;
    /** Gamepad index this player uses, if any. */
    readonly gamepad?: number;
    /** Whether this player uses the keyboard and pointer. */
    readonly keyboard?: boolean;
    /** Whether this player owns the XR controllers and hands. One headset, one
     * player: XR bindings are dropped for every other slot. */
    readonly xr?: boolean;
}
/**
 * Routes devices to players for local multiplayer.
 *
 * Each player gets its own {@link InputActions} built from the same maps, with
 * gamepad bindings rewritten to that player's pad. Local multiplayer is then a
 * routing question rather than a parallel input stack, and gameplay code reads
 * `players.get(1).vector("Move")` without knowing which pad that is.
 */
export declare class PlayerInput {
    #private;
    constructor(maps: readonly ActionMapDefinition[], options?: InputActionsOptions);
    addPlayer(slot: PlayerSlotOptions): InputActions;
    get(id: number): InputActions;
    get playerIds(): readonly number[];
    removePlayer(id: number): boolean;
    /** Updates every player's actions. */
    update(): void;
}
/** Standard action names, so gameplay, UI, and XR agree on spelling. */
export declare const STANDARD_ACTIONS: {
    readonly moveX: "MoveX";
    readonly moveY: "MoveY";
    readonly move: "Move";
    readonly lookX: "LookX";
    readonly lookY: "LookY";
    readonly jump: "Jump";
    readonly interact: "Interact";
    readonly fire: "Fire";
    readonly aim: "Aim";
    readonly sprint: "Sprint";
    readonly crouch: "Crouch";
    readonly reload: "Reload";
    readonly pause: "Pause";
    readonly submit: "Submit";
    readonly cancel: "Cancel";
    readonly navigateX: "NavigateX";
    readonly navigateY: "NavigateY";
};
/**
 * The action map most games start from: WASD or stick movement, mouse or stick
 * look, and the usual verbs, bound to both keyboard and gamepad.
 *
 * Provided because the first hour of every project is otherwise spent retyping
 * it, and because a shared default means examples and documentation agree.
 */
export declare function defaultGameplayMap(): ActionMapDefinition;
//# sourceMappingURL=actions.d.ts.map