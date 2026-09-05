import { describe, expect, it, vi } from "vitest";
import { History } from "./history.js";

describe("History", () => {
  it("applies the mutation as it records it", () => {
    const history = new History();
    let value = 0;
    history.perform("Set", () => { value = 0; }, () => { value = 5; });
    expect(value).toBe(5);
    expect(history.canUndo).toBe(true);
    expect(history.nextUndoLabel).toBe("Set");
  });

  it("walks backward and forward through separate edits", () => {
    const history = new History();
    const log: string[] = [];
    history.perform("A", () => log.push("-A"), () => log.push("+A"));
    history.perform("B", () => log.push("-B"), () => log.push("+B"));
    expect(history.undo()).toBe("B");
    expect(history.undo()).toBe("A");
    expect(history.undo()).toBeUndefined();
    expect(history.redo()).toBe("A");
    expect(log).toEqual(["+A", "+B", "-B", "-A", "+A"]);
  });

  it("folds a continuous gesture into one undo step", () => {
    const history = new History();
    let value = 0;
    const start = value;
    for (const step of [1, 2, 3, 4]) {
      history.perform("Move", () => { value = start; }, () => { value = step; }, "move:cube");
    }
    expect(value).toBe(4);
    expect(history.depth).toBe(1);
    expect(history.undo()).toBe("Move");
    expect(value).toBe(0);
    // Redo restores the end of the gesture, not an intermediate frame.
    history.redo();
    expect(value).toBe(4);
  });

  it("starts a new entry once the gesture ends", () => {
    const history = new History();
    history.perform("Move", () => {}, () => {}, "move:cube");
    history.endGesture();
    history.perform("Move", () => {}, () => {}, "move:cube");
    expect(history.depth).toBe(2);
  });

  it("starts a new entry when a different thing is edited", () => {
    const history = new History();
    history.perform("Move", () => {}, () => {}, "move:cube");
    history.perform("Move", () => {}, () => {}, "move:sphere");
    expect(history.depth).toBe(2);
  });

  it("drops the redo branch when new work is done", () => {
    const history = new History();
    history.perform("A", () => {}, () => {});
    history.undo();
    expect(history.canRedo).toBe(true);
    history.perform("B", () => {}, () => {});
    expect(history.canRedo).toBe(false);
    expect(history.nextUndoLabel).toBe("B");
  });

  it("closes an open gesture before undoing, so one press is enough", () => {
    const history = new History();
    let value = 0;
    history.perform("Move", () => { value = 0; }, () => { value = 9; }, "move:cube");
    history.undo();
    expect(value).toBe(0);
    // A later edit with the same key must not reopen the undone group.
    history.perform("Move", () => { value = 0; }, () => { value = 3; }, "move:cube");
    expect(history.depth).toBe(1);
  });

  it("discards the oldest entries beyond its limit", () => {
    const history = new History(3);
    for (const label of ["A", "B", "C", "D"]) history.perform(label, () => {}, () => {});
    expect(history.depth).toBe(3);
    history.undo(); history.undo(); history.undo();
    expect(history.canUndo).toBe(false);
    expect(history.nextRedoLabel).toBe("B");
  });

  it("announces every change so the UI can enable its buttons", () => {
    const history = new History();
    const listener = vi.fn();
    history.addEventListener("change", listener);
    history.perform("A", () => {}, () => {});
    history.undo();
    history.redo();
    history.clear();
    expect(listener).toHaveBeenCalledTimes(4);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });

  it("rejects a nonsensical limit instead of silently misbehaving", () => {
    expect(() => new History(0)).toThrow(/positive integer/);
  });
});
