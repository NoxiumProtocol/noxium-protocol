/*
 * The palette is computed, not chosen.
 *
 * Ground: the night sky is not black. Its own airglow emission, weighted by
 * the intensities those lines actually have overhead, integrates to a
 * green-dominant chromaticity. That is the ground colour, taken down to a very
 * low luminance and pulled most of the way toward neutral.
 *
 * Accents: one per field in the spectrum, each computed from that field's
 * emission wavelength. No accent is picked by eye, and none can be nudged
 * without changing a wavelength.
 *
 * Text and accent luminances are solved against the ground until they hit a
 * stated contrast ratio, rather than assumed to pass. Deep reds cannot reach
 * 4.5:1 at full chroma inside sRGB, so chroma steps down until they can, and
 * the step it settled on is reported.
 */

import {
  chromaticityOf,
  contrastRatio,
  fromChromaticity,
  integrate,
  solveForContrast,
  toHex,
  towardNeutral,
} from "./spectral.js";

/* Typical overhead nightglow intensities in rayleighs. The green O I line
   dominates, which is why the ground leans olive rather than blue. */
const NIGHTGLOW = [
  { nm: 557.7, intensity: 250 },
  { nm: 630.0, intensity: 60 },
  { nm: 589.0, intensity: 30 },
  { nm: 486.1, intensity: 2 },
  { nm: 427.8, intensity: 1 },
];

const GROUND_CHROMA = 0.3;
const NEUTRAL_CHROMA = 0.16;
const ACCENT_CHROMA_MAX = 0.55;
const ACCENT_CHROMA_MIN = 0.1;

export const TARGETS = {
  ink: 8.0,
  body: 4.6,
  mute: 3.05,
  accent: 4.6,
  accentFloor: 4.5,
  uiFloor: 3.0,
};

const at = (chromaticity, luminance, chroma) =>
  toHex(
    towardNeutral(
      fromChromaticity(chromaticity.x, chromaticity.y, luminance),
      chroma,
    ),
  );

function solveNeutral(chromaticity, ground, target) {
  return solveForContrast(chromaticity, NEUTRAL_CHROMA, ground, target);
}

/* Step chroma down until this wavelength can actually reach the floor. */
function solveAccent(nm, ground) {
  const chromaticity = chromaticityOf(nm);
  for (let k = ACCENT_CHROMA_MAX; k >= ACCENT_CHROMA_MIN; k -= 0.01) {
    const hex = solveForContrast(chromaticity, k, ground, TARGETS.accent);
    if (contrastRatio(hex, ground) >= TARGETS.accentFloor) {
      return { hex, chroma: Number(k.toFixed(2)) };
    }
  }
  const hex = solveForContrast(
    chromaticity,
    ACCENT_CHROMA_MIN,
    ground,
    TARGETS.accent,
  );
  return { hex, chroma: ACCENT_CHROMA_MIN, short: true };
}

export function paletteFrom(config) {
  const sky = integrate(NIGHTGLOW);

  const ground = at(sky, 0.01, GROUND_CHROMA);
  const raise = at(sky, 0.018, GROUND_CHROMA);
  const line = at(sky, 0.032, GROUND_CHROMA);
  const line2 = at(sky, 0.052, GROUND_CHROMA);

  const ink = solveNeutral(sky, ground, TARGETS.ink);
  const body = solveNeutral(sky, ground, TARGETS.body);
  const mute = solveNeutral(sky, ground, TARGETS.mute);

  const lines = config.spectrum.lines.map((entry) => {
    const { hex, chroma, short } = solveAccent(entry.nm, ground);
    return {
      ...entry,
      hex,
      chroma,
      short: Boolean(short),
      ratio: Number(contrastRatio(hex, ground).toFixed(2)),
    };
  });

  return {
    sky,
    ground,
    raise,
    line,
    line2,
    ink,
    body,
    mute,
    lines,
    axis: config.spectrum.axis,
    ratios: {
      ink: Number(contrastRatio(ink, ground).toFixed(2)),
      body: Number(contrastRatio(body, ground).toFixed(2)),
      mute: Number(contrastRatio(mute, ground).toFixed(2)),
      line2: Number(contrastRatio(line2, ground).toFixed(2)),
    },
  };
}

/* Emitted as custom properties so the stylesheet never hard-codes a colour. */
export function paletteCss(palette) {
  const rows = [
    ["--nx-ground", palette.ground],
    ["--nx-raise", palette.raise],
    ["--nx-line", palette.line],
    ["--nx-line-2", palette.line2],
    ["--nx-mute", palette.mute],
    ["--nx-body", palette.body],
    ["--nx-ink", palette.ink],
  ];
  for (const line of palette.lines) rows.push([`--nx-${line.key}`, line.hex]);
  return `:root{\n${rows.map(([k, v]) => `  ${k}: ${v};`).join("\n")}\n}`;
}
