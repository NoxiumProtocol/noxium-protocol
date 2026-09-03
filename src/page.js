/*
 * Renders the page from config. Every visible sentence about what is or is not
 * known is produced by a branch here, never typed as prose, so a value landing
 * in config reverses the wording without anyone editing a paragraph.
 */

import { paletteCss } from "./palette.js";

const escape = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/* Returns the value only when it is genuinely an http address, and null
   otherwise. Callers use that to decide whether something is navigable rather
   than assuming every published value is. */
export function asWebAddress(value) {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? value
      : null;
  } catch {
    return null;
  }
}

/* One value is stored per channel: the address itself. The label is read back
   out of that same string, so a link cannot end up pointing somewhere other
   than the place it names. */
export function channelLabel(url) {
  const { hostname, pathname } = new URL(url);
  const parts = pathname.split("/").filter(Boolean);
  if (hostname.endsWith("x.com")) return `@${parts[0]}`;
  return parts.join("/");
}

/* Marks sit in a 44 by 44 viewBox and are drawn well inside it. The box is the
   target: it is stated on the element itself, so the hit area is a property of
   the markup and not of whatever padding a stylesheet happens to apply. */
const GLYPHS = {
  x: {
    title: "X",
    inner:
      '<g transform="translate(12 12) scale(0.8333)">' +
      '<path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817' +
      "L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1" +
      '.833L7.084 4.126H5.117z" fill="currentColor"/></g>',
  },
  github: {
    title: "GitHub",
    inner:
      '<g transform="translate(11 11) scale(1.375)">' +
      '<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17' +
      ".55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.9" +
      "4-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87." +
      "87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1." +
      "59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2" +
      "-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51." +
      "56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.0" +
      "7-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58" +
      '-8-8-8z" fill="currentColor"/></g>',
  },
};

/* The button and the row in the readout are two views of one spectrum line,
   not two copies of an address. There is exactly one place the address is
   written down, so the button's target and the row's target cannot disagree
   and neither can drift from the label, which is parsed back out of it. */
function metaButton(line) {
  const glyph = GLYPHS[line.key];
  const svg =
    `<svg class="btn__glyph" width="44" height="44" viewBox="0 0 44 44" ` +
    `aria-hidden="true" focusable="false">${glyph.inner}</svg>`;

  const url = asWebAddress(line.value);

  if (!url) {
    return (
      `<span class="btn is-absent" data-channel="${escape(line.key)}" ` +
      `aria-disabled="true" title="${escape(glyph.title)}: ${escape(line.reason)}">` +
      `${svg}<span class="sr">${escape(glyph.title)}: ${escape(line.reason)}</span>` +
      `</span>`
    );
  }

  const label = channelLabel(url);
  return (
    `<a class="btn" data-channel="${escape(line.key)}" href="${escape(url)}" ` +
    `rel="noopener" target="_blank">` +
    `${svg}<span class="sr">${escape(glyph.title)}, ${escape(label)}</span>` +
    `</a>`
  );
}

function band(palette) {
  const { axis } = palette;
  const span = axis.to - axis.from;
  const marks = palette.lines
    .map((line) => {
      const at = (((line.nm - axis.from) / span) * 100).toFixed(3);
      const state = line.value === null ? "is-dark" : "is-lit";
      return (
        `<span class="band__ln ${state}" style="left:${at}%;` +
        `--ln:var(--nx-${escape(line.key)})"></span>`
      );
    })
    .join("");

  const lit = palette.lines.filter((line) => line.value !== null).length;
  const label =
    `An emission spectrum with ${palette.lines.length} lines, one for each ` +
    `property of this project. ${lit} of them are lit, meaning a value has ` +
    `been published. The rest are unlit.`;

  return (
    `<div class="band" role="img" aria-label="${escape(label)}">` +
    `<span class="band__rule"></span>${marks}</div>`
  );
}

/* The address slot. When there is no address the placeholder is built from a
   character that cannot appear in one, so a search for address-shaped text
   finds nothing, and no control that could put something on the clipboard is
   rendered at all. */
function addressSlot(line) {
  if (line.value === null) {
    return (
      `<div class="addr is-absent">` +
      `<p class="addr__slot" aria-hidden="true">${"·".repeat(42)}</p>` +
      `<p class="addr__note">${escape(line.reason)}. ` +
      `Nothing is published here yet, and nothing on this page stands in for ` +
      `it.</p></div>`
    );
  }
  return (
    `<div class="addr is-set">` +
    `<p class="addr__slot" id="nx-address">${escape(line.value)}</p>` +
    `<button class="addr__copy" type="button" data-copy="nx-address">` +
    `Copy address</button>` +
    `<p class="addr__note" data-copy-live aria-live="polite"></p></div>`
  );
}

function readoutRow(line) {
  const known = line.value !== null;
  /* The line's colour is set once on the row, not on the swatch, so everything
     inside the row can reach it. Declaring it on the swatch alone left the
     link resolving var(--ln) to nothing and quietly inheriting body colour. */
  const swatch = `<span class="row__dot" aria-hidden="true"></span>`;

  /* Not every published value is somewhere to navigate to. An address is a
     string to read and copy, and turning one into a link would invent a
     destination for it. Only a value that really is an http address becomes
     one, and the rest are shown verbatim. */
  const target = known ? asWebAddress(line.value) : null;

  let detail;
  if (!known)
    detail = `<span class="row__val is-absent">${escape(line.reason)}</span>`;
  else if (target)
    detail =
      `<a class="row__val" href="${escape(target)}" rel="noopener" ` +
      `target="_blank">${escape(channelLabel(target))}</a>`;
  else
    detail = `<span class="row__val mono">${escape(line.value)}</span>`;

  return (
    `<li class="row ${known ? "is-lit" : "is-dark"}" ` +
    `style="--ln:var(--nx-${escape(line.key)})">` +
    `${swatch}` +
    `<span class="row__k">${escape(line.label)}</span>` +
    `<span class="row__nm">${escape(line.nm.toFixed(1))} nm` +
    `<span class="row__em"> ${escape(line.emitter)}</span></span>` +
    `${detail}` +
    `<span class="row__state">${known ? "published" : "not published"}</span>` +
    `</li>`
  );
}

export function render(config, palette) {
  const total = palette.lines.length;
  const known = palette.lines.filter((line) => line.value !== null).length;
  const byKey = (key) => palette.lines.find((line) => line.key === key);
  const contract = byKey("contract");

  const buttons = config.buttons.map((key) => {
    const line = byKey(key);
    if (!line) throw new Error(`buttons lists "${key}", which is not a spectrum line`);
    return metaButton(line);
  });

  const heading =
    `${total} ${total === 1 ? "property" : "properties"}. ` +
    `${known} ${known === 1 ? "is" : "are"} known.`;

  const lede =
    known === 0
      ? `Every property of this project is still unpublished. The spectrum ` +
        `above is unlit because there is nothing yet to light it.`
      : `Each line above is one property of this project. A line is lit only ` +
        `when the value behind it has been published. The unlit ones are not ` +
        `placeholders for something withheld: no value for them exists yet.`;

  const tagline =
    config.identity.tagline === null
      ? `<p class="say is-absent">No positioning line has been supplied, so ` +
        `none is shown.</p>`
      : `<p class="say">${escape(config.identity.tagline)}</p>`;

  const rows = palette.lines.map(readoutRow).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(config.identity.wordmark)}</title>
<meta name="description" content="${escape(
    `${known} of ${total} properties of this project have been published. ` +
      `The rest are shown as unlit and unclaimed.`,
  )}">
<meta name="color-scheme" content="dark">
<meta property="og:title" content="${escape(config.identity.wordmark)}">
<meta property="og:description" content="${escape(heading)}">
<meta property="og:image" content="/assets/share.png">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/assets/mark.png" type="image/png">
<link rel="stylesheet" href="/assets/site.css">
<style>${paletteCss(palette)}</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="mast">
  <div class="mast__bar">
    <a class="mast__mark" href="/" aria-label="${escape(
      config.identity.wordmark,
    )}, home">
      <img src="/assets/mark.png" width="220" height="37" decoding="async"
           alt="${escape(config.identity.wordmark)}">
    </a>
    <nav class="meta" aria-label="Project channels">
      ${buttons.join("\n      ")}
    </nav>
  </div>
  ${band(palette)}
</header>
<main id="main" tabindex="-1">
  <section class="slot" aria-labelledby="addr-h">
    <h2 class="h2" id="addr-h">${escape(contract.label)}</h2>
    ${addressSlot(contract)}
  </section>
  <section class="readout" aria-labelledby="read-h">
    <h2 class="h2" id="read-h">The spectrum, line by line</h2>
    <ol class="rows">${rows}</ol>
  </section>
  <section class="lead">
    <h1 class="h1">${escape(heading)}</h1>
    <p class="lede">${lede}</p>
    ${tagline}
  </section>
</main>
<footer class="foot">
  <p>${escape(config.identity.domain)}</p>
  <p class="foot__note">Colour on this page is computed from the emission
     wavelengths listed above, not sampled by eye.</p>
</footer>
<script src="/assets/site.js" defer></script>
</body>
</html>
`;
}
