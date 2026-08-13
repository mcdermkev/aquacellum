/**
 * breedingProgram.js — pure planner for lineage-first intake.
 * See docs/LINEAGE_FIRST_INTAKE_SPEC.md.
 *
 * Turns declared lines ("6 blue grass guppies: 2 males, 4 females") into the tank
 * specs and specimen specs the existing bulk services persist. Pure and DOM-free
 * so the rules below are unit-testable without Dexie.
 *
 * ── THE RULE THIS MODULE EXISTS TO PROTECT ──────────────────────────────────
 *
 * Declared stock is FOUNDATION stock: this planner never emits a `sireId` or
 * `damId`. Zero is the canonical "no parent recorded" sentinel, and it is what
 * keeps `pairingAssessment.isZeroReportable` returning false for a pairing of
 * declared fish — so the COI reads "Unknown — no pedigree data" instead of a
 * fabricated "verified 0%" that would be written permanently onto every
 * offspring certificate (spec §5; a certificate can never be withdrawn).
 *
 * Sex is likewise taken from explicit counts the breeder entered. "Pair" is never
 * read as "one male and one female" — a wrong sex silently permits or forbids a
 * pairing (BREEDER_STATE_MODEL §4.4).
 */

import { SEX } from "./specimenSex";

export const MAX_FISH_PER_LINE = 50;
export const MAX_PROGRAM_FISH = 300;
export const MAX_LINES = 60;

const GAL_TO_L = 3.78541;
const DEFAULT_VOLUME_GAL = 10;

/** A blank row for the form. */
export function emptyProgramLine() {
  return { line: "", species: "", speciesId: null, males: 1, females: 1, unsexed: 0, volumeGal: DEFAULT_VOLUME_GAL };
}

function count(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Validate and normalize one declared line.
 *
 * `speciesId` must already be resolved (and human-confirmed when it wasn't an
 * exact catalog match) — see utils/matchSpecies. An unresolved species is a row
 * error, never a guess.
 *
 * @returns {{ line, speciesId, commonName, scientificName, males, females,
 *             unsexed, fishCount, volumeLiters, errors: string[], warnings: string[] }}
 */
export function planProgramLine(row = {}, catalogEntry = null) {
  const errors = [];
  const warnings = [];

  const line = String(row.line ?? "").trim();
  if (!line) errors.push("Missing line name");

  const speciesId = row.speciesId === null || row.speciesId === undefined || row.speciesId === "" ? null : Number(row.speciesId);
  if (!speciesId) errors.push("Species not matched");

  let males = count(row.males);
  let females = count(row.females);
  let unsexed = count(row.unsexed);
  let fishCount = males + females + unsexed;

  if (fishCount < 1) {
    errors.push("No fish in this line");
  } else if (fishCount > MAX_FISH_PER_LINE) {
    // Clamp from the largest bucket down so the stated sex ratio is preserved as
    // closely as possible, rather than silently dropping one sex entirely.
    const scale = MAX_FISH_PER_LINE / fishCount;
    males = Math.floor(males * scale);
    females = Math.floor(females * scale);
    unsexed = Math.floor(unsexed * scale);
    // Give any rounding remainder to the largest original bucket.
    let remainder = MAX_FISH_PER_LINE - (males + females + unsexed);
    while (remainder > 0) {
      if (females >= males && females >= unsexed) females += 1;
      else if (males >= unsexed) males += 1;
      else unsexed += 1;
      remainder -= 1;
    }
    fishCount = males + females + unsexed;
    warnings.push(`Capped at ${MAX_FISH_PER_LINE} fish per line`);
  }

  const gal = Number(row.volumeGal);
  const volumeLiters = Math.round((Number.isFinite(gal) && gal > 0 ? gal : DEFAULT_VOLUME_GAL) * GAL_TO_L);

  return {
    line,
    speciesId: speciesId || null,
    commonName: catalogEntry?.commonName || "",
    scientificName: catalogEntry?.scientificName || "",
    males,
    females,
    unsexed,
    fishCount,
    volumeLiters,
    errors,
    warnings,
  };
}

/**
 * Plan a whole program.
 *
 * @param {Array} rows form rows
 * @param {Map<number, object>} catalogById speciesId -> catalog entry
 * @returns {{ lines: Array, readyLines: Array, tankSpecs: Array, totalFish: number,
 *             skippedCount: number, overCap: boolean }}
 */
export function planBreedingProgram(rows = [], catalogById = new Map()) {
  const lines = rows.map((row) => {
    const entry = row.speciesId ? catalogById.get(Number(row.speciesId)) || null : null;
    return planProgramLine(row, entry);
  });

  const readyLines = lines.filter((l) => l.errors.length === 0);
  const totalFish = readyLines.reduce((sum, l) => sum + l.fishCount, 0);

  // One tank per ready line, named for the line. Index-aligned with readyLines so
  // created tank ids map straight back (see buildSpecimenSpecs).
  const tankSpecs = readyLines.map((l) => ({
    name: l.line,
    tankType: 0,
    volumeLiters: l.volumeLiters,
    containment: 0,
    facility: "",
    room: "",
    rack: "",
  }));

  return {
    lines,
    readyLines,
    tankSpecs,
    totalFish,
    skippedCount: lines.length - readyLines.length,
    overCap: totalFish > MAX_PROGRAM_FISH || readyLines.length > MAX_LINES,
  };
}

/**
 * Expand ready lines into individual specimen specs, placed in the tanks that
 * were just created.
 *
 * `tankIds` must be index-aligned with `readyLines` (which is how
 * `relayImportTanks` returns them — creation order). A missing id yields
 * `currentTankId: 0` (unassigned) rather than guessing another line's tank, since
 * filing a fish into the wrong tank misrepresents which pair it belongs to.
 *
 * Note what is NOT here: no sireId, no damId, no status. Foundation stock carries
 * no parents (see the module header), and the service owns `status`.
 *
 * @param {Array} readyLines from planBreedingProgram
 * @param {number[]} tankIds
 * @returns {Array<{ speciesId, commonName, scientificName, gender, currentTankId, breederStockTag }>}
 */
export function buildSpecimenSpecs(readyLines = [], tankIds = []) {
  const specs = [];
  readyLines.forEach((l, index) => {
    const currentTankId = Number(tankIds[index]) || 0;
    const push = (gender, n) => {
      for (let i = 0; i < n; i++) {
        specs.push({
          speciesId: Number(l.speciesId),
          commonName: l.commonName,
          scientificName: l.scientificName,
          gender,
          currentTankId,
          // The line label IS the pair record (spec §3) — an existing, already
          // synced field, so this needs no new table and no migration.
          breederStockTag: l.line,
        });
      }
    };
    push(SEX.MALE, l.males);
    push(SEX.FEMALE, l.females);
    push(SEX.UNSEXED, l.unsexed);
  });
  return specs;
}
