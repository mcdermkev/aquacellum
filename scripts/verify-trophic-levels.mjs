#!/usr/bin/env node
/**
 * verify-trophic-levels.mjs: check every FishBase fish's `diet.trophicLevel`
 * against the local FishBase dump, and fix the "Omnivore" values that FishBase
 * contradicts or that are provably the old seed default.
 *
 * Why: scripts/seed_from_collectr.js used to write `trophicLevel: "Omnivore"`
 * whenever its source lacked a value, and nothing marks which Omnivores are
 * real. Later scripts added more "Omnivore" labels from their own troph cut-offs
 * (merge-verified-data.mjs mapped troph 2.8-3.3 to Omnivore; the add-*-batch
 * scripts mapped 2.8-3.8 to Omnivore), which FishBase itself files as
 * "mainly animals".
 *
 * FishBase evidence (repo-root parquet dumps; one ecology row per species here):
 *   ecology.Herbivory2   FishBase's own class: "mainly plants/detritus
 *                        (troph. 2-2.19)", "plants/detritus+animals (troph.
 *                        2.2-2.79)", "mainly animals (troph. 2.8 and up)".
 *                        Has its own reference (HerbivoryRef).
 *   ecology.FeedingType  curated text. Only unambiguous ones map to a class:
 *                        "hunting macrofauna (predator)", "picking parasites off
 *                        a host (cleaner)", "feeding on a host (parasite)",
 *                        "feeding on dead animals (scavenger)" -> carnivore;
 *                        "grazing on aquatic plants" -> herbivore. "variable",
 *                        "browsing on substrate", "filtering plankton",
 *                        "selective plankton feeding", "other" name a feeding
 *                        mode, not a diet, and are neutral.
 *   ecology.DietTroph    trophic level from diet-composition studies (+ DietSeTroph).
 *   ecology.FoodTroph    trophic level from the food-items table (+ FoodSeTroph).
 *                        When FoodRemark says "Tentative ... single food item"
 *                        it is weak: it can veto (conflict) but cannot decide.
 *   estimate.Troph       only used when TrophObserved = -1 (species data) and
 *                        ecology has no Diet/FoodTroph. TrophObserved = 0 means a
 *                        model estimate from size and relatives: not data about
 *                        this species, only shown in the report.
 *   diet / fooditems     row counts only, to tell "no data at all" apart.
 * Numbers use the Herbivory2 cut-offs: < 2.2 herbivore/detritivore, 2.2-2.79
 * omnivore, >= 2.8 carnivore.
 *
 * FishBase verdict: "clear" when at least one decisive signal (Herbivory2,
 * mapped FeedingType, DietTroph, non-tentative FoodTroph, observed estimate)
 * names a class and no signal (tentative FoodTroph included) names another;
 * "conflict" when signals disagree; "weak" when there is some species data but
 * nothing decisive; "none" when FishBase has no species-level feeding data.
 *
 * Rules (records with fishbaseSpecCode and a trophicLevel only; corals,
 * inverts, plants and anything without fishbaseSpecCode are never touched):
 *   - clear and agrees with the catalog class                   -> keep
 *   - clear, catalog is exactly "Omnivore", FishBase says
 *     herbivore or carnivore                                    -> set the FishBase
 *     label ("Herbivore / Detritivore" or "Carnivore", the catalog's vocabulary)
 *     and write diet.trophicSource. Exception: the four hand-set Omnivores in
 *     merge-verified-data.mjs trophOverrides (kuhli loaches, discus) are a
 *     deliberate aquarium-diet call; report only.
 *   - clear and disagrees with any other label                  -> report only
 *   - catalog exactly "Omnivore", FishBase "none", and solid evidence the value
 *     is the seed default for this record                       -> trophicLevel
 *     null, diet.trophicSource says why. Evidence, all required:
 *       1. in the first committed catalog (git SEED_COMMIT) the record, same
 *          specCode, had the seed script's all-default diet: trophicLevel
 *          "Omnivore", fooditems and feedingPlaybook "Information arriving soon".
 *          The script wrote those three only as fallbacks, so the source had no
 *          diet at all for it;
 *       2. its scientificName is a row of local_data/supabase_migration_source.json,
 *          the seed source, whose rows carry no trophic field;
 *       3. no one has added a real fooditems or feedingPlaybook since (a later
 *          diet edit may have looked at and kept the Omnivore).
 *   - any other "Omnivore" FishBase cannot confirm               -> keep, listed
 *     as unverified.
 *
 * Re-runnable (a second run changes nothing). Writes both catalog mirrors
 * byte-identically, then rebuild the homepage index:
 *   node scripts/verify-trophic-levels.mjs           # report only (dry run)
 *   node scripts/verify-trophic-levels.mjs --write   # report + write both mirrors
 *   node scripts/build-species-index.mjs
 * Flags: --all also lists every agreeing record.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parquetRead } from "hyparquet";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const MIRRORS = [`${ROOT}frontend/public/fishbase_master.json`, `${ROOT}frontend/fishbase_master.json`];
const SEED_SOURCE = `${ROOT}local_data/supabase_migration_source.json`;
/** First commit of the catalog: the seed script's output, before any cleanup. */
export const SEED_COMMIT = "71ed357";
const SEED_PLACEHOLDER = "Information arriving soon";

export const LABELS = { herbivore: "Herbivore / Detritivore", omnivore: "Omnivore", carnivore: "Carnivore" };

/** Hand-set Omnivores (merge-verified-data.mjs trophOverrides): report, never change. */
export const CURATED_OMNIVORES = new Set([
  "Pangio kuhlii",
  "Pangio oblonga",
  "Pangio semicincta",
  "Symphysodon aequifasciatus",
]);
/**
 * Names some script set to "Omnivore" on purpose (merge-verified-data.mjs
 * trophOverrides, fill-remaining-gaps.mjs fishFixes / fishEcology). Unsourced,
 * so FishBase can still overrule them, but they are never treated as the seed
 * default.
 */
export const HAND_SET_OMNIVORES = new Set([
  ...CURATED_OMNIVORES,
  "Hyphessobrycon eques",
  "Hyphessobrycon erythrostigma",
  "Hyphessobrycon megalopterus",
  "Hyphessobrycon sweglesi",
  "Moenkhausia pittieri",
  "Moenkhausia sanctaefilomenae",
  "Apistogramma borellii Opal",
  "Hemigrammus rhodostomus",
  "Leporinus vanzoi",
  "Rasbora trilineata",
  "Iriatherina werneri",
  "Biotodoma cupido",
  "Chilatherina axelrodi",
]);
/**
 * Stock feedingPlaybook sentence written in commit 465c7ec from the record's
 * own trophicLevel. It restates the label, so it is not evidence for it.
 */
const TEMPLATE_PLAYBOOK = "Omnivorous and generally unfussy.";

/**
 * True when the record's own diet text (a real source such as the Seriously
 * Fish text in fooditems) calls the fish omnivorous, independent of the label.
 */
export function dietTextSaysOmnivore(diet) {
  const food = typeof diet?.fooditems === "string" ? diet.fooditems : "";
  const playbook = typeof diet?.feedingPlaybook === "string" ? diet.feedingPlaybook.split(TEMPLATE_PLAYBOOK).join("") : "";
  return /omnivor/i.test(food) || /omnivor/i.test(playbook);
}

const HERBIVORY2 = new Map([
  ["mainly plants/detritus (troph. 2-2.19)", "herbivore"],
  ["plants/detritus+animals (troph. 2.2-2.79)", "omnivore"],
  ["mainly animals (troph. 2.8 and up)", "carnivore"],
]);
const FEEDING_TYPE = new Map([
  ["hunting macrofauna (predator)", "carnivore"],
  ["picking parasites off a host (cleaner)", "carnivore"],
  ["feeding on a host (parasite)", "carnivore"],
  ["feeding on dead animals (scavenger)", "carnivore"],
  ["grazing on aquatic plants", "herbivore"],
]);
/** FeedingType values that fit an omnivore: they veto a herbivore/carnivore call but cannot make one. */
const FEEDING_TYPE_VETO = new Map([["variable", "omnivore"]]);
const TENTATIVE_FOOD = /^tentative/i;

const CATALOG_CLASS = new Map([
  ["omnivore", "omnivore"],
  ["omnivore/detritivore", "omnivore"],
  ["omnivore / detritivore", "omnivore"],
  ["omnivore (primarily herbivore/detritivore)", "omnivore"],
  ["carnivore", "carnivore"],
  ["carnivore / piscivore", "carnivore"],
  ["piscivore", "carnivore"],
  ["herbivore", "herbivore"],
  ["herbivore / detritivore", "herbivore"],
  ["detritivore", "herbivore"],
]);

/** Catalog label -> "herbivore" | "omnivore" | "carnivore" | null (unmapped). */
export function catalogClass(label) {
  if (typeof label !== "string") return null;
  return CATALOG_CLASS.get(label.trim().toLowerCase()) ?? null;
}

/** FishBase trophic level -> class, using the Herbivory2 cut-offs. */
export function trophClass(t) {
  if (typeof t !== "number" || !Number.isFinite(t)) return null;
  if (t < 2.2) return "herbivore";
  if (t < 2.8) return "omnivore";
  return "carnivore";
}

const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const fmt = (v, se) => `${Number(v).toFixed(2)}${se != null ? ` (s.e. ${Number(se).toFixed(2)})` : ""}`;

/**
 * Build the FishBase signals for one species.
 * @param {{ecology?: object, estimate?: object, dietRows?: number, foodRows?: number}} fb
 * @returns {{source: string, text: string, cls: (string|null), decisive: boolean}[]}
 */
export function fishbaseSignals(fb) {
  const out = [];
  const e = fb?.ecology;
  if (e) {
    if (e.Herbivory2) {
      out.push({ source: "Herbivory2", text: e.Herbivory2, cls: HERBIVORY2.get(e.Herbivory2) ?? null, decisive: HERBIVORY2.has(e.Herbivory2) });
    }
    if (e.FeedingType) {
      const cls = FEEDING_TYPE.get(e.FeedingType) ?? FEEDING_TYPE_VETO.get(e.FeedingType) ?? null;
      out.push({ source: "FeedingType", text: e.FeedingType, cls, decisive: FEEDING_TYPE.has(e.FeedingType) });
    }
    const dt = num(e.DietTroph);
    if (dt != null) out.push({ source: "DietTroph", text: fmt(dt, num(e.DietSeTroph)), cls: trophClass(dt), decisive: true });
    const ft = num(e.FoodTroph);
    if (ft != null) {
      const tentative = TENTATIVE_FOOD.test(String(e.FoodRemark || ""));
      out.push({ source: tentative ? "FoodTroph (tentative, 1 food item)" : "FoodTroph", text: fmt(ft, num(e.FoodSeTroph)), cls: trophClass(ft), decisive: !tentative });
    }
  }
  const est = fb?.estimate;
  const hasEcoTroph = out.some((s) => s.source === "DietTroph" || s.source.startsWith("FoodTroph"));
  if (est && num(est.Troph) != null && Number(est.TrophObserved) === -1 && !hasEcoTroph) {
    out.push({ source: "estimate Troph (observed)", text: fmt(num(est.Troph), num(est.seTroph)), cls: trophClass(num(est.Troph)), decisive: true });
  }
  return out;
}

/**
 * FishBase's verdict for one species.
 * @returns {{status: "clear"|"conflict"|"weak"|"none", cls: (string|null), signals: object[], source: (string|null), model: (string|null)}}
 */
export function fishbaseVerdict(fb, fishbaseSpecCode) {
  const signals = fishbaseSignals(fb);
  const est = fb?.estimate;
  const model = est && num(est.Troph) != null && Number(est.TrophObserved) !== -1 ? fmt(num(est.Troph), num(est.seTroph)) : null;
  const classed = signals.filter((s) => s.cls);
  const classes = new Set(classed.map((s) => s.cls));
  const decisive = classed.filter((s) => s.decisive);
  const source = signals.length
    ? `FishBase SpecCode ${fishbaseSpecCode}: ${signals.map((s) => `${s.source} ${s.text}`).join("; ")}`
    : null;
  if (classes.size > 1) return { status: "conflict", cls: null, signals, source, model };
  // Clear: one class, named by at least one decisive signal and at least two signals in all.
  if (decisive.length && classed.length >= 2) return { status: "clear", cls: decisive[0].cls, signals, source, model };
  const anyData = signals.length > 0 || (fb?.dietRows ?? 0) > 0 || (fb?.foodRows ?? 0) > 0;
  return { status: anyData ? "weak" : "none", cls: null, signals, source, model };
}

/** Rebuild `diet` with trophicLevel set and trophicSource right after it. */
function withTrophic(diet, trophicLevel, trophicSource) {
  const out = {};
  for (const [k, v] of Object.entries(diet)) {
    if (k === "trophicSource") continue;
    out[k] = k === "trophicLevel" ? trophicLevel : v;
    if (k === "trophicLevel") out.trophicSource = trophicSource;
  }
  return out;
}

/**
 * Classify every record and build the corrected catalog. Pure.
 * @param {object[]} catalog
 * @param {Map<number, object>} fishbase  fishbaseSpecCode -> {ecology, estimate, dietRows, foodRows}
 * @param {Set<number>} seedDefaults      specCodes with seed-default evidence 1 and 2
 * @returns {{next: object[], rows: object[], counts: Record<string, number>}}
 */
export function planTrophicLevels(catalog, fishbase, seedDefaults = new Set()) {
  const rows = [];
  const next = catalog.map((rec) => {
    const level = rec.diet?.trophicLevel;
    if (rec.fishbaseSpecCode == null || typeof level !== "string" || !level.trim()) return rec;
    const code = Number(rec.fishbaseSpecCode);
    const v = fishbaseVerdict(fishbase.get(code), code);
    const mine = catalogClass(level);
    const isOmnivore = level === "Omnivore";
    const row = { specCode: rec.specCode, name: rec.scientificName, level, fishbase: v, kind: null, to: undefined };
    rows.push(row);
    let out = rec;
    if (v.status === "clear") {
      if (mine === v.cls) row.kind = "agree";
      else if (isOmnivore && !CURATED_OMNIVORES.has(rec.scientificName)) {
        row.kind = "changed";
        row.to = LABELS[v.cls];
        out = { ...rec, diet: withTrophic(rec.diet, row.to, v.source) };
      } else if (mine == null) row.kind = "unmapped";
      else row.kind = isOmnivore ? "disagree-curated" : "disagree";
    } else if (v.status === "none" && isOmnivore && seedDefaults.has(Number(rec.specCode))
      && !HAND_SET_OMNIVORES.has(rec.scientificName) && !dietTextSaysOmnivore(rec.diet)) {
      row.kind = "removed";
      row.to = null;
      out = {
        ...rec,
        diet: withTrophic(rec.diet, null,
          `Removed seed default "Omnivore" (scripts/seed_from_collectr.js fallback; source row had no diet); FishBase SpecCode ${code} has no feeding data`),
      };
    } else if (isOmnivore) {
      row.kind = `unverified-${v.status}`;
      if (v.status === "none" && seedDefaults.has(Number(rec.specCode))) {
        row.note = HAND_SET_OMNIVORES.has(rec.scientificName)
          ? "seed default, later hand-set to Omnivore"
          : "seed default, but the record's diet text calls it omnivorous";
      }
    } else row.kind = `unconfirmed-${v.status}`;
    return out;
  });
  const counts = {};
  for (const r of rows) counts[r.kind] = (counts[r.kind] || 0) + 1;
  // The stock playbook sentence restated the old "Omnivore" label. Once a
  // record's label is no longer Omnivore it contradicts the record, so drop
  // that sentence (and only it); the rest of the feeding advice stays.
  let stripped = 0;
  const cleaned = next.map((rec) => {
    const out = stripStaleTemplate(rec);
    if (out !== rec) stripped++;
    return out;
  });
  if (stripped) counts["playbook-template-removed"] = stripped;
  return { next: cleaned, rows, counts };
}

/** Remove TEMPLATE_PLAYBOOK from a record whose trophicLevel is not "Omnivore". Pure; same object when unchanged. */
export function stripStaleTemplate(rec) {
  const d = rec?.diet;
  const pb = d?.feedingPlaybook;
  if (!d || typeof pb !== "string" || !pb.includes(TEMPLATE_PLAYBOOK) || d.trophicLevel === "Omnivore") return rec;
  if (rec.fishbaseSpecCode == null || !("trophicSource" in d)) return rec;
  const text = pb.split(TEMPLATE_PLAYBOOK).join("").replace(/\s{2,}/g, " ").trim();
  return { ...rec, diet: { ...d, feedingPlaybook: text || null } };
}

async function readParquet(name, columns) {
  const buf = readFileSync(`${ROOT}${name}`);
  const file = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  let rows = [];
  await parquetRead({ file, columns, rowFormat: "object", onComplete: (d) => { rows = d; } });
  return rows;
}

/** Load FishBase feeding data for the given SpecCodes (all when omitted). */
export async function loadFishBase(codes = null) {
  const want = (c) => codes == null || codes.has(Number(c));
  const map = new Map();
  const get = (c) => {
    const k = Number(c);
    if (!map.has(k)) map.set(k, { ecology: null, estimate: null, dietRows: 0, foodRows: 0 });
    return map.get(k);
  };
  const eco = await readParquet("fishbase_ecology.parquet", [
    "SpecCode", "Herbivory2", "FeedingType", "DietTroph", "DietSeTroph", "FoodTroph", "FoodSeTroph", "FoodRemark",
  ]);
  for (const r of eco) {
    if (!want(r.SpecCode)) continue;
    const slot = get(r.SpecCode);
    if (slot.ecology) throw new Error(`FishBase SpecCode ${r.SpecCode} has several ecology rows; merge rule needed`);
    slot.ecology = r;
  }
  for (const r of await readParquet("fishbase_estimate.parquet", ["SpecCode", "Troph", "seTroph", "TrophObserved"])) {
    if (want(r.SpecCode)) get(r.SpecCode).estimate = r;
  }
  for (const r of await readParquet("fishbase_diet.parquet", ["Speccode"])) if (want(r.Speccode)) get(r.Speccode).dietRows++;
  for (const r of await readParquet("fishbase_fooditems.parquet", ["SpecCode"])) if (want(r.SpecCode)) get(r.SpecCode).foodRows++;
  return map;
}

/**
 * specCodes whose "Omnivore" is the seed default (evidence 1 and 2 in the header).
 * Needs git history; returns null when SEED_COMMIT is not available.
 */
export function loadSeedDefaults() {
  let first;
  try {
    const text = execFileSync("git", ["show", `${SEED_COMMIT}:frontend/public/fishbase_master.json`], {
      cwd: ROOT, maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"],
    }).toString("utf8");
    first = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
  if (!existsSync(SEED_SOURCE)) return null;
  const source = JSON.parse(readFileSync(SEED_SOURCE, "utf8"));
  if (source.some((r) => "trophic_level" in r || "trophicLevel" in r)) {
    throw new Error("seed source now carries a trophic field; the seed-default evidence no longer holds");
  }
  const seeded = new Set(source.map((r) => String(r.scientific_name).trim().toLowerCase()));
  const out = new Set();
  for (const r of first) {
    const d = r.diet;
    if (d?.trophicLevel === "Omnivore" && d.fooditems === SEED_PLACEHOLDER && d.feedingPlaybook === SEED_PLACEHOLDER
      && seeded.has(String(r.scientificName).trim().toLowerCase())) {
      out.add(Number(r.specCode));
    }
  }
  return out;
}

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

async function main() {
  const WRITE = process.argv.includes("--write");
  const ALL = process.argv.includes("--all");
  const text = readFileSync(MIRRORS[0], "utf8");
  for (const m of MIRRORS.slice(1)) {
    if (readFileSync(m, "utf8") !== text) throw new Error(`${m} differs from ${MIRRORS[0]}; sync the mirrors first`);
  }
  const catalog = JSON.parse(text);
  const codes = new Set(catalog.filter((r) => r.fishbaseSpecCode != null).map((r) => Number(r.fishbaseSpecCode)));
  const fishbase = await loadFishBase(codes);
  const seed = loadSeedDefaults();
  if (!seed) console.log(`WARNING: git ${SEED_COMMIT} or the seed source is unavailable; no seed default will be removed.\n`);
  else console.log(`Seed-default evidence (first catalog commit + seed source): ${seed.size} records.\n`);
  const { next, rows, counts } = planTrophicLevels(catalog, fishbase, seed || new Set());

  const line = (r) => `${pad(r.specCode, 7)} ${pad(r.name, 34)} ${pad(JSON.stringify(r.level), 26)}`;
  const section = (title, list, extra) => {
    if (!list.length) return;
    console.log(`\n${title} (${list.length}):`);
    for (const r of list) console.log(`  ${line(r)} ${extra(r)}`);
  };
  const by = (k) => rows.filter((r) => r.kind === k);
  section("Changed", by("changed"), (r) => `-> ${JSON.stringify(r.to)}  [${r.fishbase.source}]`);
  section("Removed seed default (trophicLevel -> null)", by("removed"), (r) => (r.fishbase.model ? `(FishBase model estimate only: ${r.fishbase.model})` : ""));
  section("Disagree, report only", by("disagree"), (r) => `FishBase: ${r.fishbase.cls}  [${r.fishbase.source}]`);
  section("Disagree with a hand-set Omnivore (merge-verified-data.mjs), report only", by("disagree-curated"), (r) => `FishBase: ${r.fishbase.cls}  [${r.fishbase.source}]`);
  section("FishBase signals conflict, report only", rows.filter((r) => r.fishbase.status === "conflict"), (r) => `[${r.fishbase.source}]`);
  section("Unverified Omnivore, FishBase data weak", by("unverified-weak"), (r) => `[${r.fishbase.source ?? "diet/fooditems rows only"}]`);
  section("Unverified Omnivore, FishBase has no data", by("unverified-none"),
    (r) => [r.note, r.fishbase.model ? `model estimate only: ${r.fishbase.model}` : ""].filter(Boolean).join("; "));
  section("Unmapped catalog label", by("unmapped"), (r) => `FishBase: ${r.fishbase.cls}`);
  if (ALL) section("Agree", by("agree"), (r) => `[${r.fishbase.source}]`);

  const omni = rows.filter((r) => r.level === "Omnivore");
  console.log(`\nSummary (${rows.length} records with fishbaseSpecCode and a trophicLevel; ${omni.length} say "Omnivore"):`);
  for (const [k, n] of Object.entries(counts).sort()) console.log(`  ${pad(k, 22)} ${n}`);

  const out = JSON.stringify(next, null, 2);
  const changed = out !== text;
  if (!WRITE) {
    console.log(`\nDry run. ${changed ? "Changes pending; re-run with --write." : "Mirrors already up to date."}`);
    return;
  }
  if (changed) for (const m of MIRRORS) writeFileSync(m, out);
  console.log(`\nWrote ${MIRRORS.length} mirrors (${changed ? "updated" : "unchanged"}). Now run: node scripts/build-species-index.mjs`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
