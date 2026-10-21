# pi-animation-reader

Three Pi tools for **reading animated GIFs and APNGs**. Pi's built-in `read` hands an
animated file to the vision model, which decodes only the first frame — motion is silently
lost. These tools give an agent the loop it uses for any other document: inspect structure,
skim cheaply, then zoom into the part that matters.

## Tools

### `animation_info`

```
animation_info({ path })
```

Metadata as text: format, canvas size, frame count, loop count, total duration, per-frame
delays (identical runs collapsed), whether frames are partial patches, per-frame content
hashes, and a palindrome hint.

```
file: /path/Emoji.gif
format: gif
canvas: 128x128
frames: 216
loop: infinite
duration: 4320ms
delays: 0-215: 20ms
partial frames: yes (frames are patches/overlays; per-frame extraction needs compositing)
palindrome: no
frame hashes: 3f9a1c2b8d40 ...
```

**Palindrome hint.** GIF has no ping-pong playback flag, so a "breathe out, breathe in"
animation stores the reversed frame sequence literally. The decoder already composites every
frame, so hashing is nearly free and the mirror pattern can be reported:
`palindrome: yes (half: 108 frames — analyze 0-107, the rest mirrors it)`. Advisory only —
it never changes how frame ranges are interpreted.

### `animation_grid`

```
animation_grid({ path, start, end, max_frames = 16, cell_width = 160 })
```

Composites frames `start..end`, downscales to thumbnails, tiles them (max 8 columns), and
returns **one PNG** with the physical frame number rendered under each cell:

```
grid of sampled frames 0-215 (16 of 216 in range; cell 160px).
Numbers under each thumbnail are physical frame indices. Use animation_frames with those indices to zoom.
```

If the range holds more frames than `max_frames`, frames are sampled uniformly and both
endpoints are always included. Numbers are drawn with a built-in bitmap font directly into
the pixels, so they survive any downstream image resizing.

`cell_width` above the file's native resolution just upscales — for real detail use
`animation_frames`.

### `animation_frames`

```
animation_frames({ path, start, end, max_frames = 8 })
```

Writes full native-resolution composited PNGs named by physical frame index to
`<tmpdir>/pi-animation-reader/<file>-<timestamp>/`, and returns up to 4 of them inline so a
small zoom needs no follow-up `read`.

## Frame indices are the coordinate space

All three tools speak the same numbers: physical frame order in the file, 0-based. The
number under a thumbnail is exactly the number to pass to `animation_frames`. Out-of-range
bounds are clamped and the result says so.

Frames are always **composited**, never dumped raw. GIF frames are frequently partial patches
with disposal methods, and APNG frames are blended overlays — extracting them naively yields
fragments. Both formats are decoded and resolved onto a full canvas.

## Typical loop

```
animation_info(Emoji.gif)            -> 216 frames, 20ms each, no palindrome
animation_grid(0-215, max 16)        -> sees the arc: heart hugged, heart breaks, tears, heart returns
animation_grid(140-175, max 12)      -> narrows to the moment the tears start
animation_frames(158-162)            -> full-res frames to read the expression
```

## Supported formats

| Format | Status |
| --- | --- |
| GIF87a / GIF89a (incl. partial frames, disposal methods, transparency, NETSCAPE loops) | yes |
| APNG (fcTL dispose/blend, IDAT + fdAT frames, multi-chunk frames, bit depth 8/16, colour types 0/2/3/6) | yes |
| Static PNG | rejected on purpose — `read` already handles it |
| Interlaced PNG/GIF | rejected with a clear message |
| Animated WebP, AVIF, mp4/webm | not yet |

Decoding is pure TypeScript on Node built-ins: GIF LZW is hand-rolled, APNG uses `zlib`. The
formats have been frozen since 1989 and 2008, so there is nothing to chase. **No runtime
dependencies, no native binaries, no external commands.**

Decoding is cached per session keyed by path + mtime + size, so repeated grids over the same
file are cheap.

### A note on APNG disposal

Frames are resolved exactly as the APNG specification defines `dispose_op` and `blend_op`
(`SOURCE` replaces the frame rectangle, `BACKGROUND` clears it to transparent). Some encoders
emit sparse patches marked `SOURCE`, which under a strict reading blanks the canvas — players
disagree on those files: ffmpeg and Pillow both composite them as if they were `OVER`, which
is why the same file can look different in different viewers. If a grid shows an unexpectedly
blank frame, that is the file's metadata being ambiguous, not the decode losing pixels.

## Install

Local path (development):

```json
// .pi/settings.json
{ "packages": ["../packages/pi-animation-reader"] }
```

Mirror (once published):

```bash
pi install git:github.com/chknd1nner/pi-animation-reader@v0.1.0
```

## Development

```bash
npm test -w pi-animation-reader
npm run typecheck -w pi-animation-reader
```

Tests build GIF and APNG fixtures byte-by-byte (`tests/helpers.ts`) rather than committing
binaries, and include a real-world check that decodes a 216-frame GIF pixel-comparable to
ffmpeg's extraction.
