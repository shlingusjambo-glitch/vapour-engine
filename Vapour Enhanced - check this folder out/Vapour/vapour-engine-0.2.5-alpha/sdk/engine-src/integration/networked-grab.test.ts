import { describe, expect, it } from "vitest";
import { XrGrabController, type XrPose } from "../index.js";
import {
  handleNetworkedGrabRpc,
  NetworkedGrabSession,
  RIGID_BODY_POSITION_KEY,
  XR_GRAB_REFUSED_RPC,
  XR_GRAB_RPC,
  XR_RELEASE_RPC,
  type GrabPolicy,
  type NetworkedGrabbable,
} from "./networked-grab.js";

/**
 * `@vapour/engine` cannot import `@vapour/net`, so this loopback restates the
 * server's ownership contract exactly as `NetworkServer` implements it: an
 * `ownership` notification goes to every client on change, entity state is
 * merged by `setState`, and client RPCs are delivered to `onRpc` in order.
 */
class Loopback {
  readonly entities = new Map<number, { owner: number | null; state: Record<string, unknown> }>();
  readonly sent: { readonly to: number; readonly name: string; readonly id: number | null }[] = [];
  readonly sessions = new Map<number, NetworkedGrabSession>();
  policy: GrabPolicy = "first-holder-wins";

  readonly server = {
    entity: (id: number) => this.entities.get(id),
    setOwner: (id: number, owner: number | null) => {
      const entity = this.entities.get(id)!;
      if (entity.owner === owner) return;
      entity.owner = owner;
      for (const session of this.sessions.values()) session.onOwnership({ id, owner });
    },
    setState: (id: number, state: Record<string, unknown>) => {
      const entity = this.entities.get(id)!;
      entity.state = { ...entity.state, ...state };
    },
    sendRpc: (name: string, args: readonly unknown[] = [], options: { to?: number; id?: number } = {}) => {
      this.sent.push({ to: options.to!, name, id: options.id ?? null });
      this.sessions.get(options.to!)!.onRpc(name, args, options.id ?? null);
    },
  };

  spawn(id: number): void {
    this.entities.set(id, { owner: null, state: {} });
  }

  connect(connection: number): NetworkedGrabSession {
    const session = new NetworkedGrabSession(
      {
        connection,
        entity: (id) => this.entities.get(id),
        sendRpc: (name, args = [], options = {}) => {
          this.sent.push({ to: 0, name, id: options.id ?? null });
          handleNetworkedGrabRpc(this.server, connection, name, args, options.id ?? null, this.policy);
        },
      },
      new XrGrabController(),
    );
    this.sessions.set(connection, session);
    return session;
  }
}

const crate: NetworkedGrabbable = { id: "crate", networkId: 7, position: [1, 1, 0], radius: 0.2 };
const nearCrate: XrPose = { position: [1, 1.1, 0], forward: [0, 0, -1] };
const farAway: XrPose = { position: [4, 1.1, 2], forward: [0, 0, -1] };

describe("Networked XR grab (M121)", () => {
  it("grab requests ownership, the hand keeps the object, and release hands back the final transform", () => {
    const net = new Loopback();
    net.spawn(7);
    const alice = net.connect(1);

    const grab = alice.grab("right", nearCrate, [crate]);
    expect(grab?.id).toBe("crate");
    expect(alice.controller.isHeld("crate")).toBe(true);
    expect(net.entities.get(7)!.owner).toBe(1);
    expect(net.sent.map((message) => message.name)).toEqual([XR_GRAB_RPC]);

    // The real grab controller carries the object with the hand.
    expect(alice.resolve("right", farAway)).toEqual([4, 1, 2]);

    const release = alice.release("right", farAway);
    expect(release).toEqual({ networkId: 7, position: [4, 1, 2] });
    expect(alice.controller.isHeld("crate")).toBe(false);
    expect(net.entities.get(7)!.owner).toBeNull();
    expect(net.entities.get(7)!.state[RIGID_BODY_POSITION_KEY]).toEqual([4, 1, 2]);
    expect(net.sent.at(-1)?.name).toBe(XR_RELEASE_RPC);
  });

  it("first holder wins: a second client cannot grab a held object, even in a race", () => {
    const net = new Loopback();
    net.spawn(7);
    const alice = net.connect(1);
    const bob = net.connect(2);
    alice.grab("right", nearCrate, [crate]);

    // Bob's replicated state already says Alice owns it: no grab, no RPC.
    expect(bob.grab("left", nearCrate, [crate])).toBeUndefined();
    expect(net.sent).toHaveLength(1);

    // The race: Bob grabbed before the ownership notification reached him.
    net.entities.get(7)!.owner = null; // what Bob's stale view claims
    const stale = new NetworkedGrabSession({ connection: 2, entity: () => ({ owner: null }), sendRpc: (name, args = [], options = {}) => {
      net.entities.get(7)!.owner = 1; // the server's truth
      net.sessions.set(2, stale);
      handleNetworkedGrabRpc(net.server, 2, name, args, options.id ?? null);
    } });
    expect(stale.grab("left", nearCrate, [crate])?.id).toBe("crate");
    // Refused server-side and dropped client-side; Alice still holds it.
    expect(net.sent.at(-1)).toEqual({ to: 2, name: XR_GRAB_REFUSED_RPC, id: 7 });
    expect(stale.controller.isHeld("crate")).toBe(false);
    expect(net.entities.get(7)!.owner).toBe(1);
    expect(alice.controller.isHeld("crate")).toBe(true);
  });

  it("steal policy: the newer grab wins and the previous holder's hand empties", () => {
    const net = new Loopback();
    net.policy = "steal";
    net.spawn(7);
    const alice = net.connect(1);
    const bob = net.connect(2);
    alice.grab("right", nearCrate, [crate]);
    net.entities.get(7)!.owner = null; // Bob has not heard yet
    expect(bob.grab("left", nearCrate, [crate])?.id).toBe("crate");
    expect(net.entities.get(7)!.owner).toBe(2);
    expect(bob.controller.isHeld("crate")).toBe(true);
    expect(alice.controller.isHeld("crate")).toBe(false);
  });

  it("ignores a release from a client that does not own the object", () => {
    const net = new Loopback();
    net.spawn(7);
    net.entities.get(7)!.owner = 1;
    handleNetworkedGrabRpc(net.server, 2, XR_RELEASE_RPC, [[9, 9, 9]], 7);
    expect(net.entities.get(7)!.owner).toBe(1);
    expect(net.entities.get(7)!.state).toEqual({});
    expect(handleNetworkedGrabRpc(net.server, 2, "chat", [], null)).toBe(false);
  });
});
