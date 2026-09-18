/** XR grabbing of networked objects: grab = ownership request, release = handback.
 *
 * `XrGrabController` decides *what* a hand is holding and where it should be;
 * `@vapour/net` decides *who* may move a replicated body. Joining them:
 *
 * 1. **Grab → ownership request.** A client cannot take ownership itself
 *    (`transferOwnership` is honoured only for the current owner), so the
 *    grab is sent as the `xr.grab` RPC and the server's handler,
 *    {@link handleNetworkedGrabRpc}, calls `setOwner`. The client keeps the
 *    object in hand from the first frame — waiting a round trip to close a
 *    hand is how VR grabs feel broken — and the resulting ownership
 *    notification simply confirms the prediction.
 * 2. **Release → final transform.** The client sends `xr.release` with the
 *    hand-resolved position; the server writes it as the body's replicated
 *    position (key `"p"`, mirroring `RIGID_BODY_KEYS.position`) and returns
 *    ownership to the server so physics carries on from where the hand let go.
 * 3. **Remote grab on a held object: first holder wins.** A client does not
 *    grab what its replicated state says another connection owns, and the
 *    server refuses `xr.grab` for such a body regardless — the two grabs may
 *    have raced — answering with the `xr.grab.refused` RPC so the session
 *    drops the local grab and the object is never in two hands. Set
 *    `policy: "steal"` to let the newer grab win instead: the previous holder
 *    loses ownership, learns so through `onOwnership`, and its session
 *    releases.
 *
 * Typed structurally, like `scene-sync`: `GrabClient` is the slice of
 * `NetworkClient` used, `GrabServer` the slice of `NetworkServer`.
 */
import { XrGrabController, type XrGrabbable, type XrGrabState, type XrPose } from "../xr/interaction.js";
import type { XrHand, XrVector3 } from "../xr/xr-locomotion.js";

export const XR_GRAB_RPC = "xr.grab";
export const XR_RELEASE_RPC = "xr.release";
export const XR_GRAB_REFUSED_RPC = "xr.grab.refused";
/** `RIGID_BODY_KEYS.position` in `@vapour/net`. */
export const RIGID_BODY_POSITION_KEY = "p";

export type GrabPolicy = "first-holder-wins" | "steal";

/** A grabbable that is also a replicated entity. */
export interface NetworkedGrabbable extends XrGrabbable {
  readonly networkId: number;
}

/** What this needs from `NetworkClient`. */
export interface GrabClient {
  readonly connection: number | undefined;
  entity(id: number): { readonly owner: number | null } | undefined;
  sendRpc(name: string, args?: readonly unknown[], options?: { readonly id?: number }): void;
}

/** What this needs from `NetworkServer`. */
export interface GrabServer {
  entity(id: number): { readonly owner: number | null } | undefined;
  setOwner(id: number, owner: number | null): void;
  setState(id: number, state: Readonly<Record<string, unknown>>): void;
  sendRpc(name: string, args?: readonly unknown[], options?: { readonly to?: number; readonly id?: number }): void;
}

export interface NetworkedGrabRelease {
  readonly networkId: number;
  readonly position: XrVector3;
}

/** Client half. */
export class NetworkedGrabSession {
  readonly #controller: XrGrabController;
  readonly #client: GrabClient;
  readonly #ids = new Map<string, number>();

  constructor(client: GrabClient, controller = new XrGrabController()) {
    this.#client = client;
    this.#controller = controller;
  }

  get controller(): XrGrabController {
    return this.#controller;
  }

  /** Grabs within reach and asks the server for ownership. Objects another client holds are not candidates. */
  grab(hand: XrHand, pose: XrPose, grabbables: readonly NetworkedGrabbable[]): XrGrabState | undefined {
    const free = grabbables.filter((candidate) => {
      const owner = this.#client.entity(candidate.networkId)?.owner ?? null;
      return owner === null || owner === this.#client.connection;
    });
    const grab = this.#controller.grabDirect(hand, pose, free);
    if (!grab) return undefined;
    const networkId = grabbables.find((candidate) => candidate.id === grab.id)!.networkId;
    this.#ids.set(grab.id, networkId);
    this.#client.sendRpc(XR_GRAB_RPC, [], { id: networkId });
    return grab;
  }

  /** Where the held object renders this frame, or `undefined` when the hand is empty. */
  resolve(hand: XrHand, pose: XrPose): XrVector3 | undefined {
    return this.#controller.resolve(hand, pose);
  }

  /** Releases and reports the final transform; ownership returns to the server. */
  release(hand: XrHand, pose: XrPose): NetworkedGrabRelease | undefined {
    const position = this.#controller.resolve(hand, pose);
    const id = this.#controller.release(hand);
    if (id === undefined || position === undefined) return undefined;
    const networkId = this.#ids.get(id)!;
    if (!this.#controller.isHeld(id)) this.#ids.delete(id);
    this.#client.sendRpc(XR_RELEASE_RPC, [position], { id: networkId });
    return { networkId, position };
  }

  /** Wire to `ClientOptions.onOwnership`. A held object now owned by someone else was stolen: drop the grab. */
  onOwnership(entity: { readonly id: number; readonly owner: number | null }): void {
    if (entity.owner !== this.#client.connection) this.#drop(entity.id);
  }

  /** Wire to `ClientOptions.onRpc`. Returns whether the RPC was ours. */
  onRpc(name: string, _args: readonly unknown[], id: number | null): boolean {
    if (name !== XR_GRAB_REFUSED_RPC) return false;
    if (id !== null) this.#drop(id);
    return true;
  }

  #drop(networkId: number): void {
    for (const grab of this.#controller.held) {
      if (this.#ids.get(grab.id) !== networkId) continue;
      this.#controller.release(grab.hand);
      this.#ids.delete(grab.id);
    }
  }
}

/**
 * Server half. Wire to `ServerOptions.onRpc`; returns whether the RPC was one
 * of ours. Ownership rules are enforced here, never trusted from the client.
 */
export function handleNetworkedGrabRpc(
  server: GrabServer,
  connection: number,
  name: string,
  args: readonly unknown[],
  id: number | null,
  policy: GrabPolicy = "first-holder-wins",
): boolean {
  if (name !== XR_GRAB_RPC && name !== XR_RELEASE_RPC) return false;
  const entity = id === null ? undefined : server.entity(id);
  if (!entity || id === null) return true;
  if (name === XR_GRAB_RPC) {
    const free = entity.owner === null || entity.owner === connection;
    if (free || policy === "steal") server.setOwner(id, connection);
    else server.sendRpc(XR_GRAB_REFUSED_RPC, [], { to: connection, id });
    return true;
  }
  if (entity.owner !== connection) return true;
  const position = args[0];
  if (isVec3(position)) server.setState(id, { [RIGID_BODY_POSITION_KEY]: position });
  server.setOwner(id, null);
  return true;
}

function isVec3(value: unknown): value is XrVector3 {
  return Array.isArray(value) && value.length === 3 && value.every((member) => typeof member === "number" && Number.isFinite(member));
}
