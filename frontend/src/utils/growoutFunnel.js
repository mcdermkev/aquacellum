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
 *   alive    = fry − lost − culled − sold, floored at 0
 *
 * SURVIVAL RATE IS `(fry − lost) / fry` — culls and sales are deliberately NOT
 * counted against it. This is the pre-existing product definition and is
 * preserved here rather than corrected, because every displayed number and every
 * achievement threshold is calibrated to it. Whether an intentional cull should
 * count as a survival failure is a product question, logged as
 * BREEDER_STATE_MODEL §9.21.
 *
 * `narration` and `note` rows carry no counts and are excluded from the math.
 */

/** Checkpoint types that carry a meaningful count. */
export const COUNTED_TYPES = Object.freeze(["fry_count", "cull", "sold", "loss", "moved"]);

/** Types that are commentary, not accounting. */
export const NON_COUNTING_TYPES = Object.freeze(["note", "narration"]);

/**
 * Types that REDUCE the living population. `moved` is absent on purpose — moving
 * fry to a grow-out tank relocates them, it doesn't remove them from the cohort.
 */
export const DEPARTURE_TYPES = Object.freeze(["cull", "sold", "loss"]);

/** True for a row that participates in the funnel math. */
export function isCountingCheckpoint(checkpoint) {
  return !!checkpoint && !NON_COUNTING_TYPES.includes(checkpoint.type);
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
 *   departed: number, alive: number, survivalRate: number|null,
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
  const departed = lost + culled + sold;

  const alive = Math.max(0, fry - departed);
  // See the header: culls and sales are not survival failures under the existing
  // definition.
  const survivalRate = fry > 0 ? Math.round(((fry - lost) / fry) * 100) : null;

  const timestamps = rows.map((c) => Number(c.timestamp) || 0).filter(Boolean);

  return {
    eggs: Number(eggCount) || 0,
    fry,
    culled,
    sold,
    lost,
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
  let totalCheckpoints = 0;
  let bestSurvivalRate = 0;

  for (const spawn of list) {
    const summary = summarizeGrowout(spawn.checkpoints, { eggCount: spawn.eggCount });
    totalAlive += summary.alive;
    totalSoldSelfReported += summary.sold;
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
  let lost = 0;
  let sold = 0;
  let culled = 0;
  const points = [];

  for (const cp of sorted) {
    const count = Number(cp.count) || 0;
    if (cp.type === "fry_count") {
      fry = sawFryCount ? Math.max(fry, count) : count;
      sawFryCount = true;
    }
    else if (cp.type === "loss") lost += count;
    else if (cp.type === "sold") sold += count;
    else if (cp.type === "cull") culled += count;

    points.push({
      timestamp: cp.timestamp,
      alive: Math.max(0, fry - lost - sold - culled),
      maxFry: fry,
      totalLost: lost,
      totalSold: sold,
      totalCulled: culled,
      survivalRate: fry > 0 ? Math.round(((fry - lost) / fry) * 100) : 100,
      type: cp.type,
      count: cp.count,
      note: cp.note,
    });
  }

  return points;
}
