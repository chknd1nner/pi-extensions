export interface AnimationFrame {
  /** Canvas-sized RGBA, row-major, 4 bytes per pixel. Always a TRUE composited full frame. */
  rgba: Uint8Array;
  delayMs: number;
}

export interface DecodedAnimation {
  format: "gif" | "apng";
  width: number;
  height: number;
  frames: AnimationFrame[];
  /** NETSCAPE/APNG loop iteration count; 0 = infinite, undefined = no loop block. */
  loopCount?: number;
  /** True when frames are partial patches/blended overlays (naive per-frame extraction breaks). */
  usesPartialFrames: boolean;
  /** Non-fatal per-frame problems, e.g. "frame 7: truncated image data". */
  errors: string[];
}
