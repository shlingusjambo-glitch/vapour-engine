/** NavMesh baking and queries.
 *
 * Before Mirage, `findPath` searched a graph the *caller* supplied. That is the
 * right low-level primitive and the wrong thing to ask a game for: building the
 * graph is the hard part, and it is the part that has to agree with the
 * geometry the renderer and physics use. So this module bakes one from
 * triangles.
 *
 * The approach is a heightfield voxelization, the same shape of algorithm
 * Recast uses and for the same reasons: it makes no assumptions about the input
 * being clean, it handles overlapping floors (a bridge over a road, a second
 * storey) naturally by keeping several spans per column, and its parameters —
 * cell size, agent radius, step height — are quantities a designer can reason
 * about rather than tuning constants.
 *
 * Baking is deliberately **per agent size**. A navmesh eroded for a 0.3 m
 * radius is wrong for a 1.2 m vehicle, and the alternative — one mesh with
 * runtime radius checks — is both slower and subtly wrong at corners.
 */
import { findPath, } from "./navigation.js";
export const DEFAULT_NAVMESH_SETTINGS = {
    cellSize: 0.3,
    cellHeight: 0.2,
    agentRadius: 0.35,
    agentHeight: 1.8,
    agentMaxClimb: 0.4,
    maxSlopeDegrees: 45,
};
export const DEFAULT_AREA = { id: 0, name: "walkable", cost: 1 };
export const NAVMESH_DATA_VERSION = 1;
/** Baked navigation data plus the queries a game runs against it. */
export class NavMesh {
    settings;
    #spans;
    #columns;
    #origin;
    #areas;
    #offMesh = [];
    #obstacles = new Map();
    #blockedSpans = new Map();
    #stats;
    /** @internal Built by {@link bakeNavMesh}. */
    constructor(settings, spans, columns, origin, areas, bakeMs) {
        this.settings = settings;
        this.#spans = spans;
        this.#columns = columns;
        this.#origin = origin;
        this.#areas = new Map(areas.map((area) => [area.id, area]));
        if (!this.#areas.has(DEFAULT_AREA.id))
            this.#areas.set(DEFAULT_AREA.id, DEFAULT_AREA);
        this.#stats = {
            spans: spans.length,
            columns: columns.size,
            links: spans.reduce((sum, span) => sum + span.links.length, 0),
            offMeshLinks: 0,
            bakeMs,
            cellSize: settings.cellSize,
            agentRadius: settings.agentRadius,
            dynamicObstacles: 0,
        };
    }
    get spanCount() {
        return this.#spans.length;
    }
    get isEmpty() {
        return this.#spans.length === 0;
    }
    stats() {
        return {
            ...this.#stats,
            offMeshLinks: this.#offMesh.length,
            links: this.#spans.reduce((sum, span) => sum + span.links.length, 0),
            dynamicObstacles: this.#obstacles.size,
        };
    }
    /** Deterministic asset form; runtime maps and column indexes are rebuilt on load. */
    serialize() {
        return {
            version: NAVMESH_DATA_VERSION,
            settings: { ...this.settings },
            origin: [...this.#origin],
            spans: this.#spans.map((span) => ({ ...span, links: [...span.links] })),
            areas: [...this.#areas.values()]
                .sort((a, b) => a.id - b.id)
                .map((area) => ({
                ...area,
                cost: Number.isFinite(area.cost) ? area.cost : null,
            })),
            offMeshLinks: this.#offMesh.map((link) => ({ ...link })),
        };
    }
    /** Rehydrates a baked asset without rerunning geometry voxelization. */
    static deserialize(input) {
        const data = validateNavMeshData(input);
        const spans = data.spans.map((span) => ({
            ...span,
            links: [...span.links],
        }));
        const columns = new Map();
        for (const span of spans) {
            const key = columnKey(span.x, span.z);
            const column = columns.get(key) ?? { spans: [] };
            column.spans.push(span);
            columns.set(key, column);
        }
        const mesh = new NavMesh(data.settings, spans, columns, data.origin, data.areas.map((area) => ({ ...area, cost: area.cost ?? Infinity })), 0);
        mesh.#offMesh.push(...data.offMeshLinks.map((link) => ({ ...link })));
        return mesh;
    }
    /** Every span, for debug rendering. */
    spans() {
        return this.#spans;
    }
    /** World-space centre of a span, which is where a path routes through. */
    spanPosition(span) {
        return [
            this.#origin[0] + (span.x + 0.5) * this.settings.cellSize,
            span.y,
            this.#origin[2] + (span.z + 0.5) * this.settings.cellSize,
        ];
    }
    /**
     * Adds a connection that adjacency cannot express.
     *
     * This is how a generated building's doorways become routes: the architecture
     * generator reports apertures, and each walkable one becomes a link here.
     * Endpoints snap to the nearest span, so a link placed approximately still
     * connects.
     */
    addOffMeshLink(link) {
        const from = this.nearestSpan(link.from);
        const to = this.nearestSpan(link.to);
        if (from === undefined || to === undefined)
            return false;
        const cost = link.cost ?? distance(this.spanPosition(from), this.spanPosition(to));
        const kind = link.kind ?? "link";
        this.#offMesh.push({ from: from.index, to: to.index, cost, kind });
        if (link.bidirectional !== false)
            this.#offMesh.push({ from: to.index, to: from.index, cost, kind });
        return true;
    }
    /** Off-mesh links, for debug rendering. */
    offMeshLinks() {
        return this.#offMesh.map((link) => ({
            from: this.spanPosition(this.#spans[link.from]),
            to: this.spanPosition(this.#spans[link.to]),
            kind: link.kind,
        }));
    }
    /** Adds or moves a dynamic obstacle and returns its carved span count. */
    setObstacle(obstacle) {
        if (!obstacle.id.trim())
            throw new Error("A navigation obstacle requires a non-empty id.");
        if (obstacle.position.length !== 3 ||
            !obstacle.position.every(Number.isFinite))
            throw new Error(`Navigation obstacle "${obstacle.id}" needs a finite 3D position.`);
        if (!Number.isFinite(obstacle.radius) || obstacle.radius <= 0)
            throw new Error(`Navigation obstacle "${obstacle.id}" radius must be positive and finite.`);
        const height = obstacle.height ?? this.settings.agentHeight;
        if (!Number.isFinite(height) || height <= 0)
            throw new Error(`Navigation obstacle "${obstacle.id}" height must be positive and finite.`);
        this.removeObstacle(obstacle.id);
        const blocked = [];
        const radius = obstacle.radius + this.settings.agentRadius;
        for (const span of this.#spans) {
            const position = this.spanPosition(span);
            if (Math.abs(position[1] - obstacle.position[1]) > height * 0.5)
                continue;
            if (Math.hypot(position[0] - obstacle.position[0], position[2] - obstacle.position[2]) > radius)
                continue;
            blocked.push(span.index);
            this.#blockedSpans.set(span.index, (this.#blockedSpans.get(span.index) ?? 0) + 1);
        }
        this.#obstacles.set(obstacle.id, blocked);
        return blocked.length;
    }
    /** Removes one carving volume while preserving overlapping obstacles. */
    removeObstacle(id) {
        const blocked = this.#obstacles.get(id);
        if (!blocked)
            return false;
        for (const index of blocked) {
            const count = (this.#blockedSpans.get(index) ?? 1) - 1;
            if (count === 0)
                this.#blockedSpans.delete(index);
            else
                this.#blockedSpans.set(index, count);
        }
        this.#obstacles.delete(id);
        return true;
    }
    isSpanBlocked(index) {
        return this.#blockedSpans.has(index);
    }
    /**
     * The walkable span nearest a world position.
     *
     * Searches outward ring by ring rather than scanning every span: an agent
     * asks this every time it is given a destination, and a linear scan over a
     * large map would show up in the frame.
     */
    nearestSpan(position, maxRadiusCells = 16) {
        const [x, z] = this.#columnOf(position);
        let best;
        let bestDistance = Infinity;
        for (let ring = 0; ring <= maxRadiusCells; ring += 1) {
            for (let dz = -ring; dz <= ring; dz += 1) {
                for (let dx = -ring; dx <= ring; dx += 1) {
                    // Only the ring's perimeter is new on each iteration.
                    if (ring > 0 && Math.max(Math.abs(dx), Math.abs(dz)) !== ring)
                        continue;
                    for (const span of this.#columns.get(columnKey(x + dx, z + dz))
                        ?.spans ?? []) {
                        if (this.isSpanBlocked(span.index))
                            continue;
                        const candidate = distance(this.spanPosition(span), position);
                        if (candidate < bestDistance) {
                            bestDistance = candidate;
                            best = span;
                        }
                    }
                }
            }
            // Stop as soon as a ring cannot contain anything closer than the best.
            if (best !== undefined && bestDistance <= ring * this.settings.cellSize)
                break;
        }
        return best;
    }
    isWalkable(position, tolerance = 1) {
        const span = this.nearestSpan(position, 2);
        return (span !== undefined &&
            distance(this.spanPosition(span), position) <= tolerance);
    }
    /**
     * Finds a path between two world positions.
     *
     * Returns the corridor of span centres. Use {@link smoothPath} to turn it
     * into the straight-line route an agent should actually walk — a raw grid
     * corridor makes agents move in visible staircase steps.
     */
    findPath(start, goal, options = {}) {
        const startSpan = this.nearestSpan(start);
        const goalSpan = this.nearestSpan(goal);
        if (startSpan === undefined || goalSpan === undefined) {
            return {
                status: "unreachable",
                path: [],
                visited: 0,
                cost: Infinity,
                points: [],
            };
        }
        const spans = this.#spans;
        const offMeshBySpan = new Map();
        for (const link of this.#offMesh) {
            const list = offMeshBySpan.get(link.from) ?? [];
            list.push({ to: link.to, cost: link.cost });
            offMeshBySpan.set(link.from, list);
        }
        const nodeFor = (index) => {
            const position = this.spanPosition(spans[index]);
            return { x: position[0], y: position[1], z: position[2], index };
        };
        const result = findPath(nodeFor(startSpan.index), nodeFor(goalSpan.index), {
            key: (node) => String(node.index),
            neighbours: (node) => {
                const index = node.index;
                const out = [];
                for (const link of spans[index].links)
                    if (!this.isSpanBlocked(link))
                        out.push(nodeFor(link));
                for (const link of offMeshBySpan.get(index) ?? [])
                    if (!this.isSpanBlocked(link.to))
                        out.push(nodeFor(link.to));
                return out;
            },
            cost: (from, to) => {
                const target = spans[to.index];
                const area = this.#areas.get(target.area) ?? DEFAULT_AREA;
                return (distance([from.x, from.y, from.z], [to.x, to.y, to.z]) * area.cost);
            },
            ...(options.maxVisited === undefined
                ? {}
                : { maxVisited: options.maxVisited }),
        });
        return {
            ...result,
            points: result.path.map((node) => [node.x, node.y, node.z]),
        };
    }
    /**
     * Rebakes only the spans touching `region`, splicing them into this mesh
     * instead of rebaking whole. Built for streaming worlds: a newly loaded or
     * edited tile shouldn't force every other tile's navmesh to reprocess.
     *
     * `input` must describe the tile's *current* geometry (not a delta) — a
     * column inside `region` with no covering triangle becomes empty, which is
     * how removed geometry is represented.
     *
     * Correctness relies on two rings around `region`, sized from the agent
     * radius: a "halo" of `ceil(agentRadius / cellSize) + 1` columns where span
     * *existence* is recomputed (erosion can only be affected this far from a
     * geometry change), and one further ring where only *links* are
     * recomputed against the halo's new spans. Everything outside that is
     * mechanically unreachable by the edit and is carried over unchanged,
     * other than a possible index renumbering — the flat span array has no
     * gaps, so any change in span count shifts later indices; span *content*
     * (position/area/links) outside the touched rings is otherwise untouched.
     * Off-mesh links with an endpoint in the touched region are re-snapped by
     * position; a removed endpoint drops the link.
     */
    rebakeRegion(input, region) {
        const settings = this.settings;
        const cell = settings.cellSize;
        const origin = this.#origin;
        const erodeCells = Math.ceil(settings.agentRadius / cell);
        const halo = erodeCells + 1;
        const regionBounds = {
            x0: Math.floor((region.minX - origin[0]) / cell),
            x1: Math.floor((region.maxX - origin[0]) / cell),
            z0: Math.floor((region.minZ - origin[2]) / cell),
            z1: Math.floor((region.maxZ - origin[2]) / cell),
        };
        const haloBounds = expandBounds(regionBounds, halo);
        const outerBounds = expandBounds(haloBounds, 1);
        // Surfaces for the working set: new geometry inside the region, existing
        // (unchanged) geometry for the rest of the outer ring.
        const surfaces = rasterizeSurfaces(input, settings, origin, regionBounds);
        for (const [key, column] of this.#columns) {
            const [x, z] = unpackColumnKey(key);
            if (!inBounds(outerBounds, x, z) || inBounds(regionBounds, x, z))
                continue;
            surfaces.set(key, column.spans.map((span) => ({ y: span.y, area: span.area })));
        }
        const { spans: workingSpans, columns: workingColumns } = buildSpansFromSurfaces(surfaces);
        linkSpans(workingSpans, workingColumns, settings.agentMaxClimb);
        // Existence (erosion) is only recomputed for the halo; the outer link
        // ring keeps whatever spans it already had — its geometry never changed.
        const erodeCellsForHalo = erodeCells;
        const kept = erodeCellsForHalo > 0
            ? erode(workingSpans, workingColumns, erodeCellsForHalo)
            : new Set(workingSpans.map((span) => span.index));
        const survivingWorking = workingSpans.filter((span) => {
            if (!inBounds(haloBounds, span.x, span.z))
                return true; // outer ring: always kept
            return kept.has(span.index);
        });
        // Match surviving working spans back to whatever previously occupied the
        // same position, so unaffected adjacency carries over automatically.
        const positionKey = (x, z, y) => `${x}|${z}|${y}`;
        const workingByPosition = new Map();
        for (const span of survivingWorking)
            workingByPosition.set(positionKey(span.x, span.z, span.y), span);
        const untouched = this.#spans.filter((span) => !inBounds(outerBounds, span.x, span.z));
        const finalOrder = [...untouched, ...survivingWorking];
        const finalIndexOf = new Map();
        finalOrder.forEach((span, index) => finalIndexOf.set(span, index));
        // Old global index -> new global index, for every span that still exists.
        const oldToNew = new Map();
        for (const span of this.#spans) {
            if (!inBounds(outerBounds, span.x, span.z)) {
                oldToNew.set(span.index, finalIndexOf.get(span));
                continue;
            }
            const match = workingByPosition.get(positionKey(span.x, span.z, span.y));
            if (match)
                oldToNew.set(span.index, finalIndexOf.get(match));
            // else: this span was removed or eroded away; links to it are dropped.
        }
        // Working-local index -> new global index, for spans built fresh above
        // (needed because their `links` reference each other by local index, a
        // different numbering than the old mesh's).
        const workingLocalToNew = new Map();
        for (const span of survivingWorking)
            workingLocalToNew.set(span.index, finalIndexOf.get(span));
        // Cross-link the outer ring's true-exterior neighbours (outside
        // `outerBounds`, never touched) to the working spans that now sit beside
        // them. Working spans were only linked *within* the working set above,
        // so this is the one splice that has to happen unconditionally, not just
        // for brand-new spans: a surviving-but-rebuilt span (e.g. the outermost
        // link-recompute ring) also lost its exterior-facing links along the way.
        const exteriorLinks = new Map();
        for (const span of survivingWorking) {
            for (const [dx, dz] of NEIGHBOUR_OFFSETS) {
                const nx = span.x + dx;
                const nz = span.z + dz;
                if (inBounds(outerBounds, nx, nz))
                    continue;
                for (const exterior of this.#columns.get(columnKey(nx, nz))?.spans ??
                    []) {
                    if (Math.abs(exterior.y - span.y) > settings.agentMaxClimb)
                        continue;
                    const newSpanIndex = finalIndexOf.get(span);
                    const newExteriorIndex = oldToNew.get(exterior.index);
                    if (newExteriorIndex === undefined)
                        continue;
                    (exteriorLinks.get(span) ?? exteriorLinks.set(span, new Set()).get(span)).add(newExteriorIndex);
                    (exteriorLinks.get(exterior) ??
                        exteriorLinks.set(exterior, new Set()).get(exterior)).add(newSpanIndex);
                }
            }
        }
        const workingSet = new Set(survivingWorking);
        const finalSpans = finalOrder.map((span, index) => {
            const links = new Set();
            if (workingSet.has(span)) {
                for (const local of span.links) {
                    const mapped = workingLocalToNew.get(local);
                    if (mapped !== undefined)
                        links.add(mapped);
                }
            }
            else {
                for (const old of span.links) {
                    const mapped = oldToNew.get(old);
                    if (mapped !== undefined)
                        links.add(mapped);
                }
            }
            for (const extra of exteriorLinks.get(span) ?? [])
                links.add(extra);
            return {
                index,
                x: span.x,
                z: span.z,
                y: span.y,
                area: span.area,
                links: [...links],
            };
        });
        const finalColumns = new Map();
        for (const span of finalSpans) {
            const key = columnKey(span.x, span.z);
            const column = finalColumns.get(key) ?? { spans: [] };
            column.spans.push(span);
            finalColumns.set(key, column);
        }
        // Report, scoped to the requested region (not the wider halo/link rings).
        const oldRegionSpans = this.#spans.filter((span) => inBounds(regionBounds, span.x, span.z));
        const oldRegionByPosition = new Map(oldRegionSpans.map((span) => [
            positionKey(span.x, span.z, span.y),
            span,
        ]));
        const newRegionSpans = finalSpans.filter((span) => inBounds(regionBounds, span.x, span.z));
        const newRegionByPosition = new Map(newRegionSpans.map((span) => [
            positionKey(span.x, span.z, span.y),
            span,
        ]));
        let spansModified = 0;
        for (const [key, oldSpan] of oldRegionByPosition) {
            const newSpan = newRegionByPosition.get(key);
            if (newSpan && newSpan.area !== oldSpan.area)
                spansModified += 1;
        }
        const spansAdded = [...newRegionByPosition.keys()].filter((key) => !oldRegionByPosition.has(key)).length;
        const spansRemoved = [...oldRegionByPosition.keys()].filter((key) => !newRegionByPosition.has(key)).length;
        // Off-mesh links: re-snap by endpoint position, drop what no longer exists.
        const newOffMesh = [];
        let offMeshInvalidated = 0;
        for (const link of this.#offMesh) {
            const from = oldToNew.get(link.from);
            const to = oldToNew.get(link.to);
            if (from === undefined || to === undefined) {
                offMeshInvalidated += 1;
                continue;
            }
            newOffMesh.push({ ...link, from, to });
        }
        const rebaked = new NavMesh(settings, finalSpans, finalColumns, origin, [...this.#areas.values()], 0);
        rebaked.#offMesh.push(...newOffMesh);
        return {
            navmesh: rebaked,
            spansAdded,
            spansRemoved,
            spansModified,
            spansRebaked: survivingWorking.length,
            spansTotal: finalSpans.length,
            offMeshLinksInvalidated: offMeshInvalidated,
        };
    }
    #columnOf(position) {
        return [
            Math.floor(((position[0] ?? 0) - this.#origin[0]) / this.settings.cellSize),
            Math.floor(((position[2] ?? 0) - this.#origin[2]) / this.settings.cellSize),
        ];
    }
}
export function serializeNavMesh(navmesh) {
    return `${JSON.stringify(navmesh.serialize(), null, 2)}\n`;
}
export function deserializeNavMesh(source) {
    let data = source;
    if (typeof source === "string") {
        try {
            data = JSON.parse(source);
        }
        catch (error) {
            throw new Error(`NavMesh asset is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    return NavMesh.deserialize(data);
}
function validateNavMeshData(input) {
    if (typeof input !== "object" || input === null)
        throw new Error("NavMesh asset must be an object.");
    const data = input;
    if (data.version !== NAVMESH_DATA_VERSION)
        throw new Error(`Unsupported NavMesh asset version ${String(data.version)}; expected ${String(NAVMESH_DATA_VERSION)}.`);
    if (!data.settings)
        throw new Error("NavMesh asset is missing settings.");
    validateSettings(data.settings);
    if (!Array.isArray(data.origin) ||
        data.origin.length !== 3 ||
        !data.origin.every(Number.isFinite))
        throw new Error("NavMesh asset origin must contain three finite numbers.");
    if (!Array.isArray(data.spans) ||
        !Array.isArray(data.areas) ||
        !Array.isArray(data.offMeshLinks))
        throw new Error("NavMesh asset must contain spans, areas, and offMeshLinks arrays.");
    for (const [index, span] of data.spans.entries()) {
        if (span.index !== index)
            throw new Error(`NavMesh span ${String(index)} has non-canonical index ${String(span.index)}.`);
        if (![span.x, span.y, span.z, span.area].every(Number.isFinite) ||
            !Array.isArray(span.links))
            throw new Error(`NavMesh span ${String(index)} is malformed.`);
        for (const link of span.links)
            if (!Number.isInteger(link) || link < 0 || link >= data.spans.length)
                throw new Error(`NavMesh span ${String(index)} links to missing span ${String(link)}.`);
    }
    const areaIds = new Set();
    for (const area of data.areas) {
        if (!Number.isInteger(area.id) ||
            area.id < 0 ||
            !area.name?.trim() ||
            (area.cost !== null && (!Number.isFinite(area.cost) || area.cost < 0)))
            throw new Error("NavMesh asset contains a malformed area.");
        if (areaIds.has(area.id))
            throw new Error(`NavMesh asset contains duplicate area id ${String(area.id)}.`);
        areaIds.add(area.id);
    }
    for (const [index, link] of data.offMeshLinks.entries()) {
        if (![link.from, link.to].every((value) => Number.isInteger(value) && value >= 0 && value < data.spans.length) ||
            !Number.isFinite(link.cost) ||
            link.cost < 0 ||
            !link.kind?.trim())
            throw new Error(`NavMesh off-mesh link ${String(index)} is malformed.`);
    }
    return data;
}
function columnKey(x, z) {
    // Pack two signed 16-bit column coordinates into one number key, which is
    // markedly faster to hash than a string on the millions of lookups a bake does.
    return ((x & 0xffff) << 16) | (z & 0xffff);
}
function unpackColumnKey(key) {
    return [((key >> 16) << 16) >> 16, (key << 16) >> 16];
}
const NEIGHBOUR_OFFSETS = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
];
function inBounds(bounds, x, z) {
    return x >= bounds.x0 && x <= bounds.x1 && z >= bounds.z0 && z <= bounds.z1;
}
function expandBounds(bounds, cells) {
    return {
        x0: bounds.x0 - cells,
        x1: bounds.x1 + cells,
        z0: bounds.z0 - cells,
        z1: bounds.z1 + cells,
    };
}
/** Steps 1 and 2 of {@link bakeNavMesh}: rasterize triangles into per-column
 * surface heights, merging near-coincident heights within one column.
 *
 * When `bounds` is given, only columns inside it are populated — triangles
 * whose footprint falls entirely outside are skipped, which is what makes a
 * {@link NavMesh.rebakeRegion} rebake cheaper than a full bake. */
function rasterizeSurfaces(input, settings, origin, bounds) {
    const triangleCount = input.indices.length / 3;
    const cosLimit = Math.cos((settings.maxSlopeDegrees * Math.PI) / 180);
    const cell = settings.cellSize;
    const surfaces = new Map();
    for (let triangle = 0; triangle < triangleCount; triangle += 1) {
        const a = corner(input, triangle, 0);
        const b = corner(input, triangle, 1);
        const c = corner(input, triangle, 2);
        const normal = cross(subtract(b, a), subtract(c, a));
        const length = Math.hypot(normal[0], normal[1], normal[2]);
        if (length < 1e-12)
            continue;
        if (normal[1] / length < cosLimit)
            continue; // too steep to stand on
        const area = input.areas?.[triangle] ?? DEFAULT_AREA.id;
        let x0 = Math.floor((Math.min(a[0], b[0], c[0]) - origin[0]) / cell);
        let x1 = Math.floor((Math.max(a[0], b[0], c[0]) - origin[0]) / cell);
        let z0 = Math.floor((Math.min(a[2], b[2], c[2]) - origin[2]) / cell);
        let z1 = Math.floor((Math.max(a[2], b[2], c[2]) - origin[2]) / cell);
        if (bounds) {
            if (x1 < bounds.x0 || x0 > bounds.x1 || z1 < bounds.z0 || z0 > bounds.z1)
                continue; // triangle's footprint cannot touch a bounded column
            x0 = Math.max(x0, bounds.x0);
            x1 = Math.min(x1, bounds.x1);
            z0 = Math.max(z0, bounds.z0);
            z1 = Math.min(z1, bounds.z1);
        }
        for (let z = z0; z <= z1; z += 1) {
            for (let x = x0; x <= x1; x += 1) {
                const px = origin[0] + (x + 0.5) * cell;
                const pz = origin[2] + (z + 0.5) * cell;
                const height = heightAt(a, b, c, px, pz);
                if (height === undefined)
                    continue;
                const key = columnKey(x, z);
                const list = surfaces.get(key) ?? [];
                // Merge with an existing surface within one cell height, so a floor of
                // many triangles becomes one span instead of dozens stacked up.
                const existing = list.find((entry) => Math.abs(entry.y - height) <= settings.cellHeight);
                if (existing) {
                    if (height > existing.y)
                        existing.y = height;
                    continue;
                }
                list.push({ y: height, area });
                surfaces.set(key, list);
            }
        }
    }
    return surfaces;
}
/** Turns rasterized surfaces into spans and their owning columns. Span
 * `index` values are local (0-based, insertion order) — callers that splice
 * into a larger mesh must remap them. */
function buildSpansFromSurfaces(surfaces) {
    const spans = [];
    const columns = new Map();
    for (const [key, list] of surfaces) {
        const [x, z] = unpackColumnKey(key);
        const column = { spans: [] };
        for (const entry of [...list].sort((left, right) => left.y - right.y)) {
            const span = {
                index: spans.length,
                x,
                z,
                y: entry.y,
                area: entry.area,
                links: [],
            };
            spans.push(span);
            column.spans.push(span);
        }
        columns.set(key, column);
    }
    return { spans, columns };
}
/** Step 3 of {@link bakeNavMesh}: connect spans in neighbouring columns whose
 * height an agent can step over. Mutates `span.links` in place. Only links
 * within `columns` are added — a caller splicing a subset of a larger mesh
 * must separately stitch links to spans outside that set. */
function linkSpans(spans, columns, agentMaxClimb) {
    for (const span of spans) {
        for (const [dx, dz] of NEIGHBOUR_OFFSETS) {
            for (const other of columns.get(columnKey(span.x + dx, span.z + dz))
                ?.spans ?? []) {
                if (Math.abs(other.y - span.y) > agentMaxClimb)
                    continue;
                span.links.push(other.index);
            }
        }
    }
}
function distance(a, b) {
    return Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0));
}
/**
 * Bakes a navmesh from triangles.
 *
 * Steps, in order:
 *
 * 1. **Rasterize** each triangle into the columns its footprint covers,
 *    recording a surface height per column, and reject triangles steeper than
 *    the slope limit.
 * 2. **Merge** near-coincident surfaces in a column, so a floor made of many
 *    triangles becomes one span rather than dozens.
 * 3. **Connect** spans in neighbouring columns whose height difference an agent
 *    can step over.
 * 4. **Erode** by the agent radius, removing spans too close to an edge — this
 *    is what stops agents clipping walls, and doing it on the grid is far
 *    cheaper than testing radius at query time.
 */
export function bakeNavMesh(input, settings = {}, areas = []) {
    const resolved = {
        ...DEFAULT_NAVMESH_SETTINGS,
        ...settings,
    };
    validateSettings(resolved);
    const started = Date.now();
    const triangleCount = input.indices.length / 3;
    if (!Number.isInteger(triangleCount))
        throw new Error("NavMesh input indices must be a multiple of three.");
    if (input.areas !== undefined && input.areas.length !== triangleCount) {
        throw new Error(`NavMesh input has ${triangleCount} triangles but ${input.areas.length} area ids.`);
    }
    if (triangleCount === 0) {
        return new NavMesh(resolved, [], new Map(), [0, 0, 0], areas, Date.now() - started);
    }
    let [minX, minZ] = [Infinity, Infinity];
    for (let index = 0; index < input.positions.length / 3; index += 1) {
        minX = Math.min(minX, input.positions[index * 3]);
        minZ = Math.min(minZ, input.positions[index * 3 + 2]);
    }
    const origin = [minX, 0, minZ];
    // Steps 1 and 2: rasterize, keeping a merged set of surface heights per column.
    const surfaces = rasterizeSurfaces(input, resolved, origin);
    // Build spans.
    const { spans, columns } = buildSpansFromSurfaces(surfaces);
    // Step 3: connect neighbours an agent can step between.
    linkSpans(spans, columns, resolved.agentMaxClimb);
    // Step 4: erode by the agent radius. A span whose column is within `radius`
    // of a column with no walkable surface is too close to an edge to stand on.
    const erodeCells = Math.ceil(resolved.agentRadius / resolved.cellSize);
    const kept = erodeCells > 0
        ? erode(spans, columns, erodeCells)
        : new Set(spans.map((span) => span.index));
    const finalSpans = [];
    const remap = new Map();
    for (const span of spans) {
        if (!kept.has(span.index))
            continue;
        remap.set(span.index, finalSpans.length);
        finalSpans.push({ ...span, index: finalSpans.length, links: [] });
    }
    for (const span of spans) {
        const mapped = remap.get(span.index);
        if (mapped === undefined)
            continue;
        for (const link of span.links) {
            const target = remap.get(link);
            if (target !== undefined)
                finalSpans[mapped].links.push(target);
        }
    }
    const finalColumns = new Map();
    for (const span of finalSpans) {
        const key = columnKey(span.x, span.z);
        const column = finalColumns.get(key) ?? { spans: [] };
        column.spans.push(span);
        finalColumns.set(key, column);
    }
    return new NavMesh(resolved, finalSpans, finalColumns, origin, areas, Date.now() - started);
}
/** Removes spans within `cells` of a column that has no walkable surface. */
function erode(spans, columns, cells) {
    // Multi-source BFS from the border inward is O(spans * cells) rather than the
    // O(spans * cells²) a per-span radius scan would cost.
    const distanceTo = new Map();
    const queue = [];
    for (const span of spans) {
        let border = false;
        for (const [dx, dz] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
        ]) {
            const neighbour = columns.get(columnKey(span.x + dx, span.z + dz));
            if (!neighbour ||
                !neighbour.spans.some((other) => Math.abs(other.y - span.y) <= 1)) {
                border = true;
                break;
            }
        }
        if (border) {
            distanceTo.set(span.index, 0);
            queue.push(span);
        }
    }
    const byIndex = new Map(spans.map((span) => [span.index, span]));
    for (let head = 0; head < queue.length; head += 1) {
        const span = queue[head];
        const current = distanceTo.get(span.index);
        if (current >= cells)
            continue;
        for (const link of span.links) {
            if (distanceTo.has(link))
                continue;
            distanceTo.set(link, current + 1);
            queue.push(byIndex.get(link));
        }
    }
    const kept = new Set();
    for (const span of spans) {
        const border = distanceTo.get(span.index);
        if (border === undefined || border >= cells)
            kept.add(span.index);
    }
    return kept;
}
/**
 * Straightens a grid corridor into the route an agent should walk.
 *
 * A raw corridor follows cell centres, so an agent walking it moves in visible
 * staircase steps. This removes any waypoint that can be skipped without
 * leaving the corridor, which is the cheap and robust half of what a funnel
 * algorithm does and needs no portal extraction.
 */
export function smoothPath(points, isClear) {
    if (points.length <= 2)
        return points.map((point) => [...point]);
    const out = [
        [...points[0]],
    ];
    let anchor = 0;
    while (anchor < points.length - 1) {
        let furthest = anchor + 1;
        for (let candidate = points.length - 1; candidate > anchor + 1; candidate -= 1) {
            if (isClear(points[anchor], points[candidate])) {
                furthest = candidate;
                break;
            }
        }
        out.push([...points[furthest]]);
        anchor = furthest;
    }
    return out;
}
/** Straight-line walkability test over a navmesh, for {@link smoothPath}. */
export function navMeshLineOfSight(navmesh, from, to) {
    const step = navmesh.settings.cellSize * 0.5;
    const length = distance(from, to);
    const steps = Math.max(1, Math.ceil(length / step));
    for (let index = 1; index < steps; index += 1) {
        const t = index / steps;
        const point = [
            (from[0] ?? 0) + ((to[0] ?? 0) - (from[0] ?? 0)) * t,
            (from[1] ?? 0) + ((to[1] ?? 0) - (from[1] ?? 0)) * t,
            (from[2] ?? 0) + ((to[2] ?? 0) - (from[2] ?? 0)) * t,
        ];
        const span = navmesh.nearestSpan(point, 2);
        if (span === undefined)
            return false;
        const found = navmesh.spanPosition(span);
        // Tolerate one cell horizontally and one step vertically.
        if (Math.hypot(found[0] - point[0], found[2] - point[2]) >
            navmesh.settings.cellSize)
            return false;
        if (Math.abs(found[1] - point[1]) > navmesh.settings.agentMaxClimb)
            return false;
    }
    return true;
}
function validateSettings(settings) {
    if (!(settings.cellSize > 0))
        throw new Error("A navmesh cell size must be positive.");
    if (!(settings.cellHeight > 0))
        throw new Error("A navmesh cell height must be positive.");
    if (!(settings.agentRadius >= 0))
        throw new Error("A navmesh agent radius must not be negative.");
    if (!(settings.agentHeight > 0))
        throw new Error("A navmesh agent height must be positive.");
    if (!(settings.agentMaxClimb > 0))
        throw new Error("A navmesh agent max climb must be positive.");
    if (!(settings.maxSlopeDegrees >= 0 && settings.maxSlopeDegrees < 90)) {
        throw new Error("A navmesh max slope must lie in [0, 90) degrees.");
    }
}
function corner(input, triangle, index) {
    const vertex = input.indices[triangle * 3 + index];
    return [
        input.positions[vertex * 3],
        input.positions[vertex * 3 + 1],
        input.positions[vertex * 3 + 2],
    ];
}
function subtract(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross(a, b) {
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ];
}
/** Height of the triangle's plane at `(x, z)`, or `undefined` when outside. */
function heightAt(a, b, c, x, z) {
    const denominator = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
    if (Math.abs(denominator) < 1e-12)
        return undefined;
    const u = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) /
        denominator;
    const v = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) /
        denominator;
    const w = 1 - u - v;
    // A small tolerance keeps cell centres exactly on a shared edge from falling
    // through the crack between two triangles.
    if (u < -1e-6 || v < -1e-6 || w < -1e-6)
        return undefined;
    return a[1] * u + b[1] * v + c[1] * w;
}
//# sourceMappingURL=navmesh.js.map