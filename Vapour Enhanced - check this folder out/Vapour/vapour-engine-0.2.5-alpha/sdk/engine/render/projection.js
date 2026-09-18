/**
 * World→clip matrix matching the Rust renderer's camera convention exactly:
 * right-handed, looking down the camera's -Z, with WebGPU's 0..1 depth range.
 * Editor overlays project through this so gizmo handles land on the pixels the
 * renderer actually drew.
 */
export function viewProjectionMatrix(camera, aspectRatio) {
    if (!Number.isFinite(aspectRatio) || aspectRatio <= 0)
        throw new Error("Viewport aspect ratio must be positive.");
    const projection = camera.projection === "orthographic"
        ? orthographic(camera.orthographicSize ?? 10, aspectRatio, camera.near, camera.far)
        : perspective(camera.fieldOfView, aspectRatio, camera.near, camera.far);
    return multiply(projection, viewMatrix(camera));
}
/** Inverse of the camera's world matrix, exploiting its orthonormal basis. */
export function viewMatrix(camera) {
    const m = camera.worldMatrix;
    const right = [m[0], m[1], m[2]];
    const up = [m[4], m[5], m[6]];
    const back = [m[8], m[9], m[10]];
    const eye = [m[12], m[13], m[14]];
    return [
        right[0],
        up[0],
        back[0],
        0,
        right[1],
        up[1],
        back[1],
        0,
        right[2],
        up[2],
        back[2],
        0,
        -dot(right, eye),
        -dot(up, eye),
        -dot(back, eye),
        1,
    ];
}
export function perspective(fieldOfViewDegrees, aspectRatio, near, far) {
    const focal = 1 / Math.tan((fieldOfViewDegrees * Math.PI) / 180 / 2);
    const range = 1 / (near - far);
    return [
        focal / aspectRatio,
        0,
        0,
        0,
        0,
        focal,
        0,
        0,
        0,
        0,
        far * range,
        -1,
        0,
        0,
        near * far * range,
        0,
    ];
}
export function orthographic(verticalSize, aspectRatio, near, far) {
    if (!Number.isFinite(verticalSize) || verticalSize <= 0)
        throw new Error("Orthographic vertical size must be positive.");
    const halfHeight = verticalSize / 2;
    const halfWidth = halfHeight * aspectRatio;
    return [
        1 / halfWidth,
        0,
        0,
        0,
        0,
        1 / halfHeight,
        0,
        0,
        0,
        0,
        1 / (near - far),
        0,
        0,
        0,
        near / (near - far),
        1,
    ];
}
/** Projects a world point to viewport pixels, origin at the top-left. */
export function projectToViewport(viewProjection, point, widthPixels, heightPixels) {
    const clip = [0, 1, 2, 3].map((row) => viewProjection[row] * point[0] +
        viewProjection[4 + row] * point[1] +
        viewProjection[8 + row] * point[2] +
        viewProjection[12 + row]);
    const w = clip[3];
    if (!Number.isFinite(w) || Math.abs(w) < 1e-9) {
        return { x: Number.NaN, y: Number.NaN, depth: Number.NaN, visible: false };
    }
    return {
        x: ((clip[0] / w) * 0.5 + 0.5) * widthPixels,
        y: (0.5 - (clip[1] / w) * 0.5) * heightPixels,
        depth: clip[2] / w,
        visible: w > 0,
    };
}
/** World-units-per-pixel at a given world position, used to keep gizmo handles
 * a constant on-screen size regardless of distance. */
export function worldUnitsPerPixel(camera, point, heightPixels) {
    const m = camera.worldMatrix;
    const eye = [m[12], m[13], m[14]];
    const back = [m[8], m[9], m[10]];
    // Distance along the view axis, so handles do not swell near the frustum edge.
    const depth = Math.abs(dot(back, [point[0] - eye[0], point[1] - eye[1], point[2] - eye[2]]));
    const height = Math.max(1, heightPixels);
    return ((2 *
        Math.max(depth, camera.near) *
        Math.tan((camera.fieldOfView * Math.PI) / 180 / 2)) /
        height);
}
/**
 * Distance in pixels from a point to a line segment, and how far along the
 * segment the closest approach lies. Gizmo axis hit-testing runs entirely in
 * screen space so handles stay grabbable at any camera angle.
 */
export function distanceToSegment(point, start, end) {
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared < 1e-9
        ? 0
        : clamp(((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) /
            lengthSquared, 0, 1);
    return {
        distance: Math.hypot(point[0] - (start[0] + dx * t), point[1] - (start[1] + dy * t)),
        t,
    };
}
/**
 * How far to move along a world axis so the dragged handle tracks the cursor.
 *
 * The axis is projected to screen space and the pointer delta is projected onto
 * it, which is the standard screen-space translate/scale drag: it stays stable
 * when the axis is nearly edge-on, where a plane-intersection solve blows up.
 */
export function dragAlongAxis(origin, axisTip, axisWorldLength, pointerDelta) {
    if (!origin.visible || !axisTip.visible)
        return 0;
    const ax = axisTip.x - origin.x;
    const ay = axisTip.y - origin.y;
    const lengthSquared = ax * ax + ay * ay;
    if (lengthSquared < 1e-6)
        return 0;
    return (((pointerDelta[0] * ax + pointerDelta[1] * ay) / lengthSquared) *
        axisWorldLength);
}
/** Signed angle in radians swept around a screen-space pivot between two
 * pointer positions, used by the rotation gizmo. */
export function sweptAngle(pivot, from, to) {
    const startAngle = Math.atan2(from[1] - pivot[1], from[0] - pivot[0]);
    const endAngle = Math.atan2(to[1] - pivot[1], to[0] - pivot[0]);
    let delta = endAngle - startAngle;
    while (delta > Math.PI)
        delta -= Math.PI * 2;
    while (delta < -Math.PI)
        delta += Math.PI * 2;
    return delta;
}
export function multiply(left, right) {
    const output = new Array(16).fill(0);
    for (let column = 0; column < 4; column += 1) {
        for (let row = 0; row < 4; row += 1) {
            output[column * 4 + row] =
                left[row] * right[column * 4] +
                    left[4 + row] * right[column * 4 + 1] +
                    left[8 + row] * right[column * 4 + 2] +
                    left[12 + row] * right[column * 4 + 3];
        }
    }
    return output;
}
function dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}
//# sourceMappingURL=projection.js.map