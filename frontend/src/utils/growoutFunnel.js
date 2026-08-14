/**
 * growoutFunnel.js — the one implementation of the grow-out survival funnel.
 *
 * This math was duplicated across FOUR files, each with its own slightly
 * different shape:
 *
 *   SpawnGrowoutTracker.jsx   totalFry / totalCulled / totalSold / totalLoss / survivors / survivalRate
 *   BatchGrowOutPanel.jsx     maxFry / losses(+culled) / sold / alive / survival
 *   BreederAchievements.jsx   maxFry / losses / culls / sold / alive  (aggregated)
 *   GrowOutChart.jsx          the same totals, accumulated over time
 *
 * That's the same fifth-copy pattern the specimen status labels had, and it has a
 * specific consequence: adding a new checkpoint type means editing four files,
 * and missing one produces a *silent accounting error* rather than a crash — the
 * funnel just quietly stops adding up. Extracting this is the prerequisite for
 * the `promoted` type that cohort → certificate promotion needs
 * (docs/BREEDER_STATE_MODEL.md §9.16).
 *
 * HOW THE COUNTS WORK (preserving existing behavior exactly):
 *
 *   fry      = the HIGHEST `fry_count` ever recorded — a running headcount, not a
 *              sum. Logging "40 fry" twice means 40, not 80.
 *   lost     = sum of `loss`
 *   culled   = sum of `cull`
 *   sold     = sum of `sold`
 *   promoted = sum of `promoted`
 *   alive    = fry − (every departure type), floored at 0
 *
 * SURVIVAL RATE IS `(fry − lost) / fry` — culls, sales, and promotions are
 * deliberately NOT counted against it. For promotions it is the only defensible
 * reading: a promoted fry is the *success* case, and a rate that dropped when a
 * breeder pulled their best keepers out would be actively misleading.
 *
 * ── §9.21 IS DECIDED: CULLS STAY OUT. (2026-07-31) ──────────────────────────
 *
 * This was carried as an open product question for the whole stream. Resolved as
 * KEEP, and the reasoning is recorded here rather than only in the register because
 * this is the line somebody would "fix":
 *
 *   1. A cull is an INTENTIONAL removal, not a failure to survive. The two are
 *      different events and the rate is named for one of them. `loss` already
 *      carries the fish that died.
 *   2. **Culls are already counted where it matters.** `cull` is in
 *      `DEPARTURE_TYPES`, so it reduces `alive` — and therefore `totalFrySurvived`,
 *      which is what the Century Club / Five Hundred Strong / Thousand Keeper
 *      achievements read. So a heavy culler already shows fewer fish. What they do
 *      not show is a *worse survival rate*, which is correct: they did not lose
 *      those fish, they chose against them.
 *   3. Changing it would RETRACT badges, not recalibrate them. `survival_90`
 *      ("Strong Lines") and `survival_95` ("Elite Genetics") gate on
 *      `bestSurvivalRate`, and both are shareable through
 *      `generateSpawnMilestoneCard` — so cards are already in the wild. Counting
 *      culls would take earned badges away from breeders who did nothing wrong and
 *      make a previously-shared card disagree with the app.
 *
 * If this is ever revisited, the honest version is a SECOND, separately-named
 * metric ("retention including culls") rather than redefining this one — for the
 * same reason §9.11 shows verified sales and self-reported "Rehomed" side by side
 * instead of merging them.
 *
 * `narration` and `note` rows carry no counts and are excluded from the math.
 *
 * ONE LIST, NOT THREE PLACES. Both `summarizeGrowout` and `buildGrowoutTimeline`
 * derive departures by reducing over DEPARTURE_TYPES. They used to hardcode
 * `lost + culled + sold` and an `else if` chain respectively, which made the
 * array below documentation that happened to be true rather than the thing the
 * math read — appending to it changed nothing. Adding `promoted` is what forced
 * the issue: this module was extracted precisely to make a new checkpoint type a
 * one-place change, and it wasn't one yet.
 */

/** Checkpoint types that carry a meaningful count. */
export const COUNTED_TYPES = Object.freeze([
  "fry_count",
  "cull",
  "sold",
  "loss",
  "moved",
  "promoted",
]);

/** Types that are commentary, not accounting. */
export const NON_COUNTING_TYPES = Object.freeze(["note", "narration"]);

/**
 * Types that REDUCE the living population.
 *
 * `moved` is absent on purpose — moving fry to a grow-out tank relocates them, it
 * doesn't remove them from the cohort.
 *
 * `promoted` IS a departure, and this is an accounting invariant rather than a
 * preference (BREEDER_STATE_MODEL §9.16): a fish is counted either as a cohort
 * head or as an individual birth certificate, never both and never neither. A
 * cohort of 15 that promotes 3 has 12 alive plus 3 certificates. If `promoted`
 * were not a departure it would read as 15 alive plus 3 certificates — 18 fish
 * that do not exist — and it would surface as inflated Achievements and Founders
 * totals rather than as a crash.
 */
export const DEPARTURE_TYPES = Object.freeze(["cull", "sold", "loss", "promoted"]);

/** True for a row that participates in the funnel math. */
export function isCountingCheckpoint(checkpoint) {
  return !!checkpoint && !NON_COUNTING_TYPES.includes(checkpoint.type);
}

/**
 * The first second at or after `now` with no checkpoint of `type` already on it.
 *
 * WHY THIS EXISTS AND WHY IT LIVES HERE: the cloud mirror table
 * `aquadex_spawn_growout` has the natural key
 * `(owner_address, spawn_id, event_timestamp, type)` and **collisions upsert**. So
 * two checkpoints of the same type written in the same second silently collapse
 * into one row and the cohort undercounts — a data bug that surfaces as wrong
 * Achievements totals rather than as an error.
 *
 * It was private to `services/cohortPromotion.js`. It is here because this module
 * is the one place checkpoint rules are supposed to live (see the header: a second
 * copy is how the funnel math drifted across four files), and there is now a
 * second writer — `services/growoutTank.js`.
 *
 * @param {Array<object>} existingCheckpoints rows for the spawn
 * @param {number} now unix seconds
 * @param {string} type the checkpoint type about to be written
 */
export function nextFreeCheckpointTimestamp(existingCheckpoints, now, type) {
  const taken = new Set(
    (existingCheckpoints || [])
      .filter((c) => c?.type === type)
      .map((c) => Number(c.timestamp))
  );
  let ts = now;
  while (taken.has(ts)) ts += 1;
  return ts;
}

function sumOf(checkpoints, type) {
  return checkpoints
    .filter((c) => c.type === type)
    .reduce((sum, c) => sum + (Number(c.count) || 0), 0);
}

function highestOf(checkpoints, type) {
  return checkpoints
    .filter((c) => c.type === type)
    .reduce((max, c) => Math.max(max, Number(c.count) || 0), 0);
}

/**
 * Summarize a single spawn's grow-out.
 *
 * @param {Array<object>} checkpoints - `spawnGrowout` rows for one spawn
 * @param {{ eggCount?: number }} [options] - the cohort's starting size, if known
 * @returns {{
 *   eggs: number, fry: number, culled: number, sold: number, lost: number,
 *   promoted: number, departed: number, alive: number, survivalRate: number|null,
 *   checkpointCount: number, lastCheckpointAt: number|null
 * }}
 *   `survivalRate` is null — not 0 — when no fry count has been recorded, so a
 *   brand-new spawn reads as "unknown" rather than "0% survived".
 */
export function summarizeGrowout(checkpoints, { eggCount = 0 } = {}) {
  const rows = (Array.isArray(checkpoints) ? checkpoints : []).filter(isCountingCheckpoint);

  const fry = highestOf(rows, "fry_count");
  const lost = sumOf(rows, "loss");
  const culled = sumOf(rows, "cull");
  const sold = sumOf(rows, "sold");
  const promoted = sumOf(rows, "promoted");

  // Derived from the list, not from a hand-maintained sum of the types that
  // happened to exist when this was written. See the header.
  const departed = DEPARTURE_TYPES.reduce((total, type) => total + sumOf(rows, type), 0);

  const alive = Math.max(0, fry - departed);
  // Reads `loss` ONLY. Culls, sales, and promotions are not survival failures —
  // see the header for why each is excluded.
  const survivalRate = fry > 0 ? Math.round(((fry - lost) / fry) * 100) : null;

  const timestamps = rows.map((c) => Number(c.timestamp) || 0).filter(Boolean);

  return {
    eggs: Number(eggCount) || 0,
    fry,
    culled,
    sold,
    lost,
    promoted,
    departed,
    alive,
    survivalRate,
    checkpointCount: rows.length,
    lastCheckpointAt: timestamps.length > 0 ? Math.max(...timestamps) : null,
  };
}

/**
 * Aggregate several spawns' funnels into breeder-level totals.
 *
 * @param {Array<{checkpoints: Array<object>, eggCount?: number}>} spawns
 */
export function aggregateGrowout(spawns) {
  const list = Array.isArray(spawns) ? spawns : [];
  let totalAlive = 0;
  let totalSoldSelfReported = 0;
  let totalPromoted = 0;
  let totalCheckpoints = 0;
  let bestSurvivalRate = 0;

  for (const spawn of list) {
    const summary = summarizeGrowout(spawn.checkpoints, { eggCount: spawn.eggCount });
    totalAlive += summary.alive;
    totalSoldSelfReported += summary.sold;
    totalPromoted += summary.promoted;
    totalCheckpoints += summary.checkpointCount;
    if (summary.survivalRate != null) {
      bestSurvivalRate = Math.max(bestSurvivalRate, summary.survivalRate);
    }
  }

  return {
    totalAlive,
    // Named to make its provenance unmistakable at every call site: this is a
    // number the breeder typed, NOT a count of completed orders. It must never
    // back a sales claim — see BREEDER_STATE_MODEL §9.11.
    totalSoldSelfReported,
    // Unlike the line above, this one IS verifiable — every promotion has real
    // `specimens` rows behind it (services/cohortPromotion.js writes the
    // checkpoint only after counting successful mints). It is exposed here and
    // deliberately not wired into any badge threshold: feeding a new metric into
    // thresholds calibrated without it would silently re-tune them.
    totalPromoted,
    totalCheckpoints,
    bestSurvivalRate,
    spawnCount: list.length,
  };
}

/**
 * Running funnel state at each checkpoint, for the timeline chart.
 *
 * Skips commentary rows so the line only moves when the population actually
 * changes.
 *
 * @param {Array<object>} checkpoints
 * @param {number} initialEggs
 */
export function buildGrowoutTimeline(checkpoints, initialEggs = 0) {
  const sorted = (Array.isArray(checkpoints) ? checkpoints : [])
    .filter(isCountingCheckpoint)
    .sort((a, b) => (Number(a.timestamp) || 0) - (Number(b.timestamp) || 0));

  if (sorted.length === 0) return [];

  // The egg count SEEDS the line — before anything hatches it's the only datum we
  // have — but the first real `fry_count` REPLACES it rather than competing with
  // it. Eggs and fry are different stages: a clutch of 100 eggs yielding 80 fry
  // has 80 fry, not 100.
  //
  // This previously used `Math.max(eggs, fryCount)`, which meant the chart's
  // population never dropped below the clutch size and its "alive" line disagreed
  // with the funnel summary printed directly above it — inflated in the *normal*
  // case where fewer fry hatch than eggs were laid. Surfaced by the test asserting
  // the two agree at the final point, which is exactly why they now share a module.
  let fry = Number(initialEggs) || 0;
  let sawFryCount = false;
  // Per-type running totals for the tooltip, plus one combined `departed` figure
  // that drives the `alive` line. `departed` accumulates over DEPARTURE_TYPES
  // rather than an `else if` chain, so this function and `summarizeGrowout` can't
  // drift apart when a type is added — which is the whole reason they share a
  // module. The test asserting the two agree at the final point is the guard.
  const byType = { loss: 0, sold: 0, cull: 0, promoted: 0 };
  let departed = 0;
  const points = [];

  for (const cp of sorted) {
    const count = Number(cp.count) || 0;
    if (cp.type === "fry_count") {
      fry = sawFryCount ? Math.max(fry, count) : count;
      sawFryCount = true;
    } else if (DEPARTURE_TYPES.includes(cp.type)) {
      byType[cp.type] = (byType[cp.type] || 0) + count;
      departed += count;
    }

    points.push({
      timestamp: cp.timestamp,
      alive: Math.max(0, fry - departed),
      maxFry: fry,
      totalLost: byType.loss,
      totalSold: byType.sold,
      totalCulled: byType.cull,
      totalPromoted: byType.promoted,
      survivalRate: fry > 0 ? Math.round(((fry - byType.loss) / fry) * 100) : 100,
      type: cp.type,
      count: cp.count,
      note: cp.note,
    });
  }

  return points;
}
