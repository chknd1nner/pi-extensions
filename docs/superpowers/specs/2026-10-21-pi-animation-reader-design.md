# pi-animation-reader — Design

Date: 2026-10-21
Status: approved by user in brainstorming session

## Problem

When Pi's `read` tool is given an animated GIF (or APNG), the vision model only sees the first
frame — the animation is silently flattened. Agents have no way to inspect motion: skim an
animation, identify which frames matter, and zoom into those frames at full resolution.

## Goal

A Pi extension exposing three tools that let an agent "read" animations the way it reads a book:
metadata first, a numbered thumbnail grid to skim, and full-resolution frame extraction to zoom.

MVP scope: **GIF87a/89a and APNG only**. Animated WebP and video (mp4/webm) are explicitly out of
scope for later versions; the tool surface should not preclude adding them.

## Key decisions (from brainstorming)

1. **Pure JS/TypeScript decoding, zero native/runtime third-party deps.** GIF LZW decoding is
   hand-rolled; APNG uses Node built-in `zlib` (PNG IDAT is deflate). Formats are frozen
   (GIF89a: 1989, APNG: 2008), so a hand-rolled decoder is tractable and fully unit-testable.
   Chosen over `sharp` (native binaries, shaky APNG) and shelling out to ffmpeg/ImageMagick
   (external binary dependency, on-disk-only results).
2. **Frame indices are the universal coordinate space.** Physical frame order in the file, 0-based.
   The numbers printed under grid thumbnails are exactly the indices accepted by the zoom tool.
3. **Range + uniform sampling.** Grid/frames tools take `start`, `end`, and `max_frames`; when the
   range holds more frames than `max_frames`, frames are sampled uniformly (always including
   `start` and `end`).
4. **Palindrome detection is heuristic via composited-frame hashing.** GIF has no ping-pong
   playback flag — palindrome GIFs physically store the reversed sequence. Since the decoder
   composites every frame anyway, content hashes are nearly free; the metadata tool detects the
   mirror pattern and reports it as advisory metadata. Never changes range interpretation.

## Architecture

New package `packages/pi-animation-reader/` following repo package conventions:

```
packages/pi-animation-reader/
  package.json          # π manifest; Pi packages in peerDependencies; keywords: ["pi-package"]
  tsconfig.json
  README.md
  CHANGELOG.md
  index.ts              # registers the three tools
  gif-decoder.ts        # GIF87a/89a parse + LZW decode + disposal-method compositing
  apng-decoder.ts       # APNG parse (acTL/fcTL) + zlib inflate + blend=0/1 compositing
  compositor.ts         # shared RGBA canvas: patch placement, disposal, blending
  png-encode.ts         # RGBA -> PNG (zlib deflate + CRC32), ~60 lines
  grid.ts               # thumbnail downscale + tiling + bitmap-font frame numbers
  metadata.ts           # info assembly: delays, loops, hashes, palindrome detection
  tests/                # vitest; fixtures: hand-built minimal GIFs/APNGs + real samples
```

Decoding pipeline (shared by all three tools):

```
file bytes -> format sniff (magic bytes) -> decoder -> [Frame { rgba, delay_ms }]
           -> compositor produces TRUE full frames (GIF partial patches + disposal
              methods resolved; APNG fcTL offsets + blend modes resolved)
```

Compositing is always full-sequence from frame 0 up to the highest requested index (GIF/APNG
patches make random access impossible); results are cached per file path + mtime for the session.

## Tools

### 1. `animation_info`

- **Input:** `path`
- **Output (text block):** format (`gif` | `apng`), canvas width/height, frame count, per-frame
  delays (runs of identical delays collapsed, e.g. `0-14: 100ms`), loop count (0 = infinite),
  total duration, `uses_partial_frames` flag, per-frame composited content hashes (short), and
  `palindrome: { detected: boolean, half_length?: number, mirror_start?: number }`.
- Palindrome detection: shortest prefix P (≥ 2 frames) such that the hash sequence reads the same
  forwards and backwards across the file. Advisory only; `detected: false` when halves differ.

### 2. `animation_grid`

- **Input:** `path`, `start`, `end`, `max_frames` (default 16, max 64), `cell_width`
  (default 160 px, max 480).
- **Behavior:** composite frames `start..end`; if count > `max_frames`, sample uniformly
  (always including `start` and `end`); downscale each selected frame to `cell_width`
  (aspect-preserving, integer dimensions); tile in a grid, max 8 columns per row; render the
  physical frame number centered beneath each cell using a built-in bitmap font drawn directly
  into the pixel canvas (survives downstream image resizing). Font glyph height scales with
  `cell_width` (cell_width / 8, clamped to 10–24 px).
- **Output:** one inline PNG image block (`{ type: "image", data, mimeType: "image/png" }`) plus a
  text line listing the physical frame indices actually shown.

### 3. `animation_frames`

- **Input:** `path`, `start`, `end`, `max_frames` (default 8, max 32; uniform sampling as above).
- **Behavior:** write full native-resolution composited PNGs to
  `<os.tmpdir()>/pi-animation-reader/<basename>-<timestamp>/frame_<index>.png` (index = physical
  frame number in the filename).
- **Output:** text block listing written paths; additionally, up to 4 frames returned inline as
  image blocks (the sampled set, uniformly thinned if larger) so a small zoom needs no follow-up
  `read`.

## Error handling

- Unsupported format (animated WebP, mp4, webm, static PNG/JPEG): clear error naming supported
  formats (GIF, APNG) and stating this file's detected format.
- Corrupt/short frame data: decode what succeeds; report failed frame indices in the result text;
  never fail the whole call for one bad frame.
- Out-of-range `start`/`end`: clamp to `[0, frame_count - 1]` and note the clamping in output.
- `start > end`: validation error.
- Missing file: error with resolved absolute path.

## Testing

- Vitest, per repo convention. Fixtures: hand-built minimal GIFs (single frame, multi-frame with
  partial patches + each disposal method, palindrome) and APNGs (blend 0/1, offset frames), plus
  real-world samples (e.g. the 15-frame Emoji.gif class of file).
- Golden tests: decoder frame counts/delays; compositor output hashes for known patch sequences;
  PNG encoder round-trip (encode -> decode -> compare); grid layout dimensions and sampling
  selection (pure function, no image comparison needed for selection logic); palindrome detector
  on synthetic hash sequences.
- Dogfood: register via `.pi/settings.json` local-path entry during development.

## Out of scope (later)

- Animated WebP, AVIF, video sources (mp4/webm) — likely via optional ffmpeg path.
- Cropping/region-of-interest extraction.
- Frame diffing / motion heatmaps.
