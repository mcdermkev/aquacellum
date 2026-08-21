/**
 * echo-art-preview.mjs — render Echo in every behaviour state and look at her.
 *
 *   node ops/echo-art-preview.mjs [out.png]
 *
 * WHY THIS EXISTS. Echo has been redesigned repeatedly, and the reason it kept
 * going wrong is that her appearance was not reviewable: the art is path data and
 * the expressions are CSS transforms, so a diff tells you nothing about whether she
 * looks right. This renders the REAL mirror and the REAL stylesheet in Chromium,
 * one cell per state, so an art change can be judged by looking.
 *
 * It also measures the thing that is easy to get wrong and impossible to eyeball
 * from source: fins are drawn BEHIND the body, so a fin only reads if part of it
 * escapes the silhouette, and its base must NOT — a base sitting exactly on the
 * outline makes the fin look stuck on rather than growing out of her. The
 * percentages below are that check. Roughly 60–90% escaping is the working range;
 * near 100% means the join is showing, and 20% means the fin is invisible.
 *
 * Requires the Playwright chromium browser (already a dev dependency for E2E).
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
// Defaults outside the repo so a quick look never risks committing a screenshot.
const out =
  process.argv[2] || path.join(process.env.TEMP || process.env.TMPDIR || ".", "echo-art-preview.png");
const STATES = ["idle", "attending", "speaking", "examining", "reacting", "resting"];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 520, height: 400 }, deviceScaleFactor: 2 });

await page.setContent(`<!doctype html><meta charset="utf-8"><style>
/* Preview-only: she is position:fixed in production, which would stack all six in
   one corner. */
.echo-ambient { position: static !important; bottom: auto !important; left: auto !important; }
body { margin:0; background:#0b1220; color:#7dd3fc; font:12px/1.4 ui-sans-serif,system-ui,sans-serif; }
.grid { display:grid; grid-template-columns:repeat(3,1fr); gap:6px 0; padding:14px; }
.cell { display:flex; flex-direction:column; align-items:center; gap:6px; }
.big { width:150px; height:150px; }
.label { letter-spacing:.08em; text-transform:uppercase; opacity:.75; }
</style><div class="grid"></div>`);

await page.addStyleTag({ path: path.join(here, "..", "public", "css", "echo.css") });
await page.addScriptTag({ path: path.join(here, "..", "public", "js", "echo-behaviour.js") });

const built = await page.evaluate((states) => {
  const EB = window.EchoBehaviour;
  if (!EB || !EB.ECHO_SVG) return "mirror did not load, or exposes no ECHO_SVG";
  document.querySelector(".grid").innerHTML = states
    .map(
      (s) => `<div class="cell">
        <div class="echo-ambient echo-ambient--${s} big"><div class="echo-renderer" style="width:100%;height:100%">
          <div class="echo-art">${EB.ECHO_SVG}</div>
        </div></div>
        <div class="label">${s}</div>
      </div>`,
    )
    .join("");
  return "ok";
}, STATES);
if (built !== "ok") throw new Error(built);

// Let the expression transitions land, then freeze the looping tail and fin motion
// so the screenshot is a stable pose rather than a random frame.
await page.waitForTimeout(700);
await page.addStyleTag({ content: ".echo-svg *, .echo-svg { animation-play-state: paused !important; }" });
await page.waitForTimeout(150);

const measured = await page.evaluate(() => {
  const svg = document.querySelector(".echo-ambient--idle .echo-svg");
  const body = svg.querySelector(".echo-body");
  const extent = (sel) => {
    const el = svg.querySelector(sel);
    if (!el) return "MISSING";
    const b = el.getBBox();
    return `x ${b.x.toFixed(0)}-${(b.x + b.width).toFixed(0)}, y ${b.y.toFixed(0)}-${(b.y + b.height).toFixed(0)}`;
  };
  // Sample the fin's own fill and ask how much of it is not underneath the body.
  const escapes = (sel) => {
    const el = svg.querySelector(sel);
    if (!el) return "MISSING";
    const b = el.getBBox();
    let total = 0;
    let outside = 0;
    for (let i = 0; i <= 60; i++) {
      for (let j = 0; j <= 60; j++) {
        const p = svg.createSVGPoint();
        p.x = b.x + (b.width * i) / 60;
        p.y = b.y + (b.height * j) / 60;
        if (!el.isPointInFill(p)) continue;
        total++;
        if (!body.isPointInFill(p)) outside++;
      }
    }
    return total ? `${((outside / total) * 100).toFixed(0)}%` : "empty path";
  };
  return {
    extents: {
      body: extent(".echo-body"),
      dorsal: extent(".echo-fin-dorsal"),
      pectoral: extent(".echo-fin-pectoral"),
      tail: extent(".echo-tail"),
      eye: extent(".echo-eye"),
    },
    escapesBody: {
      dorsal: escapes(".echo-fin-dorsal path"),
      pectoral: escapes(".echo-fin-pectoral path"),
      tail: escapes(".echo-tail path"),
    },
  };
});
console.log(JSON.stringify(measured, null, 2));

writeFileSync(out, await page.screenshot());
await browser.close();
console.log("wrote " + out);
