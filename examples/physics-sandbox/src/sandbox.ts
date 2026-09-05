/** A physics sandbox, assembled from Mirage systems.
 *
 * This is a *showcase*, which here means something specific: its job is to prove
 * that the systems compose, not to be a game. Every part of it is real engine
 * API — no private hooks, no sample-only shortcuts — because a demo that needs
 * either is not evidence that the engine works.
 *
 * What it exercises together:
 *
 * - **Physics joints** for a hinged door and a swinging pendulum,
 * - **Grab, carry, and throw** with the velocity-spring controller,
 * - **Input actions**, so controls are `Grab` and `Throw`, not key codes,
 * - **Generated collision** from `@vapour/assetgen` for the props,
 * - **Diagnostics counters**, so the sandbox reports its own cost.
 *
 * The simulation is driven by an injected stepper rather than the WASM physics
 * world, so the whole thing runs and is tested without a browser. Swapping in
 * the real world changes only `createWorld`.
 */
import {
  DEFAULT_GRAB_OPTIONS, Diagnostics, GrabController, InputActions, PhysicsDoor,
  addJointCommand, hingeJoint, holdPointInFront, throwImpulse,
  type ActionMapDefinition, type BodyPose, type PhysicsCommand3d, type Vec3Tuple,
} from "@vapour/engine";
import { box, meshStats, signedVolume } from "@vapour/assetgen";

export interface SandboxBody {
  readonly id: number;
  readonly kind: "prop" | "ground" | "door" | "pendulum";
  readonly mass: number;
  position: [number, number, number];
  velocity: [number, number, number];
  /** Static bodies never move and never sleep. */
  readonly isStatic: boolean;
}

/**
 * A minimal rigid-body stepper.
 *
 * Deliberately not a physics engine: gravity, integration, a ground plane, and
 * nothing else. It exists so the sandbox's *composition* can be tested without
 * a WASM build, and so the commands the sandbox emits are exercised end to end
 * rather than merely constructed.
 */
export class SimpleWorld {
  readonly gravity: number;
  readonly #bodies = new Map<number, SandboxBody>();
  readonly #joints = new Map<number, { bodyA: number; bodyB: number }>();
  readonly #motors = new Map<number, { velocity: number; force: number }>();
  #nextId = 1;

  constructor(gravity = -9.81) {
    this.gravity = gravity;
  }

  get bodies(): readonly SandboxBody[] {
    return [...this.#bodies.values()];
  }

  body(id: number): SandboxBody | undefined {
    return this.#bodies.get(id);
  }

  get jointCount(): number {
    return this.#joints.size;
  }

  motor(jointId: number): { velocity: number; force: number } | undefined {
    return this.#motors.get(jointId);
  }

  add(kind: SandboxBody["kind"], position: Vec3Tuple, options: { mass?: number; isStatic?: boolean } = {}): SandboxBody {
    const body: SandboxBody = {
      id: this.#nextId++,
      kind,
      mass: options.mass ?? 1,
      position: [...position] as [number, number, number],
      velocity: [0, 0, 0],
      isStatic: options.isStatic ?? false,
    };
    this.#bodies.set(body.id, body);
    return body;
  }

  remove(id: number): boolean {
    // Joints referencing a removed body go with it, as the real world does.
    for (const [jointId, joint] of [...this.#joints]) {
      if (joint.bodyA === id || joint.bodyB === id) {
        this.#joints.delete(jointId);
        this.#motors.delete(jointId);
      }
    }
    return this.#bodies.delete(id);
  }

  /** Applies the same command shapes the real physics bridge accepts. */
  applyCommands(commands: readonly PhysicsCommand3d[]): void {
    for (const command of commands) {
      switch (command.type) {
        case "setLinearVelocity": {
          const body = this.#bodies.get(command.id);
          if (body && !body.isStatic) body.velocity = [...command.velocity] as [number, number, number];
          break;
        }
        case "applyImpulse": {
          const body = this.#bodies.get(command.id);
          if (body && !body.isStatic) {
            for (let axis = 0; axis < 3; axis += 1) {
              body.velocity[axis] = body.velocity[axis]! + command.impulse[axis]! / body.mass;
            }
          }
          break;
        }
        case "addJoint":
          this.#joints.set(command.spec.id, { bodyA: command.spec.bodyA, bodyB: command.spec.bodyB });
          break;
        case "removeJoint":
          this.#joints.delete(command.id);
          this.#motors.delete(command.id);
          break;
        case "setJointMotor":
          this.#motors.set(command.id, { velocity: command.targetVelocity, force: command.maxForce });
          break;
        default:
          break;
      }
    }
  }

  step(deltaSeconds: number): void {
    for (const body of this.#bodies.values()) {
      if (body.isStatic) continue;
      body.velocity[1] += this.gravity * deltaSeconds;
      for (let axis = 0; axis < 3; axis += 1) {
        body.position[axis] = body.position[axis]! + body.velocity[axis]! * deltaSeconds;
      }
      // A ground plane at y = 0, so props settle rather than falling forever.
      if (body.position[1] < 0.5) {
        body.position[1] = 0.5;
        body.velocity = [body.velocity[0]! * 0.8, 0, body.velocity[2]! * 0.8];
      }
    }
  }

  /** Poses in the shape `GrabController.update` expects. */
  poses(): Map<number, BodyPose> {
    const poses = new Map<number, BodyPose>();
    for (const body of this.#bodies.values()) {
      poses.set(body.id, {
        position: [...body.position] as Vec3Tuple,
        rotation: [0, 0, 0, 1],
        linearVelocity: [...body.velocity] as Vec3Tuple,
        angularVelocity: [0, 0, 0],
      });
    }
    return poses;
  }
}

/** Input the sandbox reads, expressed as actions rather than device buttons. */
export const SANDBOX_ACTIONS: ActionMapDefinition = {
  name: "sandbox",
  actions: [
    { name: "Grab", kind: "button", bindings: [{ device: "keyboard", code: "KeyE" }, { device: "pointer", button: 0 }] },
    { name: "Throw", kind: "button", bindings: [{ device: "keyboard", code: "KeyF" }, { device: "pointer", button: 2 }] },
    { name: "Spawn", kind: "button", bindings: [{ device: "keyboard", code: "KeyQ" }] },
    { name: "ToggleDoor", kind: "button", bindings: [{ device: "keyboard", code: "KeyR" }] },
  ],
};

export interface SandboxOptions {
  readonly propCount?: number;
  readonly maxProps?: number;
  readonly reachDistance?: number;
  readonly throwStrength?: number;
}

export interface SandboxStats {
  readonly props: number;
  readonly held: number;
  readonly joints: number;
  readonly doorState: string;
  readonly spawned: number;
  readonly thrown: number;
  readonly grabsBroken: number;
}

/**
 * The sandbox itself.
 *
 * Owns the composition: which systems exist, how their outputs feed each other,
 * and what the player's actions mean. Everything it calls is public engine API.
 */
export class PhysicsSandbox {
  readonly world = new SimpleWorld();
  readonly grab = new GrabController();
  readonly door: PhysicsDoor;
  readonly diagnostics = new Diagnostics();
  readonly input: InputActions;

  readonly #options: Required<SandboxOptions>;
  readonly #props: number[] = [];
  #doorFrame = 0;
  #doorPanel = 0;
  #pendulumAnchor = 0;
  #pendulumBob = 0;
  #nextJointId = 1;
  #spawned = 0;
  #thrown = 0;
  #grabsBroken = 0;
  #eye: Vec3Tuple = [0, 1.7, 4];
  #forward: Vec3Tuple = [0, 0, -1];

  constructor(options: SandboxOptions = {}) {
    this.#options = {
      propCount: options.propCount ?? 8,
      maxProps: options.maxProps ?? 64,
      reachDistance: options.reachDistance ?? 2.2,
      throwStrength: options.throwStrength ?? 9,
    };
    if (this.#options.propCount > this.#options.maxProps) {
      throw new Error("A sandbox cannot start with more props than its maximum.");
    }
    this.input = new InputActions([SANDBOX_ACTIONS]);
    this.door = new PhysicsDoor({ jointId: this.#nextJointId, speed: 2.5, force: 600, travelSeconds: 0.6, autoCloseSeconds: 5 });
    this.#build();
  }

  get propIds(): readonly number[] {
    return this.#props;
  }

  get heldId(): number | undefined {
    return this.grab.heldBodies[0];
  }

  /** Moves the viewer, which is what the hold point and reach follow. */
  look(eye: Vec3Tuple, forward: Vec3Tuple): void {
    this.#eye = eye;
    this.#forward = forward;
  }

  /** Spawns a prop, refusing past the limit rather than growing without bound. */
  spawnProp(position?: Vec3Tuple): number | undefined {
    if (this.#props.length >= this.#options.maxProps) return undefined;
    const at: Vec3Tuple = position ?? holdPointInFront(this.#eye, this.#forward, this.#options.reachDistance);
    const body = this.world.add("prop", at);
    this.#props.push(body.id);
    this.#spawned += 1;
    return body.id;
  }

  /** The nearest prop within reach of the hold point, or `undefined`. */
  propInReach(): number | undefined {
    const hold = holdPointInFront(this.#eye, this.#forward, this.#options.reachDistance);
    let best: number | undefined;
    let bestDistance = this.#options.reachDistance;
    for (const id of this.#props) {
      const body = this.world.body(id);
      if (!body) continue;
      const distance = Math.hypot(body.position[0] - hold[0], body.position[1] - hold[1], body.position[2] - hold[2]);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = id;
      }
    }
    return best;
  }

  /** Advances one fixed step, reading input and driving every system. */
  update(deltaSeconds: number): void {
    this.diagnostics.begin("sandbox.step");
    this.input.update();

    if (this.input.justPressed("Spawn")) this.spawnProp();
    if (this.input.justPressed("ToggleDoor")) this.door.toggle();

    const held = this.heldId;
    if (this.input.justPressed("Throw") && held !== undefined) {
      this.world.applyCommands(this.grab.throwObject(held, throwImpulse(this.#forward, this.#options.throwStrength)));
      this.#thrown += 1;
    } else if (this.input.justPressed("Grab")) {
      if (held !== undefined) this.grab.release(held);
      else {
        const target = this.propInReach();
        if (target !== undefined) {
          this.grab.grab(target, holdPointInFront(this.#eye, this.#forward, this.#options.reachDistance), {
            ...DEFAULT_GRAB_OPTIONS,
            // Scaled to the reach, not left at the default. A 90-degree turn
            // moves the hold point by reach x sqrt(2); with the default 3 m
            // break distance and a 2.2 m reach that is 3.1 m, so simply looking
            // around drops whatever you are carrying.
            breakDistance: this.#options.reachDistance * 2.5,
          });
        }
      }
    }

    for (const id of this.grab.heldBodies) {
      this.grab.moveHold(id, holdPointInFront(this.#eye, this.#forward, this.#options.reachDistance));
    }
    const grabResult = this.grab.update(this.world.poses(), deltaSeconds);
    this.#grabsBroken += grabResult.broken.length;
    this.world.applyCommands(grabResult.commands);
    this.world.applyCommands(this.door.update(deltaSeconds));
    this.world.step(deltaSeconds);

    this.diagnostics.end("sandbox.step");
    this.diagnostics.set("sandbox.props", this.#props.length);
    this.diagnostics.set("sandbox.held", this.grab.heldBodies.length);
    this.diagnostics.set("physics.bodies", this.world.bodies.length);
  }

  stats(): SandboxStats {
    return {
      props: this.#props.length,
      held: this.grab.heldBodies.length,
      joints: this.world.jointCount,
      doorState: this.door.state,
      spawned: this.#spawned,
      thrown: this.#thrown,
      grabsBroken: this.#grabsBroken,
    };
  }

  /** Collision generated from the prop's mesh, proving the asset path works. */
  static propCollisionVolume(): number {
    return signedVolume(box({ width: 1, height: 1, depth: 1 }));
  }

  static propTriangleCount(): number {
    return meshStats(box()).triangles;
  }

  #build(): void {
    this.world.add("ground", [0, 0, 0], { isStatic: true });

    // A hinged door: a static frame, a swinging panel, and a motor.
    const frame = this.world.add("door", [-3, 1, 0], { isStatic: true });
    const panel = this.world.add("door", [-2.5, 1, 0], { mass: 20 });
    this.#doorFrame = frame.id;
    this.#doorPanel = panel.id;
    this.world.applyCommands([
      addJointCommand(
        hingeJoint(this.#nextJointId++, frame.id, panel.id, {
          anchorA: [0, 0, 0],
          anchorB: [-0.5, 0, 0],
          axis: [0, 1, 0],
          limits: [0, Math.PI / 2],
          motor: [0, 600],
        }),
      ),
    ]);

    // A pendulum: a ball joint from a static anchor.
    const anchor = this.world.add("pendulum", [3, 4, 0], { isStatic: true });
    const bob = this.world.add("pendulum", [3, 2, 0], { mass: 5 });
    this.#pendulumAnchor = anchor.id;
    this.#pendulumBob = bob.id;
    this.world.applyCommands([
      addJointCommand({
        id: this.#nextJointId++,
        bodyA: anchor.id,
        bodyB: bob.id,
        joint: { kind: "ball", anchorA: [0, 0, 0], anchorB: [0, 2, 0] },
      }),
    ]);

    for (let index = 0; index < this.#options.propCount; index += 1) {
      const angle = (index / this.#options.propCount) * Math.PI * 2;
      this.spawnProp([Math.cos(angle) * 2, 3 + index * 0.6, Math.sin(angle) * 2]);
    }
  }

  /** Ids of the fixtures, for tests and for a renderer to label them. */
  get fixtures(): { doorFrame: number; doorPanel: number; pendulumAnchor: number; pendulumBob: number } {
    return {
      doorFrame: this.#doorFrame,
      doorPanel: this.#doorPanel,
      pendulumAnchor: this.#pendulumAnchor,
      pendulumBob: this.#pendulumBob,
    };
  }
}
