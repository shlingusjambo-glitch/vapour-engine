import { describe, expect, it } from "vitest";
import { quatFromEuler } from "@vapour/math";
import { XrRig, syntheticXrFrame } from "./xr-rig.js";

/** Mirage M104: reference spaces, player height, floor calibration, seated/standing, per-eye cameras. */
describe("XrRig", () => {
  it("produces two eye cameras separated by the IPD and a head between them", () => {
    const rig = new XrRig({ referenceSpace: "local-floor" });
    const frame = syntheticXrFrame({ headPosition: [0, 1.7, 0], ipd: 0.064 });
    const resolved = rig.resolve(frame);
    expect(resolved.eyes.map((eye) => eye.eye)).toEqual(["left", "right"]);
    expect(resolved.interpupillaryDistance).toBeCloseTo(0.064);
    expect(resolved.eyes[0]!.position[0]).toBeCloseTo(-0.032);
    expect(resolved.eyes[1]!.position[0]).toBeCloseTo(0.032);
    expect(resolved.headPosition[1]).toBeCloseTo(1.7);
    // The view matrix is the inverse of the eye's world transform.
    const eye = resolved.eyes[0]!;
    expect(eye.view[12]).toBeCloseTo(0.032);
    expect(eye.view[13]).toBeCloseTo(-1.7);
  });

  it("moves cameras with the rig while leaving tracked motion untouched", () => {
    const rig = new XrRig({ referenceSpace: "local-floor" });
    rig.setPose([10, 0, -5], quatFromEuler([0, 90, 0]));
    const frame = syntheticXrFrame({ headPosition: [0, 1.6, -1] });
    const resolved = rig.resolve(frame);
    // Local -Z (1 m forward) rotated +90° about Y becomes world -X.
    expect(resolved.headPosition[0]).toBeCloseTo(9);
    expect(resolved.headPosition[1]).toBeCloseTo(1.6);
    expect(resolved.headPosition[2]).toBeCloseTo(-5);
  });

  it("measures height in a floor-aware space and configures it elsewhere", () => {
    const floor = new XrRig({ referenceSpace: "local-floor" });
    expect(floor.height()).toEqual({ metres: 1.6, source: "configured" });
    floor.calibrateFloor(syntheticXrFrame({ headPosition: [0, 1.82, 0] }));
    expect(floor.height().source).toBe("measured");
    expect(floor.height().metres).toBeCloseTo(1.82);

    const local = new XrRig({ referenceSpace: "local", configuredHeight: 1.75 });
    expect(local.floorAware).toBe(false);
    // A `local` space starts at eye level: the head reads y ≈ 0.
    const report = local.calibrateFloor(syntheticXrFrame({ headPosition: [0, 0.05, 0] }));
    expect(report).toEqual({ metres: 1.75, source: "configured" });
    // After calibration the head sits 1.75 m above the world floor.
    expect(local.resolve(syntheticXrFrame({ headPosition: [0, 0.05, 0] })).headPosition[1]).toBeCloseTo(1.75);
    local.resetCalibration();
    expect(local.resolve(syntheticXrFrame({ headPosition: [0, 0.05, 0] })).headPosition[1]).toBeCloseTo(0.05);
  });

  it("lifts a seated player to standing eye height and leaves a standing one alone", () => {
    const frame = syntheticXrFrame({ headPosition: [0, 1.2, 0] });
    const standing = new XrRig({ referenceSpace: "local-floor", mode: "standing" });
    const seated = new XrRig({ referenceSpace: "local-floor", mode: "seated", seatedEyeHeight: 1.65 });
    expect(standing.resolve(frame).headPosition[1]).toBeCloseTo(1.2);
    expect(seated.resolve(frame).headPosition[1]).toBeCloseTo(1.65);
    // Leaning forward while seated still moves the head: only the offset is fixed.
    const leaned = syntheticXrFrame({ headPosition: [0, 1.25, -0.2] });
    expect(seated.resolve(leaned).headPosition[1]).toBeCloseTo(1.65 + 0.05);
    expect(seated.resolve(leaned).headPosition[2]).toBeCloseTo(-0.2);
    seated.setMode("standing");
    expect(seated.resolve(frame).headPosition[1]).toBeCloseTo(1.2);
  });

  it("validates its numbers", () => {
    expect(() => new XrRig({ referenceSpace: "local", configuredHeight: 0 })).toThrow(/positive/);
    expect(() => new XrRig({ referenceSpace: "local", floorOffset: Number.NaN })).toThrow(/finite/);
  });
});
