import { describe, expect, it } from "vitest";
import { NarrativeRunner, TypewriterText, validateNarrativeProgram, type NarrativeProgram } from "./narrative.js";

const program: NarrativeProgram = {
  id: "chapter-one", version: 2, start: "intro", nodes: [
    { id: "intro", type: "set", variable: "affection", value: 2, next: "hello" },
    { id: "hello", type: "line", speaker: "Monika", text: { key: "hello", text: "Hello, {player}!" }, next: "choice" },
    { id: "choice", type: "choice", prompt: { text: "Stay?" }, options: [
      { id: "yes", text: { text: "Yes" }, next: "music" },
      { id: "secret", text: { text: "Secret" }, when: { variable: "affection", operator: "greater-or-equal", value: 2 }, next: "end-secret" },
    ] },
    { id: "music", type: "command", command: "audio.play", arguments: { clip: "theme" }, next: "end" },
    { id: "end", type: "end", ending: "normal" },
    { id: "end-secret", type: "end", ending: "secret" },
  ],
};

describe("NarrativeRunner", () => {
  it("resolves control nodes, localization, interpolation, choices, and commands", () => {
    const story = new NarrativeRunner(program, { variables: { player: "Ely" }, localize: () => "Bonjour, {player}!" });
    expect(story.view).toMatchObject({ type: "line", speaker: "Monika", text: "Bonjour, Ely!" });
    expect(story.advance()).toMatchObject({ type: "choice", options: [{ id: "yes" }, { id: "secret" }] });
    expect(story.choose("yes")).toMatchObject({ type: "command", command: "audio.play", arguments: { clip: "theme" } });
    expect(story.advance()).toEqual({ type: "end", nodeId: "end", ending: "normal" });
  });

  it("rejects hidden/unknown choices with available IDs", () => {
    const story = new NarrativeRunner(program);
    story.advance();
    story.setVariable("affection", 0);
    expect(() => story.choose("secret")).toThrow(/Available choices: yes/);
  });

  it("saves, restores, and rolls back variables and position", () => {
    const story = new NarrativeRunner(program, { variables: { player: "A" } });
    story.advance();
    story.choose("secret");
    const save = story.snapshot();
    expect(story.rollback()).toMatchObject({ type: "choice" });
    expect(story.restore(save)).toEqual({ type: "end", nodeId: "end-secret", ending: "secret" });
    expect(() => story.restore({ ...save, programVersion: 1 })).toThrow(/migration/);
  });

  it("detects non-presenting control-flow loops", () => {
    expect(() => new NarrativeRunner({ id: "loop", version: 1, start: "a", nodes: [{ id: "a", type: "jump", next: "b" }, { id: "b", type: "jump", next: "a" }] })).toThrow(/loops/);
  });

  it("validates references and choice IDs", () => {
    expect(() => validateNarrativeProgram({ id: "bad", version: 1, start: "missing", nodes: [{ id: "end", type: "end" }] })).toThrow(/missing/);
    expect(() => validateNarrativeProgram({ id: "bad", version: 1, start: "pick", nodes: [{ id: "pick", type: "choice", options: [] }] })).toThrow(/no options/);
  });
});

describe("TypewriterText", () => {
  it("reveals by grapheme and supports instant completion", () => {
    const text = new TypewriterText("A👩‍🚀B", 2);
    expect(text.update(0.5)).toBe("A");
    expect(text.update(0.5)).toBe("A👩‍🚀");
    expect(text.completeNow()).toBe("A👩‍🚀B");
    expect(text.complete).toBe(true);
  });
});
