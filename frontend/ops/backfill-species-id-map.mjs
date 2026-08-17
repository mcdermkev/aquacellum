/**
 * backfill-species-id-map.mjs
 *
 * Populates `species_id_map` with the specCode -> on-chain speciesId relation for
 * every species already in the live catalog.
 *
 * WHY THIS EXISTS. Two different numbers are both called "speciesId" in this
 * codebase: the FishBase `specCode` (fishbase_master.json, Dexie `species`,
 * `species_insights.spec_code`) and the sequential on-chain id
 * (`db.specimens.speciesId`, `aquadex_specimens.species_id`,
 * `aquadex_spawns.species_id`). They line up today ONLY positionally — on-chain
 * id N happens to be json[N-1], verified across all 283 seeded entries with zero
 * drift — and nothing persisted that fact. The first out-of-order insert would
 * silently break every card link.
 *
 * It is also a hard precondition for publishing a species:
 * POST /api/species?action=promote REFUSES to spend the curator key while this
 * map is behind the chain, because an incomplete map cannot rule out a duplicate
 * catalog entry.
 *
 * This script is READ-ONLY with respect to the blockchain. It sends no
 * transactions and cannot change the catalog. It only reads the chain and writes
 * rows to Supabase, and it is idempotent — safe to re-run any time.
 *
 * It does NOT seed the 33 species that are in fishbase_master.json but not yet
 * on-chain. That needs `scripts/seed-species-catalog.js` (which does send
 * transactions); re-run this afterwards to record the new mappings.
 *
 * Usage, from the frontend/ directory:
 *   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node ops/backfill-species-id-map.mjs
 *
 * Flags:
 *   --dry-run   report what would be written, write nothing
 *   --report    additionally list JSON species that are NOT on-chain
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { ethers } from "ethers";
import { createClient } from "@supabase/supabase-js";

const here = dirname(fileURLToPath(import.meta.url));

const MANAGER_ADDRESS = (
  process.env.MANAGER_ADDRESS || "0x351ca8f34D94F29F6f865Afa419A636324473DeF"
).toLowerCase();
const RPC_URL = process.env.RPC_URL || "https://base-sepolia-rpc.publicnode.com";
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";

const DRY_RUN = process.argv.includes("--dry-run");
const REPORT = process.argv.includes("--report");

// Batched with a small delay because the public RPC endpoints rate-limit: an
// unthrottled 283-call loop reliably fails partway with "missing revert data".
const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 150;
const MAX_ATTEMPTS = 5;

const MANAGER_ABI = [
  "function nextSpeciesId() view returns (uint256)",
  "function speciesCatalog(uint256) view returns (uint256 speciesId, string scientificName, string commonName, string canonicalIpfsUri, uint8 careLevel, uint16 minTempCelsiusX10, uint16 maxTempCelsiusX10, uint8 minPhX10, uint8 maxPhX10, bool active)",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normalizeName(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}

async function readSpecies(manager, id) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await manager.speciesCatalog(id);
    } catch (err) {
      if (attempt === MAX_ATTEMPTS) throw err;
      await sleep(400 * attempt);
    }
  }
}

async function main() {
  if (!DRY_RUN && (!SUPABASE_URL || !SUPABASE_SERVICE_KEY)) {
    console.error(
      "Missing SUPABASE_URL / SUPABASE_SERVICE_KEY. Set them, or pass --dry-run to inspect without writing."
    );
    process.exit(1);
  }

  const catalogPath = join(here, "..", "public", "fishbase_master.json");
  const reference = JSON.parse(readFileSync(catalogPath, "utf8"));
  const byName = new Map();
  for (const sp of reference) {
    const key = normalizeName(sp.scientificName);
    if (key && !byName.has(key)) byName.set(key, sp);
  }

  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const manager = new ethers.Contract(MANAGER_ADDRESS, MANAGER_ABI, provider);

  const nextId = Number(await manager.nextSpeciesId());
  const total = nextId - 1;

  console.log(`Contract      : ${MANAGER_ADDRESS}`);
  console.log(`RPC           : ${RPC_URL}`);
  console.log(`Reference JSON: ${reference.length} species`);
  console.log(`On-chain      : ${total} species (nextSpeciesId=${nextId})`);
  console.log(`Mode          : ${DRY_RUN ? "DRY RUN (no writes)" : "WRITE"}\n`);

  if (total <= 0) {
    console.log("Nothing on-chain to map.");
    return;
  }

  const rows = [];
  const unmatched = [];
  const inactive = [];
  const onChainNames = new Set();

  for (let start = 1; start <= total; start += BATCH_SIZE) {
    const end = Math.min(start + BATCH_SIZE - 1, total);
    const ids = [];
    for (let i = start; i <= end; i++) ids.push(i);

    const results = await Promise.all(
      ids.map(async (id) => ({ id, species: await readSpecies(manager, id) }))
    );

    for (const { id, species } of results) {
      const key = normalizeName(species.scientificName);
      onChainNames.add(key);
      if (!species.active) inactive.push({ id, name: species.scientificName });

      const match = byName.get(key);
      if (!match || match.specCode == null) {
        // An on-chain species with no JSON counterpart. Recorded so it is visible
        // rather than silently skipped, but it gets no spec_code mapping.
        unmatched.push({ id, name: species.scientificName });
        continue;
      }

      rows.push({
        spec_code: match.specCode,
        contract_address: MANAGER_ADDRESS,
        onchain_species_id: id,
        scientific_name: species.scientificName,
        source: "backfill",
      });
    }

    process.stdout.write(`  read ${end}/${total}\r`);
    await sleep(BATCH_DELAY_MS);
  }
  console.log(`  read ${total}/${total}   `);

  console.log(`\nMapped         : ${rows.length}`);
  console.log(`Unmatched      : ${unmatched.length} (on-chain, absent from the JSON)`);
  console.log(`Inactive       : ${inactive.length}`);

  if (unmatched.length > 0) {
    console.log("\nOn-chain species with no reference entry:");
    for (const u of unmatched) console.log(`  #${u.id}  ${u.name}`);
  }

  if (REPORT) {
    const missing = reference.filter((r) => !onChainNames.has(normalizeName(r.scientificName)));
    console.log(`\nReference species NOT on-chain: ${missing.length}`);
    console.log("(these cannot be added to a tank until seeded — see scripts/seed-species-catalog.js)");
    for (const m of missing) {
      console.log(`  specCode ${m.specCode}\t${m.commonName} (${m.scientificName})`);
    }
  }

  if (DRY_RUN) {
    console.log("\nDry run — nothing written.");
    return;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  // Chunked upsert: a single 283-row payload is fine, but chunking keeps the
  // failure blast radius small and the progress legible.
  let written = 0;
  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50);
    const { error } = await supabase
      .from("species_id_map")
      .upsert(chunk, { onConflict: "spec_code,contract_address" });

    if (error) {
      console.error(`\nUpsert failed at rows ${i}-${i + chunk.length - 1}:`, error.message);
      process.exit(1);
    }
    written += chunk.length;
    process.stdout.write(`  wrote ${written}/${rows.length}\r`);
  }
  console.log(`  wrote ${written}/${rows.length}   `);

  const { count, error: countErr } = await supabase
    .from("species_id_map")
    .select("spec_code", { count: "exact", head: true })
    .eq("contract_address", MANAGER_ADDRESS);

  if (countErr) {
    console.error("\nCould not verify the final count:", countErr.message);
    process.exit(1);
  }

  console.log(`\nspecies_id_map now holds ${count} rows for this contract.`);
  if ((count || 0) < total) {
    console.log(
      `\nStill short of the ${total} on-chain species, so action=promote will keep refusing.\n` +
      `The gap is the ${unmatched.length} unmatched entries above — they need a reference\n` +
      `entry or a species_profiles row before they can be mapped.`
    );
    process.exit(2);
  }

  console.log("Complete. action=promote can now verify duplicates against the map.");
}

main().catch((err) => {
  console.error("\nBackfill failed:", err.message || err);
  process.exit(1);
});
