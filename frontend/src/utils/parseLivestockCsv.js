/**
 * parseLivestockCsv.js — pure parsing + validation for the livestock importer.
 * See docs/LIVESTOCK_IMPORT_SPEC.md §5. Reuses the delimited parser from
 * parseTankCsv so quoting/delimiter handling lives in one place.
 *
 * Output rows carry the raw species NAME (a string) — resolving that name to a
 * numeric contract speciesId is the modal's job via utils/matchSpecies, kept
 * separate because it needs the live catalog and human confirmation.
 */

import { parseDelimited } from "./parseTankCsv";
import { normalizeSex } from "./specimenSex";

export const LIVESTOCK_FIELDS = ["species", "quantity", "sex", "tank"];
export const MAX_ROW_QTY = 200;

const FIELD_ALIASES = {
  species: ["species", "name", "fish", "commonname", "scientificname", "breed", "type"],
  quantity: ["quantity", "qty", "count", "number", "amount", "num"],
  sex: ["sex", "gender"],
  tank: ["tank", "location", "group", "rack", "container", "unit"],
};

function normalizeHeader(h) {
  return String(h ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function buildEmptyLivestockMapping() {
  const m = {};
  for (const f of LIVESTOCK_FIELDS) m[f] = -1;
  return m;
}

/** Map a header row to column indices for each livestock field. */
export function autoMapLivestockColumns(headerRow = []) {
  const normalized = headerRow.map(normalizeHeader);
  const mapping = {};
  const used = new Set();
  for (const field of LIVESTOCK_FIELDS) {
    const aliases = FIELD_ALIASES[field];
    let idx = -1;
    for (let c = 0; c < normalized.length; c++) {
      if (used.has(c)) continue;
      if (aliases.includes(normalized[c])) {
        idx = c;
        break;
      }
    }
    if (idx > -1) used.add(idx);
    mapping[field] = idx;
  }
  return mapping;
}

export function hasRecognizableLivestockHeader(headerRow = []) {
  return Object.values(autoMapLivestockColumns(headerRow)).some((idx) => idx > -1);
}

function cell(row, idx) {
  return idx > -1 && idx < row.length ? String(row[idx] ?? "").trim() : "";
}

/**
 * Convert one raw row + mapping into a validated livestock line.
 * @returns {{ species: string, quantity: number, sex: string, tankName: string,
 *             errors: string[], warnings: string[] }}
 */
export function rowToLivestock(row, mapping) {
  const errors = [];
  const warnings = [];

  const species = cell(row, mapping.species);
  if (!species) errors.push("Missing species");

  let quantity = 1;
  const rawQty = cell(row, mapping.quantity);
  if (rawQty) {
    const n = parseInt(rawQty.replace(/[^0-9]/g, ""), 10);
    if (Number.isFinite(n) && n >= 1) {
      quantity = Math.min(n, MAX_ROW_QTY);
      if (n > MAX_ROW_QTY) warnings.push(`Quantity capped at ${MAX_ROW_QTY}`);
    } else {
      warnings.push(`Quantity "${rawQty}" not understood; used 1`);
    }
  }

  const rawSex = cell(row, mapping.sex);
  const sex = normalizeSex(rawSex);

  return {
    species,
    quantity,
    sex,
    tankName: cell(row, mapping.tank),
    errors,
    warnings,
  };
}

/**
 * Full parse: text -> headers, mapping, validated livestock rows.
 * @returns {{ headers, mapping, hasHeader, rows: Array<{ raw, ...livestock }> }}
 */
export function parseLivestockCsv(text) {
  const matrix = parseDelimited(text);
  if (matrix.length === 0) {
    return { headers: [], mapping: buildEmptyLivestockMapping(), hasHeader: false, rows: [] };
  }

  const hasHeader = hasRecognizableLivestockHeader(matrix[0]);
  const headers = hasHeader ? matrix[0] : matrix[0].map((_, i) => `Column ${i + 1}`);
  const mapping = hasHeader ? autoMapLivestockColumns(matrix[0]) : buildEmptyLivestockMapping();
  const dataRows = hasHeader ? matrix.slice(1) : matrix;

  const rows = dataRows.map((raw) => ({ raw, ...rowToLivestock(raw, mapping) }));
  return { headers, mapping, hasHeader, rows };
}

/** Re-validate already-split data rows under an (edited) mapping. */
export function revalidateLivestockRows(dataRows, mapping) {
  return dataRows.map((raw) => ({ raw, ...rowToLivestock(raw, mapping) }));
}

/** Distinct, non-empty species names across parsed rows (in first-seen order). */
export function distinctSpeciesNames(rows) {
  const seen = [];
  const set = new Set();
  for (const r of rows) {
    const name = String(r.species ?? "").trim();
    if (name && !set.has(name)) {
      set.add(name);
      seen.push(name);
    }
  }
  return seen;
}
