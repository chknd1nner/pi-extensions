import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApng, apngFrameData, buildGif, buildPng, splitRows } from "./helpers.js";
import { animationFrames, animationGrid, animationInfo } from "../tools.js";
import type { FramesDetails, GridDetails, InfoDetails, ToolOutput } from "../tools.js";

const dir = mkdtempSync(join(tmpdir(), "pi-animation-reader-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function writeFixture(name: string, bytes: Uint8Array): string {
  const p = join(dir, name);
  writeFileSync(p, bytes);
  return p;
}

const textOf = (r: ToolOutput): string =>
  (r.content.find((c) => c.type === "text") as { type: "text"; text: string } | undefined)?.text ?? "";

const gifBytes = buildGif({
  width: 4,
  height: 4,
  globalColorTable: Uint8Array.from([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]),
  frames: [
    { pixels: new Uint8Array(16).fill(1), delay: 10 },
    { pixels: new Uint8Array(16).fill(2), delay: 10 },
    { pixels: new Uint8Array(16).fill(1), delay: 10 },
  ],
  loop: 0,
});

describe("animation_info tool", () => {
  it("reports format, frames, delays, loop, duration, and palindrome", () => {
    const r = animationInfo({ path: writeFixture("anim.gif", gifBytes) });
    expect(r.isError).toBeUndefined();
    expect((r.details as InfoDetails).frames).toBe(3);
    const text = textOf(r);
    expect(text).toMatch(/format:\s*gif/);
    expect(text).toMatch(/frames:\s*3/);
    expect(text).toMatch(/loop:\s*infinite/);
    expect(text).toMatch(/duration:\s*300ms/);
    expect(text).toMatch(/palindrome:\s*yes/i);
    expect(text).toMatch(/palindrome:\s*yes, mirror \(/);
    expect(text).toMatch(/\(2 unique frames/);
  });

  it("detects a seamless (cyclic) boomerang end to end", () => {
    // a b c d c b: the reverse pass is stored with the seam frame dropped, so the frame
    // list is not a palindrome even though the loop is an out-and-back.
    const cyclic = buildGif({
      width: 4,
      height: 4,
      globalColorTable: Uint8Array.from([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]),
      frames: [0, 1, 2, 3, 2, 1].map((p) => ({
        pixels: new Uint8Array(16).fill(p),
        delay: 10,
      })),
      loop: 0,
    });
    const r = animationInfo({ path: writeFixture("cyclic.gif", cyclic) });
    expect(r.isError).toBeUndefined();
    expect((r.details as InfoDetails).frames).toBe(6);
    const text = textOf(r);
    expect(text).toMatch(/palindrome:\s*yes, cyclic \(/);
    // 6 frames, 4 unique: both pivots (0 and n/2) are stored once.
    expect(text).toMatch(/\(4 unique frames/);
    expect(text).toMatch(/analyze 0-3/);
    expect(text).toMatch(/replays them in reverse/);
  });

  it("rejects a static PNG with a helpful message", () => {
    const rows = splitRows(new Uint8Array(2 * 2 * 4), 2);
    const p = writeFixture("static.png", buildPng({ width: 2, height: 2, bitDepth: 8, colorType: 6, scanlines: rows }));
    const r = animationInfo({ path: p });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/GIF/i);
    expect(textOf(r)).toMatch(/APNG/i);
  });

  it("reports a missing file with the resolved path", () => {
    const r = animationInfo({ path: join(dir, "nope.gif") });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("nope.gif");
  });
});

describe("animation_grid tool", () => {
  it("returns one PNG image block and a text line naming the sampled frames", () => {
    const r = animationGrid({ path: writeFixture("grid.gif", gifBytes), start: 0, end: 2 });
    const images = r.content.filter((c) => c.type === "image");
    const png = images[0] as { type: "image"; data: string; mimeType: string };
    expect(images.length).toBe(1);
    expect(png.mimeType).toBe("image/png");
    expect(Buffer.from(png.data, "base64").slice(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(textOf(r)).toMatch(/frames 0-2/i);
  });

  it("samples uniformly when the range exceeds max_frames", () => {
    const r = animationGrid({ path: join(dir, "grid.gif"), start: 0, end: 2, max_frames: 2 });
    expect((r.details as GridDetails).indices).toEqual([0, 2]);
  });

  it("reports sparse SOURCE patches that were composited as overlays", () => {
    const solid = new Uint8Array(4 * 4 * 4);
    for (let i = 0; i < 16; i++) solid.set([255, 0, 0, 255], i * 4);
    const sparse = new Uint8Array(4 * 4 * 4);
    sparse.set([0, 0, 255, 255], 0);
    const apng = buildApng({
      width: 4,
      height: 4,
      numFrames: 2,
      numPlays: 0,
      frames: [
        { x: 0, y: 0, width: 4, height: 4, delayNum: 1, delayDen: 100, data: apngFrameData(4, 4, solid) },
        { x: 0, y: 0, width: 4, height: 4, delayNum: 1, delayDen: 100, blendOp: 1, data: apngFrameData(4, 4, sparse) },
      ],
    });
    const r = animationInfo({ path: writeFixture("lenient.apng", apng) });
    expect(textOf(r)).toContain("sparse SOURCE patches: 1 (composited as overlay, not replacement)");
  });

  it("sizes default cells from the canvas aspect ratio", () => {
    const wide = buildGif({
      width: 32,
      height: 18,
      globalColorTable: Uint8Array.from([0, 0, 0, 255, 255, 255, 0, 255, 0, 0, 255, 255]),
      frames: [
        { pixels: new Uint8Array(32 * 18).fill(1), delay: 10 },
        { pixels: new Uint8Array(32 * 18).fill(2), delay: 10 },
      ],
      loop: 0,
    });
    const r = animationGrid({ path: writeFixture("wide.gif", wide), start: 0, end: 1 });
    expect((r.details as GridDetails).cellWidth).toBe(240);
    // an explicit cell_width still wins
    const fixed = animationGrid({ path: join(dir, "wide.gif"), start: 0, end: 1, cell_width: 100 });
    expect((fixed.details as GridDetails).cellWidth).toBe(100);
  });

  it("honours columns and max_rows as bounds and reports the layout", () => {
    const many = buildGif({
      width: 4,
      height: 4,
      globalColorTable: Uint8Array.from([0, 0, 0, 255, 255, 255, 0, 255, 0, 0, 255, 255]),
      frames: Array.from({ length: 12 }, (_, i) => ({ pixels: new Uint8Array(16).fill((i % 3) + 1), delay: 10 })),
      loop: 0,
    });
    const p = writeFixture("many.gif", many);
    const r = animationGrid({ path: p, start: 0, end: 11, max_frames: 12, columns: 3, max_rows: 2 });
    const d = r.details as GridDetails;
    expect([d.cols, d.rows]).toEqual([3, 2]);
    expect(d.indices).toEqual([0, 2, 4, 7, 9, 11]); // uniform over 12, both endpoints pinned
    expect(textOf(r)).toContain("3x2");
    expect(textOf(r)).toContain("limited by columns x max_rows");
    // only one bound set -> only that bound is named (max_rows: 1 gives capacity 8 < 12 frames)
    const oneBound = animationGrid({ path: p, start: 0, end: 11, max_frames: 12, max_rows: 1 });
    expect(textOf(oneBound)).toContain("limited by max_rows");
    expect(textOf(oneBound)).not.toContain("columns x max_rows");
    // columns alone reshapes without dropping frames
    const wide = animationGrid({ path: p, start: 0, end: 11, max_frames: 12, columns: 4 });
    expect([wide.details as GridDetails].map((x) => [x.cols, x.rows])).toEqual([[4, 3]]);
  });

  it("clamps out-of-range requests and notes it", () => {
    const r = animationGrid({ path: join(dir, "grid.gif"), start: 0, end: 99 });
    expect((r.details as GridDetails).clamped).toBe(true);
    expect(textOf(r)).toMatch(/clamped/i);
  });

  it("rejects start greater than end", () => {
    const r = animationGrid({ path: join(dir, "grid.gif"), start: 5, end: 1 });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/greater than/i);
  });
});

describe("animation_frames tool", () => {
  it("writes full-resolution PNGs named by physical frame index", () => {
    const r = animationFrames({ path: join(dir, "grid.gif"), start: 0, end: 2 });
    const d = r.details as FramesDetails;
    const files = readdirSync(d.dir!).sort();
    expect(files).toEqual(["frame_0.png", "frame_1.png", "frame_2.png"]);
    const first = readFileSync(join(d.dir!, "frame_0.png"));
    expect(first.slice(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(textOf(r)).toContain(d.dir!);
  });

  it("returns at most 4 frames inline", () => {
    const big = buildGif({
      width: 2,
      height: 2,
      globalColorTable: Uint8Array.from([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]),
      frames: Array.from({ length: 10 }, (_, i) => ({
        pixels: Uint8Array.from([i % 4, (i + 1) % 4, (i + 2) % 4, (i + 3) % 4]),
        delay: 10,
      })),
    });
    const r = animationFrames({ path: writeFixture("big.gif", big), start: 0, end: 9, max_frames: 32 });
    expect((r.details as FramesDetails).files!.length).toBe(10);
    expect(r.content.filter((c) => c.type === "image").length).toBeLessThanOrEqual(4);
  });

  it("samples down when the range exceeds the default max_frames", () => {
    const r = animationFrames({ path: join(dir, "big.gif"), start: 0, end: 9 });
    const d = r.details as FramesDetails;
    expect(d.files!.length).toBe(8);
    expect(d.indices).toEqual([0, 1, 3, 4, 5, 6, 8, 9]);
  });
});

describe("real-world sample", () => {
  const real = "/Users/martinkuek/Desktop/Emoji.gif";
  const t = it.skipIf(!existsSync(real));
  t("decodes the real Emoji.gif (216 frames, matching ffmpeg's extraction)", () => {
    const r = animationInfo({ path: real });
    expect(r.isError).toBeUndefined();
    const text = textOf(r);
    expect(text).toMatch(/canvas: 128x128/);
    expect(text).toMatch(/frames:\s*216/);
    expect(text).toMatch(/loop:\s*infinite/);
    expect(text).toMatch(/partial frames: yes/);
  });
});
