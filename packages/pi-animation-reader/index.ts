import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { animationFrames, animationGrid, animationInfo } from "./tools.js";

const PathParam = Type.String({ description: "Path to an animated GIF or APNG file" });

const infoSchema = Type.Object({ path: PathParam });

const gridSchema = Type.Object({
  path: PathParam,
  start: Type.Number({ description: "First physical frame index (0-based)" }),
  end: Type.Number({ description: "Last physical frame index (inclusive)" }),
  max_frames: Type.Optional(
    Type.Number({ description: "Uniformly sample at most this many frames from the range (default 16, max 64)" }),
  ),
  cell_width: Type.Optional(
    Type.Number({
      description:
        "Thumbnail cell width in px. Default scales with the canvas aspect ratio (160px floor, 480px ceiling) so wide sources keep detail.",
    }),
  ),
});

const framesSchema = Type.Object({
  path: PathParam,
  start: Type.Number({ description: "First physical frame index (0-based)" }),
  end: Type.Number({ description: "Last physical frame index (inclusive)" }),
  max_frames: Type.Optional(
    Type.Number({ description: "Uniformly sample at most this many frames from the range (default 8, max 32)" }),
  ),
});

const GUIDELINES = [
  "Reading animations: call animation_info first (frame count, delays, palindrome hint), then animation_grid to skim a frame range (numbers under thumbnails are frame indices), then animation_frames to zoom into specific frames at full resolution.",
  "Frame indices are physical file order and are shared by all three tools; animation_info reports whether the file is a palindrome so you can skip the mirrored half.",
];

export default function piAnimationReader(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "animation_info",
    label: "animation info",
    description:
      "Show metadata for an animated GIF or APNG: canvas size, frame count, per-frame delays, loop, duration, " +
      "partial-frame flag, per-frame content hashes, and a palindrome hint. Call this before animation_grid/animation_frames.",
    promptSnippet: "Inspect animated GIF/APNG metadata (frames, delays, loops, palindrome hint)",
    promptGuidelines: GUIDELINES,
    parameters: infoSchema,
    async execute(_id, params) {
      const r = animationInfo(params);
      return {
        content: r.content as (TextContent | ImageContent)[],
        details: r.details,
        isError: r.isError,
      };
    },
  });

  pi.registerTool({
    name: "animation_grid",
    label: "animation grid",
    description:
      "Extract frames [start, end] from an animated GIF/APNG, downscale to thumbnails, and return ONE grid image with the " +
      "physical frame number rendered under each thumbnail. Ranges larger than max_frames are sampled uniformly " +
      "(endpoints always included). Use for skimming; use animation_frames to zoom.",
    promptSnippet: "Skim an animation as a numbered thumbnail grid",
    promptGuidelines: GUIDELINES,
    parameters: gridSchema,
    async execute(_id, params) {
      const r = animationGrid(params);
      return {
        content: r.content as (TextContent | ImageContent)[],
        details: r.details,
        isError: r.isError,
      };
    },
  });

  pi.registerTool({
    name: "animation_frames",
    label: "animation frames",
    description:
      "Extract frames [start, end] from an animated GIF/APNG at FULL native resolution as composited PNG files written to disk " +
      "(named by physical frame index); up to 4 are also returned inline. Use after animation_grid points you at specific frames.",
    promptSnippet: "Extract full-resolution frames from an animation range",
    promptGuidelines: GUIDELINES,
    parameters: framesSchema,
    async execute(_id, params) {
      const r = animationFrames(params);
      return {
        content: r.content as (TextContent | ImageContent)[],
        details: r.details,
        isError: r.isError,
      };
    },
  });
}
