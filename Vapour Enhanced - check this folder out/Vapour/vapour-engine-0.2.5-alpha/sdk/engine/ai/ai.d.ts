export type BehaviorStatus = "running" | "success" | "failure";
export interface StateDefinition<TContext> {
    readonly enter?: (context: TContext, previous: string | undefined) => void;
    readonly update: (context: TContext, deltaSeconds: number) => string | void;
    readonly exit?: (context: TContext, next: string) => void;
}
/** Deterministic gameplay state machine. Transitions requested during update
 * are applied atomically after the state's update callback returns. */
export declare class StateMachine<TContext> {
    #private;
    constructor(initial: string, states: Readonly<Record<string, StateDefinition<TContext>>>);
    get state(): string;
    get started(): boolean;
    get transitionCount(): number;
    start(context: TContext): void;
    update(context: TContext, deltaSeconds: number): void;
    transition(next: string, context: TContext): void;
    reset(initial: string, context?: TContext): void;
}
export type BehaviorNode<TContext> = {
    readonly id: string;
    readonly type: "action";
    readonly run: (context: TContext, deltaSeconds: number) => BehaviorStatus;
} | {
    readonly id: string;
    readonly type: "condition";
    readonly test: (context: TContext) => boolean;
} | {
    readonly id: string;
    readonly type: "sequence" | "selector";
    readonly children: readonly BehaviorNode<TContext>[];
} | {
    readonly id: string;
    readonly type: "inverter";
    readonly child: BehaviorNode<TContext>;
} | {
    readonly id: string;
    readonly type: "repeat";
    readonly child: BehaviorNode<TContext>;
    readonly count?: number;
} | {
    readonly id: string;
    readonly type: "cooldown";
    readonly child: BehaviorNode<TContext>;
    readonly seconds: number;
};
/** Resumable behavior-tree runner. Running sequence/selector cursors, repeat
 * counts, and cooldowns live in the runner rather than mutable node assets, so
 * one immutable tree definition can be shared by thousands of agents. */
export declare class BehaviorTree<TContext> {
    #private;
    constructor(root: BehaviorNode<TContext>);
    tick(context: TContext, deltaSeconds: number): BehaviorStatus;
    reset(): void;
    resetNode(id: string): void;
}
export interface Vector3Like {
    readonly x: number;
    readonly y: number;
    readonly z: number;
}
export interface MutableVector3 {
    x: number;
    y: number;
    z: number;
}
/** Writes a velocity that seeks a target without allocating a vector. */
export declare function steerSeek(out: MutableVector3, position: Vector3Like, target: Vector3Like, maxSpeed: number): MutableVector3;
/** Seek with linear deceleration inside slowRadius and a full stop inside
 * stopRadius. Useful for characters, flying agents, and camera followers. */
export declare function steerArrive(out: MutableVector3, position: Vector3Like, target: Vector3Like, maxSpeed: number, slowRadius: number, stopRadius?: number): MutableVector3;
/** Accumulates inverse-distance separation from nearby positions. */
export declare function steerSeparation(out: MutableVector3, position: Vector3Like, neighbours: Iterable<Vector3Like>, radius: number, maxSpeed: number): MutableVector3;
//# sourceMappingURL=ai.d.ts.map