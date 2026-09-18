/** Steers one motor from one nav agent. Call `update` after `crowd.update`. */
export class NavMotorBinding {
    #agent;
    #motor;
    #sprintAbove;
    constructor(agent, motor, options = {}) {
        this.#agent = agent;
        this.#motor = motor;
        this.#sprintAbove = options.sprintAbove ?? Infinity;
        // Start agreeing: the motor is where the agent thinks it is.
        motor.teleport(agent.position);
    }
    /** The motor input the agent's current velocity implies. */
    input() {
        const [vx, , vz] = this.#agent.velocity;
        const speed = Math.hypot(vx, vz);
        return { move: [vx / this.#agent.maxSpeed, vz / this.#agent.maxSpeed], sprint: speed > this.#sprintAbove };
    }
    /** Steps the motor and writes its position back to the agent. */
    update(deltaSeconds) {
        const state = this.#motor.update(deltaSeconds, this.input());
        this.#agent.position = [state.position[0], state.position[1], state.position[2]];
        return state;
    }
}
/** Applies the current AI state's parameters to an animator. */
export class AnimatorStateBinding {
    #machine;
    #animator;
    #parameters;
    constructor(machine, animator, parameters) {
        this.#machine = machine;
        this.#animator = animator;
        this.#parameters = parameters;
        if (!(machine.state in parameters))
            throw new Error(`AI state "${machine.state}" has no animator parameters.`);
    }
    /** Sets the parameters for the AI's current state. Unlisted states throw: a silent no-op leaves the NPC in the wrong animation. */
    apply() {
        const set = this.#parameters[this.#machine.state];
        if (!set)
            throw new Error(`AI state "${this.#machine.state}" has no animator parameters.`);
        for (const [name, value] of Object.entries(set))
            this.#animator.setParameter(name, value);
    }
}
//# sourceMappingURL=nav-locomotion.js.map