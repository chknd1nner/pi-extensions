import { readFileSync, statSync } from "node:fs";
import type { DecodedAnimation } from "./types.js";

interface CacheEntry {
  mtimeMs: number;
  size: number;
  animation: DecodedAnimation;
}

const CACHE_MAX = 4;
const cache = new Map<string, CacheEntry>();

/** Decode with a small per-session cache keyed by path + mtime + size. */
export function getAnimation(
  path: string,
  decode: (bytes: Uint8Array) => DecodedAnimation,
  read: (path: string) => Uint8Array = (p) => new Uint8Array(readFileSync(p)),
): DecodedAnimation {
  const st = statSync(path);
  const hit = cache.get(path);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.animation;
  const animation = decode(read(path));
  cache.set(path, { mtimeMs: st.mtimeMs, size: st.size, animation });
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value as string;
    cache.delete(oldest);
  }
  return animation;
}

export function clearAnimationCache(): void {
  cache.clear();
}
