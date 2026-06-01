#!/usr/bin/env node
/*
 * merge-personality.cjs
 * -----------------------------------------------------------------------------
 * Merge a batch fragment of personality content into the master catalog at
 * frontend/public/fishbase_master.json.
 *
 * CLI:
 *   node scripts/merge-personality.cjs <fragment.json> [--dry-run] [--overwrite]
 *
 * The fragment may be:
 *   (a) an ARRAY of entries:   [ { "specCode": 4768, "personality": {...} }, ... ]
 *   (b) an OBJECT MAP keyed by specCode:
 *         { "4768": { "personality": {...} }, ... }
 *       (the value may itself be { personality: {...} }, or the personality
 *        block { vibeLine, flavorText } directly)
 *   (c) a single entry object: { "specCode": 4768, "personality": {...} }
 *
 * Each personality block has the Schema A shape:
 *   {
 *     "vibeLine":   { "casual": "...", "pro": "..." },
 *     "flavorText": { "casual": "...", "pro": "..." }
 *   }
 *
 * Behaviour (see design.md "Correctness Properties 4/5/6"):
 *   - Matches fragment entries to master records by specCode ONLY (never name).
 *   - Validates shape (4 non-empty string leaves) and the vibeLine 12-word ceiling.
 *   - Refuses unknown specCode (report + skip).
 *   - Refuses to overwrite an existing personality block unless --overwrite.
 *   - Preserves every sibling field; only sets/replaces the `personality` key.
 *   - Writes back with 2-space indent + trailing newline ONLY when not --dry-run
 *     and at least one entry actually changed.
 *   - Exit 0 on a clean run (even with valid skips); non-zero only on fatal error.
 * -----------------------------------------------------------------------------
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Hard ceiling on words per vibeLine leaf (Style Guide v1).
const VIBELINE_WORD_LIMIT = 12;

// Master catalog location, resolved relative to this script so it works from
// any current working directory.
const MASTER_PATH = path.resolve(__dirname, '..', 'public', 'fishbase_master.json');

/** Print to stderr and exit with a non-zero code (fatal errors only). */
function fatal(message) {
  console.error(`FATAL: ${message}`);
  process.exit(1);
}

/** Count whitespace-separated words in a string. */
function wordCount(str) {
  return str.trim().split(/\s+/).filter(Boolean).length;
}

/** True for a non-empty (after trim) string. */
function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Parse argv into { fragmentPath, dryRun, overwrite }.
 * The first non-flag argument is treated as the fragment path.
 */
function parseArgs(argv) {
  const opts = { fragmentPath: null, dryRun: false, overwrite: false };
  for (const arg of argv) {
    if (arg === '--dry-run') {
      opts.dryRun = true;
    } else if (arg === '--overwrite') {
      opts.overwrite = true;
    } else if (arg.startsWith('--')) {
      fatal(`unknown flag: ${arg}`);
    } else if (opts.fragmentPath === null) {
      opts.fragmentPath = arg;
    } else {
      fatal(`unexpected extra argument: ${arg}`);
    }
  }
  return opts;
}

/** Read and JSON.parse a file, throwing helpful, contextual errors. */
function readJson(filePath, label) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new Error(`could not read ${label} at "${filePath}": ${err.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`${label} at "${filePath}" is not valid JSON: ${err.message}`);
  }
}

/**
 * Normalize any accepted fragment shape into a flat array of
 * { specCode, personality } entries. specCode is coerced to a Number when it
 * comes from an object-map key.
 */
function normalizeFragment(fragment) {
  const entries = [];

  if (Array.isArray(fragment)) {
    // Shape (a): array of entries.
    for (const item of fragment) {
      if (item && typeof item === 'object') {
        entries.push({
          specCode: item.specCode,
          personality: item.personality !== undefined ? item.personality : extractPersonality(item),
        });
      } else {
        entries.push({ specCode: undefined, personality: undefined });
      }
    }
    return entries;
  }

  if (fragment && typeof fragment === 'object') {
    // Shape (c): a single entry object that directly carries specCode.
    if (fragment.specCode !== undefined && fragment.personality !== undefined) {
      return [{ specCode: fragment.specCode, personality: fragment.personality }];
    }
    // Shape (b): object map keyed by specCode.
    for (const [key, value] of Object.entries(fragment)) {
      // Prefer an explicit specCode on the value; fall back to the map key.
      const specCode =
        value && typeof value === 'object' && value.specCode !== undefined
          ? value.specCode
          : Number(key);
      const personality =
        value && typeof value === 'object'
          ? value.personality !== undefined
            ? value.personality
            : extractPersonality(value)
          : undefined;
      entries.push({ specCode, personality });
    }
    return entries;
  }

  // Anything else (number, string, null) is unusable.
  throw new Error('fragment must be a JSON array or object of entries');
}

/**
 * If a value looks like a bare personality block ({ vibeLine, flavorText })
 * return it, otherwise undefined. Lets the map value be the personality itself.
 */
function extractPersonality(value) {
  if (value && typeof value === 'object' && 'vibeLine' in value && 'flavorText' in value) {
    return value;
  }
  return undefined;
}

/**
 * Validate a personality block.
 * Returns { ok: true } or { ok: false, reason } describing the first problem.
 */
function validatePersonality(personality) {
  if (!personality || typeof personality !== 'object') {
    return { ok: false, reason: 'missing personality block' };
  }

  const { vibeLine, flavorText } = personality;

  if (!vibeLine || typeof vibeLine !== 'object') {
    return { ok: false, reason: 'missing vibeLine' };
  }
  if (!flavorText || typeof flavorText !== 'object') {
    return { ok: false, reason: 'missing flavorText' };
  }

  // All four leaves must be present, non-empty strings.
  for (const mode of ['casual', 'pro']) {
    if (!isNonEmptyString(vibeLine[mode])) {
      return { ok: false, reason: `vibeLine.${mode} is empty or not a string` };
    }
    if (!isNonEmptyString(flavorText[mode])) {
      return { ok: false, reason: `flavorText.${mode} is empty or not a string` };
    }
  }

  // vibeLine word ceiling (both modes).
  for (const mode of ['casual', 'pro']) {
    const words = wordCount(vibeLine[mode]);
    if (words > VIBELINE_WORD_LIMIT) {
      return {
        ok: false,
        reason: `vibeLine.${mode} is ${words} words (max ${VIBELINE_WORD_LIMIT})`,
      };
    }
  }

  return { ok: true };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.fragmentPath) {
    fatal('no fragment file given. Usage: node scripts/merge-personality.cjs <fragment.json> [--dry-run] [--overwrite]');
  }

  // --- Load inputs (fatal on failure) ------------------------------------
  let master;
  let fragment;
  try {
    master = readJson(MASTER_PATH, 'master catalog');
  } catch (err) {
    fatal(err.message);
  }
  try {
    fragment = readJson(path.resolve(opts.fragmentPath), 'fragment');
  } catch (err) {
    fatal(err.message);
  }

  if (!Array.isArray(master)) {
    fatal(`master catalog at "${MASTER_PATH}" is not a JSON array`);
  }

  let entries;
  try {
    entries = normalizeFragment(fragment);
  } catch (err) {
    fatal(err.message);
  }

  // Index master records by specCode for O(1) matching by stable id (Property 5).
  const bySpecCode = new Map();
  for (const record of master) {
    if (record && record.specCode !== undefined) {
      bySpecCode.set(Number(record.specCode), record);
    }
  }

  // --- Process each fragment entry ---------------------------------------
  const counts = { merged: 0, skipped: 0, error: 0 };
  console.log(
    `Merging ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} into ${MASTER_PATH}` +
      `${opts.dryRun ? '  [DRY RUN]' : ''}${opts.overwrite ? '  [OVERWRITE]' : ''}\n`
  );

  for (const entry of entries) {
    const { specCode, personality } = entry;
    const label = specCode === undefined || specCode === null ? '<no specCode>' : String(specCode);

    // specCode must be a usable number.
    if (specCode === undefined || specCode === null || Number.isNaN(Number(specCode))) {
      console.log(`  ERROR    ${label}: missing or invalid specCode`);
      counts.error += 1;
      continue;
    }

    // Validate shape + word ceiling before touching the master.
    const validation = validatePersonality(personality);
    if (!validation.ok) {
      console.log(`  ERROR    ${label}: ${validation.reason}`);
      counts.error += 1;
      continue;
    }

    // Match by specCode only.
    const record = bySpecCode.get(Number(specCode));
    if (!record) {
      console.log(`  SKIPPED  ${label}: unknown specCode (not found in master)`);
      counts.skipped += 1;
      continue;
    }

    const name = record.commonName || record.scientificName || '';

    // Overwrite protection (Property 4).
    if (record.personality !== undefined && !opts.overwrite) {
      console.log(`  SKIPPED  ${label} (${name}): exists, skipped (use --overwrite)`);
      counts.skipped += 1;
      continue;
    }

    // This entry will change the record. In dry-run we only report.
    if (opts.dryRun) {
      const verb = record.personality !== undefined ? 'would overwrite' : 'would merge';
      console.log(`  MERGED   ${label} (${name}): ${verb}`);
    } else {
      // Set/replace ONLY the personality key; all sibling fields are preserved.
      record.personality = personality;
      console.log(`  MERGED   ${label} (${name}): personality set`);
    }
    counts.merged += 1;
  }

  // --- Write back if appropriate -----------------------------------------
  let wrote = false;
  if (!opts.dryRun && counts.merged > 0) {
    try {
      fs.writeFileSync(MASTER_PATH, JSON.stringify(master, null, 2) + '\n', 'utf8');
      wrote = true;
    } catch (err) {
      fatal(`failed to write master catalog: ${err.message}`);
    }
  }

  // --- Summary ------------------------------------------------------------
  console.log(
    `\nSummary: ${counts.merged} merged, ${counts.skipped} skipped, ${counts.error} error(s).`
  );
  if (opts.dryRun) {
    console.log('Dry run — master file was NOT modified.');
  } else if (wrote) {
    console.log('Master catalog updated.');
  } else {
    console.log('No changes written (nothing to merge).');
  }

  // Clean run exits 0 even when entries were skipped/errored for valid reasons.
  process.exit(0);
}

main();
