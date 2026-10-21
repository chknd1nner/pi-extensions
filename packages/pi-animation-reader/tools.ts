import { existsSync, mkdirSync, openSync, readSync, closeSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { getAnimation } from "./cache.js";
import { decodeGif } from "./gif-decoder.js";
import { decodeApng, isAnimatedPng } from "./apng-decoder.js";
import { renderGrid } from "./grid.js";
import { clampFrameRange, detectPalindrome, formatDelayRuns, frameHashes, sampleIndices } from "./metadata.js";
import { encodePng } from "./png-encode.js";
import type { DecodedAnimation } from "./types.js";

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export interface ToolOutput {
  content: ContentBlock[];
  details?: Record<string, unknown>;
  isError?: boolean;
}

/** Typed views of `details` for callers that need them (tests, nested tools). */
export interface InfoDetails {
  frames?: number;
  error?: boolean;
}

export interface GridDetails {
  indices?: number[];
  clamped?: boolean;
  cellWidth?: number;
  error?: boolean;
}

export interface FramesDetails {
  dir?: string;
  files?: string[];
  indices?: number[];
  clamped?: boolean;
  error?: boolean;
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
const GIF_MAGIC = "GIF8";

function sniff(path: string): "gif" | "png" | "unknown" {
  const fd = openSync(path, "r");
  try {
    const head = Buffer.alloc(8);
    readSync(fd, head, 0, 8, null);
    if (head.subarray(0, 4).toString("latin1").startsWith(GIF_MAGIC)) return "gif";
    if (PNG_MAGIC.every((b, i) => head[i] === b)) return "png";
    return "unknown";
  } finally {
    closeSync(fd);
  }
}

function errorOut(text: string): ToolOutput {
  return { content: [{ type: "text", text }], details: { error: true }, isError: true };
}

function unsupported(path: string, kind: string): ToolOutput {
  return errorOut(
    `Unsupported file type (${kind}) for "${path}". ` +
      "This tool reads animated GIF (GIF87a/89a) and APNG files. " +
      "Animated WebP and video are not supported yet.",
  );
}

/** Static PNGs (no acTL) are rejected: a single-frame "animation" is better read with `read`. */
function isStaticPng(path: string): boolean {
  if (sniff(path) !== "png") return false;
  try {
    return !isAnimatedPng(new Uint8Array(readFileSync(path)));
  } catch {
    return false;
  }
}

/**
 * Shared entry for all three tools: resolve, check existence and format, decode (cached).
 * Returns either the animation or a ready-to-return error result.
 */
function loadForTool(path: string): { anim: DecodedAnimation } | { out: ToolOutput } {
  const abs = resolve(path);
  if (!existsSync(abs)) return { out: errorOut(`File not found: ${abs}`) };

  let kind: "gif" | "png" | "unknown" = "unknown";
  try {
    kind = sniff(abs);
    if (kind === "unknown") return { out: unsupported(abs, "unrecognized magic bytes") };
    if (isStaticPng(abs)) return { out: unsupported(abs, "static PNG") };
    const anim = getAnimation(abs, kind === "gif" ? decodeGif : decodeApng);
    return { anim };
  } catch (e) {
    const msg = (e as Error).message;
    if (kind === "png" && /not a PNG/i.test(msg)) return { out: unsupported(abs, "corrupt PNG") };
    return { out: errorOut(`Failed to read animation: ${msg}`) };
  }
}

function rangeError(start: number, end: number): ToolOutput {
  return errorOut(`start (${start}) is greater than end (${end})`);
}

function palLine(pal: { detected: boolean; halfLength?: number }): string {
  if (!pal.detected || pal.halfLength === undefined) return "no";
  return `yes (half: ${pal.halfLength} frames — analyze 0-${pal.halfLength - 1}, the rest mirrors it)`;
}

export function animationInfo(params: { path: string }): ToolOutput {
  const loaded = loadForTool(params.path);
  if ("out" in loaded) return loaded.out;
  const anim = loaded.anim;

  const hashes = frameHashes(anim.frames);
  const duration = anim.frames.reduce((n, f) => n + f.delayMs, 0);
  const loop = anim.loopCount === undefined ? "none" : anim.loopCount === 0 ? "infinite" : `${anim.loopCount}x`;
  const lines = [
    `file: ${resolve(params.path)}`,
    `format: ${anim.format}`,
    `canvas: ${anim.width}x${anim.height}`,
    `frames: ${anim.frames.length}`,
    `loop: ${loop}`,
    `duration: ${duration}ms`,
    `delays: ${formatDelayRuns(anim.frames.map((f) => f.delayMs))}`,
    `partial frames: ${anim.usesPartialFrames ? "yes (frames are patches/overlays; per-frame extraction needs compositing)" : "no"}`,
    `palindrome: ${palLine(detectPalindrome(hashes))}`,
    `frame hashes: ${hashes.join(" ")}`,
  ];
  if (anim.errors.length) lines.push(`warnings: ${anim.errors.join("; ")}`);
  return { content: [{ type: "text", text: lines.join("\n") }], details: { frames: anim.frames.length } };
}

export interface GridParams {
  path: string;
  start: number;
  end: number;
  max_frames?: number;
  cell_width?: number;
}

export function animationGrid(params: GridParams): ToolOutput {
  if (params.start > params.end) return rangeError(params.start, params.end);
  const loaded = loadForTool(params.path);
  if ("out" in loaded) return loaded.out;
  const anim = loaded.anim;

  const { start, end, clamped } = clampFrameRange(params.start, params.end, anim.frames.length);
  const maxFrames = Math.max(1, Math.min(64, params.max_frames ?? 16));
  const cellWidth = Math.max(32, Math.min(480, params.cell_width ?? 160));
  const indices = sampleIndices(start, end, maxFrames);
  const png = renderGrid(
    indices.map((i) => ({ rgba: anim.frames[i].rgba, index: i })),
    anim.width,
    anim.height,
    cellWidth,
  );

  const notes: string[] = [];
  if (clamped) notes.push(`range clamped to 0-${anim.frames.length - 1}`);
  if (anim.errors.length) notes.push(...anim.errors);
  const text =
    `grid of sampled frames ${indices[0]}-${indices[indices.length - 1]} ` +
    `(${indices.length} of ${end - start + 1} in range; cell ${cellWidth}px). ` +
    `Numbers under each thumbnail are physical frame indices. ` +
    `Use animation_frames with those indices to zoom. ${notes.join("; ")}`.trimEnd();

  return {
    content: [
      { type: "text", text },
      { type: "image", data: Buffer.from(png).toString("base64"), mimeType: "image/png" },
    ],
    details: { indices, clamped, cellWidth },
  };
}

export interface FramesParams {
  path: string;
  start: number;
  end: number;
  max_frames?: number;
}

export function animationFrames(params: FramesParams): ToolOutput {
  if (params.start > params.end) return rangeError(params.start, params.end);
  const loaded = loadForTool(params.path);
  if ("out" in loaded) return loaded.out;
  const anim = loaded.anim;

  const { start, end, clamped } = clampFrameRange(params.start, params.end, anim.frames.length);
  const maxFrames = Math.max(1, Math.min(32, params.max_frames ?? 8));
  const indices = sampleIndices(start, end, maxFrames);

  const outDir = join(tmpdir(), "pi-animation-reader", `${basename(resolve(params.path), extname(resolve(params.path)))}-${Date.now()}`);
  mkdirSync(outDir, { recursive: true });
  const files: string[] = [];
  const pngs = new Map<number, Uint8Array>();
  for (const i of indices) {
    const png = encodePng(anim.width, anim.height, anim.frames[i].rgba);
    pngs.set(i, png);
    const file = join(outDir, `frame_${i}.png`);
    writeFileSync(file, png);
    files.push(file);
  }

  const notes: string[] = [];
  if (clamped) notes.push(`range clamped to 0-${anim.frames.length - 1}`);
  if (anim.errors.length) notes.push(...anim.errors);
  const inlineIdx = sampleIndices(0, indices.length - 1, 4).map((k) => indices[k]);
  const text =
    `wrote ${files.length} full-resolution frame(s) (${anim.width}x${anim.height}) to ${outDir}: ` +
    `${files.map((f) => f.split("/").pop()).join(", ")}. ` +
    `${inlineIdx.length} shown inline. ${notes.join("; ")}`.trim();

  const content: ContentBlock[] = [{ type: "text", text }];
  for (const i of inlineIdx) {
    content.push({ type: "image", data: Buffer.from(pngs.get(i)!).toString("base64"), mimeType: "image/png" });
  }
  return { content, details: { dir: outDir, files, indices, clamped } };
}
