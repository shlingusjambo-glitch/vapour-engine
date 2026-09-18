import { describe, expect, it } from "vitest";
import { AudioEngine, SceneDocument } from "../index.js";
import { AudioEntityFollower } from "./audio-follow.js";

/** The slice of Web Audio `AudioEngine` touches, recording panner positions. */
class Param { value = 0; setValueAtTime(value: number): void { this.value = value; } cancelScheduledValues(): void {} }
class Node { connect(node: unknown): unknown { return node; } disconnect(): void {} }
class Panner extends Node {
  panningModel = ""; distanceModel = ""; refDistance = 1; maxDistance = 1; rolloffFactor = 1; coneInnerAngle = 360; coneOuterAngle = 360; coneOuterGain = 0;
  positionX = new Param(); positionY = new Param(); positionZ = new Param();
  orientationX = new Param(); orientationY = new Param(); orientationZ = new Param();
  get position(): [number, number, number] { return [this.positionX.value, this.positionY.value, this.positionZ.value]; }
}
function fakeContext(): { context: AudioContext; panners: Panner[] } {
  const panners: Panner[] = [];
  const listener = Object.fromEntries(["positionX", "positionY", "positionZ", "forwardX", "forwardY", "forwardZ", "upX", "upY", "upZ"].map((key) => [key, new Param()]));
  const context = {
    state: "running", currentTime: 0, destination: new Node(), listener,
    createGain: () => Object.assign(new Node(), { gain: new Param() }),
    createDynamicsCompressor: () => new Node(),
    createPanner: () => { const panner = new Panner(); panners.push(panner); return panner; },
    createBufferSource: () => Object.assign(new Node(), { playbackRate: new Param(), start() {}, stop() {}, onended: null }),
    resume: async () => {}, close: async () => {},
  };
  return { context: context as unknown as AudioContext, panners };
}

describe("AudioEntityFollower (M124)", () => {
  it("moves a spatial voice with its entity's world transform, parents included", () => {
    const { context, panners } = fakeContext();
    const audio = new AudioEngine(context);
    audio.registerClip("lantern", { duration: 1 } as AudioBuffer);
    const scene = new SceneDocument();
    const cart = scene.addEntity("Cart");
    const lantern = scene.addEntity("Lantern", cart.id);
    scene.setTransform(lantern.id, { position: [0, 1, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] });

    const source = audio.createSource({ clip: "lantern", position: [0, 0, 0], loop: true });
    source.play();
    const follower = new AudioEntityFollower(scene);
    follower.attach(source, lantern.id);

    scene.setTransform(cart.id, { position: [5, 0, 2], rotation: [0, 0, 0, 1], scale: [1, 1, 1] });
    follower.update(1 / 60);
    expect(panners[0]!.position).toEqual([5, 1, 2]);
    expect(source.definition.position).toEqual([5, 1, 2]);

    // Moving 3 m in one 0.5 s tick implies 6 m/s for Doppler.
    scene.setTransform(cart.id, { position: [8, 0, 2], rotation: [0, 0, 0, 1], scale: [1, 1, 1] });
    follower.update(0.5);
    expect(panners[0]!.position).toEqual([8, 1, 2]);
    expect(source.definition.velocity).toEqual([6, 0, 0]);
  });

  it("drops followers whose entity was removed and rejects unknown entities", () => {
    const { context } = fakeContext();
    const audio = new AudioEngine(context);
    audio.registerClip("step", { duration: 1 } as AudioBuffer);
    const scene = new SceneDocument();
    const npc = scene.addEntity("Npc");
    const follower = new AudioEntityFollower(scene);
    const source = audio.createSource({ clip: "step", position: [0, 0, 0] });
    follower.attach(source, npc.id);
    expect(follower.size).toBe(1);
    scene.removeEntity(npc.id);
    follower.update(1 / 60);
    expect(follower.size).toBe(0);
    expect(() => follower.attach(source, "ghost")).toThrow(/missing entity 'ghost'/);
    expect(() => follower.update(-1)).toThrow(/delta/);
  });
});
