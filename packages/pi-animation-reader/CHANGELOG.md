# Changelog

## v0.2.0 - 2026-10-22

- **Fix:** `animation_info` reported `palindrome: no` on seamless boomerangs. Detection only
  recognised a literal mirror (`a b c b a`), where the seam frame is duplicated; encoders drop
  that duplicate to avoid a one-frame hitch at the loop seam (`a b c d c b`), which makes the
  frame list non-palindromic even though the loop is out-and-back. Both forms are now detected
  and named in the output (`mirror` / `cyclic`).
- **Changed:** the hint line now reads `palindrome: yes, <kind> (<n> unique frames — analyze
  0-<n-1>, …)` instead of `yes (half: <n> frames …)`. For the cyclic form the count is
  `n/2 + 1`, since both pivots are stored once. Fixes #4.

## v0.1.0 - 2026-10-21

- Initial release: `animation_info`, `animation_grid`, and `animation_frames` tools for reading
  animated GIF and APNG files, which Pi's built-in `read` flattens to a single frame.
- Pure-TypeScript GIF87a/89a decoder (LZW, partial frames, disposal methods, transparency,
  NETSCAPE loop blocks) and APNG decoder (fcTL dispose/blend, IDAT and fdAT frame data,
  multi-chunk frames, bit depth 8/16, colour types 0/2/3/6). No runtime dependencies.
- Numbered thumbnail grids with frame numbers rendered into the pixels via a built-in bitmap
  font; uniform sampling for ranges larger than `max_frames`. Default cell width scales with the
  canvas aspect ratio (~135px thumbnail short edge), so 16:9 sources get 240px cells.
- `columns` and `max_rows` layout bounds; when a shape cannot hold the requested range, fewer
  frames are sampled and the response names the bound that applied.
- Full-resolution frame extraction to disk with up to four frames returned inline.
- Advisory palindrome detection from composited-frame hashes.
- APNG frames whose `blend_op=SOURCE` patch does not cover its own rectangle are composited
  source-over rather than erasing the canvas (encoders tag sparse patches SOURCE); the count is
  reported by `animation_info`.
