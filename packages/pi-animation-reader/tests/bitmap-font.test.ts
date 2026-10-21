import { describe, expect, it } from "vitest";
import { drawText, glyphHeightFor, hasGlyph } from "../bitmap-font.js";

describe("bitmap-font", () => {
  it("has digits, uppercase letters, and punctuation", () => {
    for (const ch of "0123456789ABCDEF:.-x,() ") expect(hasGlyph(ch), ch).toBe(true);
  });

  it("scales glyph height with cell width, clamped to 10-24", () => {
    expect(glyphHeightFor(160)).toBe(20);
    expect(glyphHeightFor(40)).toBe(10);
    expect(glyphHeightFor(480)).toBe(24);
  });

  it("draws text into a canvas without writing outside bounds", () => {
    const w = 40;
    const h = 20;
    const rgba = new Uint8Array(w * h * 4);
    expect(() => drawText(rgba, w, h, 0, 0, "12:34", 16, [255, 255, 255])).not.toThrow();
    const lit = rgba.some((v) => v !== 0);
    expect(lit).toBe(true);
  });

  it("renders distinguishable bitmaps for different digits", () => {
    const w = 60;
    const h = 20;
    const a = new Uint8Array(w * h * 4);
    const b = new Uint8Array(w * h * 4);
    drawText(a, w, h, 0, 0, "1", 16, [255, 255, 255]);
    drawText(b, w, h, 0, 0, "8", 16, [255, 255, 255]);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });
});
