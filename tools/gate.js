/*
 * Gates. Each one asserts a property of what actually ships and exits non-zero
 * when it does not hold.
 *
 * The document checks read dist/index.html from disk rather than asking the
 * renderer what it would produce, because the two are not the same thing: a
 * fragment added to the head later would never pass through the renderer.
 */

import fs from "node:fs";
import path from "node:path";
import { paletteFrom, TARGETS } from "../src/palette.js";
import { contrastRatio } from "../src/spectral.js";

const HTML = "dist/index.html";

/* These lists are stored encoded so that this file does not itself contain the
   strings it forbids. Without that, the scan reports its own rule table and
   the only way out is to skip this file, which would leave the one file nobody
   is checking. Decoded at load; the scan therefore covers itself.

   Short words hide inside longer ones, so every term is matched on a word
   boundary. Hidden-directory forms are derived from the same terms rather than
   written out. */
const unpack = (encoded) =>
  Buffer.from(encoded, "base64").toString("utf8").split(",");

const FORBIDDEN_TERMS = unpack(
  "Y2xhdWRlLGFudGhyb3BpYyxjaGF0Z3B0LG9wZW5haSxjb3BpbG90LHVsdHJhZGV4LGNhbnZhLGdxZ256dSxjb2FsLHNhZGV3YQ==",
);

const FORBIDDEN_PHRASES = unpack("Z2VuZXJhdGVkIHdpdGgsY28tYXV0aG9yZWQ=");

const FORBIDDEN_FRAGMENTS = FORBIDDEN_TERMS.flatMap((term) => [
  `.${term}/`,
  `.${term}${String.fromCharCode(92)}`,
]);

/* No settlement layer is named anywhere, in any form. */
const CHAIN_TERMS = unpack(
  "ZXRoZXJldW0sc29sYW5hLHBvbHlnb24sYXJiaXRydW0sYXZhbGFuY2hlLHRyb24sc3VpLGFwdG9zLGJuYixic2MsYmluYW5jZSxyb2Jpbmhvb2QsZXJjMjAsZXJjLTIwLGJlcDIwLGJlcC0yMCxldm0=",
);

const SCAN_DIRS = ["src", "tools", "config", "dist"];
const SCAN_ROOT_FILES = [
  "package.json",
  ".gitignore",
  "README.md",
  "package-lock.json",
];

const results = [];
const record = (name, ok, detail) => results.push({ name, ok, detail });

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function shippedFiles() {
  const files = [];
  for (const dir of SCAN_DIRS) walk(dir, files);
  for (const file of SCAN_ROOT_FILES)
    if (fs.existsSync(file)) files.push(file);
  return files;
}

/* ---------------------------------------------------------------- */

function gateNoTrace() {
  const hits = [];
  for (const file of shippedFiles()) {
    const text = fs.readFileSync(file, "latin1");
    for (const term of FORBIDDEN_TERMS) {
      const re = new RegExp(`\\b${term}\\b`, "gi");
      let m;
      while ((m = re.exec(text)) !== null)
        hits.push(`${file}: /\\b${term}\\b/i at byte ${m.index}`);
    }
    for (const phrase of FORBIDDEN_PHRASES) {
      const re = new RegExp(phrase.replace(/ /g, "[\\s-]"), "gi");
      let m;
      while ((m = re.exec(text)) !== null)
        hits.push(`${file}: "${phrase}" at byte ${m.index}`);
    }
    for (const frag of FORBIDDEN_FRAGMENTS) {
      let at = text.toLowerCase().indexOf(frag.toLowerCase());
      while (at !== -1) {
        hits.push(`${file}: "${frag}" at byte ${at}`);
        at = text.toLowerCase().indexOf(frag.toLowerCase(), at + 1);
      }
    }
  }
  record(
    "no-trace",
    hits.length === 0,
    hits.length ? hits.join("\n    ") : `scanned ${shippedFiles().length} files`,
  );
}

function gateNoChainNamed() {
  const hits = [];
  for (const file of shippedFiles()) {
    const text = fs.readFileSync(file, "latin1");
    for (const term of CHAIN_TERMS) {
      const re = new RegExp(`\\b${term.replace(/-/g, "-?")}\\b`, "gi");
      let m;
      while ((m = re.exec(text)) !== null)
        hits.push(`${file}: "${m[0]}" at byte ${m.index}`);
    }
  }
  record(
    "no-chain-named",
    hits.length === 0,
    hits.length ? hits.join("\n    ") : `scanned ${shippedFiles().length} files`,
  );
}

function gateNoHtmlComments() {
  const html = fs.readFileSync(HTML, "utf8");
  const count = (html.match(/<!--/g) || []).length;
  record(
    "no-html-comments",
    count === 0,
    `grep -c "<!--" ${HTML} = ${count}`,
  );
}

/* Every leaf in config must name a place it is rendered, or be declared empty
   on purpose. A field added without either is an orphan and fails here rather
   than being discovered live. */
function leaves(value, prefix = "", out = []) {
  if (Array.isArray(value)) {
    value.forEach((item, i) => leaves(item, `${prefix}[${i}]`, out));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value))
      leaves(v, prefix ? `${prefix}.${k}` : k, out);
  } else {
    out.push({ path: prefix, value });
  }
  return out;
}

function gateRenderSites() {
  const config = JSON.parse(fs.readFileSync("config/site.config.json", "utf8"));
  const html = fs.readFileSync(HTML, "utf8");
  const declaredEmpty = new Set(config.deliberatelyEmpty || []);

  const sites = new Map();
  const site = (p, fn) => sites.set(p, fn);

  site("identity.wordmark", (v) => html.includes(v));
  site("identity.domain", (v) => html.includes(v));
  site("identity.tagline", (v) =>
    v === null
      ? html.includes("No positioning line has been supplied")
      : html.includes(v),
  );
  config.buttons.forEach((key, i) => {
    site(`buttons[${i}]`, (v) => new RegExp(`data-channel="${v}"`).test(html));
  });

  config.spectrum.lines.forEach((line, i) => {
    site(`spectrum.lines[${i}].key`, (v) => html.includes(`--nx-${v}`));
    site(`spectrum.lines[${i}].label`, (v) => html.includes(v));
    site(`spectrum.lines[${i}].nm`, (v) =>
      html.includes(`${Number(v).toFixed(1)} nm`),
    );
    site(`spectrum.lines[${i}].emitter`, (v) => html.includes(v));
    site(`spectrum.lines[${i}].value`, (v) =>
      v === null ? true : html.includes(v),
    );
    /* A reason and a value are opposite branches of the same slot. The reason
       must be shown while the value is missing, and must be gone once it
       lands: a stale line of absence copy surviving next to a real value is
       the failure this asserts against. */
    site(`spectrum.lines[${i}].reason`, (v) =>
      line.value === null ? v === null || html.includes(v) : !html.includes(v),
    );
  });

  const problems = [];
  for (const leaf of leaves(config)) {
    if (leaf.path.startsWith("deliberatelyEmpty")) continue;
    if (declaredEmpty.has(leaf.path)) continue;
    const verify = sites.get(leaf.path);
    if (!verify) {
      problems.push(`ORPHAN  ${leaf.path} = ${JSON.stringify(leaf.value)} — no render site declared`);
      continue;
    }
    if (!verify(leaf.value))
      problems.push(`MISSING ${leaf.path} = ${JSON.stringify(leaf.value)} — declared render site is not in the document`);
  }

  record(
    "config-render-sites",
    problems.length === 0,
    problems.length
      ? problems.join("\n    ")
      : `${leaves(config).length} leaves checked, ${declaredEmpty.size} declared empty`,
  );
}

/* One address, written down once. An address held in two places is an address
   that can be updated in one of them, and then the button and the row that are
   supposed to be the same link quietly point at different things. Holding a
   second copy is the failure, so the second copy is what this looks for. */
function gateSingleSource() {
  const config = JSON.parse(fs.readFileSync("config/site.config.json", "utf8"));
  const byValue = new Map();
  for (const leaf of leaves(config)) {
    if (typeof leaf.value !== "string") continue;
    if (!/^https?:\/\//.test(leaf.value)) continue;
    if (!byValue.has(leaf.value)) byValue.set(leaf.value, []);
    byValue.get(leaf.value).push(leaf.path);
  }
  const problems = [];
  for (const [value, paths] of byValue)
    if (paths.length > 1)
      problems.push(`${value} is stored ${paths.length} times: ${paths.join(", ")}`);

  record(
    "single-source-values",
    problems.length === 0,
    problems.length
      ? problems.join("\n    ")
      : `${byValue.size} address(es) in config, each written down exactly once`,
  );
}

/* The two channel buttons must state a 44 by 44 box on the svg itself. */
function gateTouchTargets() {
  const html = fs.readFileSync(HTML, "utf8");
  const problems = [];
  let found = 0;

  const re = /<svg\b[^>]*class="btn__glyph"[^>]*>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    found += 1;
    const tag = m[0];
    const width = /\swidth="(\d+)"/.exec(tag);
    const height = /\sheight="(\d+)"/.exec(tag);
    const viewBox = /\sviewBox="([^"]+)"/.exec(tag);
    if (!width || !height || !viewBox) {
      problems.push(`svg #${found}: missing width, height or viewBox — ${tag}`);
      continue;
    }
    const [minX, minY, vbW, vbH] = viewBox[1].trim().split(/\s+/).map(Number);
    if (Number(width[1]) < 44 || Number(height[1]) < 44)
      problems.push(`svg #${found}: attribute box ${width[1]}x${height[1]} < 44x44`);
    if (vbW < 44 || vbH < 44)
      problems.push(`svg #${found}: viewBox ${vbW}x${vbH} < 44x44`);
    if (minX !== 0 || minY !== 0)
      problems.push(`svg #${found}: viewBox origin ${minX},${minY} is not 0,0`);
  }

  if (found !== 2) problems.push(`expected 2 channel glyphs, found ${found}`);

  record(
    "touch-targets-44",
    problems.length === 0,
    problems.length ? problems.join("\n    ") : `${found} glyphs at 44x44 from their own viewBox`,
  );
}

function gateContrast() {
  const config = JSON.parse(fs.readFileSync("config/site.config.json", "utf8"));
  const palette = paletteFrom(config);
  const problems = [];

  /* --nx-mute clears 3:1 and no more. That is the bar for the edge of a
     control and it is not the bar for a word, so it is listed here against the
     interface floor rather than the text one, and gate-border-token-not-text
     is what stops it being used for a word anyway. */
  const text = [
    ["--nx-ink", palette.ink, TARGETS.ink - 0.1],
    ["--nx-body", palette.body, 4.5],
    ["--nx-mute", palette.mute, TARGETS.uiFloor],
  ];
  for (const [name, hex, floor] of text) {
    const r = contrastRatio(hex, palette.ground);
    if (r < floor)
      problems.push(`${name} ${hex} ratio ${r.toFixed(2)} < ${floor} on ground`);
  }

  for (const line of palette.lines) {
    const r = contrastRatio(line.hex, palette.ground);
    if (r < TARGETS.accentFloor)
      problems.push(
        `--nx-${line.key} ${line.hex} ratio ${r.toFixed(2)} < ${TARGETS.accentFloor}` +
          ` — an accent below the floor may not be used for text`,
      );
  }

  const border = contrastRatio(palette.mute, palette.ground);
  if (border < TARGETS.uiFloor)
    problems.push(`interactive border --nx-mute ratio ${border.toFixed(2)} < 3`);

  record(
    "contrast",
    problems.length === 0,
    problems.length
      ? problems.join("\n    ")
      : `ink ${palette.ratios.ink} body ${palette.ratios.body} mute ${palette.ratios.mute}, ` +
        `${palette.lines.length} accents all >= ${TARGETS.accentFloor}`,
  );
}

/* The border token is the one value in the palette that clears 3:1 and not
   4.5:1. Text set in it measured 3.07 against the ground at sizes down to
   12.5px, which is a failure the palette table alone does not show, because
   the number is correct for an edge and wrong for a word. This reads the
   stylesheet so the rule cannot be lost by remembering it. */
function gateBorderTokenNotText() {
  const css = fs.readFileSync("src/styles.css", "utf8");
  const problems = [];
  const re = /(^|[;{]|\/\*[^*]*\*\/)\s*(color|fill|stroke)\s*:\s*var\(\s*--nx-mute\s*\)/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    const line = css.slice(0, m.index).split("\n").length;
    problems.push(`src/styles.css:${line}: ${m[2]} uses --nx-mute, which only clears 3:1`);
  }
  record(
    "border-token-not-text",
    problems.length === 0,
    problems.length
      ? problems.join("\n    ")
      : "--nx-mute is used for borders only, never for a text or glyph colour",
  );
}

/* While no address is published nothing address-shaped and no control that
   could copy one may exist in the document. */
function gateAbsentAddress() {
  const config = JSON.parse(fs.readFileSync("config/site.config.json", "utf8"));
  const html = fs.readFileSync(HTML, "utf8");
  const line = config.spectrum.lines.find((l) => l.key === "contract");
  const problems = [];

  if (line.value === null) {
    const shaped = html.match(/0x[0-9a-fA-F]{6,}/g);
    if (shaped) problems.push(`address-shaped text present: ${shaped.join(", ")}`);
    if (/data-copy=/.test(html))
      problems.push("a copy control is rendered while the address is null");
    if (!html.includes(line.reason))
      problems.push(`the stated reason "${line.reason}" is not shown`);
  } else {
    if (!html.includes(line.value))
      problems.push("address is set in config but absent from the document");
    if (!/data-copy="nx-address"/.test(html))
      problems.push("address is set but no copy control is rendered");
    if (html.includes(line.reason || " "))
      problems.push("absence copy survives while an address is set");
  }

  record(
    "address-state",
    problems.length === 0,
    problems.length
      ? problems.join("\n    ")
      : line.value === null
        ? "null: no address-shaped text, no copy control, reason shown"
        : "set: address shown, copy control present, no absence copy",
  );
}

/* ---------------------------------------------------------------- */

if (!fs.existsSync(HTML)) {
  console.error(`${HTML} does not exist — run the build first`);
  process.exit(2);
}

gateNoTrace();
gateBorderTokenNotText();
gateNoChainNamed();
gateNoHtmlComments();
gateRenderSites();
gateSingleSource();
gateTouchTargets();
gateContrast();
gateAbsentAddress();

let failed = 0;
for (const r of results) {
  const tag = r.ok ? "pass" : "FAIL";
  if (!r.ok) failed += 1;
  console.log(`[${tag}] ${r.name}\n    ${r.detail}`);
}
console.log(`\n${results.length - failed}/${results.length} gates passed`);
process.exit(failed === 0 ? 0 : 1);
