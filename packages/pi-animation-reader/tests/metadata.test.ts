import { describe, expect, it } from "vitest";
import { clampFrameRange, detectPalindrome, formatDelayRuns, sampleIndices } from "../metadata.js";

describe("detectPalindrome", () => {
  it("detects a mirrored hash sequence", () => {
    expect(detectPalindrome(["a", "b", "c", "b", "a"])).toEqual({
      detected: true, kind: "mirror", halfLength: 3,
    });
  });

  it("detects an even mirror", () => {
    expect(detectPalindrome(["a", "b", "b", "a"])).toEqual({
      detected: true, kind: "mirror", halfLength: 2,
    });
  });

  it("detects a cyclic boomerang (seam frame deduped, pivot on the loop boundary)", () => {
    // a b c d c b — the list is NOT a palindrome (h[0]=a vs h[5]=b), but the cycle is.
    expect(detectPalindrome(["a", "b", "c", "d", "c", "b"])).toEqual({
      detected: true, kind: "cyclic", halfLength: 4,
    });
  });

  it("detects the minimal cyclic boomerang", () => {
    expect(detectPalindrome(["a", "b", "c", "b"])).toEqual({
      detected: true, kind: "cyclic", halfLength: 3,
    });
  });

  it("counts both pivots as unique in a cyclic boomerang", () => {
    // Real-world shape (118 frames) compressed to 12: forward pass f0..f6, then f5..f1.
    // Both pivots (f0 at the loop seam, f6 at n/2) are stored once, so 7 of 12 are unique.
    const forward = ["f0", "f1", "f2", "f3", "f4", "f5", "f6"];
    const hashes = [...forward, ...forward.slice(1, -1).reverse()];
    expect(hashes.length).toBe(12);
    expect(detectPalindrome(hashes)).toEqual({ detected: true, kind: "cyclic", halfLength: 7 });
  });

  it("rejects a cyclic near-miss", () => {
    expect(detectPalindrome(["a", "b", "c", "d", "c", "x"])).toEqual({ detected: false });
  });

  it("rejects an odd-length sequence that mirrors except at the seam", () => {
    // a b c d c — no integer self-pair at n/2, so a clean cyclic boomerang is impossible.
    expect(detectPalindrome(["a", "b", "c", "d", "c"])).toEqual({ detected: false });
  });

  it("rejects a non-mirrored sequence", () => {
    expect(detectPalindrome(["a", "b", "c", "d"])).toEqual({ detected: false });
  });

  it("rejects sequences shorter than 3 (nothing to mirror)", () => {
    expect(detectPalindrome(["a", "a"])).toEqual({ detected: false });
    expect(detectPalindrome([])).toEqual({ detected: false });
  });

  it("treats all-identical frames as a mirror (the only input matching both forms)", () => {
    // Satisfying mirror AND cyclic forces h[j] === h[j-1] for every j, so only constant
    // sequences match both; this pins the mirror-first precedence.
    expect(detectPalindrome(["a", "a", "a", "a"])).toEqual({
      detected: true, kind: "mirror", halfLength: 2,
    });
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
