import { createHash } from "node:crypto";
import type { AnimationFrame } from "./types.js";

export function frameHashes(frames: AnimationFrame[]): string[] {
  return frames.map((f) => createHash("sha256").update(f.rgba).digest("hex").slice(0, 12));
}

export interface PalindromeResult {
  detected: boolean;
  halfLength?: number;
}

/**
 * Advisory mirror detection: true when the frame sequence reads the same forwards and
 * backwards (palindrome GIFs store the reversed sequence literally — the format has no
 * ping-pong flag). Never changes how frame ranges are interpreted.
 */
export function detectPalindrome(hashes: string[]): PalindromeResult {
  if (hashes.length < 3) return { detected: false };
  for (let i = 0; i < hashes.length; i++) {
    if (hashes[i] !== hashes[hashes.length - 1 - i]) return { detected: false };
  }
  return { detected: true, halfLength: Math.ceil(hashes.length / 2) };
}

export function formatDelayRuns(delays: number[]): string {
  const runs: string[] = [];
  let start = 0;
  for (let i = 1; i <= delays.length; i++) {
    if (i === delays.length || delays[i] !== delays[start]) {
      const label = i - 1 === start ? `${start}` : `${start}-${i - 1}`;
      runs.push(`${label}: ${delays[start]}ms`);
      start = i;
    }
  }
  return runs.join(", ");
}

export interface ClampedRange {
  start: number;
  end: number;
  clamped: boolean;
}

export function clampFrameRange(start: number, end: number, frameCount: number): ClampedRange {
  const s = Math.max(0, Math.min(start, frameCount - 1));
  const e = Math.max(0, Math.min(end, frameCount - 1));
  return { start: s, end: e, clamped: s !== start || e !== end };
}

/** Uniform sampling within [start, end], always including both endpoints. */
export function sampleIndices(start: number, end: number, maxFrames: number): number[] {
  const count = end - start + 1;
  if (maxFrames >= count) {
    return Array.from({ length: count }, (_, i) => start + i);
  }
  if (maxFrames <= 1) return [start];
  const out: number[] = [];
  for (let k = 0; k < maxFrames; k++) {
    out.push(start + Math.round((k * (end - start)) / (maxFrames - 1)));
  }
  return [...new Set(out)];
}
