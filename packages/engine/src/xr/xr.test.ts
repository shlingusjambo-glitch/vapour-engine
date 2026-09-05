import { describe, expect, it, vi } from "vitest";
import { XrSessionManager } from "./xr.js";

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function harness() {
  let callback: ((time: number, frame: any) => void) | undefined; const endListeners = new Set<() => void>();
  const pulse = vi.fn(async () => true);
  const session = {
    inputSources: [{ handedness: "right", targetRayMode: "tracked-pointer", profiles: ["oculus-touch-v3"], targetRaySpace: {}, gripSpace: {}, gamepad: { buttons: [{ value: 1, pressed: true, touched: true }], axes: [0.25, -0.5], hapticActuators: [{ pulse }] }, hand: new Map([["index-finger-tip", {}]]) }], visibilityState: "visible",
    requestReferenceSpace: vi.fn(async (_type?: string) => ({})), requestAnimationFrame: vi.fn((next: typeof callback) => { callback = next; return 7; }), cancelAnimationFrame: vi.fn(), end: vi.fn(async () => { for (const listener of endListeners) listener(); }),
    addEventListener: (_: string, listener: () => void) => endListeners.add(listener), removeEventListener: (_: string, listener: () => void) => endListeners.delete(listener),
  };
  const xr = { isSessionSupported: vi.fn(async () => true), requestSession: vi.fn(async () => session) };
  const frame = { getViewerPose: () => ({ transform: { matrix: identity }, views: [{ eye: "left", transform: { matrix: identity }, projectionMatrix: identity }, { eye: "right", transform: { matrix: identity }, projectionMatrix: identity }] }), getPose: () => ({ transform: { matrix: identity } }), getJointPose: () => ({ transform: { matrix: identity }, radius: 0.01 }) };
  return { manager: new XrSessionManager({ xr } as any), session, xr, frame, pulse, fire: () => callback?.(100, frame) };
}

describe("XrSessionManager", () => {
  it("owns session/reference-space lifecycle and produces stereo input snapshots", async () => {
    const { manager, session, xr, pulse, fire } = harness(); expect(await manager.supported("immersive-vr")).toBe(true);
    await manager.start({ optionalFeatures: ["hand-tracking"] }); expect(manager.active).toBe(true); expect(xr.requestSession).toHaveBeenCalled(); expect(session.requestReferenceSpace).toHaveBeenCalledWith("local-floor");
    const snapshots = vi.fn(); manager.startFrameLoop(snapshots); fire();
    const snapshot = snapshots.mock.calls[0]![0]; expect(snapshot.views.map((view: any) => view.eye)).toEqual(["left", "right"]); expect(snapshot.inputs[0]).toMatchObject({ handedness: "right", profiles: ["oculus-touch-v3"], buttons: [{ value: 1, pressed: true, touched: true }], joints: [{ name: "index-finger-tip", radius: 0.01 }] });
    expect(await manager.pulse("right", 0.7, 40)).toBe(true); expect(pulse).toHaveBeenCalledWith(0.7, 40);
    await manager.end(); expect(manager.active).toBe(false);
  });
  it("reports unavailable XR and prevents duplicate loops", async () => {
    const missing = new XrSessionManager({}); await expect(missing.start()).rejects.toThrow("WebXR is unavailable");
    const { manager } = harness(); await manager.start(); manager.startFrameLoop(() => undefined); expect(() => manager.startFrameLoop(() => undefined)).toThrow("already running");
  });
  it("falls back from local-floor to local and reports the selected space", async () => {
    const { manager, session } = harness(); session.requestReferenceSpace.mockImplementation(async (type?: string) => { if (type === "local-floor") throw new Error("unsupported"); return {}; });
    await manager.start(); expect(session.requestReferenceSpace).toHaveBeenNthCalledWith(1, "local-floor"); expect(session.requestReferenceSpace).toHaveBeenNthCalledWith(2, "local"); expect(manager.referenceSpaceType).toBe("local");
  });
});
