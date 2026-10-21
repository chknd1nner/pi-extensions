import { describe, expect, it } from "vitest";
import { lzwEncode } from "./helpers.js";
import { lzwDecode } from "../gif-decoder.js";

describe("LZW", () => {
  it("round-trips a simple index stream at minCodeSize 2", () => {
    const src = Uint8Array.from([0, 0, 1, 1, 2, 2, 3, 3, 0, 1, 2, 3]);
    const encoded = lzwEncode(src, 2);
    expect(lzwDecode(encoded, 2, src.length)).toEqual(src);
  });

  it("round-trips a highly repetitive stream that grows the table past 4096", () => {
    const src = new Uint8Array(70_000).fill(1);
    const encoded = lzwEncode(src, 2);
    expect(encoded.length).toBeLessThan(src.length / 10);
    const decoded = lzwDecode(encoded, 2, src.length);
    expect(decoded.length).toBe(src.length);
    expect(decoded).toEqual(src);
  });

  it("round-trips a random stream at minCodeSize 8", () => {
    const src = new Uint8Array(5000);
    let seed = 42;
    for (let i = 0; i < src.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      src[i] = seed % 256;
    }
    const encoded = lzwEncode(src, 8);
    expect(lzwDecode(encoded, 8, src.length)).toEqual(src);
  });

  it("decodes an empty-coded stream as zero pixels without throwing", () => {
    // minCodeSize byte present, one empty sub-block: degenerate but seen in the wild
    expect(lzwDecode(Uint8Array.from([2, 0]), 2, 10)).toBeDefined();
  });
});
