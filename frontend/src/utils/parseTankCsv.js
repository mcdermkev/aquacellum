/**
 * parseTankCsv.js — pure parsing + validation for the CSV/paste tank importer.
 * See docs/CSV_TANK_IMPORT_SPEC.md.
 *
 * No DOM, no Dexie: everything here is a pure function so it can be unit-tested
 * exhaustively. The importer modal composes these; the relayer persists the
 * result.
 */

import { TANK_TYPE_OPTIONS } from "./tankUtils";

const GAL_TO_L = 3.78541;
const DEFAULT_VOLUME_GAL = 10;
const DEFAULT_VOLUME_L = Math.round(DEFAULT_VOLUME_GAL * GAL_TO_L); // 38

// Our importable fields and the header aliases that map to them. Aliases are
// compared after normalization (lowercase, alphanumerics only).
export const IMPORT_FIELDS = ["name", "volumeLiters", "tankType", "containment", "facility", "room", "rack"];

const FIELD_ALIASES = {
  name: ["name", "tank", "tankname", "unit", "unitname", "label", "id", "tankid"],
  volumeLiters: ["volume", "gallons", "gal", "size", "vol", "volumegal", "liters", "litres"],
  tankType: ["water", "watertype", "type", "tanktype"],
  containment: ["containment", "container", "vessel"],
  facility: ["group", "facility", "building", "location"],
  room: ["room", "aisle"],
  rack: ["rack", "shelf", "tier"],
};

const CONTAINMENT_ALIASES = { tank: 0, tub: 1, basket: 2 };

function normalizeHeader(h) {
  return String(h ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Split delimited text into rows of raw string cells. Handles comma or tab
 * delimiters and RFC4180-ish double-quote quoting (`""` is a literal quote,
 * delimiters/newlines inside quotes are literal). Tolerates \r\n and \n.
 *
 * @param {string} text
 * @returns {string[][]}
 */
export function parseDelimited(text) {
  const src = String(text ?? "").replace(/\r\n?/g, "\n");
  if (!src.trim()) return [];

  // Delimiter detection from the first non-empty line: tabs win only if present.
  const firstLine = src.split("\n").find((l) => l.trim() !== "") || "";
  const delimiter = firstLine.includes("\t") ? "\t" : ",";

  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++; // consume the escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      field = "";
      row = [];
    } else {
      field += ch;
    }
  }
  // Flush the trailing field/row (no final newline).
  row.push(field);
  rows.push(row);

  // Drop rows that are entirely empty (e.g. trailing blank line).
  return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
}

/**
 * Map a header row to column indices for each of our fields.
 * @param {string[]} headerRow
 * @returns {Record<string, number>} field -> column index (or -1 if unmatched)
 */
export function autoMapColumns(headerRow = []) {
  const normalized = headerRow.map(normalizeHeader);
  const mapping = {};
  const used = new Set();
  for (const field of IMPORT_FIELDS) {
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

/** True when at least one of our fields matched a header cell. */
export function hasRecognizableHeader(headerRow = []) {
  const mapping = autoMapColumns(headerRow);
  return Object.values(mapping).some((idx) => idx > -1);
}

function cell(row, idx) {
  return idx > -1 && idx < row.length ? String(row[idx] ?? "").trim() : "";
}

/** Map a water-type string to a tankType code. */
function parseTankType(str) {
  const s = str.toLowerCase().trim();
  if (!s) return { code: 0, warning: null };
  if (s.includes("salt") || s.includes("marine") || s.includes("reef")) {
    // Saltwater is unsupported product-wide; never mislabel, but don't drop it.
    return { code: 0, warning: `Saltwater isn't supported; imported as Freshwater` };
  }
  const match = TANK_TYPE_OPTIONS.find((o) => o.label.toLowerCase() === s || s.startsWith(o.label.toLowerCase()));
  if (match) return { code: match.id, warning: null };
  if (s.startsWith("fresh")) return { code: 0, warning: null };
  return { code: 0, warning: null }; // unknown → freshwater, no noise
}

function parseContainment(str) {
  const s = str.toLowerCase().trim();
  return CONTAINMENT_ALIASES[s] ?? 0;
}

/**
 * Convert one raw row + column mapping into a validated tank spec.
 * @returns {{ spec: object, errors: string[], warnings: string[] }}
 */
export function rowToTankSpec(row, mapping) {
  const errors = [];
  const warnings = [];

  const name = cell(row, mapping.name);
  if (!name) errors.push("Missing tank name");

  // Volume — assumed gallons, converted to liters.
  let volumeLiters = DEFAULT_VOLUME_L;
  const rawVol = cell(row, mapping.volumeLiters);
  if (rawVol) {
    const gal = Number(rawVol.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(gal) && gal > 0) {
      volumeLiters = Math.round(gal * GAL_TO_L);
    } else {
      warnings.push(`Volume "${rawVol}" not understood; defaulted to ${DEFAULT_VOLUME_GAL} gal`);
    }
  } else if (mapping.volumeLiters > -1) {
    warnings.push(`Volume blank; defaulted to ${DEFAULT_VOLUME_GAL} gal`);
  }

  const { code: tankType, warning: typeWarning } = parseTankType(cell(row, mapping.tankType));
  if (typeWarning) warnings.push(typeWarning);

  const spec = {
    name,
    volumeLiters,
    tankType,
    containment: parseContainment(cell(row, mapping.containment)),
    facility: cell(row, mapping.facility),
    room: cell(row, mapping.room),
    rack: cell(row, mapping.rack),
  };

  return { spec, errors, warnings };
}

/**
 * Full parse: text -> headers, mapping, validated rows.
 * @param {string} text
 * @returns {{ headers: string[], mapping: Record<string, number>, hasHeader: boolean,
 *             rows: Array<{ raw: string[], spec: object, errors: string[], warnings: string[] }> }}
 */
export function parseTankCsv(text) {
  const matrix = parseDelimited(text);
  if (matrix.length === 0) {
    return { headers: [], mapping: buildEmptyMapping(), hasHeader: false, rows: [] };
  }

  const hasHeader = hasRecognizableHeader(matrix[0]);
  const headers = hasHeader ? matrix[0] : matrix[0].map((_, i) => `Column ${i + 1}`);
  const mapping = hasHeader ? autoMapColumns(matrix[0]) : buildEmptyMapping();
  const dataRows = hasHeader ? matrix.slice(1) : matrix;

  const rows = dataRows.map((raw) => {
    const { spec, errors, warnings } = rowToTankSpec(raw, mapping);
    return { raw, spec, errors, warnings };
  });

  return { headers, mapping, hasHeader, rows };
}

/** Re-validate already-split data rows under an (edited) mapping. */
export function revalidateRows(dataRows, mapping) {
  return dataRows.map((raw) => {
    const { spec, errors, warnings } = rowToTankSpec(raw, mapping);
    return { raw, spec, errors, warnings };
  });
}

export function buildEmptyMapping() {
  const m = {};
  for (const f of IMPORT_FIELDS) m[f] = -1;
  return m;
}

/** The importable specs from a parsed row set (rows without errors). */
export function importableSpecs(rows) {
  return rows.filter((r) => r.errors.length === 0).map((r) => r.spec);
}
