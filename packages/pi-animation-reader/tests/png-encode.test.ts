import { describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import { encodePng } from "../png-encode.js";
import { crc32 } from "./helpers.js";

function chunks(buf: Uint8Array): Array<{ type: string; data: Uint8Array }> {
  const out: Array<{ type: string; data: Uint8Array }> = [];
  let i = 8; // signature
  while (i < buf.length) {
    const len = (buf[i] << 24) | (buf[i + 1] << 16) | (buf[i + 2] << 8) | buf[i + 3];
    const type = String.fromCharCode(...buf.slice(i + 4, i + 8));
    const data = buf.slice(i + 8, i + 8 + len);
    const crc = ((buf[i + 8 + len] << 24) | (buf[i + 8 + len + 1] << 16) | (buf[i + 8 + len + 2] << 8) | buf[i + 8 + len + 3]) >>> 0;
    expect(crc, `CRC of ${type}`).toBe(crc32(buf.slice(i + 4, i + 8 + len)));
    out.push({ type, data });
    i += 12 + len;
  }
  return out;
}

describe("encodePng", () => {
  it("writes a valid signature, IHDR, IDAT, IEND with correct CRCs", () => {
    const rgba = new Uint8Array(2 * 2 * 4);
    const png = encodePng(2, 2, rgba);
    expect(Array.from(png.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const cs = chunks(png);
    expect(cs.map((c) => c.type)).toEqual(["IHDR", "IDAT", "IEND"]);
    expect(cs[0].data.length).toBe(13);
    expect(cs[0].data[8]).toBe(8); // bit depth
    expect(cs[0].data[9]).toBe(6); // color type RGBA
  });

  it("IDAT inflates to filter-0 scanlines that round-trip the pixels", () => {
    const w = 3;
    const h = 2;
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 7) & 0xff;
    const cs = chunks(encodePng(w, h, rgba));
    const raw = inflateSync(cs[1].data);
    expect(raw.length).toBe(h * (1 + w * 4));
    for (let y = 0; y < h; y++) {
      expect(raw[y * (1 + w * 4)]).toBe(0);
      expect(Array.from(raw.slice(y * (1 + w * 4) + 1, (y + 1) * (1 + w * 4)))).toEqual(
        Array.from(rgba.slice(y * w * 4, (y + 1) * w * 4)),
      );
    }
  });

  it("encodes a uniform image smaller than the raw data (deflate works)", () => {
    const rgba = new Uint8Array(64 * 64 * 4).fill(3);
    expect(encodePng(64, 64, rgba).length).toBeLessThan(rgba.length);
  });
});
