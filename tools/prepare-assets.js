/*
 * Rebuilds the shipped images from source pixels.
 *
 * Writes only into assets/, which is generated and never hand-edited. Source
 * artwork under brand/ is read and never modified.
 *
 * The wordmark is cropped to the bounding box of its own opaque pixels, so the
 * shipped file carries the mark and not the empty canvas around it, and is
 * resampled by area average. Nothing from the source container survives except
 * colour values: see tools/png.js for why.
 */

import fs from "node:fs";
import path from "node:path";
import { decode, encode } from "./png.js";
import { paletteFrom } from "../src/palette.js";

const SOURCE_MARK = "brand/LOGO NOXIUMPROTOCOL PNG...png";
const OUT_DIR = "assets";
const MARK_WIDTH = 440;
const OG = { width: 1200, height: 630 };

function opaqueBounds({ width, height, channels, data }) {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * channels + 3] > 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return { x0, y0, x1, y1 };
}

function crop(img, { x0, y0, x1, y1 }) {
  const width = x1 - x0 + 1;
  const height = y1 - y0 + 1;
  const { channels } = img;
  const data = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y += 1) {
    const from = ((y + y0) * img.width + x0) * channels;
    img.data.copy(data, y * width * channels, from, from + width * channels);
  }
  return { width, height, channels, data };
}

/* Area-average resample. Premultiplies alpha first, because averaging colour
   across a transparent edge without it drags the fully transparent pixels'
   colour into the visible edge and leaves a halo. */
function resample(img, outWidth) {
  const scale = img.width / outWidth;
  const outHeight = Math.max(1, Math.round(img.height / scale));
  const { channels } = img;
  const data = Buffer.alloc(outWidth * outHeight * channels);

  for (let y = 0; y < outHeight; y += 1) {
    const sy0 = Math.floor(y * scale);
    const sy1 = Math.min(img.height, Math.ceil((y + 1) * scale));
    for (let x = 0; x < outWidth; x += 1) {
      const sx0 = Math.floor(x * scale);
      const sx1 = Math.min(img.width, Math.ceil((x + 1) * scale));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = sy0; sy < sy1; sy += 1) {
        for (let sx = sx0; sx < sx1; sx += 1) {
          const i = (sy * img.width + sx) * channels;
          const alpha = channels === 4 ? img.data[i + 3] / 255 : 1;
          r += img.data[i] * alpha;
          g += img.data[i + 1] * alpha;
          b += img.data[i + 2] * alpha;
          a += alpha;
          n += 1;
        }
      }
      const o = (y * outWidth + x) * channels;
      const cover = a / n;
      data[o] = cover > 0 ? Math.round(r / a) : 0;
      data[o + 1] = cover > 0 ? Math.round(g / a) : 0;
      data[o + 2] = cover > 0 ? Math.round(b / a) : 0;
      if (channels === 4) data[o + 3] = Math.round(cover * 255);
    }
  }
  return { width: outWidth, height: outHeight, channels, data };
}

const hexToRgb = (hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/* The share card is drawn from the palette and the mark. It carries no
   photography, no diagram and no statement about the product, because there is
   no confirmed statement to make. */
function shareCard(mark, palette) {
  const { width, height } = OG;
  const data = Buffer.alloc(width * height * 3);
  const ground = hexToRgb(palette.ground);

  for (let i = 0; i < width * height; i += 1) {
    data[i * 3] = ground[0];
    data[i * 3 + 1] = ground[1];
    data[i * 3 + 2] = ground[2];
  }

  const put = (x, y, [r, g, b], alpha = 1) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const o = (y * width + x) * 3;
    data[o] = Math.round(data[o] * (1 - alpha) + r * alpha);
    data[o + 1] = Math.round(data[o + 1] * (1 - alpha) + g * alpha);
    data[o + 2] = Math.round(data[o + 2] * (1 - alpha) + b * alpha);
  };

  const axis = palette.axis;
  const bandY = Math.round(height * 0.68);
  const bandLeft = Math.round(width * 0.18);
  const bandRight = Math.round(width * 0.82);
  const rule = hexToRgb(palette.line2);

  for (let x = bandLeft; x <= bandRight; x += 1) put(x, bandY, rule, 0.9);

  for (const line of palette.lines) {
    const t = (line.nm - axis.from) / (axis.to - axis.from);
    const x = Math.round(bandLeft + t * (bandRight - bandLeft));
    const colour = hexToRgb(line.hex);
    const lit = line.value !== null;
    const halfHeight = lit ? 26 : 9;
    for (let dy = -halfHeight; dy <= halfHeight; dy += 1) {
      const fade = lit ? 1 - Math.abs(dy) / (halfHeight + 10) : 0.34;
      put(x, bandY + dy, colour, fade);
      if (lit) {
        put(x - 1, bandY + dy, colour, fade * 0.4);
        put(x + 1, bandY + dy, colour, fade * 0.4);
      }
    }
  }

  const scaled = resample(mark, Math.round(width * 0.42));
  const ox = Math.round((width - scaled.width) / 2);
  const oy = Math.round(height * 0.34 - scaled.height / 2);
  for (let y = 0; y < scaled.height; y += 1) {
    for (let x = 0; x < scaled.width; x += 1) {
      const i = (y * scaled.width + x) * 4;
      const alpha = scaled.data[i + 3] / 255;
      if (alpha > 0)
        put(
          ox + x,
          oy + y,
          [scaled.data[i], scaled.data[i + 1], scaled.data[i + 2]],
          alpha,
        );
    }
  }

  return { width, height, channels: 3, data };
}

function main() {
  const target = process.argv[2];
  if (!target || !["mark", "share"].includes(target)) {
    console.error("usage: node tools/prepare-assets.js <mark|share>");
    process.exit(2);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const source = decode(fs.readFileSync(SOURCE_MARK));
  const bounds = opaqueBounds(source);
  const cropped = crop(source, bounds);

  if (target === "mark") {
    const out = resample(cropped, MARK_WIDTH);
    const file = path.join(OUT_DIR, "mark.png");
    fs.writeFileSync(file, encode(out));
    console.log(
      `mark.png  ${out.width}x${out.height}  from source bbox ` +
        `${cropped.width}x${cropped.height} at (${bounds.x0},${bounds.y0})`,
    );
    return;
  }

  const config = JSON.parse(fs.readFileSync("config/site.config.json", "utf8"));
  const palette = paletteFrom(config);
  const out = shareCard(cropped, palette);
  const file = path.join(OUT_DIR, "share.png");
  fs.writeFileSync(file, encode(out));
  console.log(`share.png ${out.width}x${out.height}`);
}

main();
