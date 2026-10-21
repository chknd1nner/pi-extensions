import type { AnimationFrame, DecodedAnimation } from "./types.js";

/**
 * GIF87a/89a decoder: parse, LZW, and full-canvas compositing (disposal methods resolved).
 * The format has not changed since 1989; see the WHATWG/Wikipedia GIF spec references.
 */

class ByteReader {
  pos = 0;
  constructor(readonly data: Uint8Array) {}
  get eof(): boolean {
    return this.pos >= this.data.length;
  }
  u8(): number {
    if (this.pos >= this.data.length) throw new Error("truncated GIF");
    return this.data[this.pos++];
  }
  u16(): number {
    const lo = this.u8();
    return lo | (this.u8() << 8);
  }
  take(n: number): Uint8Array {
    if (this.pos + n > this.data.length) throw new Error("truncated GIF");
    const s = this.data.slice(this.pos, this.pos + n);
    this.pos += n;
    return s;
  }
}

/**
 * GIF-LZW decoder. Codes are LSB-first packed; dictionary starts at 2^minCodeSize + 2
 * (clear code, then end-of-information). Handles the KwKwK case and 12-bit table resets.
 */
export function lzwDecode(stream: Uint8Array, minCodeSize: number, expectedPixels: number): Uint8Array {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  const out = new Uint8Array(Math.max(0, expectedPixels));
  let n = 0;

  let bitBuf = 0;
  let bitCount = 0;
  let sp = 0;
  const readCode = (width: number): number | null => {
    while (bitCount < width) {
      if (sp >= stream.length) return null;
      bitBuf |= stream[sp++] << bitCount;
      bitCount += 8;
    }
    const code = bitBuf & ((1 << width) - 1);
    bitBuf >>>= width;
    bitCount -= width;
    return code;
  };

  let dict: Uint8Array[] = [];
  let width = minCodeSize + 1;
  let next = 0;
  const resetTable = () => {
    dict = [];
    for (let i = 0; i < clear; i++) dict.push(Uint8Array.from([i]));
    dict.push(Uint8Array.from([])); // clear
    dict.push(Uint8Array.from([])); // eoi
    next = clear + 2;
    width = minCodeSize + 1;
  };
  resetTable();

  let prev: Uint8Array | null = null;
  for (;;) {
    const code = readCode(width);
    if (code === null) break; // stream exhausted
    if (code === eoi) break;
    if (code === clear) {
      resetTable();
      prev = null;
      continue;
    }
    let entry: Uint8Array;
    if (code < dict.length && dict[code].length > 0) {
      entry = dict[code];
    } else if (code === next && prev) {
      entry = new Uint8Array(prev.length + 1); // KwKwK
      entry.set(prev);
      entry[prev.length] = prev[0];
    } else {
      break; // corrupt code
    }
    for (let i = 0; i < entry.length && n < out.length; i++) out[n++] = entry[i];
    if (prev && next < 4096) {
      const add = new Uint8Array(prev.length + 1);
      add.set(prev);
      add[prev.length] = entry[0];
      dict.push(add);
      next++;
      if (next === (1 << width) && width < 12) width++;
    }
    prev = entry;
  }
  return out.subarray(0, n);
}

interface GifFrame {
  x: number;
  y: number;
  w: number;
  h: number;
  indices: Uint8Array;
  colorTable: Uint8Array;
  transparent: number | null;
  delayCs: number;
  disposal: number;
}

function parseGif(data: Uint8Array): { width: number; height: number; bg: number; loopCount?: number; frames: GifFrame[]; errors: string[] } {
  const magic = String.fromCharCode(...data.slice(0, 6));
  if (magic !== "GIF87a" && magic !== "GIF89a") {
    throw new Error("not a GIF (expected GIF87a/GIF89a magic bytes)");
  }
  const r = new ByteReader(data);
  r.take(6);
  const width = r.u16();
  const height = r.u16();
  const packed = r.u8();
  const bg = r.u8();
  r.u8(); // aspect ratio

  const gctSize = 2 << (packed & 7);
  const gct = packed & 0x80 ? r.take(gctSize * 3) : new Uint8Array(0);

  const frames: GifFrame[] = [];
  const errors: string[] = [];
  let loopCount: number | undefined;
  let gce: { delayCs: number; transparent: number | null; disposal: number } = {
    delayCs: 0,
    transparent: null,
    disposal: 0,
  };

  while (!r.eof) {
    const block = r.u8();
    if (block === 0x3b) break; // trailer
    if (block === 0x21) {
      const label = r.u8();
      if (label === 0xf9) {
        r.u8(); // block size (4)
        const p = r.u8();
        const delayCs = r.u16();
        const ti = r.u8();
        r.u8(); // terminator
        gce = {
          delayCs,
          transparent: p & 0x01 ? ti : null,
          disposal: (p >> 2) & 0x07,
        };
      } else {
        let sawNetscape = false;
        while (!r.eof && r.data[r.pos] !== 0) {
          const sub = r.take(r.u8()); // u8() consumes the length byte; take() reads exactly that much
          if (label === 0xff && sub.length >= 11 && String.fromCharCode(...sub.slice(0, 8)) === "NETSCAPE") {
            sawNetscape = true;
          } else if (label === 0xff && sawNetscape && sub.length === 3 && sub[0] === 0x01) {
            loopCount = sub[1] | (sub[2] << 8);
          }
        }
        if (!r.eof) r.u8(); // zero terminator
      }
    } else if (block === 0x2c) {
      const x = r.u16();
      const y = r.u16();
      const w = r.u16();
      const h = r.u16();
      const f = r.u8();
      const lct = f & 0x80 ? r.take((2 << (f & 7)) * 3) : gct;
      const interlaced = (f & 0x40) !== 0;
      if (interlaced) errors.push(`frame ${frames.length}: interlaced GIF not supported, frame skipped`);
      const minCodeSize = r.u8();
      const parts: Uint8Array[] = [];
      let total = 0;
      while (!r.eof && r.data[r.pos] !== 0) {
        const sub = r.take(r.u8());
        parts.push(sub);
        total += sub.length;
      }
      if (!r.eof) r.u8();
      if (interlaced) {
        gce = { delayCs: 0, transparent: null, disposal: 0 };
        continue;
      }
      const indices = lzwDecode(
        (() => {
          const c = new Uint8Array(total);
          let o = 0;
          for (const p of parts) {
            c.set(p, o);
            o += p.length;
          }
          return c;
        })(),
        Math.max(2, minCodeSize),
        w * h,
      );
      if (indices.length < w * h) errors.push(`frame ${frames.length}: truncated image data`);
      frames.push({
        x,
        y,
        w,
        h,
        indices,
        colorTable: lct,
        transparent: gce.transparent,
        delayCs: gce.delayCs,
        disposal: gce.disposal,
      });
      gce = { delayCs: 0, transparent: null, disposal: 0 };
    } else {
      errors.push(`unknown block type 0x${block.toString(16)} skipped`);
      while (!r.eof && r.data[r.pos] !== 0) r.take(r.u8());
      if (!r.eof) r.u8();
    }
  }

  void bg;
  return { width, height, bg, loopCount, frames, errors };
}

function colorOf(table: Uint8Array, index: number): [number, number, number] {
  const o = index * 3;
  return [table[o] ?? 0, table[o + 1] ?? 0, table[o + 2] ?? 0];
}

/** Composite parsed frames onto full RGBA canvases, resolving disposal methods. */
function composite(parsed: ReturnType<typeof parseGif>): { frames: AnimationFrame[]; usesPartialFrames: boolean } {
  const { width, height } = parsed;
  const canvas = new Uint8Array(width * height * 4);
  const out: AnimationFrame[] = [];
  let backup: Uint8Array | null = null;
  let backupRect = { x: 0, y: 0, w: 0, h: 0 };
  let prevDisposal = 0;
  let usesPartialFrames = false;

  const clip = (f: { x: number; y: number; w: number; h: number }) => ({
    x: Math.max(0, Math.min(f.x, width)),
    y: Math.max(0, Math.min(f.y, height)),
    w: Math.max(0, Math.min(f.x + f.w, width) - Math.max(0, Math.min(f.x, width))),
    h: Math.max(0, Math.min(f.y + f.h, height) - Math.max(0, Math.min(f.y, height))),
  });

  const clearRect = (rect: { x: number; y: number; w: number; h: number }) => {
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      canvas.fill(0, (y * width + rect.x) * 4, (y * width + rect.x + rect.w) * 4);
    }
  };

  for (const f of parsed.frames) {
    if (prevDisposal === 2 && backup) {
      for (let y = 0; y < backupRect.h; y++) {
        canvas.set(backup.subarray(y * backupRect.w * 4, (y + 1) * backupRect.w * 4), ((backupRect.y + y) * width + backupRect.x) * 4);
      }
    } else if (prevDisposal === 3) {
      clearRect(backupRect);
    }

    const rect = clip(f);
    backup = new Uint8Array(rect.w * rect.h * 4);
    for (let y = 0; y < rect.h; y++) {
      backup.set(canvas.subarray(((rect.y + y) * width + rect.x) * 4, ((rect.y + y) * width + rect.x + rect.w) * 4), y * rect.w * 4);
    }

    for (let py = 0; py < f.h; py++) {
      const gy = f.y + py;
      if (gy < 0 || gy >= height) continue;
      for (let px = 0; px < f.w; px++) {
        const gx = f.x + px;
        if (gx < 0 || gx >= width) continue;
        const idx = f.indices[py * f.w + px];
        if (idx === undefined) continue;
        if (f.transparent !== null && idx === f.transparent) continue;
        const [cr, cg, cb] = colorOf(f.colorTable, idx);
        const o = (gy * width + gx) * 4;
        canvas[o] = cr;
        canvas[o + 1] = cg;
        canvas[o + 2] = cb;
        canvas[o + 3] = 255;
      }
    }

    if (f.transparent !== null || f.x !== 0 || f.y !== 0 || f.w !== width || f.h !== height) {
      usesPartialFrames = true;
    }

    out.push({ rgba: canvas.slice(), delayMs: f.delayCs * 10 });
    prevDisposal = f.disposal;
    backupRect = rect;
  }

  return { frames: out, usesPartialFrames };
}

export function decodeGif(data: Uint8Array): DecodedAnimation {
  const parsed = parseGif(data);
  const { frames, usesPartialFrames } = composite(parsed);
  return {
    format: "gif",
    width: parsed.width,
    height: parsed.height,
    frames,
    loopCount: parsed.loopCount,
    usesPartialFrames,
    errors: parsed.errors,
  };
}
