/**
 * growoutTank.js — create a spawn's grow-out tank and move the cohort into it.
 *
 * See docs/GROWOUT_TANK_SPEC.md. The follow-on to lineage-first intake: a clutch
 * needs somewhere to grow out, and the app needs to know where it is and how many
 * there are.
 *
 * ── WHAT THIS DOES NOT DO ───────────────────────────────────────────────────
 *
 * It mints nothing. A cohort is COUNTS on `spawnGrowout`, never certificates
 * (BREEDER_STATE_MODEL §4.2). Fry become certificates only through
 * `cohortPromotion`, and this module deliberately has no path to that.
 *
 * ── WHY `moved` ─────────────────────────────────────────────────────────────
 *
 * `moved` is the one checkpoint type that records a relocation WITHOUT reducing
 * the living population — it is deliberately absent from `DEPARTURE_TYPES` in
 * utils/growoutFunnel.js ("moving fry to a grow-out tank relocates them, it
 * doesn't remove them from the cohort"). Using `sold`/`cull`, or inventing a new
 * departure, would silently understate the breeder's production and surface as
 * wrong Achievements totals rather than as an error.
 *
 * Its `count` is 0: nothing sums `moved`, and a non-zero value would assert a
 * verified headcount of what physically moved, which nobody counted. The note
 * carries the meaning.
 *
 * ── NOTHING IS FABRICATED TO FILL A GAP ─────────────────────────────────────
 *
 * The owner comes off the spawn record. A spawn that is missing or unattributed
 * fails loudly rather than falling back to the connected wallet — the same rule
 * `cohortPromotion` enforces, for the same reason.
 */

import { db } from "../db";
import { awardXp } from "../utils/xp";
import { nextFreeCheckpointTimestamp } from "../utils/growoutFunnel";
import { relayImportTanks } from "./relayer";
import { syncGrowoutCheckpointToCloud } from "./cloudSync";

/** The checkpoint type that records a relocation. Mirrors GROWOUT_TYPES. */
export const MOVED_TYPE = "moved";
/** The checkpoint type that establishes a living headcount. Mirrors GROWOUT_TYPES. */
export const FRY_COUNT_TYPE = "fry_count";

const GAL_TO_L = 3.78541;
const DEFAULT_VOLUME_GAL = 20;

/** Keys `setUpGrowoutTank` can return in `errorKey`. */
export const GROWOUT_TANK_ERROR = Object.freeze({
  SPAWN_MISSING: "spawnMissing",
  SPAWN_UNATTRIBUTED: "spawnUnattributed",
  COUNT_INVALID: "countInvalid",
  TANK_FAILED: "tankFailed",
  UNEXPECTED: "unexpected",
});

/**
 * Copy for this flow, in one frozen const with pro/casual variants and static
 * strings — counts are interpolated by the caller from the result object. Same
 * convention as PROMOTION_COPY / PAIRING_COPY so the language invariant test can
 * scan it.
 */
export const GROWOUT_TANK_COPY = Object.freeze({
  spawnMissing: Object.freeze({
    pro: "That spawn record can't be found, so there's nothing to move.",
    casual: "We can't find that batch, so there's nothing to move.",
  }),
  spawnUnattributed: Object.freeze({
    pro: "That spawn has no owner recorded, so a tank can't be attributed to it.",
    casual: "We don't know whose batch this is, so we can't set up its tank.",
  }),
  countInvalid: Object.freeze({
    pro: "Enter a whole number of fry, or leave the headcount blank.",
    casual: "Type how many babies there are, or leave it empty.",
  }),
  tankFailed: Object.freeze({
    pro: "The grow-out tank could not be created, so the batch was left where it is.",
    casual: "We couldn't make the tank, so nothing was moved.",
  }),
  unexpected: Object.freeze({
    pro: "Something went wrong setting up the grow-out tank.",
    casual: "Something went wrong making the tank.",
  }),
  headcountIsRunning: Object.freeze({
    pro: "The batch size is the highest headcount ever recorded, so a lower number won't reduce it. Log losses or culls instead.",
    casual: "We keep the biggest count you've entered. To show fewer babies, log the ones you lost.",
  }),
  oneTankPerMove: Object.freeze({
    pro: "One grow-out tank per move. Splitting a batch across several tanks isn't tracked yet, so the app would not be able to say which fry are where.",
    casual: "One tank at a time for now.",
  }),
});

export function growoutTankText(errorKey, { casual = false } = {}) {
  const entry = GROWOUT_TANK_COPY[errorKey];
  if (!entry) return "";
  return casual ? entry.casual : entry.pro;
}

/** Every copy string, flattened — for the language invariant test. */
export function allGrowoutTankCopy() {
  const out = [];
  for (const entry of Object.values(GROWOUT_TANK_COPY)) {
    out.push(entry.pro, entry.casual);
  }
  return out;
}

function fail(errorKey) {
  return {
    success: false,
    tankId: null,
    tankName: "",
    fryCountRecorded: null,
    movedFrom: null,
    checkpointTimestamps: [],
    errorKey,
    error: growoutTankText(errorKey),
  };
}

/**
 * Create a grow-out tank for a spawn and move the cohort into it.
 *
 * @param {object} args
 * @param {number|string} args.spawnId
 * @param {string} [args.tankName] defaults to `Grow-out <last 3 of spawnId>`
 * @param {number} [args.volumeGal]
 * @param {number|null} [args.fryCount] optional headcount to record
 * @param {string} [args.note] optional note recorded on the move
 * @returns {Promise<{ success: boolean, tankId: number|null, tankName: string,
 *   fryCountRecorded: number|null, movedFrom: number|null,
 *   checkpointTimestamps: number[], errorKey?: string, error?: string }>}
 */
export async function setUpGrowoutTank({
  spawnId,
  tankName = "",
  volumeGal = DEFAULT_VOLUME_GAL,
  fryCount = null,
  note = "",
} = {}) {
  try {
    // ── 1. The spawn is the source of truth for ownership ───────────────────
    const spawn = await db.spawns.get(Number(spawnId));
    if (!spawn) return fail(GROWOUT_TANK_ERROR.SPAWN_MISSING);
    if (!spawn.ownerAddress) return fail(GROWOUT_TANK_ERROR.SPAWN_UNATTRIBUTED);

    // ── 2. Validate the optional headcount BEFORE writing anything ──────────
    let headcount = null;
    if (fryCount !== null && fryCount !== undefined && String(fryCount).trim() !== "") {
      const n = Number(fryCount);
      if (!Number.isInteger(n) || n < 1) return fail(GROWOUT_TANK_ERROR.COUNT_INVALID);
      headcount = n;
    }

    const gal = Number(volumeGal);
    const resolvedName =
      String(tankName ?? "").trim() || `Grow-out ${String(spawn.spawnId).slice(-3)}`;

    // ── 3. One tank, through the existing tested bulk path ──────────────────
    const tankResult = await relayImportTanks({
      ownerAddress: spawn.ownerAddress,
      tanks: [
        {
          name: resolvedName,
          tankType: 0,
          volumeLiters: Math.round((Number.isFinite(gal) && gal > 0 ? gal : DEFAULT_VOLUME_GAL) * GAL_TO_L),
          containment: 0,
          facility: "",
          room: "",
          rack: "",
        },
      ],
    });
    if (!tankResult.success || !tankResult.tankIds?.length) {
      return fail(GROWOUT_TANK_ERROR.TANK_FAILED);
    }
    const tankId = tankResult.tankIds[0];

    // ── 4. Checkpoints, on collision-free seconds ──────────────────────────
    // The cloud mirror upserts on (owner, spawn, timestamp, type), so a same-type
    // row in the same second would silently collapse and undercount.
    const existing = await db.spawnGrowout.where("spawnId").equals(spawn.spawnId).toArray();
    const now = Math.round(Date.now() / 1000);
    const written = [];
    const checkpointTimestamps = [];

    if (headcount !== null) {
      const ts = nextFreeCheckpointTimestamp(existing, now, FRY_COUNT_TYPE);
      const cp = {
        spawnId: spawn.spawnId,
        timestamp: ts,
        type: FRY_COUNT_TYPE,
        count: headcount,
        note: "Headcount recorded when the batch moved to its grow-out tank.",
        photo: null,
      };
      await db.spawnGrowout.add(cp);
      written.push(cp);
      checkpointTimestamps.push(ts);
    }

    // ── 5. The move itself. `count: 0` — see the module header. ─────────────
    const movedFrom = Number(spawn.tankId) || 0;
    const movedTs = nextFreeCheckpointTimestamp(
      // Include anything just written so two same-type rows can't collide either.
      [...existing, ...written],
      now,
      MOVED_TYPE
    );
    const movedNote =
      String(note ?? "").trim() ||
      (movedFrom
        ? `Moved to grow-out tank ${resolvedName} (from tank ${movedFrom}).`
        : `Moved to grow-out tank ${resolvedName}.`);
    const movedCp = {
      spawnId: spawn.spawnId,
      timestamp: movedTs,
      type: MOVED_TYPE,
      count: 0,
      note: movedNote,
      photo: null,
    };
    await db.spawnGrowout.add(movedCp);
    written.push(movedCp);
    checkpointTimestamps.push(movedTs);

    // ── 6. The cohort now lives in the grow-out tank ────────────────────────
    // So a later promotion places its keepers there. The previous tank is
    // preserved in the move note above, which is what keeps the history after
    // this pointer changes.
    await db.spawns.update(spawn.spawnId, { tankId: Number(tankId) });

    // ── 7. Mirror the history (fire-and-forget) ─────────────────────────────
    for (const cp of written) {
      syncGrowoutCheckpointToCloud(cp, spawn.ownerAddress).catch(() => {});
    }

    // One award per action. Awarded here rather than by the caller, matching
    // cohortPromotion — the sibling module that also writes checkpoints — so two
    // callers of one action can't double-fire it.
    awardXp("GROWOUT_CHECKPOINT");

    return {
      success: true,
      tankId: Number(tankId),
      tankName: resolvedName,
      fryCountRecorded: headcount,
      movedFrom: movedFrom || null,
      checkpointTimestamps,
    };
  } catch (err) {
    console.error("[GrowoutTank] Setup failed:", err);
    return fail(GROWOUT_TANK_ERROR.UNEXPECTED);
  }
}
