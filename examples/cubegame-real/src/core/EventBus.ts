type EventCallback = (...args: any[]) => void;

type ListenerRecord = {
  callbacks: Set<EventCallback>;
  onceCallbacks: Set<EventCallback>;
  emitting: boolean;
};

export class EventBus {
  private static listeners: Map<string, ListenerRecord> = new Map();

  private static getOrCreateRecord(event: string): ListenerRecord {
    let record = this.listeners.get(event);
    if (!record) {
      record = { callbacks: new Set(), onceCallbacks: new Set(), emitting: false };
      this.listeners.set(event, record);
    }
    return record;
  }

  public static on(event: string, callback: EventCallback): () => void {
    const record = this.getOrCreateRecord(event);
    record.callbacks.add(callback);
    return () => this.off(event, callback);
  }

  public static once(event: string, callback: EventCallback): () => void {
    const record = this.getOrCreateRecord(event);
    record.callbacks.add(callback);
    record.onceCallbacks.add(callback);
    return () => this.off(event, callback);
  }

  public static off(event: string, callback: EventCallback): void {
    const record = this.listeners.get(event);
    if (!record) return;

    record.callbacks.delete(callback);
    record.onceCallbacks.delete(callback);
    if (record.callbacks.size === 0) {
      this.listeners.delete(event);
    }
  }

  public static emit(event: string, ...args: any[]): void {
    const record = this.listeners.get(event);
    if (!record || record.callbacks.size === 0) return;

    // Snapshot first so listeners can safely subscribe/unsubscribe during emit
    // without skipping callbacks or throwing "set changed while iterating" bugs.
    const callbacks = Array.from(record.callbacks);
    record.emitting = true;

    for (const callback of callbacks) {
      if (!record.callbacks.has(callback)) continue;
      try {
        callback(...args);
      } catch (error) {
        console.error(`Error in event listener for ${event}:`, error);
      } finally {
        if (record.onceCallbacks.has(callback)) {
          record.callbacks.delete(callback);
          record.onceCallbacks.delete(callback);
        }
      }
    }

    record.emitting = false;
    if (record.callbacks.size === 0) {
      this.listeners.delete(event);
    }
  }

  public static listenerCount(event: string): number {
    return this.listeners.get(event)?.callbacks.size ?? 0;
  }

  public static clear(event?: string): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }
}
