import {
  EditorCamera,
  boundsOfInstances,
  distanceToSegment,
  dragAlongAxis,
  inverseTransformDirection,
  multiplyQuaternions,
  pickAtPixel,
  projectToViewport,
  quaternionFromAxisAngle,
  quaternionFromMatrix,
  rotateVector,
  sweptAngle,
  viewProjectionMatrix,
  worldUnitsPerPixel,
  type RenderWorldSnapshot,
  type TransformData,
  type ViewportPoint,
} from "@vapour/engine";

export type TransformTool = "select" | "translate" | "rotate" | "scale";
export type TransformSpace = "local" | "world";

export interface ViewportSnapping {
  readonly enabled: boolean;
  /** World units per translate and scale increment. */
  readonly gridStep: number;
  /** Degrees per rotate increment. */
  readonly angleStep: number;
}

/* Snapping is incremental, not absolute: a drag advances in whole steps from
 * where the object already was, which is what Unity does. It keeps relative
 * spacing exact without yanking objects onto a global lattice. */

export interface ViewportHost {
  /** The render world currently on screen, or undefined before the first scene. */
  snapshot(): RenderWorldSnapshot | undefined;
  /** World matrix of any entity, including ones the renderer does not draw. */
  worldMatrix(entityId: string): readonly number[] | undefined;
  /** World matrix of an entity's parent, or undefined for a scene root. */
  parentWorldMatrix(entityId: string): readonly number[] | undefined;
  localTransform(entityId: string): TransformData | undefined;
  /** Applies a transform mid-gesture. `gestureKey` groups the whole drag into
   * one undo entry; the host is responsible for history. */
  applyTransform(entityId: string, transform: TransformData, gestureKey: string): void;
  endGesture(): void;
  selection(): readonly string[];
  select(entityId: string | undefined, additive: boolean): void;
  tool(): TransformTool;
  space(): TransformSpace;
  snapping(): ViewportSnapping;
  onCameraMoved(): void;
  reportError(message: string): void;
}

type Axis = 0 | 1 | 2;

interface GizmoFrame {
  readonly entityId: string;
  readonly origin: ViewportPoint;
  readonly tips: readonly ViewportPoint[];
  readonly axes: readonly [number, number, number][];
  readonly worldLength: number;
}

type DragMode =
  | { kind: "orbit" }
  | { kind: "pan" }
  | { kind: "gizmo"; axis: Axis; tool: Exclude<TransformTool, "select">; entityId: string; start: TransformData; accumulated: number };

const AXIS_COLORS = ["var(--axis-x)", "var(--axis-y)", "var(--axis-z)"] as const;
const AXIS_NAMES = ["X", "Y", "Z"] as const;
const HANDLE_PIXELS = 78;
const GRAB_PIXELS = 9;
const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Scene-view interaction: camera navigation, click-to-select, and the
 * translate/rotate/scale gizmos.
 *
 * The gizmo is drawn as an SVG overlay rather than as GPU geometry. Projecting
 * the handles with the same camera the renderer used keeps them pixel-accurate,
 * keeps editor-only geometry out of the render world the runtime consumes, and
 * makes hit-testing exact instead of a depth-buffer readback round trip.
 */
export class ViewportController {
  readonly #canvas: HTMLCanvasElement;
  readonly #overlay: SVGSVGElement;
  readonly #host: ViewportHost;
  readonly #camera = new EditorCamera();
  #drag: DragMode | undefined;
  #pointer: [number, number] = [0, 0];
  #activePointer: number | undefined;
  #hoveredAxis: Axis | undefined;

  constructor(canvas: HTMLCanvasElement, overlay: SVGSVGElement, host: ViewportHost) {
    this.#canvas = canvas;
    this.#overlay = overlay;
    this.#host = host;
    canvas.addEventListener("pointerdown", this.#onPointerDown);
    canvas.addEventListener("pointermove", this.#onPointerMove);
    canvas.addEventListener("pointerup", this.#onPointerUp);
    canvas.addEventListener("pointercancel", this.#onPointerUp);
    canvas.addEventListener("wheel", this.#onWheel, { passive: false });
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  get camera(): EditorCamera {
    return this.#camera;
  }

  /** Frames the selection, or the whole scene when nothing is selected. */
  frameSelection(): void {
    const snapshot = this.#host.snapshot();
    const selection = this.#host.selection();
    if (selection.length > 0) {
      const matrices = selection
        .map((entityId) => this.#host.worldMatrix(entityId))
        .filter((matrix): matrix is readonly number[] => matrix !== undefined)
        .map((matrix, index) => ({ entityId: selection[index]!, modelMatrix: matrix }));
      const bounds = boundsOfInstances(matrices);
      if (bounds !== undefined) {
        this.#camera.focus(bounds);
        this.#host.onCameraMoved();
        this.draw();
        return;
      }
    }
    const sceneBounds = snapshot === undefined ? undefined : boundsOfInstances(snapshot.instances);
    this.#camera.focus(sceneBounds ?? { center: [0, 0, 0], radius: 4 });
    this.#host.onCameraMoved();
    this.draw();
  }

  resetView(): void {
    this.#camera.focus({ center: [0, 0, 0], radius: 4 });
    this.#host.onCameraMoved();
    this.draw();
  }

  /** Redraws the gizmo overlay. Cheap enough to call on every frame. */
  draw(): void {
    const width = this.#canvas.clientWidth;
    const height = this.#canvas.clientHeight;
    this.#overlay.setAttribute("viewBox", `0 0 ${String(width)} ${String(height)}`);
    this.#overlay.replaceChildren();
    const gizmo = this.#gizmoFrame();
    if (gizmo === undefined) return;
    const tool = this.#host.tool();
    if (tool === "translate") this.#drawTranslate(gizmo);
    else if (tool === "rotate") this.#drawRotate(gizmo);
    else if (tool === "scale") this.#drawScale(gizmo);
    else this.#drawSelectionMarker(gizmo);
  }

  destroy(): void {
    this.#canvas.removeEventListener("pointerdown", this.#onPointerDown);
    this.#canvas.removeEventListener("pointermove", this.#onPointerMove);
    this.#canvas.removeEventListener("pointerup", this.#onPointerUp);
    this.#canvas.removeEventListener("pointercancel", this.#onPointerUp);
    this.#canvas.removeEventListener("wheel", this.#onWheel);
    this.#overlay.replaceChildren();
  }

  // -- interaction --------------------------------------------------------

  readonly #onPointerDown = (event: PointerEvent): void => {
    if (this.#activePointer !== undefined) return;
    this.#pointer = this.#localPoint(event);
    const navigating = event.button === 1 || event.altKey || event.button === 2;
    if (navigating) {
      this.#drag = event.button === 1 || event.shiftKey ? { kind: "pan" } : { kind: "orbit" };
    } else if (event.button === 0) {
      const grabbed = this.#grabGizmo(this.#pointer);
      if (grabbed !== undefined) this.#drag = grabbed;
      else {
        this.#selectAtPointer(this.#pointer, event.shiftKey || event.ctrlKey || event.metaKey);
        return;
      }
    } else {
      return;
    }
    this.#activePointer = event.pointerId;
    this.#canvas.setPointerCapture(event.pointerId);
    this.#canvas.classList.add("navigating");
    event.preventDefault();
  };

  readonly #onPointerMove = (event: PointerEvent): void => {
    const point = this.#localPoint(event);
    if (this.#drag === undefined) {
      const axis = this.#gizmoAxisAt(point);
      if (axis !== this.#hoveredAxis) {
        this.#hoveredAxis = axis;
        this.draw();
      }
      return;
    }
    const delta: [number, number] = [point[0] - this.#pointer[0], point[1] - this.#pointer[1]];
    this.#pointer = point;
    if (this.#drag.kind === "orbit") {
      this.#camera.orbit(delta[0], delta[1]);
      this.#host.onCameraMoved();
    } else if (this.#drag.kind === "pan") {
      this.#camera.pan(delta[0], delta[1], this.#canvas.clientHeight);
      this.#host.onCameraMoved();
    } else {
      this.#dragGizmo(this.#drag, delta, point);
    }
    this.draw();
  };

  readonly #onPointerUp = (event: PointerEvent): void => {
    if (this.#activePointer !== event.pointerId) return;
    if (this.#drag?.kind === "gizmo") this.#host.endGesture();
    this.#drag = undefined;
    this.#activePointer = undefined;
    if (this.#canvas.hasPointerCapture(event.pointerId)) this.#canvas.releasePointerCapture(event.pointerId);
    this.#canvas.classList.remove("navigating");
  };

  readonly #onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    // Normalize line and page deltas so trackpads and mice feel comparable.
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.#canvas.clientHeight : 1;
    this.#camera.dolly((event.deltaY * scale) / 240);
    this.#host.onCameraMoved();
    this.draw();
  };

  #selectAtPointer(point: [number, number], additive: boolean): void {
    const snapshot = this.#host.snapshot();
    const width = this.#canvas.clientWidth;
    const height = this.#canvas.clientHeight;
    if (snapshot?.camera === undefined || width <= 0 || height <= 0) return;
    try {
      const hit = pickAtPixel(snapshot, point[0], point[1], width, height);
      this.#host.select(hit?.entityId, additive);
    } catch (error) {
      this.#host.reportError(`Viewport selection failed: ${messageOf(error)}`);
    }
  }

  // -- gizmo --------------------------------------------------------------

  /** Screen-space frame of the active gizmo, or undefined when there is
   * nothing to manipulate or the pivot is behind the camera. */
  #gizmoFrame(): GizmoFrame | undefined {
    const snapshot = this.#host.snapshot();
    const selection = this.#host.selection();
    const entityId = selection.at(-1);
    const width = this.#canvas.clientWidth;
    const height = this.#canvas.clientHeight;
    if (entityId === undefined || snapshot?.camera === undefined || width <= 0 || height <= 0) return undefined;
    const world = this.#host.worldMatrix(entityId);
    if (world === undefined) return undefined;
    const pivot: [number, number, number] = [world[12]!, world[13]!, world[14]!];
    const viewProjection = viewProjectionMatrix(snapshot.camera, width / height);
    const origin = projectToViewport(viewProjection, pivot, width, height);
    if (!origin.visible) return undefined;

    const worldLength = worldUnitsPerPixel(snapshot.camera, pivot, height) * HANDLE_PIXELS;
    const axes = this.#axisDirections(entityId, world);
    const tips = axes.map((axis) =>
      projectToViewport(viewProjection, [pivot[0] + axis[0] * worldLength, pivot[1] + axis[1] * worldLength, pivot[2] + axis[2] * worldLength], width, height),
    );
    return { entityId, origin, tips, axes, worldLength };
  }

  /** Gizmo axis directions in world space. Scale is always local, matching the
   * convention every mainstream editor uses: stretching along a world axis is
   * not representable in a per-entity scale vector. */
  #axisDirections(entityId: string, world: readonly number[]): [number, number, number][] {
    const useLocal = this.#host.space() === "local" || this.#host.tool() === "scale";
    if (!useLocal) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    try {
      const rotation = quaternionFromMatrix(world);
      return [rotateVector(rotation, [1, 0, 0]), rotateVector(rotation, [0, 1, 0]), rotateVector(rotation, [0, 0, 1])];
    } catch {
      // A zero-scale transform has no usable local frame; fall back to world.
      void entityId;
      return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    }
  }

  #gizmoAxisAt(point: [number, number]): Axis | undefined {
    if (this.#host.tool() === "select") return undefined;
    const frame = this.#gizmoFrame();
    if (frame === undefined) return undefined;
    let best: { axis: Axis; distance: number } | undefined;
    for (const axis of [0, 1, 2] as Axis[]) {
      const tip = frame.tips[axis]!;
      if (!tip.visible) continue;
      const measured = this.#host.tool() === "rotate"
        ? Math.abs(Math.hypot(point[0] - frame.origin.x, point[1] - frame.origin.y) - Math.hypot(tip.x - frame.origin.x, tip.y - frame.origin.y))
        : distanceToSegment(point, [frame.origin.x, frame.origin.y], [tip.x, tip.y]).distance;
      if (measured <= GRAB_PIXELS && (best === undefined || measured < best.distance)) best = { axis, distance: measured };
    }
    return best?.axis;
  }

  #grabGizmo(point: [number, number]): DragMode | undefined {
    const tool = this.#host.tool();
    if (tool === "select") return undefined;
    const axis = this.#gizmoAxisAt(point);
    if (axis === undefined) return undefined;
    const entityId = this.#host.selection().at(-1);
    if (entityId === undefined) return undefined;
    const start = this.#host.localTransform(entityId);
    if (start === undefined) return undefined;
    return { kind: "gizmo", axis, tool, entityId, start: structuredClone(start), accumulated: 0 };
  }

  #dragGizmo(drag: Extract<DragMode, { kind: "gizmo" }>, delta: [number, number], point: [number, number]): void {
    const frame = this.#gizmoFrame();
    if (frame === undefined) return;
    const snapping = this.#host.snapping();
    try {
      if (drag.tool === "rotate") {
        const swept = sweptAngle([frame.origin.x, frame.origin.y], [point[0] - delta[0], point[1] - delta[1]], point);
        // Rotating the far side of the ring must turn the object the same way
        // it appears to move, so flip when the axis points away from the view.
        drag.accumulated += swept * (frame.tips[drag.axis]!.depth < frame.origin.depth ? 1 : -1);
        this.#applyRotation(drag, frame.axes[drag.axis]!, snapping);
      } else {
        const distance = dragAlongAxis(frame.origin, frame.tips[drag.axis]!, frame.worldLength, delta);
        drag.accumulated += distance;
        if (drag.tool === "translate") this.#applyTranslation(drag, frame.axes[drag.axis]!, snapping);
        else this.#applyScale(drag, snapping);
      }
    } catch (error) {
      this.#host.reportError(`Transform edit failed: ${messageOf(error)}`);
      this.#drag = undefined;
    }
  }

  #applyTranslation(drag: Extract<DragMode, { kind: "gizmo" }>, worldAxis: [number, number, number], snapping: ViewportSnapping): void {
    const amount = snapping.enabled ? Math.round(drag.accumulated / snapping.gridStep) * snapping.gridStep : drag.accumulated;
    const worldDelta: [number, number, number] = [worldAxis[0] * amount, worldAxis[1] * amount, worldAxis[2] * amount];
    const parent = this.#host.parentWorldMatrix(drag.entityId);
    const localDelta = parent === undefined ? worldDelta : inverseTransformDirection(parent, worldDelta);
    const position = drag.start.position.map((value, axis) => round(value + localDelta[axis]!)) as [number, number, number];
    this.#host.applyTransform(drag.entityId, { ...structuredClone(drag.start), position }, `translate:${drag.entityId}`);
  }

  #applyRotation(drag: Extract<DragMode, { kind: "gizmo" }>, worldAxis: [number, number, number], snapping: ViewportSnapping): void {
    const degrees = (drag.accumulated * 180) / Math.PI;
    const stepped = snapping.enabled ? Math.round(degrees / snapping.angleStep) * snapping.angleStep : degrees;
    if (stepped === 0 && snapping.enabled) return;
    const parent = this.#host.parentWorldMatrix(drag.entityId);
    // Transforms are stored in parent space, so bring the world axis there.
    const parentAxis = parent === undefined ? worldAxis : normalize(inverseTransformDirection(parent, worldAxis));
    const delta = quaternionFromAxisAngle(parentAxis, (stepped * Math.PI) / 180);
    const rotation = multiplyQuaternions(delta, drag.start.rotation);
    this.#host.applyTransform(
      drag.entityId,
      { ...structuredClone(drag.start), rotation: rotation.map(round) as [number, number, number, number] },
      `rotate:${drag.entityId}`,
    );
  }

  #applyScale(drag: Extract<DragMode, { kind: "gizmo" }>, snapping: ViewportSnapping): void {
    const stepped = snapping.enabled ? Math.round(drag.accumulated / snapping.gridStep) * snapping.gridStep : drag.accumulated;
    const scale = [...drag.start.scale] as [number, number, number];
    // Scale never crosses zero: a mirrored transform cannot be inverted, which
    // would break gizmo axes and physics alike.
    scale[drag.axis] = round(Math.max(0.001, drag.start.scale[drag.axis]! + stepped));
    this.#host.applyTransform(drag.entityId, { ...structuredClone(drag.start), scale }, `scale:${drag.entityId}`);
  }

  // -- overlay drawing ----------------------------------------------------

  #drawTranslate(frame: GizmoFrame): void {
    for (const axis of [0, 1, 2] as Axis[]) {
      const tip = frame.tips[axis]!;
      if (!tip.visible) continue;
      const active = this.#isAxisActive(axis);
      this.#line(frame.origin, tip, AXIS_COLORS[axis], active ? 3 : 2);
      this.#arrowHead(frame.origin, tip, AXIS_COLORS[axis], active);
      this.#axisLabel(tip, AXIS_NAMES[axis], AXIS_COLORS[axis]);
    }
    this.#pivotDot(frame.origin);
  }

  #drawScale(frame: GizmoFrame): void {
    for (const axis of [0, 1, 2] as Axis[]) {
      const tip = frame.tips[axis]!;
      if (!tip.visible) continue;
      const active = this.#isAxisActive(axis);
      this.#line(frame.origin, tip, AXIS_COLORS[axis], active ? 3 : 2);
      const box = document.createElementNS(SVG_NS, "rect");
      const size = active ? 11 : 9;
      box.setAttribute("x", String(tip.x - size / 2));
      box.setAttribute("y", String(tip.y - size / 2));
      box.setAttribute("width", String(size));
      box.setAttribute("height", String(size));
      box.setAttribute("fill", AXIS_COLORS[axis]);
      this.#overlay.append(box);
      this.#axisLabel(tip, AXIS_NAMES[axis], AXIS_COLORS[axis]);
    }
    this.#pivotDot(frame.origin);
  }

  #drawRotate(frame: GizmoFrame): void {
    for (const axis of [0, 1, 2] as Axis[]) {
      const tip = frame.tips[axis]!;
      if (!tip.visible) continue;
      const radius = Math.hypot(tip.x - frame.origin.x, tip.y - frame.origin.y);
      if (radius < 4) continue;
      const ring = document.createElementNS(SVG_NS, "circle");
      ring.setAttribute("cx", String(frame.origin.x));
      ring.setAttribute("cy", String(frame.origin.y));
      ring.setAttribute("r", String(radius));
      ring.setAttribute("fill", "none");
      ring.setAttribute("stroke", AXIS_COLORS[axis]);
      ring.setAttribute("stroke-width", String(this.#isAxisActive(axis) ? 3 : 1.5));
      ring.setAttribute("opacity", this.#isAxisActive(axis) ? "1" : "0.75");
      this.#overlay.append(ring);
    }
    this.#pivotDot(frame.origin);
  }

  #drawSelectionMarker(frame: GizmoFrame): void {
    const marker = document.createElementNS(SVG_NS, "rect");
    marker.setAttribute("x", String(frame.origin.x - 7));
    marker.setAttribute("y", String(frame.origin.y - 7));
    marker.setAttribute("width", "14");
    marker.setAttribute("height", "14");
    marker.setAttribute("fill", "none");
    marker.setAttribute("stroke", "var(--accent)");
    marker.setAttribute("stroke-width", "1.5");
    this.#overlay.append(marker);
  }

  #isAxisActive(axis: Axis): boolean {
    return (this.#drag?.kind === "gizmo" && this.#drag.axis === axis) || (this.#drag === undefined && this.#hoveredAxis === axis);
  }

  #line(from: ViewportPoint, to: ViewportPoint, color: string, width: number): void {
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", String(from.x));
    line.setAttribute("y1", String(from.y));
    line.setAttribute("x2", String(to.x));
    line.setAttribute("y2", String(to.y));
    line.setAttribute("stroke", color);
    line.setAttribute("stroke-width", String(width));
    line.setAttribute("stroke-linecap", "round");
    this.#overlay.append(line);
  }

  #arrowHead(from: ViewportPoint, to: ViewportPoint, color: string, active: boolean): void {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const size = active ? 11 : 9;
    const points = [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3]
      .map((offset) => `${String(to.x + Math.cos(angle + offset) * size)},${String(to.y + Math.sin(angle + offset) * size)}`)
      .join(" ");
    const head = document.createElementNS(SVG_NS, "polygon");
    head.setAttribute("points", points);
    head.setAttribute("fill", color);
    this.#overlay.append(head);
  }

  #axisLabel(at: ViewportPoint, text: string, color: string): void {
    const label = document.createElementNS(SVG_NS, "text");
    label.setAttribute("x", String(at.x + 12));
    label.setAttribute("y", String(at.y - 8));
    label.setAttribute("fill", color);
    label.setAttribute("font-size", "10");
    label.setAttribute("font-family", "ui-monospace, monospace");
    label.textContent = text;
    this.#overlay.append(label);
  }

  #pivotDot(at: ViewportPoint): void {
    const dot = document.createElementNS(SVG_NS, "circle");
    dot.setAttribute("cx", String(at.x));
    dot.setAttribute("cy", String(at.y));
    dot.setAttribute("r", "3.5");
    dot.setAttribute("fill", "var(--ink)");
    this.#overlay.append(dot);
  }

  #localPoint(event: PointerEvent): [number, number] {
    const rect = this.#canvas.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  }
}

function normalize(value: readonly number[]): [number, number, number] {
  const length = Math.hypot(value[0]!, value[1]!, value[2]!);
  if (length < 1e-9) throw new Error("A transform axis collapsed to zero length.");
  return [value[0]! / length, value[1]! / length, value[2]! / length];
}

/** Keeps serialized scenes free of float noise like 1.0000000000000002. */
function round(value: number): number {
  return Math.round(value * 1e5) / 1e5 + 0;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
