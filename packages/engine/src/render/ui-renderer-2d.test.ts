import { describe, expect, it } from "vitest";
import { UiDocument } from "../ui/ui.js";
import { composeUi2D } from "./ui-renderer-2d.js";
import type { FontAtlas } from "../text/text-2d.js";

const panel = {
  id: "panel",
  material: "material:ui",
  textureSize: [32, 32] as const,
  rect: [0, 0, 32, 32] as const,
  border: [4, 4, 4, 4] as const,
};
const font: FontAtlas = {
  id: "font",
  material: "material:ui",
  textureSize: [32, 32],
  designSize: 10,
  lineHeight: 12,
  glyphs: [
    { character: "A", rect: [0, 0, 8, 10], advance: 8, bearing: [0, 8] },
  ],
};

describe("composeUi2D", () => {
  it("turns the same retained layout into material-batched sprite and text geometry", () => {
    const ui = new UiDocument({
      id: "root",
      role: "panel",
      style: { padding: 10 },
      children: [{ id: "dialogue", role: "button", style: { height: 40 } }],
    });
    ui.layout(200, 100);
    const batches = composeUi2D(
      ui,
      {
        dialogue: {
          background: panel,
          text: "A",
          font,
          fontSize: 10,
          textPadding: 5,
        },
      },
      [200, 100],
      10,
    );
    expect(batches).toHaveLength(1);
    expect(batches[0]?.material).toBe("material:ui");
    expect(batches[0]?.elementCount).toBe(2);
    expect(batches[0]!.mesh.indices.length).toBeGreaterThan(6);
    expect(batches[0]!.mesh.positions.every(Number.isFinite)).toBe(true);
    const zValues = [...batches[0]!.mesh.positions].filter(
      (_value, index) => index % 3 === 2,
    );
    expect(Math.max(...zValues)).toBeGreaterThan(Math.min(...zValues));
  });

  it("names a UI node that has text without a font", () => {
    const ui = new UiDocument({ id: "root", role: "panel" });
    ui.layout(100, 100);
    expect(() =>
      composeUi2D(ui, { root: { text: "broken" } }, [100, 100]),
    ).toThrow(/root.*font/);
  });
});
