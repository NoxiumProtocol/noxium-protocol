/*
 * Colour is derived here, never typed in by hand.
 *
 * Every hex this file returns is computed from a wavelength in nanometres
 * through the CIE 1931 2-degree standard observer, into CIE XYZ, then into
 * sRGB under a D65 white point. Change the wavelength and the colour follows.
 *
 * The colour-matching functions use the multi-lobe Gaussian fits published in
 * Wyman, Sloan & Shirley, "Simple Analytic Approximations to the CIE XYZ Color
 * Matching Functions", Journal of Computer Graphics Techniques 2:2 (2013).
 */

const gauss = (x, a, mu, s1, s2) =>
  a * Math.exp(-0.5 * ((x - mu) / (x < mu ? s1 : s2)) ** 2);

export const xBar = (w) =>
  gauss(w, 1.056, 599.8, 37.9, 31.0) +
  gauss(w, 0.362, 442.0, 16.0, 26.7) +
  gauss(w, -0.065, 501.1, 20.4, 26.2);

export const yBar = (w) =>
  gauss(w, 0.821, 568.8, 46.9, 40.5) + gauss(w, 0.286, 530.9, 16.3, 31.1);

export const zBar = (w) =>
  gauss(w, 1.217, 437.0, 11.8, 36.0) + gauss(w, 0.681, 459.0, 26.0, 13.8);

/* Linear sRGB from XYZ, D65. */
const XYZ_TO_RGB = [
  [3.2404542, -1.5371385, -0.4985314],
  [-0.969266, 1.8760108, 0.041556],
  [0.0556434, -0.2040259, 1.0572252],
];

const encode = (c) =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

const decode = (c8) => {
  const c = c8 / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const hex2 = (v) => Math.round(v).toString(16).padStart(2, "0");

/* A chromaticity at a given luminance, lifted into gamut by adding the
   smallest constant that makes every channel non-negative. That desaturates
   toward white rather than clipping a channel, which would shift the hue. */
export function fromChromaticity(x, y, luminance) {
  const X = (x / y) * luminance;
  const Z = ((1 - x - y) / y) * luminance;
  let rgb = XYZ_TO_RGB.map(
    (row) => row[0] * X + row[1] * luminance + row[2] * Z,
  );
  const min = Math.min(...rgb);
  if (min < 0) rgb = rgb.map((c) => c - min);
  return rgb.map((c) => 255 * clamp01(encode(clamp01(c))));
}

/* Pull a colour toward its own grey at the same mean. k = 1 keeps it, k = 0
   makes it neutral. Used to bring spectral primaries into a usable range. */
export function towardNeutral([r, g, b], k) {
  const m = (r + g + b) / 3;
  return [r * k + m * (1 - k), g * k + m * (1 - k), b * k + m * (1 - k)];
}

export const toHex = ([r, g, b]) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

export function relativeLuminance(hex) {
  const r = decode(parseInt(hex.slice(1, 3), 16));
  const g = decode(parseInt(hex.slice(3, 5), 16));
  const b = decode(parseInt(hex.slice(5, 7), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/* The chromaticity of a single emission wavelength. */
export function chromaticityOf(nm) {
  const X = xBar(nm);
  const Y = yBar(nm);
  const Z = zBar(nm);
  const sum = X + Y + Z;
  return { x: X / sum, y: Y / sum };
}

/* Integrated chromaticity of a set of lines weighted by intensity. The night
   sky is not black; this is what its own emission actually adds up to. */
export function integrate(lines) {
  let X = 0;
  let Y = 0;
  let Z = 0;
  for (const { nm, intensity } of lines) {
    X += intensity * xBar(nm);
    Y += intensity * yBar(nm);
    Z += intensity * zBar(nm);
  }
  const sum = X + Y + Z;
  return { x: X / sum, y: Y / sum };
}

/* Find the luminance at which a chromaticity hits an exact contrast ratio
   against a given background. Bisection, because contrast is monotone in
   luminance and this is the only way to state a ratio and get it. */
export function solveForContrast({ x, y }, chroma, against, target) {
  let lo = 0.004;
  let hi = 1;
  for (let i = 0; i < 80; i += 1) {
    const mid = (lo + hi) / 2;
    const candidate = toHex(towardNeutral(fromChromaticity(x, y, mid), chroma));
    if (contrastRatio(candidate, against) < target) lo = mid;
    else hi = mid;
  }
  return toHex(towardNeutral(fromChromaticity(x, y, hi), chroma));
}
