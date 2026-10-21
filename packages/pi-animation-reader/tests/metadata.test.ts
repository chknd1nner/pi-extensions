import { describe, expect, it } from "vitest";
import { clampFrameRange, detectPalindrome, formatDelayRuns, sampleIndices } from "../metadata.js";

describe("detectPalindrome", () => {
  it("detects a mirrored hash sequence", () => {
    expect(detectPalindrome(["a", "b", "c", "b", "a"])).toEqual({ detected: true, halfLength: 3 });
  });

  it("detects an even mirror", () => {
    expect(detectPalindrome(["a", "b", "b", "a"])).toEqual({ detected: true, halfLength: 2 });
  });

  it("rejects a non-mirrored sequence", () => {
    expect(detectPalindrome(["a", "b", "c", "d"])).toEqual({ detected: false });
  });

  it("rejects sequences shorter than 3 (nothing to mirror)", () => {
    expect(detectPalindrome(["a", "a"])).toEqual({ detected: false });
    expect(detectPalindrome([])).toEqual({ detected: false });
  });

  it("treats all-identical frames as a palindrome", () => {
    expect(detectPalindrome(["a", "a", "a", "a"])).toEqual({ detected: true, halfLength: 2 });
  });
});

describe("formatDelayRuns", () => {
  it("collapses runs of identical delays", () => {
    expect(formatDelayRuns([100, 100, 100, 50, 200, 200])).toBe("0-2: 100ms, 3: 50ms, 4-5: 200ms");
  });

  it("handles a single frame", () => {
    expect(formatDelayRuns([80])).toBe("0: 80ms");
  });
});

describe("clampFrameRange", () => {
  it("clamps out-of-range bounds and reports it", () => {
    expect(clampFrameRange(-5, 999, 10)).toEqual({ start: 0, end: 9, clamped: true });
  });

  it("leaves in-range bounds alone", () => {
    expect(clampFrameRange(2, 5, 10)).toEqual({ start: 2, end: 5, clamped: false });
  });
});

describe("sampleIndices", () => {
  it("returns every index when the range fits under max", () => {
    expect(sampleIndices(0, 4, 10)).toEqual([0, 1, 2, 3, 4]);
  });

  it("always includes start and end", () => {
    const s = sampleIndices(0, 100, 8);
    expect(s[0]).toBe(0);
    expect(s[s.length - 1]).toBe(100);
    expect(s.length).toBe(8);
  });

  it("samples monotonically increasing with roughly even spacing", () => {
    const s = sampleIndices(10, 90, 5);
    expect(s).toEqual([10, 30, 50, 70, 90]);
  });

  it("returns a single index when start equals end", () => {
    expect(sampleIndices(7, 7, 4)).toEqual([7]);
  });
});
