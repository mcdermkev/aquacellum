#!/usr/bin/env node
/**
 * fix-catalog-typos.mjs: spelling fixes and cut-off text repair for the
 * species catalog prose.
 *
 * 1. Misspellings. A cspell pass over every prose field (2026-09-30) found a
 *    short list of real typos in imported text: "blcakwater", "paramaters",
 *    misspelled genus names (Myriophylum, Machrobrachium) and two broken
 *    accents. Each fix below is an exact, whole-word replacement.
 *
 * 2. Cut-off text. The FishBase import clipped long fields at a fixed length
 *    (500, 400, 350, 300 or 150 characters, sometimes one less), so several
 *    hundred fields end mid-word ("...minimum aquarium siz"). We do not have
 *    the missing words, and inventing them would be making things up, so each
 *    clipped field is trimmed back to its last complete sentence. When that
 *    would throw away most of the field, it is cut at the last whole word and
 *    ends with an ellipsis instead, so the reader can see it is partial.
 *
 * Writes both catalog mirrors identically. Rebuild the search index after:
 *
 *   node scripts/fix-catalog-typos.mjs          # report only (dry run)
 *   node scripts/fix-catalog-typos.mjs --write  # write both mirrors
 *   node scripts/build-species-index.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const MIRRORS = [
  `${ROOT}frontend/public/fishbase_master.json`,
  `${ROOT}frontend/fishbase_master.json`,
];
const WRITE = process.argv.includes("--write");

/** [wrong, right]. Whole-word, case-sensitive. */
export const SPELLING = [
  ["blcakwater", "blackwater"],
  ["cicrcumstances", "circumstances"],
  ["decribed", "described"],
  ["dessicated", "desiccated"],
  ["dessication", "desiccation"],
  ["devlopment", "development"],
  ["lenths", "lengths"],
  ["microrganisms", "microorganisms"],
  ["occuring", "occurring"],
  ["paramaters", "parameters"],
  ["specis", "species"],
  ["strcutures", "structures"],
  ["detrivore", "detritivore"],
  ["creniciclid", "crenicichlid"],
  ["may consis of", "may consist of"],
  ["placing a tumb over", "placing a thumb over"],
  ["Myriophylum", "Myriophyllum"],
  ["Hygrophilia", "Hygrophila"],
  ["Taxiphylum", "Taxiphyllum"],
  ["Machrobrachium", "Macrobrachium"],
  ["Nymphea", "Nymphaea"],
  // California grass is Brachiaria mutica.
  ["Brachiara nuatica", "Brachiaria mutica"],
  ["Brachiara", "Brachiaria"],
  // Broken accents (UTF-8 read as Latin-1, and an OCR slip).
  ["In\u00c3\u00adrida", "In\u00edrida"],
  ["Santfssima", "Sant\u00edssima"],
];

/** Lengths the import clipped at. */
const CUT_LENGTHS = new Set([500, 499, 400, 399, 350, 349, 300, 299, 150, 149]);
/** Words that end in a period without ending a sentence. */
const ABBREV = /(?:^|[\s(])(?:Ref|e\.g|i\.e|cf|sp|spp|ssp|subsp|var|ca|approx|pers|obsv|vs|etc|al|St|Dr|Mt|No|Nos|Fig|max|min|incl|esp|resp|av|avg|[A-Z])\.$/;

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function fixSpelling(text) {
  let out = text;
  for (const [wrong, right] of SPELLING) {
    out = out.replace(new RegExp(`(?<![\\p{L}])${escapeRe(wrong)}(?![\\p{L}])`, "gu"), right);
  }
  return out;
}

/** True when a field looks clipped by the import (fixed length, no ending). */
export function isClipped(text) {
  if (!CUT_LENGTHS.has(text.length)) return false;
  return !/[.!?)"'\u201d\]]\s*$/.test(text);
}

/** Trim a clipped field back to its last full sentence (or last word + "…"). */
export function repairClipped(text) {
  const boundary = /[.!?]["')\]\u201d]*(?=\s+[A-Z(<"\u201c])/g;
  let best = -1;
  let m;
  while ((m = boundary.exec(text))) {
    const upto = text.slice(0, m.index + 1);
    if (ABBREV.test(upto)) continue;
    best = m.index + m[0].length;
  }
  if (best > 0 && best >= text.length * 0.35) return closeItalics(text.slice(0, best).trim());
  const lastSpace = text.trimEnd().lastIndexOf(" ");
  let head = (lastSpace > 0 ? text.slice(0, lastSpace) : text).replace(/[\s,;:(\-\u2013]+$/, "");
  // Never leave half a tag ("<i" or "</") at the cut.
  head = head.replace(/<\/?[a-z]*$/i, "").trimEnd();
  return closeItalics(`${head}\u2026`);
}

/** FishBase prose italicises names with <i>; close any the cut left open. */
function closeItalics(text) {
  const open = (text.match(/<i>/g) || []).length - (text.match(/<\/i>/g) || []).length;
  return open > 0 ? text + "</i>".repeat(open) : text;
}

function walk(value, visit, path = "") {
  if (typeof value === "string") return visit(value, path);
  if (Array.isArray(value)) return value.map((v, i) => walk(v, visit, `${path}[${i}]`));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      // Names, links and ids are not prose.
      out[k] = /url|photo|image|video|slug|scientificName|genus|^species$|family|specCode|duplicateOf|waterTypes|trophicSource/i.test(k)
        ? v
        : walk(v, visit, path ? `${path}.${k}` : k);
    }
    return out;
  }
  return value;
}

function main() {
  const data = JSON.parse(readFileSync(MIRRORS[0], "utf8"));
  let spelled = 0;
  let clipped = 0;
  let ellipsis = 0;
  const samples = [];
  const fixed = data.map((rec) => walk(rec, (text, path) => {
    let out = closeItalics(fixSpelling(text));
    if (out !== text) spelled++;
    if (isClipped(out)) {
      const repaired = repairClipped(out);
      clipped++;
      if (repaired.endsWith("\u2026")) ellipsis++;
      if (samples.length < 12) samples.push(`${rec.scientificName} ${path}\n    ...${out.slice(-70)}\n => ...${repaired.slice(-70)}`);
      out = repaired;
    }
    return out;
  }));
  console.log(`spelling fixes in ${spelled} fields; clipped fields repaired: ${clipped} (${ellipsis} ended with an ellipsis)`);
  samples.forEach((s) => console.log("  " + s));
  if (!WRITE) { console.log("dry run; pass --write to save"); return; }
  // Same shape as the committed file: 2-space indent, LF, no final newline.
  const json = JSON.stringify(fixed, null, 2);
  for (const file of MIRRORS) writeFileSync(file, json);
  console.log("wrote", MIRRORS.length, "mirrors");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
