export interface NavigationNode {
    readonly x: number;
    readonly y: number;
    readonly z: number;
}
export interface PathfindingOptions<TNode extends NavigationNode> {
    readonly neighbours: (node: TNode) => Iterable<TNode>;
    readonly traversable?: (node: TNode) => boolean;
    readonly cost?: (from: TNode, to: TNode) => number;
    readonly heuristic?: (node: TNode, goal: TNode) => number;
    readonly key?: (node: TNode) => string;
    readonly maxVisited?: number;
}
export interface PathResult<TNode> {
    readonly status: "complete" | "unreachable" | "budget-exceeded";
    readonly path: readonly TNode[];
    readonly visited: number;
    readonly cost: number;
}
/** Deterministic A* over a caller-defined graph. Nodes can be voxel cells,
 * tile coordinates, waypoints, or navmesh polygons. Search budgets turn an
 * expensive/unreachable query into an explicit result instead of a frame hang. */
export declare function findPath<TNode extends NavigationNode>(start: TNode, goal: TNode, options: PathfindingOptions<TNode>): PathResult<TNode>;
/** Four-way XZ neighbours for tile and voxel walking. Y is preserved. */
export declare function gridNeighbours4(node: NavigationNode): readonly NavigationNode[];
export declare function navigationNodeKey(node: NavigationNode): string;
export declare function euclideanDistance(a: NavigationNode, b: NavigationNode): number;
export declare function manhattanDistance(a: NavigationNode, b: NavigationNode): number;
//# sourceMappingURL=navigation.d.ts.map