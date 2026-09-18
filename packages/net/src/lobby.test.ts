import { describe, expect, it } from "vitest";
import { Lobby, Matchmaker } from "./lobby.js";

describe("Lobby", () => {
  it("creates, joins, and leaves rooms, deleting an emptied room", () => {
    const lobby = new Lobby();
    const room = lobby.createRoom("alpha", { capacity: 2, metadata: { map: "docks" } });
    lobby.joinRoom("alpha", 1, { name: "ann" });
    lobby.joinRoom("alpha", 2, { name: "bob" });
    expect(room.members.map((member) => member.id)).toEqual([1, 2]);
    expect(room.full).toBe(true);
    expect(() => lobby.joinRoom("alpha", 3)).toThrow(/full/);
    expect(() => lobby.joinRoom("nope", 3)).toThrow(/No room/);
    expect(() => lobby.createRoom("alpha")).toThrow(/already exists/);

    expect(lobby.leaveRoom(1)?.id).toBe("alpha");
    expect(lobby.leaveRoom(1)).toBeUndefined();
    expect(lobby.room("alpha")?.size).toBe(1);
    lobby.leaveRoom(2);
    expect(lobby.room("alpha")).toBeUndefined();
  });

  it("keeps a member in at most one room", () => {
    const lobby = new Lobby();
    lobby.createRoom("a");
    lobby.createRoom("b");
    lobby.joinRoom("a", 1);
    lobby.joinRoom("b", 1);
    expect(lobby.roomOf(1)?.id).toBe("b");
    expect(lobby.room("a")).toBeUndefined();
  });

  it("tracks readiness per member and reports allReady only when everyone is", () => {
    const lobby = new Lobby();
    const room = lobby.createRoom("a", { capacity: 3 });
    expect(room.allReady).toBe(false);
    lobby.joinRoom("a", 1);
    lobby.joinRoom("a", 2);
    lobby.setReady(1, true);
    expect(room.allReady).toBe(false);
    lobby.setReady(2, true);
    expect(room.allReady).toBe(true);
    lobby.setReady(1, false);
    expect(room.allReady).toBe(false);
    expect(() => lobby.setReady(9, true)).toThrow(/not in a room/);
  });

  it("answers requests with replies rather than exceptions", () => {
    const lobby = new Lobby();
    expect(lobby.handle(1, { type: "createRoom", room: "a", capacity: 1, metadata: { mode: "duel" }, profile: { name: "ann" } })).toEqual({
      type: "room",
      room: { id: "a", capacity: 1, metadata: { mode: "duel" }, members: [{ id: 1, ready: false, profile: { name: "ann" } }], allReady: false },
    });
    expect(lobby.handle(2, { type: "joinRoom", room: "a" })).toEqual({ type: "error", reason: 'Room "a" is full.' });
    expect(lobby.handle(1, { type: "ready", ready: true })).toMatchObject({ type: "room", room: { allReady: true } });
    expect(lobby.handle(2, { type: "listRooms" })).toMatchObject({ type: "rooms", rooms: [{ id: "a" }] });
    expect(lobby.handle(1, { type: "leaveRoom" })).toEqual({ type: "left", room: "a" });
    expect(lobby.handle(1, { type: "leaveRoom" })).toEqual({ type: "left", room: null });
    expect(lobby.handle(1, { type: "bogus" } as never)).toMatchObject({ type: "error" });
  });

  it("validates room ids and capacity", () => {
    const lobby = new Lobby();
    expect(() => lobby.createRoom(" ")).toThrow(/must not be empty/);
    expect(() => lobby.createRoom("a", { capacity: 0 })).toThrow(/at least 1/);
  });
});

describe("Matchmaker", () => {
  it("fills rooms by the predicate and opens a new one when nothing matches", () => {
    const lobby = new Lobby();
    const matchmaker = new Matchmaker(lobby, {
      capacity: 2,
      // Same region, and within 100 rating of everyone already there.
      match: (profile, room) =>
        room.metadata.region === profile.region &&
        room.members.every((member) => Math.abs((member.profile.rating as number) - (profile.rating as number)) <= 100),
      metadata: (profile) => ({ region: profile.region! }),
    });
    const a = matchmaker.enqueue(1, { region: "eu", rating: 1500 });
    const b = matchmaker.enqueue(2, { region: "eu", rating: 1550 });
    const c = matchmaker.enqueue(3, { region: "us", rating: 1500 });
    const d = matchmaker.enqueue(4, { region: "eu", rating: 1900 });
    const e = matchmaker.enqueue(5, { region: "eu", rating: 1520 });
    expect(a).toBe(b);
    expect(c).not.toBe(a);
    expect(d).not.toBe(a);
    // Room "a" is full at two, so the third matching player opens another.
    expect(e).not.toBe(a);
    expect(lobby.rooms.map((room) => room.id)).toEqual(["match-1", "match-2", "match-3", "match-4"]);
    expect(a.full).toBe(true);

    matchmaker.dequeue(3);
    expect(lobby.room("match-2")).toBeUndefined();
    expect(() => new Matchmaker(lobby, { capacity: 0, match: () => true })).toThrow(/at least 1/);
  });
});
