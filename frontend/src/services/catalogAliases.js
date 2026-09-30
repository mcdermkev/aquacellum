/**
 * catalogAliases.js — duplicate records in the species catalog.
 *
 * `specCode` is the catalog ID and user data keys on it (tank/specimen
 * `speciesId`, listings `species_id`, species_insights `spec_code`, Dexie
 * `db.species`, /api/species?id=, species.html?id=). So a record is never
 * deleted or renumbered, even when it turns out to be the same fish as another
 * record. Instead the duplicate carries one field:
 *
 *   { "specCode": 70002, "duplicateOf": 12370, ... }
 *
 * meaning "70002 is the same species as 12370; show 12370". The field is
 * written by scripts/mark-duplicates.mjs, which asserts the canonical record
 * exists and is not itself a duplicate (so there are no chains or cycles).
 *
 * Rules every reader follows:
 *   - Lists, counts and search use `visibleCatalog(catalog)`: duplicates are
 *     dropped, so each species appears once.
 *   - Lookups by ID use `resolveSpecies(id, catalog)`: an old ID returns the
 *     canonical record, so data saved under 70002 still shows real care data.
 *
 * `visibleCatalog` tags each canonical record that has duplicates with
 * `aliasSpecCodes: [70002]`, so `resolveSpecies` still resolves old IDs on a
 * catalog that no longer contains the duplicate records (the React catalog).
 *
 * Pure, no imports. Also used by api/species.js, api/_lib/speciesIndex.js and
 * scripts/build-species-index.mjs. The static pages (database.html,
 * compare.html, species.html) load the browser mirror public/js/catalog-aliases.js;
 * src/__tests__/catalogAliases.test.js keeps the two in lockstep.
 *
 * Catalog arrays are treated as immutable: the ID index is cached per array.
 */

export const DUPLICATE_FIELD = "duplicateOf";
export const ALIAS_FIELD = "aliasSpecCodes";

/** Positive integer catalog ID, or null. Accepts numbers and numeric strings. */
function toId(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** True when the record says it is a duplicate of another record. */
export function isDuplicate(record) {
  if (!record || typeof record !== "object") return false;
  const target = toId(record[DUPLICATE_FIELD]);
  return target !== null && target !== toId(record.specCode);
}

const INDEX = new WeakMap();

/** { byId: specCode -> record, byAlias: old specCode -> canonical record } */
function indexFor(catalog) {
  let index = INDEX.get(catalog);
  if (index) return index;
  const byId = new Map();
  const byAlias = new Map();
  for (const record of catalog) {
    const id = toId(record?.specCode);
    if (id !== null && !byId.has(id)) byId.set(id, record);
    for (const alias of Array.isArray(record?.[ALIAS_FIELD]) ? record[ALIAS_FIELD] : []) {
      const aliasId = toId(alias);
      if (aliasId !== null && !byAlias.has(aliasId)) byAlias.set(aliasId, record);
    }
  }
  index = { byId, byAlias };
  INDEX.set(catalog, index);
  return index;
}

/**
 * The record to show for a catalog ID. A duplicate resolves to its canonical
 * record (one hop only). If the canonical record is missing or is itself a
 * duplicate (bad data: a chain or a cycle), the duplicate record is returned
 * as is rather than following further. Unknown IDs return null.
 *
 * @param {number|string} id - catalog specCode
 * @param {Array<object>} catalog - full catalog or visibleCatalog() output
 * @returns {object|null}
 */
export function resolveSpecies(id, catalog) {
  const n = toId(id);
  if (n === null || !Array.isArray(catalog)) return null;
  const { byId, byAlias } = indexFor(catalog);
  const record = byId.get(n);
  if (!record) return byAlias.get(n) || null;
  if (!isDuplicate(record)) return record;
  // One hop, by specCode only: never through another record's aliases, so a
  // chain resolves the same way on the full and the visible catalog.
  const target = byId.get(toId(record[DUPLICATE_FIELD])) || null;
  if (!target || target === record || isDuplicate(target)) return record;
  return target;
}

/**
 * The canonical specCode for a catalog ID. Unknown IDs come back unchanged
 * (as a number) so callers can still use them; invalid input returns null.
 */
export function canonicalSpecCode(id, catalog) {
  const record = resolveSpecies(id, catalog);
  const resolved = toId(record?.specCode);
  return resolved !== null ? resolved : toId(id);
}

/**
 * The record to show for a record already in hand (e.g. found by scientific
 * name). Non-duplicates come back unchanged.
 */
export function resolveRecord(record, catalog) {
  if (!isDuplicate(record)) return record || null;
  const resolved = resolveSpecies(record.specCode, catalog);
  return resolved && !isDuplicate(resolved) ? resolved : record;
}

/**
 * Old catalog IDs that resolve to `specCode` (the duplicates of it), sorted.
 * Works on the full catalog and on visibleCatalog() output.
 */
export function aliasSpecCodesFor(specCode, catalog) {
  const n = toId(specCode);
  if (n === null || !Array.isArray(catalog)) return [];
  const out = new Set();
  const own = indexFor(catalog).byId.get(n);
  for (const alias of Array.isArray(own?.[ALIAS_FIELD]) ? own[ALIAS_FIELD] : []) {
    if (toId(alias) !== null) out.add(toId(alias));
  }
  for (const record of catalog) {
    if (!isDuplicate(record)) continue;
    const id = toId(record.specCode);
    if (id === null || id === n) continue;
    const target = resolveSpecies(id, catalog);
    if (target !== record && toId(target?.specCode) === n) out.add(id);
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * The catalog with duplicates dropped, for every list, count and search.
 * Only duplicates that actually resolve to another record are dropped, so a
 * broken `duplicateOf` never hides a species entirely. Canonical records that
 * have duplicates come back as shallow copies with `aliasSpecCodes`; every
 * other record is returned by reference. Idempotent. Returns the input array
 * itself when there is nothing to drop.
 *
 * @param {Array<object>} catalog
 * @returns {Array<object>}
 */
export function visibleCatalog(catalog) {
  if (!Array.isArray(catalog)) return [];
  const aliasesByTarget = new Map();
  const hidden = new Set();
  for (const record of catalog) {
    if (!isDuplicate(record)) continue;
    const target = resolveSpecies(record.specCode, catalog);
    if (!target || target === record) continue;
    hidden.add(record);
    if (!aliasesByTarget.has(target)) aliasesByTarget.set(target, []);
    aliasesByTarget.get(target).push(toId(record.specCode));
  }
  if (hidden.size === 0) return catalog;
  const out = [];
  for (const record of catalog) {
    if (hidden.has(record)) continue;
    const aliases = aliasesByTarget.get(record);
    if (!aliases) {
      out.push(record);
      continue;
    }
    const existing = Array.isArray(record[ALIAS_FIELD]) ? record[ALIAS_FIELD].map(toId).filter((x) => x !== null) : [];
    const merged = [...new Set([...existing, ...aliases])].sort((a, b) => a - b);
    out.push({ ...record, [ALIAS_FIELD]: merged });
  }
  return out;
}
