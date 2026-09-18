import { describe, expect, it } from "vitest";
import type { PhysicsBodySnapshot3d } from "./physics-3d.js";
import {
  PhysicsWorkerChannel,
  createPhysicsWorkerBuffer,
  isSharedPhysicsBufferAvailable,
  physicsWorkerBufferByteLength,
  PHYSICS_WORKER_BODY_STRIDE,
} from "./physics-worker-protocol.js";

function body(id: number, x: number): PhysicsBodySnapshot3d {
  return {
    id,
    position: [x, 1, -2],
    rotation: [0, 0, 0, 1],
    linearVelocity: [0.5, 0, 0],
    angularVelocity: [0, 0, 0],
    sleeping: false,
  };
}

describe("physicsWorkerBufferByteLength", () => {
  it("sizes a header plus two body buffers", () => {
    const bytes = physicsWorkerBufferByteLength(10);
    const headerBytes = 4 * 4; // 4 Int32 words
    const bodyBufferBytes = 10 * PHYSICS_WORKER_BODY_STRIDE * 4; // Float32
    expect(bytes).toBe(headerBytes + bodyBufferBytes * 2);
  });
});

describe("PhysicsWorkerChannel", () => {
  it("round-trips a published step exactly (producer and consumer sharing one buffer)", () => {
    const buffer = createPhysicsWorkerBuffer(4);
    const producer = new PhysicsWorkerChannel(buffer, 4);
    const consumer = new PhysicsWorkerChannel(buffer, 4);

    expect(consumer.consume()).toBeUndefined(); // nothing published yet

    producer.publish(42, [body(1, 10), body(2, 20)]);

    const snapshot = consumer.consume();
    expect(snapshot).toBeDefined();
    expect(snapshot!.tick).toBe(42);
    expect(snapshot!.bodies).toHaveLength(2);
    expect(snapshot!.bodies[0]).toEqual(body(1, 10));
    expect(snapshot!.bodies[1]).toEqual(body(2, 20));
  });

  it("alternates buffers across publishes and always reads the latest", () => {
    const buffer = createPhysicsWorkerBuffer(2);
    const producer = new PhysicsWorkerChannel(buffer, 2);
    const consumer = new PhysicsWorkerChannel(buffer, 2);

    producer.publish(1, [body(1, 0)]);
    expect(consumer.consume()!.bodies[0]!.position[0]).toBe(0);

    producer.publish(2, [body(1, 5)]);
    expect(consumer.consume()!.bodies[0]!.position[0]).toBe(5);

    producer.publish(3, [body(1, 9)]);
    expect(consumer.consume()!.tick).toBe(3);
    expect(consumer.consume()!.bodies[0]!.position[0]).toBe(9);
  });

  it("rejects a buffer sized for the wrong body count", () => {
    const buffer = createPhysicsWorkerBuffer(4);
    expect(() => new PhysicsWorkerChannel(buffer, 8)).toThrow(/wrong size/);
  });

  it("rejects publishing more bodies than the channel's capacity", () => {
    const buffer = createPhysicsWorkerBuffer(1);
    const producer = new PhysicsWorkerChannel(buffer, 1);
    expect(() => producer.publish(1, [body(1, 0), body(2, 0)])).toThrow(/at most 1/);
  });

  it("detects a torn read via the generation counter and retries past it", () => {
    // Simulate the race directly: a reader that captured a stale (odd,
    // "publish in progress") generation must not trust the data underneath
    // it, and must succeed once the real, even generation is visible.
    const buffer = createPhysicsWorkerBuffer(1);
    const producer = new PhysicsWorkerChannel(buffer, 1);
    producer.publish(1, [body(1, 0)]);

    const header = new Int32Array(buffer, 0, 4);
    const realGeneration = Atomics.load(header, 0);
    Atomics.store(header, 0, realGeneration + 1); // force "publish in progress"

    const consumer = new PhysicsWorkerChannel(buffer, 1);
    // With the generation stuck odd, every attempt is rejected as in-flight
    // and consume() gives up after maxRetries rather than trusting it.
    expect(consumer.consume(3)).toBeUndefined();

    Atomics.store(header, 0, realGeneration); // repair it, as the real publish() would have
    expect(consumer.consume()!.tick).toBe(1);
  });
});

describe("isSharedPhysicsBufferAvailable / createPhysicsWorkerBuffer", () => {
  it("allocates a buffer either way, same layout", () => {
    const buffer = createPhysicsWorkerBuffer(3);
    expect(buffer.byteLength).toBe(physicsWorkerBufferByteLength(3));
    if (isSharedPhysicsBufferAvailable()) {
      expect(buffer).toBeInstanceOf(SharedArrayBuffer);
    } else {
      expect(buffer).toBeInstanceOf(ArrayBuffer);
    }
  });

  it("works identically over a plain ArrayBuffer (the same-thread fallback)", () => {
    const buffer = new ArrayBuffer(physicsWorkerBufferByteLength(2));
    const producer = new PhysicsWorkerChannel(buffer, 2);
    const consumer = new PhysicsWorkerChannel(buffer, 2);
    producer.publish(7, [body(1, 3)]);
    expect(consumer.consume()!.tick).toBe(7);
  });
});
