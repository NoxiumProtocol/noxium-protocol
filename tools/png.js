/*
 * A very small PNG reader and writer: 8-bit, non-interlaced, RGB or RGBA.
 *
 * The writer emits IHDR, IDAT and IEND and nothing else. That is the point of
 * it. Any colour profile, orientation tag, authoring history or rights block
 * that arrived with a source file cannot survive a trip through here, because
 * the output is rebuilt from the pixel array rather than edited in place.
 */

import zlib from "node:zlib";

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1)
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
};

/* Returns { width, height, channels, data } with data as raw 8-bit samples. */
export function decode(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE))
    throw new Error("not a PNG: signature mismatch");

  let offset = 8;
  let header = null;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("latin1");
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        colourType: data[9],
        interlace: data[12],
      };
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }

  if (!header) throw new Error("no IHDR");
  if (header.depth !== 8)
    throw new Error(`unsupported bit depth ${header.depth}`);
  if (header.interlace !== 0) throw new Error("interlaced PNG unsupported");

  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[header.colourType];
  if (!channels)
    throw new Error(`unsupported colour type ${header.colourType}`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const { width, height } = header;
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);

  let pos = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos];
    pos += 1;
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev =
      y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);

    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      const x = line[i];
      let value;
      if (filter === 0) value = x;
      else if (filter === 1) value = x + a;
      else if (filter === 2) value = x + b;
      else if (filter === 3) value = x + ((a + b) >> 1);
      else if (filter === 4) value = x + paeth(a, b, c);
      else throw new Error(`bad filter ${filter} on row ${y}`);
      cur[i] = value & 0xff;
    }
  }

  return { width, height, channels, data: out };
}

/* Encodes with per-row filter selection by minimum sum of absolute
   differences, which is the heuristic the PNG specification suggests. */
export function encode({ width, height, channels, data }) {
  const stride = width * channels;
  const rows = [];

  for (let y = 0; y < height; y += 1) {
    const cur = data.subarray(y * stride, (y + 1) * stride);
    const prev =
      y > 0 ? data.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);

    let best = null;
    for (let f = 0; f <= 4; f += 1) {
      const line = Buffer.alloc(stride + 1);
      line[0] = f;
      let score = 0;
      for (let i = 0; i < stride; i += 1) {
        const a = i >= channels ? cur[i - channels] : 0;
        const b = prev[i];
        const c = i >= channels ? prev[i - channels] : 0;
        let v;
        if (f === 0) v = cur[i];
        else if (f === 1) v = cur[i] - a;
        else if (f === 2) v = cur[i] - b;
        else if (f === 3) v = cur[i] - ((a + b) >> 1);
        else v = cur[i] - paeth(a, b, c);
        v &= 0xff;
        line[i + 1] = v;
        score += v < 128 ? v : 256 - v;
      }
      if (!best || score < best.score) best = { score, line };
    }
    rows.push(best.line);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = channels === 4 ? 6 : channels === 3 ? 2 : channels === 2 ? 4 : 0;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const body = zlib.deflateSync(Buffer.concat(rows), { level: 9 });

  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", body),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* Lists chunk types present in a file, so a test can assert what shipped. */
export function chunkTypes(buffer) {
  const types = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("latin1");
    types.push(type);
    if (type === "IEND") break;
    offset += 12 + length;
  }
  return types;
}
