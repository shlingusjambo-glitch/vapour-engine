/** Amanatides–Woo grid traversal. Runtime cost is proportional to crossed
 * cells, not the number of blocks in the world. */
export function raycastVoxels(world, palette, origin, direction, maxDistance) {
    if (!(maxDistance >= 0) || !Number.isFinite(maxDistance))
        throw new Error("Ray distance must be finite and non-negative.");
    const length = Math.hypot(direction[0], direction[1], direction[2]);
    if (!(length > 0) || !Number.isFinite(length))
        throw new Error("Ray direction must be finite and non-zero.");
    const dx = direction[0] / length;
    const dy = direction[1] / length;
    const dz = direction[2] / length;
    let x = Math.floor(origin[0]);
    let y = Math.floor(origin[1]);
    let z = Math.floor(origin[2]);
    let blockId = world.getBlock(x, y, z);
    if (palette.isSolid(blockId))
        return { x, y, z, blockId, distance: 0, normal: [0, 0, 0] };
    const stepX = Math.sign(dx);
    const stepY = Math.sign(dy);
    const stepZ = Math.sign(dz);
    const deltaX = dx === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dx);
    const deltaY = dy === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dy);
    const deltaZ = dz === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dz);
    let maxX = boundaryDistance(origin[0], x, stepX, dx);
    let maxY = boundaryDistance(origin[1], y, stepY, dy);
    let maxZ = boundaryDistance(origin[2], z, stepZ, dz);
    while (true) {
        let distance;
        let normal;
        if (maxX <= maxY && maxX <= maxZ) {
            x += stepX;
            distance = maxX;
            maxX += deltaX;
            normal = [-stepX, 0, 0];
        }
        else if (maxY <= maxZ) {
            y += stepY;
            distance = maxY;
            maxY += deltaY;
            normal = [0, -stepY, 0];
        }
        else {
            z += stepZ;
            distance = maxZ;
            maxZ += deltaZ;
            normal = [0, 0, -stepZ];
        }
        if (distance > maxDistance)
            return undefined;
        blockId = world.getBlock(x, y, z);
        if (palette.isSolid(blockId))
            return { x, y, z, blockId, distance, normal };
    }
}
const EPSILON = 1e-5;
/** Sweeps a body independently on X, Y, then Z. Each axis visits voxel planes
 * crossed by the leading face, so fast movement cannot tunnel through a wall.
 * The mutable body is updated in place and does not allocate in steady state. */
export function moveVoxelBody(world, palette, body, deltaSeconds) {
    if (!(deltaSeconds >= 0) || !Number.isFinite(deltaSeconds))
        throw new Error("Movement delta must be finite and non-negative.");
    validateBody(body);
    body.grounded = false;
    const verticalWasFalling = body.velocity[1] < 0;
    const collidedX = moveAxis(world, palette, body, 0, body.velocity[0] * deltaSeconds);
    const collidedY = moveAxis(world, palette, body, 1, body.velocity[1] * deltaSeconds);
    const collidedZ = moveAxis(world, palette, body, 2, body.velocity[2] * deltaSeconds);
    if (collidedY && verticalWasFalling)
        body.grounded = true;
    return { collidedX, collidedY, collidedZ, grounded: body.grounded };
}
function moveAxis(world, palette, body, axis, delta) {
    if (delta === 0)
        return false;
    const positive = delta > 0;
    const edge = positive ? bodyMax(body, axis) : bodyMin(body, axis);
    const end = edge + delta;
    let plane = positive ? Math.floor(edge - EPSILON) + 1 : Math.floor(edge + EPSILON) - 1;
    const last = positive ? Math.floor(end - EPSILON) : Math.floor(end + EPSILON);
    const step = positive ? 1 : -1;
    for (; positive ? plane <= last : plane >= last; plane += step) {
        if (!planeHasCollision(world, palette, body, axis, plane))
            continue;
        const boundary = positive ? plane : plane + 1;
        const allowed = boundary - edge + (positive ? -EPSILON : EPSILON);
        body.position[axis] += positive ? Math.max(0, allowed) : Math.min(0, allowed);
        body.velocity[axis] = 0;
        return true;
    }
    body.position[axis] += delta;
    return false;
}
function planeHasCollision(world, palette, body, axis, plane) {
    const minX = Math.floor(bodyMin(body, 0) + EPSILON);
    const maxX = Math.floor(bodyMax(body, 0) - EPSILON);
    const minY = Math.floor(bodyMin(body, 1) + EPSILON);
    const maxY = Math.floor(bodyMax(body, 1) - EPSILON);
    const minZ = Math.floor(bodyMin(body, 2) + EPSILON);
    const maxZ = Math.floor(bodyMax(body, 2) - EPSILON);
    if (axis === 0) {
        for (let y = minY; y <= maxY; y += 1)
            for (let z = minZ; z <= maxZ; z += 1)
                if (palette.isSolid(world.getBlock(plane, y, z)))
                    return true;
    }
    else if (axis === 1) {
        for (let x = minX; x <= maxX; x += 1)
            for (let z = minZ; z <= maxZ; z += 1)
                if (palette.isSolid(world.getBlock(x, plane, z)))
                    return true;
    }
    else {
        for (let x = minX; x <= maxX; x += 1)
            for (let y = minY; y <= maxY; y += 1)
                if (palette.isSolid(world.getBlock(x, y, plane)))
                    return true;
    }
    return false;
}
function bodyMin(body, axis) {
    if (axis === 0)
        return body.position[0] - body.width / 2;
    if (axis === 1)
        return body.position[1];
    return body.position[2] - body.depth / 2;
}
function bodyMax(body, axis) {
    if (axis === 0)
        return body.position[0] + body.width / 2;
    if (axis === 1)
        return body.position[1] + body.height;
    return body.position[2] + body.depth / 2;
}
function boundaryDistance(origin, cell, step, direction) {
    if (step === 0)
        return Number.POSITIVE_INFINITY;
    const boundary = step > 0 ? cell + 1 : cell;
    return (boundary - origin) / direction;
}
function validateBody(body) {
    if (![...body.position, ...body.velocity, body.width, body.height, body.depth].every(Number.isFinite)) {
        throw new Error("Voxel body values must be finite.");
    }
    if (!(body.width > 0) || !(body.height > 0) || !(body.depth > 0)) {
        throw new Error("Voxel body dimensions must be positive.");
    }
}
//# sourceMappingURL=voxel-physics.js.map