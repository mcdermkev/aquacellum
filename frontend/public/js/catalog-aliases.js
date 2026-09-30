/**
 * catalog-aliases.js — browser mirror of src/services/catalogAliases.js.
 *
 * Some catalog records are the same species as another record. They keep their
 * specCode (user data keys on it) and carry `"duplicateOf": <canonical specCode>`.
 * Lists, counts and search drop them (visibleCatalog); lookups by ID resolve
 * them to the canonical record (resolveSpecies).
 *
 * The static pages (database.html, compare.html, species.html) are plain
 * <script> pages that can't import ESM from src/, so they load this file as a
 * global (`window.CatalogAliases`). src/__tests__/catalogAliases.test.js
 * require()s it and asserts it agrees with the ESM module.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api; // Node / vitest parity test
  }
  root.CatalogAliases = api; // browser global
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  var DUPLICATE_FIELD = "duplicateOf";
  var ALIAS_FIELD = "aliasSpecCodes";

  function toId(value) {
    if (value === null || value === undefined || value === "") return null;
    var n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  function isDuplicate(record) {
    if (!record || typeof record !== "object") return false;
    var target = toId(record[DUPLICATE_FIELD]);
    return target !== null && target !== toId(record.specCode);
  }

  var INDEX = new WeakMap();

  function indexFor(catalog) {
    var index = INDEX.get(catalog);
    if (index) return index;
    var byId = new Map();
    var byAlias = new Map();
    catalog.forEach(function (record) {
      var id = toId(record && record.specCode);
      if (id !== null && !byId.has(id)) byId.set(id, record);
      var aliases = record && Array.isArray(record[ALIAS_FIELD]) ? record[ALIAS_FIELD] : [];
      aliases.forEach(function (alias) {
        var aliasId = toId(alias);
        if (aliasId !== null && !byAlias.has(aliasId)) byAlias.set(aliasId, record);
      });
    });
    index = { byId: byId, byAlias: byAlias };
    INDEX.set(catalog, index);
    return index;
  }

  function resolveSpecies(id, catalog) {
    var n = toId(id);
    if (n === null || !Array.isArray(catalog)) return null;
    var index = indexFor(catalog);
    var record = index.byId.get(n);
    if (!record) return index.byAlias.get(n) || null;
    if (!isDuplicate(record)) return record;
    var target = index.byId.get(toId(record[DUPLICATE_FIELD])) || null;
    if (!target || target === record || isDuplicate(target)) return record;
    return target;
  }

  function canonicalSpecCode(id, catalog) {
    var record = resolveSpecies(id, catalog);
    var resolved = toId(record && record.specCode);
    return resolved !== null ? resolved : toId(id);
  }

  function resolveRecord(record, catalog) {
    if (!isDuplicate(record)) return record || null;
    var resolved = resolveSpecies(record.specCode, catalog);
    return resolved && !isDuplicate(resolved) ? resolved : record;
  }

  function aliasSpecCodesFor(specCode, catalog) {
    var n = toId(specCode);
    if (n === null || !Array.isArray(catalog)) return [];
    var out = new Set();
    var own = indexFor(catalog).byId.get(n);
    (own && Array.isArray(own[ALIAS_FIELD]) ? own[ALIAS_FIELD] : []).forEach(function (alias) {
      if (toId(alias) !== null) out.add(toId(alias));
    });
    catalog.forEach(function (record) {
      if (!isDuplicate(record)) return;
      var id = toId(record.specCode);
      if (id === null || id === n) return;
      var target = resolveSpecies(id, catalog);
      if (target !== record && toId(target && target.specCode) === n) out.add(id);
    });
    return Array.from(out).sort(function (a, b) { return a - b; });
  }

  function visibleCatalog(catalog) {
    if (!Array.isArray(catalog)) return [];
    var aliasesByTarget = new Map();
    var hidden = new Set();
    catalog.forEach(function (record) {
      if (!isDuplicate(record)) return;
      var target = resolveSpecies(record.specCode, catalog);
      if (!target || target === record) return;
      hidden.add(record);
      if (!aliasesByTarget.has(target)) aliasesByTarget.set(target, []);
      aliasesByTarget.get(target).push(toId(record.specCode));
    });
    if (hidden.size === 0) return catalog;
    var out = [];
    catalog.forEach(function (record) {
      if (hidden.has(record)) return;
      var aliases = aliasesByTarget.get(record);
      if (!aliases) {
        out.push(record);
        return;
      }
      var existing = Array.isArray(record[ALIAS_FIELD])
        ? record[ALIAS_FIELD].map(toId).filter(function (x) { return x !== null; })
        : [];
      var merged = Array.from(new Set(existing.concat(aliases))).sort(function (a, b) { return a - b; });
      var copy = Object.assign({}, record);
      copy[ALIAS_FIELD] = merged;
      out.push(copy);
    });
    return out;
  }

  return {
    DUPLICATE_FIELD: DUPLICATE_FIELD,
    ALIAS_FIELD: ALIAS_FIELD,
    isDuplicate: isDuplicate,
    resolveSpecies: resolveSpecies,
    canonicalSpecCode: canonicalSpecCode,
    resolveRecord: resolveRecord,
    aliasSpecCodesFor: aliasSpecCodesFor,
    visibleCatalog: visibleCatalog,
  };
});
