/*
 * Build. Reads config, computes the palette from it, renders the page and
 * writes dist/.
 *
 * Writes only inside dist/, which is emptied first so a previous run cannot
 * leave a file behind that nothing in this run produced. Nothing under src/,
 * config/ or brand/ is ever written to.
 */

import fs from "node:fs";
import path from "node:path";
import { paletteFrom } from "../src/palette.js";
import { render } from "../src/page.js";

const OUT = "dist";
const OUT_ASSETS = path.join(OUT, "assets");

/* Comments are removed from the emitted document rather than merely omitted by
   the renderer, so a comment that arrives in a static fragment later is still
   gone from what ships. The doctype is not a comment and is left alone. */
export function stripHtmlComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, "");
}

function emptyDir(dir) {
  if (!fs.existsSync(dir)) return [];
  const removed = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    removed.push(full);
    fs.rmSync(full, { recursive: true, force: true });
  }
  return removed;
}

function main() {
  const config = JSON.parse(fs.readFileSync("config/site.config.json", "utf8"));
  const palette = paletteFrom(config);

  const removed = emptyDir(OUT);
  if (removed.length)
    console.log(`cleared ${removed.length} path(s) from ${OUT}/`);

  fs.mkdirSync(OUT_ASSETS, { recursive: true });

  const rendered = render(config, palette);
  const before = (rendered.match(/<!--/g) || []).length;
  const html = stripHtmlComments(rendered);
  const after = (html.match(/<!--/g) || []).length;
  fs.writeFileSync(path.join(OUT, "index.html"), html);
  console.log(`index.html  ${html.length} bytes  comments ${before} -> ${after}`);

  fs.copyFileSync("src/styles.css", path.join(OUT_ASSETS, "site.css"));
  fs.copyFileSync("src/app.js", path.join(OUT_ASSETS, "site.js"));

  for (const name of ["mark.png", "share.png"]) {
    const from = path.join("assets", name);
    if (!fs.existsSync(from)) {
      console.error(
        `missing ${from} — run: node tools/prepare-assets.js ` +
          `${name === "mark.png" ? "mark" : "share"}`,
      );
      process.exit(1);
    }
    fs.copyFileSync(from, path.join(OUT_ASSETS, name));
  }

  console.log("");
  console.log(`ground ${palette.ground}  ink ${palette.ink} ` +
    `(${palette.ratios.ink}:1)  body ${palette.body} (${palette.ratios.body}:1)` +
    `  mute ${palette.mute} (${palette.ratios.mute}:1)`);
  for (const line of palette.lines) {
    console.log(
      `  ${line.key.padEnd(10)} ${String(line.nm).padStart(6)} nm  ` +
        `${line.hex}  chroma ${String(line.chroma).padStart(4)}  ` +
        `${String(line.ratio).padStart(5)}:1  ` +
        `${line.value === null ? "unlit" : "lit"}`,
    );
  }
}

main();
