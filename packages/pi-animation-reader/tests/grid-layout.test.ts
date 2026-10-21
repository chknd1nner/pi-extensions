import { describe, expect, it } from "vitest";
import { defaultCellWidth, gridLayout, resolveGridShape } from "../grid.js";

describe("resolveGridShape", () => {
  it("defaults to 8 columns with rows derived from the frame count", () => {
    expect(resolveGridShape(46, { maxFrames: 46 })).toEqual({ cols: 8, rows: 6, count: 46, limitedBy: null });
  });

  it("caps the frame count when max_rows cannot hold them all", () => {
    expect(resolveGridShape(46, { maxFrames: 46, maxRows: 3 })).toEqual({
      cols: 8,
      rows: 3,
      count: 24,
      limitedBy: "max_rows",
    });
  });

  it("narrows the grid without dropping frames when only columns is set", () => {
    expect(resolveGridShape(46, { maxFrames: 46, columns: 4 })).toEqual({ cols: 4, rows: 12, count: 46, limitedBy: null });
  });

  it("applies both bounds together", () => {
    expect(resolveGridShape(46, { maxFrames: 46, columns: 4, maxRows: 3 })).toEqual({
      cols: 4,
      rows: 3,
      count: 12,
      limitedBy: "max_rows",
    });
  });

  it("reports max_frames as the binding limit when it is tighter than the shape", () => {
    expect(resolveGridShape(46, { maxFrames: 10, maxRows: 3 })).toEqual({ cols: 8, rows: 2, count: 10, limitedBy: "max_frames" });
  });

  it("clamps an oversized column request", () => {
    const s = resolveGridShape(46, { maxFrames: 46, columns: 20 });
    expect(s.cols).toBe(16);
    expect(s.rows).toBe(3);
    expect(s.count).toBe(46);
  });

  it("never asks for more columns than there are frames", () => {
    expect(resolveGridShape(3, { maxFrames: 46, columns: 8 })).toEqual({ cols: 3, rows: 1, count: 3, limitedBy: null });
  });
});

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
