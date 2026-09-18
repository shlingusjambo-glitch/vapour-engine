/** Nav agents driving the physics motor; AI state driving the animator.
 *
 * **Navigation → locomotion.** A `Crowd` produces, per agent per tick, a
 * velocity that follows the path and avoids neighbours. A
 * `ThirdPersonMotor3d` wants a move direction and sweeps a capsule through the
 * physics world. {@link NavMotorBinding} turns the one into the other and —
 * the part that matters — feeds the motor's *actual* position back to the
 * agent, so a character stopped by a door the navmesh did not know about
 * stops on the navmesh too instead of drifting through it in the AI's mind.
 * Physics is the truth for position; navigation is the truth for intent.
 *
 * **AI state → animation.** A `StateMachine` names what an NPC is doing; an
 * `Animator` state machine decides what that looks like, driven by parameters.
 * {@link AnimatorStateBinding} maps AI state names to parameter sets and
 * applies the current one each tick. The animator's own transitions (fades,
 * wait-for-exit) are untouched: AI says "chasing", animation decides how to
 * get from idle to run.
 */
import type { StateMachine } from "../ai/ai.js";
import type { NavAgent } from "../ai/nav-agent.js";
import type { Animator, ParameterValue } from "../animation/animator.js";
import type { ThirdPersonMotor3d, ThirdPersonMotor3dInput, ThirdPersonMotor3dState } from "../physics/locomotion-3d.js";
export interface NavMotorBindingOptions {
    /** Speed above which the motor sprints. Default: never. */
    readonly sprintAbove?: number;
}
/** Steers one motor from one nav agent. Call `update` after `crowd.update`. */
export declare class NavMotorBinding {
    #private;
    constructor(agent: NavAgent, motor: ThirdPersonMotor3d, options?: NavMotorBindingOptions);
    /** The motor input the agent's current velocity implies. */
    input(): ThirdPersonMotor3dInput;
    /** Steps the motor and writes its position back to the agent. */
    update(deltaSeconds: number): ThirdPersonMotor3dState;
}
/** Animator parameters to set while an AI state is current. */
export type AnimatorParameterMap = Readonly<Record<string, Readonly<Record<string, ParameterValue>>>>;
/** Applies the current AI state's parameters to an animator. */
export declare class AnimatorStateBinding<TContext> {
    #private;
    constructor(machine: StateMachine<TContext>, animator: Animator, parameters: AnimatorParameterMap);
    /** Sets the parameters for the AI's current state. Unlisted states throw: a silent no-op leaves the NPC in the wrong animation. */
    apply(): void;
}
//# sourceMappingURL=nav-locomotion.d.ts.map