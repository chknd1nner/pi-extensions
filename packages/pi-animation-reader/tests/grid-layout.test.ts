import { describe, expect, it } from "vitest";
import { defaultCellWidth, gridLayout } from "../grid.js";

describe("defaultCellWidth", () => {
  it("keeps square canvases at the 160px floor", () => {
    expect(defaultCellWidth(220, 220)).toBe(160);
  });

  it("widens cells for wide canvases so the thumbnail keeps its short edge", () => {
    expect(defaultCellWidth(480, 270)).toBe(240); // 16:9 -> 240x135
    expect(defaultCellWidth(1280, 720)).toBe(240); // same ratio, same answer
  });

  it("does not shrink below the floor for tall canvases", () => {
    expect(defaultCellWidth(270, 480)).toBe(160);
  });

  it("caps at the 480px ceiling for extreme aspect ratios", () => {
    expect(defaultCellWidth(1000, 100)).toBe(480);
  });
});

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
