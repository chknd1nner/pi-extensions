import { describe, expect, it } from "vitest";
import { buildGif, rgbaFill } from "./helpers.js";
import { decodeGif } from "../gif-decoder.js";

const CT4 = Uint8Array.from([
  255, 0, 0, // 1 = red
  0, 255, 0, // 2 = green
  0, 0, 255, // 3 = blue
]);
// note: index 0 is black (padding)

function solidGif(): Uint8Array {
  return buildGif({
    width: 4,
    height: 4,
    globalColorTable: Uint8Array.from([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]),
    frames: [{ pixels: new Uint8Array(16).fill(1), delay: 10 }],
    loop: 0,
  });
}

describe("decodeGif", () => {
  it("decodes a single full-canvas frame", () => {
    const anim = decodeGif(solidGif());
    expect(anim.format).toBe("gif");
    expect(anim.width).toBe(4);
    expect(anim.height).toBe(4);
    expect(anim.frames.length).toBe(1);
    expect(anim.frames[0].delayMs).toBe(100);
    expect(anim.loopCount).toBe(0);
    expect(anim.usesPartialFrames).toBe(false);
    expect(Array.from(anim.frames[0].rgba.slice(0, 4))).toEqual([255, 0, 0, 255]);
  });

  it("composites partial patches onto the previous canvas", () => {
    const gif = buildGif({
      width: 4,
      height: 4,
      globalColorTable: Uint8Array.from([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]),
      frames: [
        { pixels: new Uint8Array(16).fill(1), delay: 10 }, // all red
        { pixels: new Uint8Array(4).fill(2), x: 1, y: 1, patchW: 2, patchH: 2, delay: 10 }, // green patch
      ],
    });
    const anim = decodeGif(gif);
    expect(anim.usesPartialFrames).toBe(true);
    const f1 = anim.frames[1].rgba;
    const px = (x: number, y: number) => Array.from(f1.slice((y * 4 + x) * 4, (y * 4 + x) * 4 + 4));
    expect(px(0, 0)).toEqual([255, 0, 0, 255]); // red survives
    expect(px(1, 1)).toEqual([0, 255, 0, 255]); // patch drawn
    expect(px(2, 2)).toEqual([0, 255, 0, 255]);
  });

  it("disposal method 2 restores the canvas under the patch for the next frame", () => {
    const gif = buildGif({
      width: 4,
      height: 4,
      globalColorTable: Uint8Array.from([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]),
      frames: [
        { pixels: new Uint8Array(16).fill(1), delay: 10 }, // all red
        { pixels: new Uint8Array(4).fill(2), x: 1, y: 1, patchW: 2, patchH: 2, delay: 10, disposal: 2 },
        { pixels: new Uint8Array(1).fill(3), x: 2, y: 2, patchW: 1, patchH: 1, delay: 10 },
      ],
    });
    const anim = decodeGif(gif);
    const f2 = anim.frames[2].rgba;
    const px = (x: number, y: number) => Array.from(f2.slice((y * 4 + x) * 4, (y * 4 + x) * 4 + 4));
    expect(px(1, 1)).toEqual([255, 0, 0, 255]); // green patch was restored away
    expect(px(2, 2)).toEqual([0, 0, 255, 255]); // new patch visible
  });

  it("disposal method 3 clears the patch region to transparent for the next frame", () => {
    const gif = buildGif({
      width: 4,
      height: 4,
      globalColorTable: Uint8Array.from([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]),
      frames: [
        { pixels: new Uint8Array(16).fill(1), delay: 10 },
        { pixels: new Uint8Array(4).fill(2), x: 1, y: 1, patchW: 2, patchH: 2, delay: 10, disposal: 3 },
        { pixels: new Uint8Array(16).fill(0), delay: 10, transparentIndex: 0 }, // paints nothing new
      ],
    });
    const anim = decodeGif(gif);
    const f2 = anim.frames[2].rgba;
    const px = (x: number, y: number) => Array.from(f2.slice((y * 4 + x) * 4, (y * 4 + x) * 4 + 4));
    expect(px(1, 1)).toEqual([0, 0, 0, 0]); // cleared by disposal 3
    expect(px(0, 0)).toEqual([255, 0, 0, 255]); // untouched red remains
  });

  it("honors the transparent index", () => {
    const gif = buildGif({
      width: 2,
      height: 2,
      globalColorTable: Uint8Array.from([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]),
      frames: [{ pixels: Uint8Array.from([1, 0, 0, 1]), transparentIndex: 0, delay: 10 }],
    });
    const anim = decodeGif(gif);
    const f0 = anim.frames[0].rgba;
    expect(Array.from(f0.slice(0, 4))).toEqual([255, 0, 0, 255]);
    expect(Array.from(f0.slice(4, 8))).toEqual([0, 0, 0, 0]);
  });

  it("reports loop count from the NETSCAPE2.0 block and undefined when absent", () => {
    const withLoop = decodeGif(solidGif());
    expect(withLoop.loopCount).toBe(0);
    const noLoop = decodeGif(
      buildGif({
        width: 2,
        height: 2,
        globalColorTable: Uint8Array.from([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]),
        frames: [{ pixels: new Uint8Array(4).fill(1) }],
      }),
    );
    expect(noLoop.loopCount).toBeUndefined();
  });

  it("rejects non-GIF bytes with a clear error", () => {
    expect(() => {
      decodeGif(rgbaFill(1, 1, [0, 0, 0, 0]));
    }).toThrow(/not a GIF/i);
  });
});
