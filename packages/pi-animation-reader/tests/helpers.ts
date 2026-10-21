import { deflateSync } from "node:zlib";

/** Test-only builders for GIF and PNG/APNG fixtures. Not shipped in the π manifest. */

export function crc32(data: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < data.length; i++) {
    c ^= data[i];
    for (let k = 0; k < 8; k++) {
      c = (c & 1) === 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
  }
  return ~c >>> 0;
}

export function u16le(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff];
}

export function u32be(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

export function u32le(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff];
}

export function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = Uint8Array.from([...type].map((ch) => ch.charCodeAt(0)));
  const body = new Uint8Array([...typeBytes, ...data]);
  return Uint8Array.from([...u32be(data.length), ...body, ...u32be(crc32(body))]);
}

// ---------------------------------------------------------------------------
// GIF
// ---------------------------------------------------------------------------

/**
 * Real GIF-LZW encoder (dictionary + clear codes), mirroring the decoder's code-width
 * growth exactly so round-trips are deterministic.
 */
export function lzwEncode(indices: Uint8Array, minCodeSize: number): Uint8Array {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  const out: number[] = [];
  let acc = 0;
  let nbits = 0;
  const emit = (code: number, width: number) => {
    acc |= code << nbits;
    nbits += width;
    while (nbits >= 8) {
      out.push(acc & 0xff);
      acc >>>= 8;
      nbits -= 8;
    }
  };

  let width = minCodeSize + 1;
  let next = clear + 2;
  const table = new Map<string, number>();
  const resetTable = () => {
    table.clear();
    next = clear + 2;
    width = minCodeSize + 1;
  };

  emit(clear, width);
  resetTable();

  if (indices.length === 0) {
    emit(eoi, width);
    if (nbits > 0) out.push(acc & 0xff);
    return Uint8Array.from(out);
  }

  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = `${prefix},${k}`;
    const found = table.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    emit(prefix, width);
    // Every emitted code except the final one adds a dictionary entry, matching the
    // decoder, which adds one for every code it reads after the first.
    table.set(key, next);
    next++;
    // The decoder has performed one fewer add by the time it reads this code, so the
    // encoder widens one entry later than a naive mirror (the classic GIF LZW quirk).
    if (next === (1 << width) + 1 && width < 12) {
      width++;
    } else if (next >= 4096) {
      emit(clear, width);
      resetTable();
    }
    prefix = k;
  }
  emit(prefix, width);
  emit(eoi, width);
  if (nbits > 0) out.push(acc & 0xff);
  return Uint8Array.from(out);
}

/** GIF color-table size field: 2^(field+1) entries fit the given byte length. */
function colorTableField(byteLen: number): number {
  const entries = Math.max(1, Math.ceil(byteLen / 3));
  return Math.max(0, Math.ceil(Math.log2(entries)) - 1);
}

export function subBlocks(data: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < data.length; i += 255) {
    const n = Math.min(255, data.length - i);
    out.push(n, ...data.slice(i, i + n));
  }
  out.push(0);
  return out;
}

export interface GifFrameInput {
  /** Flat palette indices, row-major, patchW*patchH. */
  pixels: Uint8Array;
  x?: number;
  y?: number;
  patchW?: number;
  patchH?: number;
  /** Centiseconds. */
  delay?: number;
  transparentIndex?: number;
  disposal?: number;
  /** When the patch has its own color table. */
  localColorTable?: Uint8Array;
}

export interface GifBuildOptions {
  width: number;
  height: number;
  globalColorTable: Uint8Array; // RGB packed, multiple of 3; padded to power of two
  frames: GifFrameInput[];
  loop?: number; // emit NETSCAPE2.0 block with this iteration count
  backgroundColorIndex?: number;
}

export function buildGif(o: GifBuildOptions): Uint8Array {
  const gctSizeField = colorTableField(o.globalColorTable.length);
  const gctBytes = 3 * (2 << gctSizeField);
  const gct = new Uint8Array(gctBytes);
  gct.set(o.globalColorTable.subarray(0, Math.min(o.globalColorTable.length, gctBytes)));

  const bytes: number[] = [..."GIF89a"].map((c) => c.charCodeAt(0));
  bytes.push(
    ...u16le(o.width),
    ...u16le(o.height),
    0x80 | gctSizeField, // global table, no color resolution, non-interlaced
    o.backgroundColorIndex ?? 0,
    0, // pixel aspect ratio
    ...gct,
  );

  if (o.loop !== undefined) {
    // Application extension: "NETSCAPE" + "2.0", then sub-block {1, loop_count}
    const app = [..."NETSCAPE", ..."2.0"].map((c) => c.charCodeAt(0));
    bytes.push(0x21, 0xff, 0x0b, ...app, 0x03, 0x01, ...u16le(o.loop), 0x00);
  }

  for (const f of o.frames) {
    const x = f.x ?? 0;
    const y = f.y ?? 0;
    const w = f.patchW ?? o.width;
    const h = f.patchH ?? o.height;
    if (f.delay !== undefined || f.transparentIndex !== undefined || (f.disposal ?? 0) !== 0) {
      const packed = ((f.disposal ?? 0) << 2) | (f.transparentIndex !== undefined ? 0x01 : 0);
      const gce = [
        0x21, 0xf9, 0x04, packed,
        ...u16le(f.delay ?? 0),
        f.transparentIndex ?? 0,
        0x00,
      ];
      bytes.push(...gce);
    }
    const lct = f.localColorTable;
    const lctSizeField = lct ? colorTableField(lct.length) : 0;
    const packed = (lct ? 0x80 | lctSizeField : 0) | 0; // non-interlaced, unsorted
    bytes.push(0x2c, ...u16le(x), ...u16le(y), ...u16le(w), ...u16le(h), packed);
    if (lct) {
      const lctBytes = 3 * (2 << lctSizeField);
      const padded = new Uint8Array(lctBytes);
      padded.set(lct.subarray(0, Math.min(lct.length, lctBytes)));
      bytes.push(...padded);
    }
    const minCodeSize = Math.max(2, lctSizeField + 1);
    const lzw = lzwEncode(f.pixels, minCodeSize);
    bytes.push(minCodeSize, ...subBlocks(lzw));
  }

  bytes.push(0x3b);
  return Uint8Array.from(bytes);
}

// ---------------------------------------------------------------------------
// PNG / APNG
// ---------------------------------------------------------------------------

export function pngChunk(type: string, data: number[] | Uint8Array): number[] {
  return [...chunk(type, Uint8Array.from(data))];
}

export interface RawImageOptions {
  width: number;
  height: number;
  bitDepth: number; // 8 or 16
  colorType: number; // 0, 2, 3, 6
  /** Raw sample values per scanline (already bit-packed for depth 16 as big-endian pairs). */
  scanlines: Uint8Array[];
}

export function imageData(raw: RawImageOptions): Uint8Array {
  const body: number[] = [];
  for (const line of raw.scanlines) {
    body.push(0, ...line); // filter type 0 (None)
  }
  return Uint8Array.from(deflateSync(Uint8Array.from(body)));
}

export function buildPng(o: RawImageOptions & { colorTable?: Uint8Array; trns?: Uint8Array }): Uint8Array {
  const bytes: number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const channels = o.colorType === 6 ? 4 : o.colorType === 2 ? 3 : 1;
  bytes.push(
    ...pngChunk("IHDR", [
      ...u32be(o.width),
      ...u32be(o.height),
      o.bitDepth,
      o.colorType,
      0, // compression
      0, // filter
      0, // interlace
    ]),
  );
  if (o.colorTable) bytes.push(...pngChunk("PLTE", [...o.colorTable]));
  if (o.trns) bytes.push(...pngChunk("tRNS", [...o.trns]));
  void channels;
  bytes.push(...pngChunk("IDAT", [...imageData(o)]));
  bytes.push(...pngChunk("IEND", []));
  return Uint8Array.from(bytes);
}

export interface ApngFrameInput {
  x: number;
  y: number;
  width: number;
  height: number;
  delayNum: number;
  delayDen: number;
  disposeOp?: number;
  blendOp?: number;
  /** Image data for this frame (its own IHDR..IEND payload without signature). */
  data: Uint8Array;
}

export function buildApng(o: {
  width: number;
  height: number;
  numFrames: number;
  numPlays?: number;
  frames: ApngFrameInput[];
}): Uint8Array {
  const bytes: number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  bytes.push(
    ...pngChunk("IHDR", [
      ...u32be(o.width),
      ...u32be(o.height),
      8, // bit depth
      6, // RGBA
      0, 0, 0,
    ]),
    ...pngChunk("acTL", [...u32be(o.numFrames), ...u32be(o.numPlays ?? 0)]),
  );
  let seq = 0;
  o.frames.forEach((f, idx) => {
    bytes.push(
      ...pngChunk("fcTL", [
        ...u32be(seq++),
        ...u32be(f.width),
        ...u32be(f.height),
        ...u32be(f.x),
        ...u32be(f.y),
        ...u16be(f.delayNum),
        ...u16be(f.delayDen),
        f.disposeOp ?? 0,
        f.blendOp ?? 0,
      ]),
    );
    if (idx === 0) {
      bytes.push(...pngChunk("IDAT", [...f.data])); // the default image
    } else {
      bytes.push(...pngChunk("fdAT", [...u32be(seq++), ...f.data]));
    }
  });
  bytes.push(...pngChunk("IEND", []));
  return Uint8Array.from(bytes);
}

/** fcTL delays are 16-bit big-endian. */
function u16be(n: number): number[] {
  return [(n >> 8) & 0xff, n & 0xff];
}

/** Build the deflate payload for one APNG frame image (RGBA 8-bit, filter 0).
 *  buildApng wraps it in IDAT for the default image and fdAT (with a sequence number) for the rest. */
export function apngFrameData(width: number, height: number, rgba: Uint8Array): Uint8Array {
  return imageData({ width, height, bitDepth: 8, colorType: 6, scanlines: splitRows(rgba, width) });
}

export function splitRows(rgba: Uint8Array, width: number): Uint8Array[] {
  const stride = width * 4;
  const rows: Uint8Array[] = [];
  for (let y = 0; y < rgba.length / stride; y++) {
    rows.push(rgba.slice(y * stride, (y + 1) * stride));
  }
  return rows;
}

export function rgbaFill(width: number, height: number, rgba: [number, number, number, number]): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    out.set(rgba, i * 4);
  }
  return out;
}
