/**
 * author-species-profile.mjs
 *
 * Authors the rich care profile a species needs before it can be published.
 *
 * WHEN YOU NEED THIS. A suggestion whose `fishbase_match` is `none` is not in
 * fishbase_master.json, so there is no photo, ecology, diet, or personality for
 * its card. Publishing it anyway produces a card that renders empty, and that
 * cannot be patched afterwards by writing to Dexie `db.species`, because both of
 * that table's writers call clear() and refill from the bundled JSON file. So the
 * data has to live in Supabase `species_profiles`, which useSpeciesData merges
 * over the reference catalog on load.
 *
 * `?action=promote` refuses to publish a `none` match until a PUBLISHED profile
 * row exists, which is why this script exists rather than a hand-written INSERT.
 *
 * TWO STEPS, deliberately — the template is meant to be reviewed and filled in by
 * a human who knows the fish, not generated and shipped blind:
 *
 *   1. Emit a starter file, pre-filled from the suggestion:
 *        node ops/author-species-profile.mjs --suggestion <uuid> --template
 *
 *   2. Fill it in, then upload. Add --publish when you are happy with it:
 *        node ops/author-species-profile.mjs --file <path>
 *        node ops/author-species-profile.mjs --file <path> --publish
 *
 * Other commands:
 *   --list            pending/approved suggestions and their fishbase_match
 *   --drafts          authored profiles that are not published yet
 *   --publish-code N  publish an existing draft by spec_code
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_KEY (read from frontend/.env if present).
 * Writes only to `species_profiles`. Sends no transactions and never publishes to
 * the chain — that stays with the founder-gated promote endpoint.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { createClient } from "@supabase/supabase-js";

// ── env ─────────────────────────────────────────────────────────────────────
if (existsSync("./.env")) {
  for (const line of readFileSync("./.env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";

// ── args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
};

// Everything runs inside main() and returns an exit code rather than calling
// process.exit(). On Node 24 / Windows, exiting while the Supabase client still
// holds open handles trips a libuv assertion
// ("Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)"), which looks like a
// crash even on a fully successful run.
async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_KEY. Run this from frontend/ or set them.");
    return 1;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

// ── --list ──────────────────────────────────────────────────────────────────
if (flag("list")) {
  const { data, error } = await supabase
    .from("species_suggestion_queue")
    .select("id, common_name, scientific_name, status, fishbase_match, approvals_remaining, founder_approved")
    .in("status", ["pending", "approved"])
    .order("created_at", { ascending: false });
  if (error) {
    console.error("Read failed:", error.message);
    return 1;
  }
  if (!data.length) {
    console.log("No pending or approved suggestions.");
    return 0;
  }
  for (const s of data) {
    console.log(
      `${s.id}\n  ${s.common_name} (${s.scientific_name})\n` +
      `  status=${s.status}  match=${s.fishbase_match}  ` +
      `founderApproved=${s.founder_approved}  approvalsRemaining=${s.approvals_remaining}` +
      (s.fishbase_match === "none" ? "\n  -> needs a profile authored before it can be published" : "")
    );
  }
  return 0;
}

// ── --drafts ────────────────────────────────────────────────────────────────
if (flag("drafts")) {
  const { data, error } = await supabase
    .from("species_profiles")
    .select("spec_code, scientific_name, common_name, published, updated_at")
    .order("updated_at", { ascending: false });
  if (error) {
    console.error("Read failed:", error.message);
    return 1;
  }
  if (!data.length) {
    console.log("No authored profiles yet.");
    return 0;
  }
  for (const p of data) {
    console.log(
      `specCode ${p.spec_code}  ${p.published ? "PUBLISHED" : "draft    "}  ` +
      `${p.common_name} (${p.scientific_name})`
    );
  }
  return 0;
}

// ── --publish-code ──────────────────────────────────────────────────────────
const publishCode = value("publish-code");
if (publishCode) {
  const { data, error } = await supabase
    .from("species_profiles")
    .update({ published: true, updated_at: new Date().toISOString() })
    .eq("spec_code", Number(publishCode))
    .select()
    .maybeSingle();
  if (error) {
    console.error("Publish failed:", error.message);
    return 1;
  }
  if (!data) {
    console.error(`No profile with spec_code ${publishCode}.`);
    return 1;
  }
  console.log(`Published: ${data.common_name} (${data.scientific_name}), spec_code ${data.spec_code}`);
  console.log("The founder can now publish it to the catalog from the Council portal.");
  return 0;
}

// ── --suggestion <id> --template ────────────────────────────────────────────
const suggestionId = value("suggestion");
if (suggestionId && flag("template")) {
  const { data: sug, error } = await supabase
    .from("species_suggestions")
    .select("*")
    .eq("id", suggestionId)
    .maybeSingle();
  if (error || !sug) {
    console.error("Suggestion not found:", error?.message || suggestionId);
    return 1;
  }

  const [genus, ...rest] = String(sug.scientific_name || "").split(" ");
  const CARE_TO_DIFFICULTY = ["Beginner", "Intermediate", "Advanced", "Difficult"];

  // Shaped exactly like a fishbase_master.json record, because useSpeciesData
  // merges this over that array and the card reads the same paths either way.
  // Pre-filled with what the council already vetted; everything marked TODO is
  // what actually needs a human.
  const template = {
    _instructions: [
      "Fill in every TODO. Delete this _instructions key before uploading.",
      "tankMetrics.difficulty drives the on-chain careLevel, so get it right:",
      "  Beginner=0 Intermediate=1 Advanced=2 Difficult=3",
      "tankMetrics.tempRangeCelsius and ecology.phMin/phMax become the on-chain",
      "  ranges. They are pre-filled from the suggestion the council approved.",
      "masterPhotoUrl: put the image under frontend/public/species-images/ and",
      "  reference it as /species-images/<file>, matching the existing records.",
      "Then: node ops/author-species-profile.mjs --file <this file> --publish",
    ],
    suggestionId: sug.id,
    scientificName: sug.scientific_name,
    commonName: sug.common_name,
    genus: genus || "TODO",
    species: rest.join(" ") || "TODO",
    family: "TODO",
    maxLengthCm: 0,
    masterPhotoUrl: "",
    tankMetrics: {
      tempRangeCelsius: [Number(sug.min_temp_c), Number(sug.max_temp_c)],
      phRange: [Number(sug.min_ph), Number(sug.max_ph)],
      difficulty: CARE_TO_DIFFICULTY[Number(sug.care_level)] || "Intermediate",
      minVolumeGallons: 0,
    },
    ecology: {
      comments: "TODO",
      biotope: "TODO",
      phMin: Number(sug.min_ph),
      phMax: Number(sug.max_ph),
      hardnessRange: "TODO",
      tempCeiling: Number(sug.max_temp_c),
      socialBehavior: "TODO",
    },
    diet: { trophicLevel: "TODO", fooditems: "TODO", feedingPlaybook: "TODO" },
    reproduction: { spawningTrait: "TODO", layoutRequirement: "TODO", comments: "TODO" },
    personality: {
      vibeLine: { casual: "TODO", pro: "TODO" },
      flavorText: { casual: "TODO", pro: "TODO" },
    },
    lifespan: { averageYears: 0, rangeYears: [0, 0], notes: "TODO" },
    origin: { native: "TODO", countries: [], waterways: "TODO", habitat: "TODO", iucnStatus: "TODO" },
    behavior: {
      swimmingLevel: "TODO", activityPattern: "TODO", activityLevel: "TODO",
      temperament: "TODO", notes: "TODO",
    },
    sexualDimorphism: { identifiable: false, male: "TODO", female: "TODO", maturityAge: "TODO" },
    diseases: { susceptibility: "TODO", common: [] },
    tankmates: { compatible: [], incompatible: [], notes: "TODO" },
    variants: { types: [] },
    acclimation: { method: "TODO", sensitivity: "TODO", notes: "TODO", quarantineDays: 14 },
    tankRequirements: {
      minDimensions: "TODO", idealDimensions: "TODO", flowRate: "TODO",
      lighting: "TODO", substrate: "TODO", decorEssentials: "TODO",
      lidRequired: false, lidNotes: "",
    },
    growthTimeline: [],
    maintenance: {
      waterChangePercent: 25, waterChangeFrequency: "Weekly",
      notes: "TODO", filterMaintenance: "TODO", testSchedule: "TODO",
    },
    mythsVsReality: [],
    enrichment: { tips: [], notes: "TODO" },
    availability: { commonness: "TODO", priceRange: "TODO", notes: "TODO", whereToBuy: [] },
    sources: sug.proof_url ? [{ name: "Submitted reference", url: sug.proof_url, type: "Reference" }] : [],
    enhanced: true,
  };

  const slug = String(sug.scientific_name || "species").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const out = value("template") || `species-profile-${slug}.json`;
  writeFileSync(out, JSON.stringify(template, null, 2));
  console.log(`Template written: ${out}`);
  console.log(`Fill in the TODOs, then:\n  node ops/author-species-profile.mjs --file ${out} --publish`);
  return 0;
}

// ── --file <path> [--publish] ───────────────────────────────────────────────
const file = value("file");
if (file) {
  if (!existsSync(file)) {
    console.error(`No such file: ${file}`);
    return 1;
  }
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  const { _instructions, suggestionId: linkedId, ...profile } = parsed;

  if (!profile.scientificName || !profile.commonName) {
    console.error("The profile needs both scientificName and commonName.");
    return 1;
  }

  // Refuse to publish a half-filled template. An empty card is the exact failure
  // this whole overlay exists to prevent, so it is worth blocking loudly.
  const remainingTodos = JSON.stringify(profile).match(/TODO/g)?.length || 0;
  if (flag("publish") && remainingTodos > 0) {
    console.error(
      `Refusing to publish: ${remainingTodos} TODO placeholder(s) remain.\n` +
      `Upload it as a draft (omit --publish) or finish the fields first.`
    );
    return 1;
  }
  if (remainingTodos > 0) {
    console.log(`Note: ${remainingTodos} TODO placeholder(s) remain — uploading as a draft.`);
  }

  const existing = await supabase
    .from("species_profiles")
    .select("spec_code")
    .ilike("scientific_name", profile.scientificName)
    .maybeSingle();

  const row = {
    scientific_name: profile.scientificName,
    common_name: profile.commonName,
    profile,
    source: "suggestion",
    suggestion_id: linkedId || null,
    published: flag("publish") && remainingTodos === 0,
    updated_at: new Date().toISOString(),
  };
  // Let the sequence assign spec_code on first insert; reuse it on update so the
  // species_id_map relation and any existing card link stay stable.
  if (existing.data?.spec_code) row.spec_code = existing.data.spec_code;

  const { data, error } = await supabase
    .from("species_profiles")
    .upsert(row, { onConflict: "spec_code" })
    .select()
    .single();

  if (error) {
    console.error("Upload failed:", error.message);
    return 1;
  }

  console.log(`${existing.data ? "Updated" : "Created"} profile for ${data.common_name} (${data.scientific_name})`);
  console.log(`  spec_code : ${data.spec_code}`);
  console.log(`  published : ${data.published}`);
  if (data.published) {
    console.log("\nA founder can now publish it to the live catalog from the Council portal.");
  } else {
    console.log(`\nStill a draft. Publish it with:\n  node ops/author-species-profile.mjs --publish-code ${data.spec_code}`);
  }
  return 0;
}

  // No recognised command: print this file's own header as the usage text.
  console.log(
    readFileSync(new URL(import.meta.url))
      .toString()
      .split("*/")[0]
      .replace(/^\/\*\*?/, "")
      .replace(/^ \* ?/gm, "")
  );
  return 1;
}

process.exitCode = await main();
