import { describe, expect, it } from "vitest";
import { gridLayout } from "../grid.js";

describe("gridLayout", () => {
  it("caps columns at 8", () => {
    const l = gridLayout(20, { cellWidth: 100, cellHeight: 100, labelHeight: 20 });
    expect(l.cols).toBe(8);
    expect(l.rows).toBe(3);
  });

  it("computes canvas size from padding, gaps, cells, and labels", () => {
    const l = gridLayout(4, { cellWidth: 100, cellHeight: 80, labelHeight: 20 });
    expect(l.cols).toBe(4);
    expect(l.rows).toBe(1);
    expect(l.canvasWidth).toBe(l.padding * 2 + 4 * 100 + 3 * l.gap);
    expect(l.canvasHeight).toBe(l.padding * 2 + 1 * (80 + 20));
  });

  it("handles a single cell", () => {
    const l = gridLayout(1, { cellWidth: 64, cellHeight: 64, labelHeight: 12 });
    expect(l.cols).toBe(1);
    expect(l.rows).toBe(1);
  });
});
