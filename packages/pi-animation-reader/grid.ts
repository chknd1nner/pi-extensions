import type { AnimationFrame } from "./types.js";
import { drawText, glyphHeightFor } from "./bitmap-font.js";
import { encodePng } from "./png-encode.js";

export const MAX_COLUMNS = 8;

/**
 * Default thumbnail cell width for a canvas of the given size. Cell width alone under-serves
 * wide sources — a 16:9 frame in a 160px cell is only 90px tall — so the default is derived
 * from the aspect ratio to keep the thumbnail's short edge near 135px, floored at 160 and
 * capped at the 480px ceiling.
 */
export function defaultCellWidth(frameWidth: number, frameHeight: number): number {
  const targetShortEdge = 135;
  const scaled = Math.ceil((targetShortEdge * frameWidth) / Math.max(1, frameHeight));
  return Math.max(160, Math.min(480, scaled));
}

export interface GridLayout {
  cols: number;
  rows: number;
  padding: number;
  gap: number;
  canvasWidth: number;
  canvasHeight: number;
}

export function gridLayout(
  count: number,
  cell: { cellWidth: number; cellHeight: number; labelHeight: number },
): GridLayout {
  const cols = Math.min(count, MAX_COLUMNS);
  const rows = Math.ceil(count / MAX_COLUMNS);
  const padding = 8;
  const gap = 6;
  return {
    cols,
    rows,
    padding,
    gap,
    canvasWidth: padding * 2 + cols * cell.cellWidth + (cols - 1) * gap,
    canvasHeight: padding * 2 + rows * (cell.cellHeight + cell.labelHeight) + (rows - 1) * gap,
  };
}

/** Box-average downscale of an RGBA image to target width (aspect preserved). */
export function scaleFrame(
  rgba: Uint8Array,
  w: number,
  h: number,
  targetW: number,
): { rgba: Uint8Array; w: number; h: number } {
  const tw = Math.max(1, Math.round(targetW));
  const th = Math.max(1, Math.round((h / w) * tw));
  const out = new Uint8Array(tw * th * 4);
  for (let y = 0; y < th; y++) {
    const y0 = Math.floor((y * h) / th);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * h) / th));
    for (let x = 0; x < tw; x++) {
      const x0 = Math.floor((x * w) / tw);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * w) / tw));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const o = (sy * w + sx) * 4;
          r += rgba[o];
          g += rgba[o + 1];
          b += rgba[o + 2];
          a += rgba[o + 3];
          n++;
        }
      }
      const d = (y * tw + x) * 4;
      out[d] = Math.round(r / n);
      out[d + 1] = Math.round(g / n);
      out[d + 2] = Math.round(b / n);
      out[d + 3] = Math.round(a / n);
    }
  }
  return { rgba: out, w: tw, h: th };
}

/**
 * Tile frames into a labeled grid PNG. `cellWidth` is the max cell width; frames are
 * aspect-preserved within cells. Physical frame numbers render beneath each cell.
 */
export function renderGrid(
  frames: Array<{ rgba: Uint8Array; index: number }>,
  frameWidth: number,
  frameHeight: number,
  cellWidth: number,
): Uint8Array {
  const cellH = Math.max(1, Math.round((frameHeight / frameWidth) * cellWidth));
  const labelH = glyphHeightFor(cellWidth) + 6;
  const layout = gridLayout(frames.length, { cellWidth, cellHeight: cellH, labelHeight: labelH });

  const canvas = new Uint8Array(layout.canvasWidth * layout.canvasHeight * 4);
  // dark neutral background so transparency reads as dark
  for (let i = 0; i < canvas.length; i += 4) {
    canvas[i] = 34;
    canvas[i + 1] = 34;
    canvas[i + 2] = 34;
    canvas[i + 3] = 255;
  }

  const cellStride = cellWidth + layout.gap;
  const rowStride = cellH + labelH + layout.gap;

  frames.forEach(({ rgba, index }, i) => {
    const col = i % layout.cols;
    const row = Math.floor(i / layout.cols);
    const cx = layout.padding + col * cellStride;
    const cy = layout.padding + row * rowStride;

    const scaled = scaleFrame(rgba, frameWidth, frameHeight, cellWidth);
    const drawW = Math.min(scaled.w, cellWidth);
    const drawH = Math.min(scaled.h, cellH);
    for (let y = 0; y < drawH; y++) {
      for (let x = 0; x < drawW; x++) {
        const s = (y * scaled.w + x) * 4;
        const sa = scaled.rgba[s + 3];
        if (sa === 0) continue;
        const d = ((cy + y) * layout.canvasWidth + (cx + x)) * 4;
        const da = canvas[d + 3];
        const na = sa + ((da * (255 - sa)) >> 8);
        canvas[d] = Math.min(255, (scaled.rgba[s] * sa + canvas[d] * ((255 * (255 - sa)) / 255)) / (na || 1));
        canvas[d + 1] = Math.min(255, (scaled.rgba[s + 1] * sa + canvas[d + 1] * ((255 * (255 - sa)) / 255)) / (na || 1));
        canvas[d + 2] = Math.min(255, (scaled.rgba[s + 2] * sa + canvas[d + 2] * ((255 * (255 - sa)) / 255)) / (na || 1));
        canvas[d + 3] = na;
      }
    }

    const label = String(index);
    const gH = glyphHeightFor(cellWidth);
    const scale = Math.max(1, Math.floor(gH / 7));
    const textW = label.length * (5 * scale + scale) - scale;
    const tx = cx + Math.max(0, Math.floor((cellWidth - textW) / 2));
    drawText(canvas, layout.canvasWidth, layout.canvasHeight, tx, cy + cellH + 3, label, gH);
  });

  return encodePng(layout.canvasWidth, layout.canvasHeight, canvas);
}
