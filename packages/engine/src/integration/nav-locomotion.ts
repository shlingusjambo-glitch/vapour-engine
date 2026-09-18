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
export class NavMotorBinding {
  readonly #agent: NavAgent;
  readonly #motor: ThirdPersonMotor3d;
  readonly #sprintAbove: number;

  constructor(agent: NavAgent, motor: ThirdPersonMotor3d, options: NavMotorBindingOptions = {}) {
    this.#agent = agent;
    this.#motor = motor;
    this.#sprintAbove = options.sprintAbove ?? Infinity;
    // Start agreeing: the motor is where the agent thinks it is.
    motor.teleport(agent.position);
  }

  /** The motor input the agent's current velocity implies. */
  input(): ThirdPersonMotor3dInput {
    const [vx, , vz] = this.#agent.velocity;
    const speed = Math.hypot(vx, vz);
    return { move: [vx / this.#agent.maxSpeed, vz / this.#agent.maxSpeed], sprint: speed > this.#sprintAbove };
  }

  /** Steps the motor and writes its position back to the agent. */
  update(deltaSeconds: number): ThirdPersonMotor3dState {
    const state = this.#motor.update(deltaSeconds, this.input());
    this.#agent.position = [state.position[0], state.position[1], state.position[2]];
    return state;
  }
}

/** Animator parameters to set while an AI state is current. */
export type AnimatorParameterMap = Readonly<Record<string, Readonly<Record<string, ParameterValue>>>>;

/** Applies the current AI state's parameters to an animator. */
export class AnimatorStateBinding<TContext> {
  readonly #machine: StateMachine<TContext>;
  readonly #animator: Animator;
  readonly #parameters: AnimatorParameterMap;

  constructor(machine: StateMachine<TContext>, animator: Animator, parameters: AnimatorParameterMap) {
    this.#machine = machine;
    this.#animator = animator;
    this.#parameters = parameters;
    if (!(machine.state in parameters)) throw new Error(`AI state "${machine.state}" has no animator parameters.`);
  }

  /** Sets the parameters for the AI's current state. Unlisted states throw: a silent no-op leaves the NPC in the wrong animation. */
  apply(): void {
    const set = this.#parameters[this.#machine.state];
    if (!set) throw new Error(`AI state "${this.#machine.state}" has no animator parameters.`);
    for (const [name, value] of Object.entries(set)) this.#animator.setParameter(name, value);
  }
}
