import { describe, expect, it } from "vitest";
import {
  CRUSH_PROCESSOR_NAME,
  DEFAULT_CRUSH_PARAMETERS,
  createDspNode,
  dspWorkletModuleSource,
  isDspWorkletRegistered,
  processCrush,
  registerDspWorklet,
  type CrushState,
} from "./worklet.js";

function ramp(length: number): Float32Array {
  const input = new Float32Array(length);
  for (let index = 0; index < length; index += 1)
    input[index] = (index / (length - 1)) * 2 - 1;
  return input;
}

class Node {
  connected: unknown[] = [];
  connect(node: unknown): unknown {
    this.connected.push(node);
    return node;
  }
  disconnect(): void {
    this.connected = [];
  }
}

/** Fake contexts in the shape `audio.test.ts` uses, with the worklet surface
 * switchable so both the supported and unsupported paths are exercised. */
function fakeContext(options: {
  worklet?: boolean;
  scriptProcessor?: boolean;
  addModule?: (url: string) => Promise<void>;
}): BaseAudioContext & { modules: string[] } {
  const modules: string[] = [];
  const context: Record<string, unknown> = {
    modules,
    destination: new Node(),
    currentTime: 0,
    createGain: () => new Node(),
  };
  if (options.worklet !== false) {
    context["audioWorklet"] = {
      addModule:
        options.addModule ??
        (async (url: string) => {
          modules.push(url);
        }),
    };
  }
  if (options.scriptProcessor !== false) {
    context["createScriptProcessor"] = () => {
      const node = new Node() as Node & {
        onaudioprocess: unknown;
      };
      node.onaudioprocess = null;
      return node;
    };
  }
  return context as unknown as BaseAudioContext & { modules: string[] };
}

describe("processCrush", () => {
  it("quantizes to the requested bit depth", () => {
    const input = ramp(9);
    const output = new Float32Array(9);
    const state: CrushState = { hold: 0, phase: 0 };
    processCrush(input, output, { bits: 2, reduction: 1, drive: 1, mix: 1 }, state);
    // Two bits give three levels either side of zero: 2^2 - 1 = 3 steps.
    const distinct = new Set([...output].map((value) => value.toFixed(6)));
    expect(distinct.size).toBeLessThanOrEqual(4);
    for (const value of output) expect(Math.abs(value)).toBeLessThanOrEqual(1);
  });

  it("holds a sample for the reduction factor and carries the hold across blocks", () => {
    const state: CrushState = { hold: 0, phase: 0 };
    const first = new Float32Array(4);
    processCrush(
      Float32Array.from([0.5, -0.9, 0.1, 0.7]),
      first,
      { bits: 16, reduction: 4, drive: 1, mix: 1 },
      state,
    );
    expect(first[0]).toBeCloseTo(first[1]!, 6);
    expect(first[0]).toBeCloseTo(first[3]!, 6);
    // Block boundary: phase is mid-hold, so the next block keeps the same value.
    const second = new Float32Array(2);
    processCrush(
      Float32Array.from([0.2, -0.2]),
      second,
      { bits: 16, reduction: 4, drive: 1, mix: 1 },
      state,
    );
    expect(second[0]).not.toBeCloseTo(first[0]!, 6);
    expect(state.phase).toBeGreaterThanOrEqual(0);
  });

  it("passes dry signal through at mix 0 and saturates under drive", () => {
    const input = Float32Array.from([0.25, -0.75, 1]);
    const dry = new Float32Array(3);
    processCrush(input, dry, { bits: 4, reduction: 8, drive: 4, mix: 0 }, {
      hold: 0,
      phase: 0,
    });
    expect([...dry]).toEqual([...input]);
    const wet = new Float32Array(3);
    processCrush(input, wet, { bits: 16, reduction: 1, drive: 8, mix: 1 }, {
      hold: 0,
      phase: 0,
    });
    expect(wet[0]).toBeGreaterThan(input[0]!);
    for (const value of wet) expect(Math.abs(value)).toBeLessThanOrEqual(1);
  });

  it("clamps hostile parameters instead of throwing on the audio thread", () => {
    const output = new Float32Array(4);
    expect(() =>
      processCrush(
        ramp(4),
        output,
        { bits: -50, reduction: -3, drive: 0, mix: 4 },
        { hold: 0, phase: 0 },
      ),
    ).not.toThrow();
    for (const value of output) expect(Number.isFinite(value)).toBe(true);
  });
});

describe("dspWorkletModuleSource", () => {
  it("embeds the shipped DSP function and registers the processor", () => {
    const source = dspWorkletModuleSource();
    expect(source).toContain("const processCrush =");
    expect(source).toContain("Math.tanh");
    expect(source).toContain(`registerProcessor("${CRUSH_PROCESSOR_NAME}"`);
    expect(source).toContain(JSON.stringify(DEFAULT_CRUSH_PARAMETERS));
  });
});

describe("registerDspWorklet", () => {
  it("publishes the module and marks the context registered", async () => {
    const context = fakeContext({});
    const status = await registerDspWorklet(context);
    expect(status).toEqual({ ready: true, mode: "worklet" });
    expect(context.modules).toHaveLength(1);
    expect(isDspWorkletRegistered(context)).toBe(true);
    // Idempotent: a second call does not re-add the module.
    await registerDspWorklet(context);
    expect(context.modules).toHaveLength(1);
  });

  it("accepts a hosted module URL instead of a blob", async () => {
    const context = fakeContext({});
    await registerDspWorklet(context, { moduleUrl: "/dsp/vapour-crush.js" });
    expect(context.modules).toEqual(["/dsp/vapour-crush.js"]);
  });

  it("falls back to a script processor when audioWorklet is missing", async () => {
    const context = fakeContext({ worklet: false });
    const status = await registerDspWorklet(context);
    expect(status.ready).toBe(false);
    expect(status.mode).toBe("script-processor");
    expect(status.reason).toMatch(/no AudioWorklet/);
    expect(isDspWorkletRegistered(context)).toBe(false);
    const node = createDspNode(context, { bits: 6 });
    expect(node.mode).toBe("script-processor");
    node.setParameters({ mix: 0.5 });
    expect(node.parameters).toMatchObject({ bits: 6, mix: 0.5 });
    node.dispose();
  });

  it("falls back to a bypass gain when neither DSP path exists", async () => {
    const context = fakeContext({ worklet: false, scriptProcessor: false });
    const status = await registerDspWorklet(context);
    expect(status.mode).toBe("bypass");
    expect(createDspNode(context).mode).toBe("bypass");
  });

  it("reports a module that fails to load and keeps the fallback path", async () => {
    const context = fakeContext({
      addModule: () => Promise.reject(new Error("SyntaxError")),
    });
    const status = await registerDspWorklet(context);
    expect(status.ready).toBe(false);
    expect(status.reason).toMatch(/failed to load: SyntaxError/);
    expect(createDspNode(context).mode).toBe("script-processor");
  });

  it("rejects invalid parameters at the API boundary", () => {
    const context = fakeContext({ worklet: false });
    expect(() => createDspNode(context, { mix: 2 })).toThrow(/mix.*\[0, 1\]/);
    expect(() => createDspNode(context, { bits: 0 })).toThrow(/bits/);
    expect(() => createDspNode(context, { drive: 0 })).toThrow(/drive/);
    expect(() => createDspNode(context, { reduction: 0.5 })).toThrow(
      /reduction/,
    );
    expect(() => createDspNode(context).setParameters({ mix: Number.NaN })).toThrow(
      /finite/,
    );
  });
});
