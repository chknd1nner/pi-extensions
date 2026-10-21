import { inflateSync } from "node:zlib";
import type { AnimationFrame, DecodedAnimation } from "./types.js";

/**
 * APNG decoder (and static-PNG fallback). Supports bit depth 8/16 (16 downsampled),
 * color types 0/2/3/6, non-interlaced only. fcTL dispose_op/blend_op resolved onto a
 * full canvas, mirroring the GIF compositor's contract.
 */

class ChunkReader {
  chunks: Array<{ type: string; data: Uint8Array }> = [];

  constructor(data: Uint8Array) {
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    for (let i = 0; i < 8; i++) {
      if (data[i] !== sig[i]) throw new Error("not a PNG (bad signature)");
    }
    let i = 8;
    while (i + 8 <= data.length) {
      const len = ((data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | data[i + 3]) >>> 0;
      const type = String.fromCharCode(...data.slice(i + 4, i + 8));
      const chunkData = data.slice(i + 8, i + 8 + len);
      this.chunks.push({ type, data: chunkData });
      i += 12 + len;
      if (type === "IEND") break;
    }
  }
}

function u32(d: Uint8Array, o: number): number {
  return ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0;
}

interface ImageDesc {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlace: number;
}

function readIhdr(d: Uint8Array): ImageDesc {
  return { width: u32(d, 0), height: u32(d, 4), bitDepth: d[8], colorType: d[9], interlace: d[12] };
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 6: 4 };

/** Decode one image (IHDR + PLTE/tRNS + IDAT) to RGBA8888. Filter 0-4 unapplied per PNG spec. */
function decodeImage(desc: ImageDesc, idat: Uint8Array, plte?: Uint8Array, trns?: Uint8Array): Uint8Array {
  if (desc.interlace !== 0) throw new Error("interlaced images are not supported");
  if (!(desc.bitDepth === 8 || desc.bitDepth === 16)) {
    throw new Error(`bit depth ${desc.bitDepth} is not supported (8/16 only)`);
  }
  const channels = CHANNELS[desc.colorType];
  if (!channels) throw new Error(`color type ${desc.colorType} is not supported`);

  const raw = inflateSync(idat);
  const bitPerSample = desc.bitDepth;
  const strideBits = desc.width * channels * bitPerSample;
  const stride = Math.floor(strideBits / 8);
  const expected = desc.height * (1 + stride);
  if (raw.length < expected) throw new Error("truncated image data");

  const bpp = Math.max(1, Math.floor((channels * bitPerSample) / 8)); // bytes per whole pixel
  const getPixelByte = (x: number): number => Math.floor((x * channels * bitPerSample) / 8);

  const out = new Uint8Array(desc.width * desc.height * 4);

  const sampleAt = (line: Uint8Array, x: number, c: number): number => {
    const bitOff = (x * channels + c) * bitPerSample;
    const byte = line[Math.floor(bitOff / 8)];
    if (bitPerSample === 8) return byte;
    if (bitPerSample === 16) {
      const lo = line[Math.floor(bitOff / 8) + 1];
      return ((byte << 8) | lo) >> 8; // downsample 16 -> 8 (high byte)
    }
    // bit-packed sub-byte samples (color type 0/3 at depth 1/2/4)
    const within = bitOff % 8;
    const mask = (1 << bitPerSample) - 1;
    return ((byte >> (8 - bitPerSample - within)) & mask) * (255 / ((1 << bitPerSample) - 1));
  };

  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);

  const paeth = (a: number, b: number, c: number): number => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };

  for (let y = 0; y < desc.height; y++) {
    const filter = raw[y * (1 + stride)];
    const src = raw.subarray(y * (1 + stride) + 1, (y + 1) * (1 + stride));
    for (let i = 0; i < stride; i++) {
      const v = src[i];
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let value: number;
      switch (filter) {
        case 0: value = v; break;
        case 1: value = v + a; break;
        case 2: value = v + b; break;
        case 3: value = v + ((a + b) >> 1); break;
        case 4: value = v + paeth(a, b, c); break;
        default: throw new Error(`unknown PNG filter ${filter}`);
      }
      cur[i] = value & 0xff;
    }

    for (let x = 0; x < desc.width; x++) {
      let r = 0, g = 0, b = 0, a = 255;
      if (desc.colorType === 6) {
        r = sampleAt(cur, x, 0);
        g = sampleAt(cur, x, 1);
        b = sampleAt(cur, x, 2);
        a = sampleAt(cur, x, 3);
      } else if (desc.colorType === 2) {
        r = sampleAt(cur, x, 0);
        g = sampleAt(cur, x, 1);
        b = sampleAt(cur, x, 2);
        if (trns && trns.length >= 6) {
          const tr = (trns[0] << 8) | trns[1];
          const tg = (trns[2] << 8) | trns[3];
          const tb = (trns[4] << 8) | trns[5];
          const scale = desc.bitDepth === 16 ? 256 : 1;
          if (r * scale === tr && g * scale === tg && b * scale === tb) a = 0;
        }
      } else if (desc.colorType === 0) {
        r = g = b = sampleAt(cur, x, 0);
        if (trns && trns.length >= 2) {
          const t = (trns[0] << 8) | trns[1];
          if (r * (desc.bitDepth === 16 ? 256 : 1) === t) a = 0;
        }
      } else if (desc.colorType === 3) {
        const idx = sampleAt(cur, x, 0);
        if (plte) {
          r = plte[idx * 3] ?? 0;
          g = plte[idx * 3 + 1] ?? 0;
          b = plte[idx * 3 + 2] ?? 0;
        }
        if (trns && idx < trns.length) a = trns[idx];
      }
      void getPixelByte;
      const o = (y * desc.width + x) * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = a;
    }
    prev.set(cur);
  }
  return out;
}

interface Fctl {
  width: number;
  height: number;
  x: number;
  y: number;
  delayMs: number;
  disposeOp: number;
  blendOp: number;
}

interface FramePart {
  fctl?: Fctl;
  image?: { desc: ImageDesc; idat: Uint8Array };
}

/**
 * Walk chunks in order and group them into frame parts. A frame is its fcTL (optional for the
 * default image) plus every IDAT that follows it until the next fcTL — real encoders split large
 * frames across several IDAT chunks. Frame images inherit the canvas IHDR's pixel format; their
 * dimensions come from fcTL.
 */
function collectParts(chunks: Array<{ type: string; data: Uint8Array }>, canvasDesc: ImageDesc): FramePart[] {
  const parts: FramePart[] = [];
  let pending: Fctl | null = null;
  let idats: Uint8Array[] = [];

  const flush = () => {
    if (idats.length === 0) return;
    const total = idats.reduce((n, c) => n + c.length, 0);
    const idat = new Uint8Array(total);
    let off = 0;
    for (const c of idats) {
      idat.set(c, off);
      off += c.length;
    }
    const desc: ImageDesc = pending
      ? {
          width: pending.width,
          height: pending.height,
          bitDepth: canvasDesc.bitDepth,
          colorType: canvasDesc.colorType,
          interlace: 0,
        }
      : canvasDesc;
    parts.push({ fctl: pending ?? undefined, image: { desc, idat } });
    idats = [];
    pending = null;
  };

  for (const c of chunks) {
    if (c.type === "fcTL") {
      flush();
      const d = c.data;
      pending = {
        width: u32(d, 4),
        height: u32(d, 8),
        x: u32(d, 12),
        y: u32(d, 16),
        delayMs: Math.round((u16(d, 20) / (u16(d, 22) || 100)) * 1000),
        disposeOp: d[24],
        blendOp: d[25],
      };
    } else if (c.type === "IDAT") {
      idats.push(c.data);
    }
  }
  flush();
  return parts;
}

/** True when a PNG carries an acTL chunk (i.e. it is an APNG, not a static image). */
export function isAnimatedPng(data: Uint8Array): boolean {
  return new ChunkReader(data).chunks.some((c) => c.type === "acTL");
}

export function decodeApng(data: Uint8Array): DecodedAnimation {
  const reader = new ChunkReader(data);
  const ihdr = reader.chunks.find((c) => c.type === "IHDR");
  if (!ihdr) throw new Error("not a PNG (missing IHDR)");
  const canvasDesc = readIhdr(ihdr.data);
  if (canvasDesc.interlace !== 0) throw new Error("interlaced PNG/APNG is not supported");

  const actl = reader.chunks.find((c) => c.type === "acTL");
  const plte = reader.chunks.find((c) => c.type === "PLTE")?.data;
  const trns = reader.chunks.find((c) => c.type === "tRNS")?.data;

  // Collect frame parts in chunk order.
  const parts = collectParts(reader.chunks, canvasDesc);
  if (parts.length === 0) {
    throw new Error("PNG has no image data");
  }

  const errors: string[] = [];
  const frames: AnimationFrame[] = [];
  const canvas = new Uint8Array(canvasDesc.width * canvasDesc.height * 4);
  let backup: Uint8Array | null = null;
  let backupRect = { x: 0, y: 0, w: 0, h: 0 };
  let prevDispose = 0;
  let usesPartialFrames = false;

  const clipRect = (r: { x: number; y: number; w: number; h: number }) => {
    const x = Math.max(0, Math.min(r.x, canvasDesc.width));
    const y = Math.max(0, Math.min(r.y, canvasDesc.height));
    return {
      x,
      y,
      w: Math.max(0, Math.min(r.x + r.w, canvasDesc.width) - x),
      h: Math.max(0, Math.min(r.y + r.h, canvasDesc.height) - y),
    };
  };

  for (const part of parts) {
    if (!part.image) continue;
    const fctl = part.fctl ?? { width: canvasDesc.width, height: canvasDesc.height, x: 0, y: 0, delayMs: 0, disposeOp: 0, blendOp: 0 };

    if (prevDispose === 1 && backup) {
      for (let y = 0; y < backupRect.h; y++) {
        canvas.set(backup.subarray(y * backupRect.w * 4, (y + 1) * backupRect.w * 4), ((backupRect.y + y) * canvasDesc.width + backupRect.x) * 4);
      }
    } else if (prevDispose === 2) {
      for (let y = 0; y < backupRect.h; y++) {
        canvas.fill(0, ((backupRect.y + y) * canvasDesc.width + backupRect.x) * 4, ((backupRect.y + y) * canvasDesc.width + backupRect.x + backupRect.w) * 4);
      }
    }

    let img: Uint8Array;
    try {
      img = decodeImage(part.image.desc, part.image.idat, plte, trns);
    } catch (e) {
      errors.push(`frame ${frames.length}: ${(e as Error).message}`);
      prevDispose = 0;
      continue;
    }

    const rect = clipRect({ x: fctl.x, y: fctl.y, w: fctl.width, h: fctl.height });
    backup = new Uint8Array(rect.w * rect.h * 4);
    for (let y = 0; y < rect.h; y++) {
      backup.set(canvas.subarray(((rect.y + y) * canvasDesc.width + rect.x) * 4, ((rect.y + y) * canvasDesc.width + rect.x + rect.w) * 4), y * rect.w * 4);
    }

    for (let py = 0; py < fctl.height; py++) {
      const gy = fctl.y + py;
      if (gy < 0 || gy >= canvasDesc.height) continue;
      for (let px = 0; px < fctl.width; px++) {
        const gx = fctl.x + px;
        if (gx < 0 || gx >= canvasDesc.width) continue;
        const s = (py * fctl.width + px) * 4;
        const sr = img[s], sg = img[s + 1], sb = img[s + 2], sa = img[s + 3];
        const o = (gy * canvasDesc.width + gx) * 4;
        if (fctl.blendOp === 1) {
          canvas[o] = sr;
          canvas[o + 1] = sg;
          canvas[o + 2] = sb;
          canvas[o + 3] = sa;
        } else {
          const da = canvas[o + 3];
          // exact source-over with rounding: opaque over opaque stays exact
          const na = Math.round(sa + (da * (255 - sa)) / 255);
          if (na === 0) {
            canvas[o] = canvas[o + 1] = canvas[o + 2] = canvas[o + 3] = 0;
            continue;
          }
          const inv = (255 - sa) / 255;
          canvas[o] = Math.min(255, Math.round((sr * sa + canvas[o] * da * inv) / na));
          canvas[o + 1] = Math.min(255, Math.round((sg * sa + canvas[o + 1] * da * inv) / na));
          canvas[o + 2] = Math.min(255, Math.round((sb * sa + canvas[o + 2] * da * inv) / na));
          canvas[o + 3] = na;
        }
      }
    }

    if (fctl.x !== 0 || fctl.y !== 0 || fctl.width !== canvasDesc.width || fctl.height !== canvasDesc.height) {
      usesPartialFrames = true;
    }

    frames.push({ rgba: canvas.slice(), delayMs: fctl.delayMs });
    prevDispose = fctl.disposeOp;
    backupRect = rect;
  }

  return {
    format: "apng",
    width: canvasDesc.width,
    height: canvasDesc.height,
    frames,
    loopCount: actl ? u32(actl.data, 8) : undefined,
    usesPartialFrames,
    errors,
  };
}

function u16(d: Uint8Array, o: number): number {
  return (d[o] << 8) | d[o + 1];
}
