import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import { apngFrameData, buildApng, buildPng, pngChunk, splitRows, u32be } from "./helpers.js";
import { decodeApng } from "../apng-decoder.js";

const RED = [255, 0, 0, 255];
const BLUE50 = [0, 0, 255, 128];

function frame(w: number, h: number, rgba: number[]) {
  const px = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) px.set(rgba, i * 4);
  return px;
}

function twoFrameApng(opts?: { blendOp?: number; disposeOp?: number }) {
  return buildApng({
    width: 4,
    height: 4,
    numFrames: 2,
    numPlays: 0,
    frames: [
      {
        x: 0, y: 0, width: 4, height: 4, delayNum: 1, delayDen: 100,
        data: apngFrameData(4, 4, frame(4, 4, RED)),
      },
      {
        x: 1, y: 1, width: 2, height: 2, delayNum: 1, delayDen: 50,
        blendOp: opts?.blendOp, disposeOp: opts?.disposeOp,
        data: apngFrameData(2, 2, frame(2, 2, BLUE50)),
      },
    ],
  });
}

describe("decodeApng", () => {
  it("decodes frame count, delays, and loop count", () => {
    const anim = decodeApng(twoFrameApng());
    expect(anim.format).toBe("apng");
    expect(anim.width).toBe(4);
    expect(anim.height).toBe(4);
    expect(anim.frames.length).toBe(2);
    expect(anim.frames[0].delayMs).toBe(10);
    expect(anim.frames[1].delayMs).toBe(20);
    expect(anim.loopCount).toBe(0);
  });

  it("blend op 0 (source-over) composites the offset patch over the previous canvas", () => {
    const anim = decodeApng(twoFrameApng({ blendOp: 0 }));
    const f1 = anim.frames[1].rgba;
    const px = (x: number, y: number) => Array.from(f1.slice((y * 4 + x) * 4, (y * 4 + x) * 4 + 4));
    expect(px(0, 0)).toEqual(RED);
    // 50% blue over red ≈ (128, 0, 128, 255)
    const p = px(1, 1);
    expect(Math.abs(p[0] - 128)).toBeLessThanOrEqual(2);
    expect(p[2]).toBeGreaterThanOrEqual(126);
    expect(p[3]).toBe(255);
  });

  it("blend op 1 (on-leave) replaces the region, honoring patch alpha", () => {
    const anim = decodeApng(twoFrameApng({ blendOp: 1 }));
    const f1 = anim.frames[1].rgba;
    const px = (x: number, y: number) => Array.from(f1.slice((y * 4 + x) * 4, (y * 4 + x) * 4 + 4));
    expect(px(0, 0)).toEqual(RED);
    expect(px(1, 1)).toEqual(BLUE50); // replaced, not blended
  });

  it("dispose op 1 restores the pre-patch canvas for the next frame", () => {
    const apng = buildApng({
      width: 4,
      height: 4,
      numFrames: 3,
      frames: [
        { x: 0, y: 0, width: 4, height: 4, delayNum: 1, delayDen: 100, data: apngFrameData(4, 4, frame(4, 4, RED)) },
        {
          x: 1, y: 1, width: 2, height: 2, delayNum: 1, delayDen: 100, disposeOp: 1, blendOp: 1,
          data: apngFrameData(2, 2, frame(2, 2, [0, 255, 0, 255])),
        },
        { x: 0, y: 0, width: 4, height: 4, delayNum: 1, delayDen: 100, data: apngFrameData(4, 4, frame(4, 4, [0, 0, 0, 0])) },
      ],
    });
    const anim = decodeApng(apng);
    const f2 = anim.frames[2].rgba;
    const px = (x: number, y: number) => Array.from(f2.slice((y * 4 + x) * 4, (y * 4 + x) * 4 + 4));
    // frame 2 paints fully transparent over a canvas where the green patch was restored away:
    // source-over with alpha 0 leaves the restored red canvas intact
    expect(px(1, 1)).toEqual(RED);
  });

  it("joins a frame split across multiple IDAT chunks", () => {
    // Real encoders split a frame's IDAT stream across chunks: one deflate stream, two chunks.
    const px = frame(4, 4, RED);
    const rows: number[] = [];
    for (let y = 0; y < 4; y++) rows.push(0, ...px.slice(y * 16, y * 16 + 16));
    const deflated = deflateSync(Uint8Array.from(rows));
    const cut = Math.floor(deflated.length / 2);
    const bytes = [
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ...pngChunk("IHDR", [...u32be(4), ...u32be(4), 8, 6, 0, 0, 0]),
      ...pngChunk("acTL", [...u32be(1), ...u32be(0)]),
      ...pngChunk("fcTL", [...u32be(0), ...u32be(4), ...u32be(4), ...u32be(0), ...u32be(0), 0, 1, 0, 100, 0, 0]),
      ...pngChunk("IDAT", [...deflated.slice(0, cut)]),
      ...pngChunk("IDAT", [...deflated.slice(cut)]),
      ...pngChunk("IEND", []),
    ];
    const anim = decodeApng(Uint8Array.from(bytes));
    expect(anim.frames.length).toBe(1);
    expect(Array.from(anim.frames[0].rgba.slice(0, 4))).toEqual(RED);
  });

  it("rejects interlaced APNG with a clear error", () => {
    const ihdr = pngChunk("IHDR", [...u32be(4), ...u32be(4), 8, 6, 0, 0, 1]);
    const bytes = [
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ...ihdr,
      ...pngChunk("acTL", [...u32be(1), ...u32be(0)]),
      ...pngChunk("IEND", []),
    ];
    expect(() => decodeApng(Uint8Array.from(bytes))).toThrow(/interlac/i);
  });

  it("rejects non-PNG bytes with a clear error", () => {
    expect(() => decodeApng(Uint8Array.from([1, 2, 3, 4]))).toThrow(/not a PNG/i);
  });

  it("decodes a static RGBA PNG as a single frame", () => {
    const rows = splitRows(frame(2, 2, RED), 2);
    const png = buildPng({ width: 2, height: 2, bitDepth: 8, colorType: 6, scanlines: rows });
    const anim = decodeApng(png);
    expect(anim.frames.length).toBe(1);
    expect(Array.from(anim.frames[0].rgba.slice(0, 4))).toEqual(RED);
  });

  it("downsamples 16-bit RGBA to 8-bit", () => {
    const rows: Uint8Array[] = [];
    for (let y = 0; y < 2; y++) {
      const line = new Uint8Array(2 * 4 * 2);
      for (let x = 0; x < 2; x++) {
        const o = x * 8;
        line[o] = 0x12; line[o + 1] = 0x34; // R high/low
        line[o + 2] = 0x00; line[o + 3] = 0x00;
        line[o + 4] = 0xab; line[o + 5] = 0xcd; // B
        line[o + 6] = 0xff; line[o + 7] = 0xff; // A
      }
      rows.push(line);
    }
    const png = buildPng({ width: 2, height: 2, bitDepth: 16, colorType: 6, scanlines: rows });
    const anim = decodeApng(png);
    expect(Array.from(anim.frames[0].rgba.slice(0, 4))).toEqual([0x12, 0, 0xab, 0xff]);
  });

  it("decodes color type 2 (RGB) with tRNS index transparency", () => {
    const rows: Uint8Array[] = [];
    for (let y = 0; y < 2; y++) {
      const line = new Uint8Array(2 * 3);
      line.set([255, 0, 0], 0); // red
      line.set([0, 0, 255], 3); // blue -> transparent via tRNS
      rows.push(line);
    }
    const png = buildPng({
      width: 2, height: 2, bitDepth: 8, colorType: 2, scanlines: rows,
      trns: Uint8Array.from([0x00, 0x00, 0x00, 0x00, 0x00, 0xff]),
    });
    const anim = decodeApng(png);
    const f = anim.frames[0].rgba;
    expect(Array.from(f.slice(0, 4))).toEqual([255, 0, 0, 255]);
    // composited onto an empty canvas a transparent source pixel reads as transparent black;
    // what matters is that tRNS made it transparent at all (alpha 0, not 255)
    expect(f[7]).toBe(0);
  });
});
