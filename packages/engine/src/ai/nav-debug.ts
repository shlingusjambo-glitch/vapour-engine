import { DEBUG_CATEGORIES, DEBUG_COLORS, type DebugDraw } from "../diagnostics/debug-draw.js";
import type { NavMesh } from "./navmesh.js";

export interface NavDebugOptions {
  readonly spans?: boolean;
  readonly adjacency?: boolean;
  readonly offMeshLinks?: boolean;
  readonly labels?: boolean;
  readonly heightOffset?: number;
}

/** Queues a baked navmesh into the shared debug-draw buffer. */
export function drawNavMesh(debug: DebugDraw, navmesh: NavMesh, options: NavDebugOptions = {}): void {
  const drawSpans = options.spans ?? true;
  const yOffset = options.heightOffset ?? 0.03;
  if (!Number.isFinite(yOffset)) throw new Error("Navigation debug height offset must be finite.");
  const half = navmesh.settings.cellSize * 0.46;
  const common = { category: DEBUG_CATEGORIES.navigation, depthTest: true } as const;
  const spans = navmesh.spans();
  for (const span of spans) {
    const [x, y0, z] = navmesh.spanPosition(span);
    const y = y0 + yOffset;
    const blocked = navmesh.isSpanBlocked(span.index);
    if (drawSpans) debug.polyline([[x-half,y,z-half],[x+half,y,z-half],[x+half,y,z+half],[x-half,y,z+half]], { ...common, close: true, color: blocked ? DEBUG_COLORS.red : DEBUG_COLORS.green });
    if (options.labels) debug.text([x, y + 0.05, z], `${span.index}:${span.area}`, { ...common, color: DEBUG_COLORS.white });
    if (options.adjacency) {
      for (const linked of span.links) {
        if (linked <= span.index) continue;
        const target = navmesh.spanPosition(spans[linked]!);
        debug.line([x,y,z], [target[0],target[1]+yOffset,target[2]], { ...common, color: DEBUG_COLORS.cyan });
      }
    }
  }
  if (options.offMeshLinks ?? true) for (const link of navmesh.offMeshLinks()) {
    const from = [link.from[0], link.from[1] + yOffset, link.from[2]] as const;
    const direction = [link.to[0] - link.from[0], link.to[1] - link.from[1], link.to[2] - link.from[2]] as const;
    debug.arrow(from, direction, { ...common, color: DEBUG_COLORS.magenta });
    if (options.labels) debug.text(from, link.kind, { ...common, color: DEBUG_COLORS.magenta });
  }
}

/** Draws an agent route, highlighting start and destination. */
export function drawNavigationPath(debug: DebugDraw, points: readonly (readonly number[])[], heightOffset = 0.08): void {
  if (!Number.isFinite(heightOffset)) throw new Error("Navigation path debug height offset must be finite.");
  if (points.length === 0) return;
  const raised = points.map((point) => [point[0] ?? 0, (point[1] ?? 0) + heightOffset, point[2] ?? 0] as const);
  debug.polyline(raised, { category: DEBUG_CATEGORIES.navigation, color: DEBUG_COLORS.yellow, depthTest: true });
  debug.sphere(raised[0]!, 0.08, { category: DEBUG_CATEGORIES.navigation, color: DEBUG_COLORS.green, segments: 8 });
  if (raised.length > 1) debug.sphere(raised[raised.length - 1]!, 0.08, { category: DEBUG_CATEGORIES.navigation, color: DEBUG_COLORS.orange, segments: 8 });
}
