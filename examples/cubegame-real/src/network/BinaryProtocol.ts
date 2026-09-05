export enum PacketType {
  Handshake = 0,
  PlayerMove = 1,
  BlockEdit = 2,
  PlayerJoinLeave = 3,
  ChatMessage = 4,
  TimeSync = 5,
  ServerSnapshot = 6
}

export class BinaryProtocol {
  public static readonly PROTOCOL_VERSION = 2;

  public static readonly PLAYER_MOVE_BYTES = 23;        // client -> server
  public static readonly SERVER_PLAYER_MOVE_BYTES = 25; // server -> clients
  public static readonly BLOCK_EDIT_BYTES = 15;
  public static readonly TIME_SYNC_BYTES = 13;          // type + float32 time + float64 server ms
  public static readonly LEGACY_TIME_SYNC_BYTES = 5;
  public static readonly SERVER_SNAPSHOT_BYTES = 13;

  /**
   * Encodes a player movement update into a compact binary buffer.
   * Total size: 23 bytes.
   */
  public static encodePlayerMove(
    x: number,
    y: number,
    z: number,
    yaw: number,
    pitch: number,
    heldItemId: number = 0
  ): ArrayBuffer {
    const buffer = new ArrayBuffer(this.PLAYER_MOVE_BYTES);
    const view = new DataView(buffer);

    view.setUint8(0, PacketType.PlayerMove);
    view.setFloat32(1, x);
    view.setFloat32(5, y);
    view.setFloat32(9, z);
    view.setFloat32(13, yaw);
    view.setFloat32(17, pitch);
    view.setUint16(21, heldItemId & 0xffff);

    return buffer;
  }

  /**
   * Decodes a client-origin movement update.
   */
  public static decodePlayerMove(buffer: ArrayBuffer | ArrayBufferView): {
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
    heldItemId: number;
  } {
    const view = this.toDataView(buffer);
    if (view.byteLength < this.PLAYER_MOVE_BYTES) {
      throw new Error(`PlayerMove packet too small: ${view.byteLength}`);
    }

    return {
      x: view.getFloat32(1),
      y: view.getFloat32(5),
      z: view.getFloat32(9),
      yaw: view.getFloat32(13),
      pitch: view.getFloat32(17),
      heldItemId: view.getUint16(21)
    };
  }

  /**
   * Server broadcast movement format: type + uint16 player index + 22 bytes movement.
   */
  public static encodeServerPlayerMove(
    playerIndex: number,
    x: number,
    y: number,
    z: number,
    yaw: number,
    pitch: number,
    heldItemId: number = 0
  ): ArrayBuffer {
    const buffer = new ArrayBuffer(this.SERVER_PLAYER_MOVE_BYTES);
    const view = new DataView(buffer);

    view.setUint8(0, PacketType.PlayerMove);
    view.setUint16(1, playerIndex);
    view.setFloat32(3, x);
    view.setFloat32(7, y);
    view.setFloat32(11, z);
    view.setFloat32(15, yaw);
    view.setFloat32(19, pitch);
    view.setUint16(23, heldItemId & 0xffff);

    return buffer;
  }

  public static decodeServerPlayerMove(buffer: ArrayBuffer | ArrayBufferView): {
    index: number;
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
    heldItemId: number;
  } {
    const view = this.toDataView(buffer);
    if (view.byteLength < 23) {
      throw new Error(`Server PlayerMove packet too small: ${view.byteLength}`);
    }

    return {
      index: view.getUint16(1),
      x: view.getFloat32(3),
      y: view.getFloat32(7),
      z: view.getFloat32(11),
      yaw: view.getFloat32(15),
      pitch: view.getFloat32(19),
      heldItemId: view.byteLength >= 25 ? view.getUint16(23) : 0
    };
  }

  /**
   * Encodes a block mutation: 14 bytes.
   */
  public static encodeBlockEdit(
    x: number,
    y: number,
    z: number,
    blockId: number
  ): ArrayBuffer {
    const buffer = new ArrayBuffer(this.BLOCK_EDIT_BYTES);
    const view = new DataView(buffer);

    view.setUint8(0, PacketType.BlockEdit);
    view.setInt32(1, x);
    view.setInt32(5, y);
    view.setInt32(9, z);
    view.setUint16(13, blockId & 0xffff);

    return buffer;
  }

  /**
   * Decodes a block mutation.
   */
  public static decodeBlockEdit(buffer: ArrayBuffer | ArrayBufferView): {
    x: number;
    y: number;
    z: number;
    blockId: number;
  } {
    const view = this.toDataView(buffer);
    if (view.byteLength < this.BLOCK_EDIT_BYTES) {
      throw new Error(`BlockEdit packet too small: ${view.byteLength}`);
    }

    return {
      x: view.getInt32(1),
      y: view.getInt32(5),
      z: view.getInt32(9),
      blockId: view.getUint16(13)
    };
  }

  /**
   * Encodes time-of-day sync.
   *
   * v2 format: 13 bytes
   * - 1 byte type
   * - 4 byte float timeOfDay, normalized 0..1
   * - 8 byte float server timestamp ms
   *
   * decodeTimeSync still accepts old 5-byte packets, so old/new clients can mix.
   */
  public static encodeTimeSync(timeOfDay: number, serverTimeMs: number = Date.now()): ArrayBuffer {
    const buffer = new ArrayBuffer(this.TIME_SYNC_BYTES);
    const view = new DataView(buffer);

    view.setUint8(0, PacketType.TimeSync);
    view.setFloat32(1, this.normalizeTime(timeOfDay));
    view.setFloat64(5, Number.isFinite(serverTimeMs) ? serverTimeMs : Date.now());

    return buffer;
  }

  /**
   * Decodes time-of-day sync.
   */
  public static decodeTimeSync(buffer: ArrayBuffer | ArrayBufferView): { timeOfDay: number; serverTimeMs: number } {
    const view = this.toDataView(buffer);
    if (view.byteLength < this.LEGACY_TIME_SYNC_BYTES) {
      throw new Error(`TimeSync packet too small: ${view.byteLength}`);
    }

    return {
      timeOfDay: this.normalizeTime(view.getFloat32(1)),
      serverTimeMs: view.byteLength >= this.TIME_SYNC_BYTES ? view.getFloat64(5) : 0
    };
  }

  /**
   * Tiny server snapshot used when a client first joins or clicks refresh servers.
   * Currently includes time only, but it reserves a protocol point for extending
   * world/player snapshots later without breaking old packet handlers.
   */
  public static encodeServerSnapshot(timeOfDay: number, serverTimeMs: number = Date.now()): ArrayBuffer {
    const buffer = new ArrayBuffer(this.SERVER_SNAPSHOT_BYTES);
    const view = new DataView(buffer);

    view.setUint8(0, PacketType.ServerSnapshot);
    view.setFloat32(1, this.normalizeTime(timeOfDay));
    view.setFloat64(5, Number.isFinite(serverTimeMs) ? serverTimeMs : Date.now());

    return buffer;
  }

  public static decodeServerSnapshot(buffer: ArrayBuffer | ArrayBufferView): { timeOfDay: number; serverTimeMs: number } {
    const view = this.toDataView(buffer);
    if (view.byteLength < this.SERVER_SNAPSHOT_BYTES) {
      throw new Error(`ServerSnapshot packet too small: ${view.byteLength}`);
    }

    return {
      timeOfDay: this.normalizeTime(view.getFloat32(1)),
      serverTimeMs: view.getFloat64(5)
    };
  }

  public static normalizeTime(timeOfDay: number): number {
    if (!Number.isFinite(timeOfDay)) return 0;
    return ((timeOfDay % 1) + 1) % 1;
  }

  public static getPacketType(buffer: ArrayBuffer | ArrayBufferView): PacketType | null {
    const view = this.toDataView(buffer);
    if (view.byteLength < 1) return null;
    return view.getUint8(0) as PacketType;
  }

  private static toDataView(buffer: ArrayBuffer | ArrayBufferView): DataView {
    if (buffer instanceof ArrayBuffer) {
      return new DataView(buffer);
    }

    // Node Buffer can be a slice into a larger ArrayBuffer, so respect offsets.
    return new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }
}
