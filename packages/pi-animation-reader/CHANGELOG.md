# Changelog

## v0.1.0 - 2026-10-21

- Initial release: `animation_info`, `animation_grid`, and `animation_frames` tools for
  reading animated GIF and APNG files.
- Pure-TypeScript GIF87a/89a decoder (LZW, partial frames, disposal methods, transparency,
  NETSCAPE loop blocks) and APNG decoder (fcTL dispose/blend, multi-IDAT frames, bit depth
  8/16, colour types 0/2/3/6). No runtime dependencies.
- Numbered thumbnail grids with frame numbers rendered into the pixels via a built-in bitmap
  font; uniform sampling for ranges larger than `max_frames`.
- Full-resolution frame extraction to disk with up to four frames returned inline.
- Advisory palindrome detection from composited-frame hashes.
