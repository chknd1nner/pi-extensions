import { createHash } from "node:crypto";
import type { AnimationFrame } from "./types.js";

export function frameHashes(frames: AnimationFrame[]): string[] {
  return frames.map((f) => createHash("sha256").update(f.rgba).digest("hex").slice(0, 12));
}

export type PalindromeKind = "mirror" | "cyclic";

export interface PalindromeResult {
  detected: boolean;
  /** Count of UNIQUE frames — the forward pass, both pivots included. */
  halfLength?: number;
  kind?: PalindromeKind;
}

/**
 * Advisory boomerang detection: true when the frame sequence replays itself in reverse.
 * GIF has no ping-pong playback flag, so an out-and-back animation stores the reversed
 * frames literally — and there are two ways authoring tools do that, both of which must
 * be recognised:
 *
 *   mirror  a b c b a     the seam frame is duplicated, so the LIST is a palindrome:
 *                         h[i] === h[n-1-i]. Looping it emits the same frame twice at the
 *                         seam (a one-frame hitch), so encoders avoid this form.
 *   cyclic  a b c d c b   the duplicated seam frame is dropped, so a pivot sits exactly on
 *                         the loop boundary and the sequence is a palindrome only AS A
 *                         CYCLE: h[i] === h[n-i] for i in 1..n-1, with pivots at 0 and n/2
 *                         each stored once. This is what modern encoders emit.
 *
 * The two forms overlap only on constant sequences (both together force h[j] === h[j-1]);
 * mirror is checked first, so those report as mirror.
 *
 * halfLength is the count of unique frames, so "analyze 0..halfLength-1" holds for both
 * kinds. Advisory only — never changes how frame ranges are interpreted.
 */
export function detectPalindrome(hashes: string[]): PalindromeResult {
  const n = hashes.length;
  if (n < 3) return { detected: false };

  if (hashes.every((h, i) => h === hashes[n - 1 - i])) {
    return { detected: true, kind: "mirror", halfLength: Math.ceil(n / 2) };
  }

  // The cyclic form needs a self-paired frame at i === n/2, so n must be even.
  if (n % 2 === 0 && hashes.every((h, i) => i === 0 || i === n / 2 || h === hashes[n - i])) {
    return { detected: true, kind: "cyclic", halfLength: n / 2 + 1 };
  }

  return { detected: false };
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
