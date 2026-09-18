/** Rooms and matchmaking.
 *
 * This is pure state plus a message shape, on purpose. A lobby service is
 * nine-tenths rules — who may join, when a room is full, when everyone is
 * ready — and one-tenth sockets, and putting the sockets in first is how the
 * rules end up untestable. `Lobby.handle` takes a request and returns a reply;
 * what carries them (an RPC over `NetworkServer`, a WebSocket, an HTTP route)
 * is the game's choice.
 */
import type { NetState, NetValue } from "./protocol.js";
import type { ConnectionId } from "./transport.js";

export interface RoomMember {
  readonly id: ConnectionId;
  /** Whatever the game wants matched on or shown: name, rank, region. */
  readonly profile: NetState;
  ready: boolean;
}

export interface RoomOptions {
  readonly capacity?: number;
  readonly metadata?: NetState;
}

/** A room as it goes over the wire: plain values only. */
export interface RoomSnapshot {
  readonly id: string;
  readonly capacity: number;
  readonly metadata: NetState;
  readonly members: readonly { readonly id: ConnectionId; readonly ready: boolean; readonly profile: NetState }[];
  readonly allReady: boolean;
}

export class Room {
  readonly id: string;
  readonly capacity: number;
  metadata: NetState;
  readonly #members = new Map<ConnectionId, RoomMember>();

  /** @internal Created through {@link Lobby.createRoom}. */
  constructor(id: string, options: RoomOptions) {
    const capacity = options.capacity ?? 8;
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error("A room capacity must be a whole number of at least 1.");
    this.id = id;
    this.capacity = capacity;
    this.metadata = options.metadata ?? {};
  }

  get members(): readonly RoomMember[] {
    return [...this.#members.values()];
  }

  get size(): number {
    return this.#members.size;
  }

  get full(): boolean {
    return this.#members.size >= this.capacity;
  }

  /** Every member is ready — and there is at least one, so an empty room is not "ready". */
  get allReady(): boolean {
    if (this.#members.size === 0) return false;
    for (const member of this.#members.values()) if (!member.ready) return false;
    return true;
  }

  member(id: ConnectionId): RoomMember | undefined {
    return this.#members.get(id);
  }

  snapshot(): RoomSnapshot {
    return {
      id: this.id,
      capacity: this.capacity,
      metadata: this.metadata,
      members: this.members.map((member) => ({ id: member.id, ready: member.ready, profile: member.profile })),
      allReady: this.allReady,
    };
  }

  /** @internal */
  add(member: RoomMember): void {
    this.#members.set(member.id, member);
  }

  /** @internal */
  remove(id: ConnectionId): boolean {
    return this.#members.delete(id);
  }
}

export type LobbyRequest =
  | { readonly type: "createRoom"; readonly room: string; readonly capacity?: number; readonly metadata?: NetState; readonly profile?: NetState }
  | { readonly type: "joinRoom"; readonly room: string; readonly profile?: NetState }
  | { readonly type: "leaveRoom" }
  | { readonly type: "ready"; readonly ready: boolean }
  | { readonly type: "listRooms" };

export type LobbyReply =
  | { readonly type: "room"; readonly room: RoomSnapshot }
  | { readonly type: "rooms"; readonly rooms: readonly RoomSnapshot[] }
  | { readonly type: "left"; readonly room: string | null }
  | { readonly type: "error"; readonly reason: string };

export class Lobby {
  readonly #rooms = new Map<string, Room>();
  readonly #roomOf = new Map<ConnectionId, string>();

  get rooms(): readonly Room[] {
    return [...this.#rooms.values()];
  }

  room(id: string): Room | undefined {
    return this.#rooms.get(id);
  }

  roomOf(member: ConnectionId): Room | undefined {
    const id = this.#roomOf.get(member);
    return id === undefined ? undefined : this.#rooms.get(id);
  }

  createRoom(id: string, options: RoomOptions = {}): Room {
    const name = id.trim();
    if (!name) throw new Error("A room id must not be empty.");
    if (this.#rooms.has(name)) throw new Error(`Room "${name}" already exists.`);
    const room = new Room(name, options);
    this.#rooms.set(name, room);
    return room;
  }

  /**
   * Puts a member in a room, leaving whichever one they were in.
   *
   * A member is in at most one room. Allowing two would mean two sets of
   * ready flags and two matches starting with the same player in both.
   */
  joinRoom(roomId: string, member: ConnectionId, profile: NetState = {}): Room {
    const room = this.#rooms.get(roomId);
    if (!room) throw new Error(`No room "${roomId}".`);
    if (room.member(member)) return room;
    if (room.full) throw new Error(`Room "${roomId}" is full.`);
    this.leaveRoom(member);
    room.add({ id: member, profile, ready: false });
    this.#roomOf.set(member, room.id);
    return room;
  }

  /** Removes a member; an emptied room is deleted. Returns the room left, if any. */
  leaveRoom(member: ConnectionId): Room | undefined {
    const room = this.roomOf(member);
    if (!room) return undefined;
    room.remove(member);
    this.#roomOf.delete(member);
    if (room.size === 0) this.#rooms.delete(room.id);
    return room;
  }

  setReady(member: ConnectionId, ready: boolean): Room {
    const room = this.roomOf(member);
    if (!room) throw new Error(`Connection ${String(member)} is not in a room.`);
    room.member(member)!.ready = ready;
    return room;
  }

  /** Answers one request from one peer. Never throws: a bad request is a reply, not an outage. */
  handle(from: ConnectionId, request: LobbyRequest): LobbyReply {
    try {
      switch (request.type) {
        case "createRoom": {
          const options: RoomOptions = {
            ...(request.capacity === undefined ? {} : { capacity: request.capacity }),
            ...(request.metadata === undefined ? {} : { metadata: request.metadata }),
          };
          this.createRoom(request.room, options);
          return { type: "room", room: this.joinRoom(request.room, from, request.profile ?? {}).snapshot() };
        }
        case "joinRoom":
          return { type: "room", room: this.joinRoom(request.room, from, request.profile ?? {}).snapshot() };
        case "leaveRoom":
          return { type: "left", room: this.leaveRoom(from)?.id ?? null };
        case "ready":
          return { type: "room", room: this.setReady(from, request.ready === true).snapshot() };
        case "listRooms":
          return { type: "rooms", rooms: this.rooms.map((room) => room.snapshot()) };
        default:
          return { type: "error", reason: `Unknown lobby request "${String((request as { type: NetValue }).type)}".` };
      }
    } catch (error) {
      return { type: "error", reason: error instanceof Error ? error.message : String(error) };
    }
  }
}

export interface MatchmakerOptions {
  /** Whether a player may be placed in a room. Sees the room's members and metadata. */
  readonly match: (profile: NetState, room: Room) => boolean;
  /** Capacity of rooms the matchmaker creates. */
  readonly capacity: number;
  /** Metadata for a room created around this player, e.g. their region or mode. */
  readonly metadata?: (profile: NetState) => NetState;
  /** Names created rooms. Defaults to `match-1`, `match-2`, ... */
  readonly roomId?: (index: number) => string;
}

/**
 * Fills rooms by a predicate.
 *
 * Simplest possible policy: the first open room the player matches, else a new
 * one. Skill windows, wait-time widening, and party handling are all
 * expressible in `match` — and none of them belongs in an engine.
 */
export class Matchmaker {
  readonly #lobby: Lobby;
  readonly #options: MatchmakerOptions;
  #created = 0;

  constructor(lobby: Lobby, options: MatchmakerOptions) {
    if (!Number.isInteger(options.capacity) || options.capacity < 1) {
      throw new Error("Matchmaker room capacity must be a whole number of at least 1.");
    }
    this.#lobby = lobby;
    this.#options = options;
  }

  /** Places a player and returns their room. */
  enqueue(member: ConnectionId, profile: NetState = {}): Room {
    for (const room of this.#lobby.rooms) {
      if (room.full || !this.#options.match(profile, room)) continue;
      return this.#lobby.joinRoom(room.id, member, profile);
    }
    this.#created += 1;
    const id = this.#options.roomId?.(this.#created) ?? `match-${String(this.#created)}`;
    const metadata = this.#options.metadata?.(profile);
    this.#lobby.createRoom(id, { capacity: this.#options.capacity, ...(metadata === undefined ? {} : { metadata }) });
    return this.#lobby.joinRoom(id, member, profile);
  }

  dequeue(member: ConnectionId): void {
    this.#lobby.leaveRoom(member);
  }
}
