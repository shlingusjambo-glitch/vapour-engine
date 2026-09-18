import { describe, expect, it } from "vitest";
import * as engine from "../index.js";
import { runVapourScript } from "./vs-bindings.js";

/**
 * Mirage M130: every new subsystem is drivable from Vapour Script.
 *
 * Each case is real VS source, compiled by the real compiler, executed against
 * the real engine barrel, asserting on what the engine did. No mocks: if a
 * subsystem's exports cannot be reached from VS syntax, the case fails.
 */
const run = (source: string): Record<string, unknown> => runVapourScript(source, engine as unknown as Record<string, unknown>, "bindings.vs").exports;

describe("Vapour Script drives every Mirage subsystem", () => {
  it("ui: layout, widgets, world-space canvas", () => {
    const out = run(`from "@vapour/engine" import UiDocument, WorldUiCanvas

export func build():
    var a = { id: "a", role: "button", style: { flexGrow: 1 } }
    var q = { id: "q", role: "dropdown", style: { width: 50 }, options: ["low", "high"], value: "low" }
    var ui = new UiDocument({ id: "root", role: "panel", style: { direction: "row", gap: 10 }, children: [a, q] })
    ui.layout(200, 40)
    ui.adjust("q", 1)
    var canvas = new WorldUiCanvas(ui, { position: [0, 0, -2], pixelsPerUnit: 100 })
    var hit = canvas.hitTest({ origin: [-0.5, 0, 0], direction: [0, 0, -1] })
    return { a: ui.rect("a"), q: ui.value("q"), hit: hit.nodeId }
`);
    expect((out["build"] as () => { a: { width: number }; q: string; hit: string })()).toEqual({ a: { x: 0, y: 0, width: 140, height: 40 }, q: "high", hit: "a" });
  });

  it("text: font fallback, rich text effects, cached batched layout", () => {
    const out = run(`from "@vapour/engine" import resolveFallback, parseRichText, CachedTextLayout, batchText

export func text(font):
    var chain = { name: "ui", fonts: [font] }
    var fallback = resolveFallback(chain, "A€")
    var runs = parseRichText("[outline=ink]x[/outline]", { outlines: { ink: { width: 1, color: [0, 0, 0, 1] } } })
    var cache = new CachedTextLayout()
    var layout = cache.layout(font, "AA", { fontSize: 10 })
    var batches = batchText([{ layout: layout, position: [0, 0] }, { layout: layout, position: [50, 0] }])
    return { missing: fallback.missing, outline: runs[0].style.outline.width, glyphs: batches[0].glyphCount }
`);
    const font = { id: "f", material: "m", textureSize: [16, 16], designSize: 10, lineHeight: 12, glyphs: [{ character: "A", rect: [0, 0, 8, 10], advance: 8, bearing: [0, 8] }] };
    expect((out["text"] as (f: unknown) => unknown)(font)).toEqual({ missing: ["€"], outline: 1, glyphs: 4 });
  });

  it("xr: rig cameras, hand poses, haptics, capabilities", () => {
    const out = run(`from "@vapour/engine" import XrRig, syntheticXrFrame, HandPoseRecognizer, XrHaptics, diagnoseXrCapabilities

export async func xr():
    var rig = new XrRig({ referenceSpace: "local-floor", mode: "seated", seatedEyeHeight: 1.7 })
    var frame = rig.resolve(syntheticXrFrame({ headPosition: [0, 1.2, 0], ipd: 0.064 }))
    var played = []
    var haptics = new XrHaptics(async (hand, intensity, ms) => played.push([hand, intensity, ms]) > 0)
    haptics.pulse("left", 0.4, 10)
    haptics.pulse("left", 0.9, 30)
    await haptics.flush()
    var issues = diagnoseXrCapabilities({ webxr: False, modes: { inline: False, "immersive-vr": False, "immersive-ar": False }, webgpuBinding: False, webglLayer: False })
    return { headY: frame.headPosition[1], ipd: frame.interpupillaryDistance, played: played, pose: new HandPoseRecognizer().pose("left"), issue: issues[0].code }
`);
    return (out["xr"] as () => Promise<Record<string, unknown>>)().then((result) => {
      expect(result["headY"]).toBeCloseTo(1.7);
      expect(result["ipd"]).toBeCloseTo(0.064);
      expect(result["played"]).toEqual([["left", 0.9, 30]]);
      expect(result["pose"]).toBeUndefined();
      expect(result["issue"]).toBe("xr.unavailable");
    });
  });

  it("input: XR bindings resolve through action maps", () => {
    const out = run(`from "@vapour/engine" import InputActions

export func fire(controller):
    var actions = new InputActions([{ name: "xr", actions: [{ name: "Fire", kind: "button", bindings: [{ device: "xr", hand: "right", control: "button", index: 0 }] }] }])
    actions.update([], [controller])
    return { pressed: actions.pressed("Fire"), device: actions.lastDevice }
`);
    const controller = { handedness: "right", buttons: [{ value: 1, pressed: true, touched: true }], axes: [] };
    expect((out["fire"] as (c: unknown) => unknown)(controller)).toEqual({ pressed: true, device: "xr" });
  });

  it("physics: ragdoll blend ramp and worker interpolation", () => {
    const out = run(`from "@vapour/engine" import rampWeight, interpolateBody3d

export func blend():
    var weights = []
    for t in [0, 0.5, 1]:
        weights.push(rampWeight(t, 1))
    var a = { id: 1, position: [0, 0, 0], rotation: [0, 0, 0, 1], linearVelocity: [0, 0, 0], angularVelocity: [0, 0, 0], sleeping: False }
    var b = { id: 1, position: [2, 4, 6], rotation: [0, 0, 0, 1], linearVelocity: [0, 0, 0], angularVelocity: [0, 0, 0], sleeping: False }
    var mid = interpolateBody3d(a, b, 0.5)
    return { weights: weights, mid: mid.position }
`);
    const result = (out["blend"] as () => { weights: number[]; mid: number[] })();
    expect(result.weights[0]).toBe(0);
    expect(result.weights[2]).toBe(1);
    expect(result.weights[1]!).toBeGreaterThan(0);
    expect(result.weights[1]!).toBeLessThan(1);
    expect(Array.from(result.mid)).toEqual([1, 2, 3]);
  });

  it("voxel: chunk save format round trip", () => {
    const out = run(`from "@vapour/engine" import encodeChunk, decodeChunk

export func roundTrip(chunk):
    var encoded = encodeChunk(chunk)
    var decoded = decodeChunk(encoded)
    return { bytes: encoded.byteLength, same: decoded.blocks.every((value, index) => value == chunk.blocks[index]) }
`);
    const blocks = new Uint16Array(16 * 16 * 16);
    blocks.fill(1, 0, 512);
    const chunk = new engine.VoxelChunk(0, 0, 16, 16, blocks);
    const result = (out["roundTrip"] as (c: unknown) => { bytes: number; same: boolean }) (chunk);
    expect(result.same).toBe(true);
    expect(result.bytes).toBeLessThan(blocks.byteLength);
  });

  it("2D: light attenuation", () => {
    const out = run(`from "@vapour/engine" import lightAttenuation

export func falloff():
    var light = { kind: "point", position: [0, 0], radius: 10, intensity: 1, color: [1, 1, 1] }
    return [lightAttenuation(light, [1, 0]), lightAttenuation(light, [5, 0]), lightAttenuation(light, [20, 0])]
`);
    const [near, mid, far] = (out["falloff"] as () => number[])();
    expect(near!).toBeGreaterThan(mid!);
    expect(mid!).toBeGreaterThan(far!);
    expect(far).toBe(0);
  });

  it("refuses imports the engine does not export, with the symbol named", () => {
    expect(() => run(`from "@vapour/engine" import NotAThing\nvar x = 1\n`)).toThrow(/imports "NotAThing"/);
    expect(() => run(`from "./local.ts" import thing\nvar x = 1\n`)).toThrow(/non-engine import/);
  });
});
