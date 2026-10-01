/**
 * echoMatch.js — "can these fish live together?", answered from the catalog.
 *
 * Pure. No React, no network. Used by Echo's answer cards in the chat and by
 * the tank planner, so both give the same verdict for the same fish.
 *
 * WHY NOT LET THE MODEL DO THIS. A compatibility verdict is arithmetic on
 * numbers the catalog already holds: overlapping temperature and pH ranges,
 * the largest minimum tank, adult sizes, recorded temperament. Doing it here
 * means the card cannot invent a range or misread one, and it can be tested.
 * Poseidon still writes the friendly sentence around it; the card is the facts.
 *
 * Every row states the numbers it used. A missing value is reported as
 * missing, never filled in, and too little data gives "Not enough data"
 * rather than a green light.
 */

import { normalizeSpeciesProfile, TEMPERAMENT } from "./shippingSafety.js";
import { livingInhabitants, speciesRecordFor } from "../components/logbook/inhabitants.js";

export const MATCH = Object.freeze({
  GOOD: "good",
  CARE: "care",
  BAD: "bad",
  UNKNOWN: "unknown",
});

export const VERDICT_TEXT = Object.freeze({
  good: "Good match",
  care: "Works with care",
  bad: "Not a good match",
  unknown: "Not enough data",
});

/** Echo's reaction to a verdict (a mood from echoBehaviour's list). */
export const VERDICT_MOOD = Object.freeze({
  good: "happy",
  care: "alert",
  bad: "concerned",
  unknown: "calm",
});

const TANK_WATER = Object.freeze({ 0: "fresh", 1: "salt", 2: "brackish", 3: "fresh" });

/** "fresh" | "salt" | "brackish" for a tank's `tankType` (a pond is fresh). */
export const waterForTankType = (tankType) => TANK_WATER[Number(tankType)] || "fresh";

const cToF = (c) => Math.round((c * 9) / 5 + 32);
const fmtC = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const fmtPh = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10));
const isRange = (r) => Array.isArray(r) && r.length === 2 && Number.isFinite(Number(r[0])) && Number.isFinite(Number(r[1]));

function tempText([lo, hi]) {
  const f = lo === hi ? `${cToF(lo)}°F` : `${cToF(lo)}–${cToF(hi)}°F`;
  const c = lo === hi ? `${fmtC(lo)}°C` : `${fmtC(lo)}–${fmtC(hi)}°C`;
  return `${f} (${c})`;
}
const phText = ([lo, hi]) => (lo === hi ? fmtPh(lo) : `${fmtPh(lo)}–${fmtPh(hi)}`);

/**
 * The facts one species brings to a check, from a catalog record.
 *
 * @param {object} record fishbase_master.json shape (raw or normalized)
 */
export function speciesFacts(record) {
  if (!record) return null;
  const p = normalizeSpeciesProfile(record);
  const waterTypes = Array.isArray(record.waterTypes) ? record.waterTypes : (Array.isArray(p.waterTypes) ? p.waterTypes : []);
  return {
    // "Betta / Siamese Fighting Fish" reads as "Betta" on a card.
    name: String(record.commonName || "").split("/")[0].trim() || record.scientificName || "Unknown species",
    scientificName: record.scientificName || null,
    specCode: record.specCode ?? null,
    photo: typeof record.masterPhotoUrl === "string" && record.masterPhotoUrl ? record.masterPhotoUrl : null,
    temp: isRange(p.tempRange) ? p.tempRange.map(Number) : null,
    ph: isRange(p.phRange) ? p.phRange.map(Number) : null,
    minGallons: Number.isFinite(Number(p.minVolumeGallons)) && Number(p.minVolumeGallons) > 0 ? Number(p.minVolumeGallons) : null,
    sizeCm: Number.isFinite(Number(p.adultSizeCm)) && Number(p.adultSizeCm) > 0 ? Number(p.adultSizeCm) : null,
    fresh: waterTypes.includes("freshwater"),
    salt: waterTypes.includes("marine"),
    brackish: waterTypes.includes("brackish"),
    temperament: p.temperament?.value && p.temperament.value !== TEMPERAMENT.UNKNOWN ? p.temperament.value : null,
    temperamentText: temperamentTextOf(record),
    ownKindOnly: isOwnKindAggression(record, p.temperament?.value),
    tankmates: record.tankmates && typeof record.tankmates === "object" ? record.tankmates : null,
  };
}

function temperamentTextOf(record) {
  const t = record?.behavior?.temperament || record?.ecology?.socialBehavior || record?.temperamentText || "";
  return typeof t === "string" ? t.trim() : "";
}

/**
 * "Aggressive towards conspecific males; generally peaceful towards dissimilar
 * species" (the catalog's betta) is aggression toward its own kind, not toward
 * a community. The shipping classifier reads the first keyword and says
 * "aggressive", which is right for a shipping bag and wrong for a tank.
 */
const OWN_KIND = /\b(aggressiv\w*|territorial)\b[^.;]*\b(conspecific\w*|own (species|kind)|same species|other males|rival males)\b/i;
function isOwnKindAggression(record, value) {
  if (value !== TEMPERAMENT.AGGRESSIVE && value !== TEMPERAMENT.TERRITORIAL) return false;
  const text = temperamentTextOf(record);
  return OWN_KIND.test(text) && /\bpeaceful\b/i.test(text);
}

/**
 * The catalog's own tankmate notes for a pair, when it has them. `entry.species`
 * is free text ("Puntigrus tetrazona (Tiger Barb)", "Otocinclus sp."), so match
 * the other fish's scientific name, or its genus for an "sp."/"spp." entry.
 */
function listedTankmate(a, b) {
  const lists = a.tankmates;
  if (!lists || !b.scientificName) return null;
  const sci = b.scientificName.toLowerCase();
  const genus = sci.split(" ")[0];
  const hit = (entry) => {
    const s = String(entry?.species || "").toLowerCase();
    if (!s) return false;
    if (s.includes(sci)) return true;
    return new RegExp(`^${genus}\\s+spp?\\.?(\\s|$)`).test(s);
  };
  const bad = (Array.isArray(lists.incompatible) ? lists.incompatible : []).find(hit);
  if (bad) return { good: false, text: String(bad.reason || "").trim() };
  const good = (Array.isArray(lists.compatible) ? lists.compatible : []).find(hit);
  if (good) return { good: true, text: String(good.notes || "").trim() };
  return null;
}

const sentence = (s) => {
  const t = String(s || "").trim();
  return t && !/[.!?]$/.test(t) ? `${t}.` : t;
};

/**
 * A tank as the checks need it, from a Dexie tank row (or a planner draft).
 *
 * @param {object} tank { name, volumeLiters | gallons, tankType, reading: { temp, ph } }
 */
export function tankFacts(tank) {
  if (!tank) return null;
  const gallons = Number.isFinite(Number(tank.gallons)) && Number(tank.gallons) > 0
    ? Number(tank.gallons)
    : (Number.isFinite(Number(tank.volumeLiters)) && Number(tank.volumeLiters) > 0 ? Math.round(Number(tank.volumeLiters) / 3.78541) : null);
  const water = tank.water || TANK_WATER[Number(tank.tankType)] || null;
  const t = Number(tank.reading?.temp);
  const ph = Number(tank.reading?.ph);
  return {
    name: tank.name || "your tank",
    gallons,
    water,
    tempC: Number.isFinite(t) && t > 0 ? t : null,
    ph: Number.isFinite(ph) && ph > 0 ? ph : null,
  };
}

function overlap(ranges) {
  const lo = Math.max(...ranges.map((r) => r[0]));
  const hi = Math.min(...ranges.map((r) => r[1]));
  return lo <= hi ? [lo, hi] : null;
}

const TEMPERAMENT_WORD = Object.freeze({
  [TEMPERAMENT.PEACEFUL]: "peaceful",
  [TEMPERAMENT.SEMI_AGGRESSIVE]: "nippy",
  [TEMPERAMENT.TERRITORIAL]: "territorial",
  [TEMPERAMENT.AGGRESSIVE]: "aggressive",
  [TEMPERAMENT.PREDATORY]: "predatory",
});

/**
 * Check a group of species (and optionally a tank).
 *
 * @param {object} args
 * @param {object[]} args.species catalog records (1 or more)
 * @param {object|null} [args.tank] tank row or planner draft (see tankFacts)
 * @returns {{ verdict: string, title: string, headline: string, mood: string,
 *             rows: Array<{key: string, status: string, label: string, detail: string}>,
 *             names: string[] }}
 */
export function checkGroup({ species = [], tank = null } = {}) {
  const facts = species.map(speciesFacts).filter(Boolean);
  const t = tankFacts(tank);
  const rows = [];
  const names = facts.map((f) => f.name);
  const many = facts.length > 1;

  // ── Water type ────────────────────────────────────────────────────────────
  const freshOnly = facts.filter((f) => f.fresh && !f.salt && !f.brackish);
  const saltOnly = facts.filter((f) => f.salt && !f.fresh);
  if (freshOnly.length && saltOnly.length) {
    rows.push({
      key: "water", status: MATCH.BAD, label: "Freshwater and saltwater don't mix",
      detail: `${saltOnly.map((f) => f.name).join(", ")} ${saltOnly.length > 1 ? "need" : "needs"} saltwater; ${freshOnly.map((f) => f.name).join(", ")} ${freshOnly.length > 1 ? "need" : "needs"} freshwater.`,
    });
  } else if (t?.water === "fresh" && saltOnly.length) {
    rows.push({ key: "water", status: MATCH.BAD, label: "Needs saltwater", detail: `${saltOnly.map((f) => f.name).join(", ")} can't live in a freshwater tank.` });
  } else if (t?.water === "salt" && freshOnly.length) {
    rows.push({ key: "water", status: MATCH.BAD, label: "Needs freshwater", detail: `${freshOnly.map((f) => f.name).join(", ")} can't live in a saltwater tank.` });
  }

  // ── Temperature ───────────────────────────────────────────────────────────
  const temps = facts.filter((f) => f.temp);
  const missingTemp = facts.filter((f) => !f.temp).map((f) => f.name);
  if (temps.length) {
    const shared = overlap(temps.map((f) => f.temp));
    const each = temps.map((f) => `${f.name} ${fmtC(f.temp[0])}–${fmtC(f.temp[1])}°C`).join(", ");
    if (!shared) {
      rows.push({ key: "temp", status: MATCH.BAD, label: "No shared temperature", detail: `${each}. There is no temperature that suits them all.` });
    } else if (t?.tempC != null && (t.tempC < shared[0] || t.tempC > shared[1])) {
      rows.push({ key: "temp", status: MATCH.CARE, label: `Your tank reads ${fmtC(t.tempC)}°C`, detail: `${many ? "Together they" : names[0]} ${many ? "need" : "needs"} ${tempText(shared)}. ${each}.` });
    } else if (many && shared[1] - shared[0] < 2) {
      rows.push({ key: "temp", status: MATCH.CARE, label: "Narrow temperature overlap", detail: `Both are happy at ${tempText(shared)}. ${each}.` });
    } else {
      rows.push({ key: "temp", status: MATCH.GOOD, label: many ? "Temperature overlaps" : "Temperature", detail: `${many ? "Shared range" : "Range"} ${tempText(shared)}.${many ? ` ${each}.` : ""}` });
    }
  }
  if (missingTemp.length) rows.push({ key: "temp-missing", status: MATCH.UNKNOWN, label: "Temperature not recorded", detail: `No temperature range in the catalog for ${missingTemp.join(", ")}.` });

  // ── pH ────────────────────────────────────────────────────────────────────
  const phs = facts.filter((f) => f.ph);
  if (phs.length) {
    const shared = overlap(phs.map((f) => f.ph));
    const each = phs.map((f) => `${f.name} ${phText(f.ph)}`).join(", ");
    if (!shared) {
      rows.push({ key: "ph", status: MATCH.BAD, label: "No shared pH", detail: `${each}. Their pH ranges don't meet.` });
    } else if (t?.ph != null && (t.ph < shared[0] || t.ph > shared[1])) {
      rows.push({ key: "ph", status: MATCH.CARE, label: `Your tank reads pH ${fmtPh(t.ph)}`, detail: `${many ? "Together they" : names[0]} ${many ? "need" : "needs"} pH ${phText(shared)}.` });
    } else if (many && shared[1] - shared[0] < 0.4) {
      rows.push({ key: "ph", status: MATCH.CARE, label: "Narrow pH overlap", detail: `Only pH ${phText(shared)} suits both. ${each}.` });
    } else {
      rows.push({ key: "ph", status: MATCH.GOOD, label: many ? "pH overlaps" : "pH", detail: `${many ? "Shared range" : "Range"} ${phText(shared)}.${many ? ` ${each}.` : ""}` });
    }
  }

  // ── Tank size ─────────────────────────────────────────────────────────────
  const sized = facts.filter((f) => f.minGallons);
  if (sized.length) {
    const biggest = sized.reduce((a, b) => (b.minGallons > a.minGallons ? b : a));
    const need = biggest.minGallons;
    const who = sized.length > 1 ? `${biggest.name} needs the most` : `${biggest.name} needs`;
    if (t?.gallons) {
      if (t.gallons < need) {
        rows.push({ key: "size", status: MATCH.BAD, label: "Tank too small", detail: `${who}: ${need}+ gal. ${t.name} is ${t.gallons} gal.` });
      } else {
        rows.push({ key: "size", status: MATCH.GOOD, label: "Tank size fits", detail: `${who}: ${need}+ gal. ${t.name} is ${t.gallons} gal.` });
      }
    } else {
      rows.push({ key: "size", status: MATCH.GOOD, label: "Tank size", detail: `${who} ${need}+ gal (${Math.round(need * 3.785)} L).` });
    }
  }

  // ── The catalog's own tankmate notes ──────────────────────────────────────
  // Where a species record names another as a good or poor tankmate, that is
  // the most specific fact there is, so it goes first and it can clear a
  // general temperament worry for that pair.
  const listedOk = new Set();
  if (many) {
    const bad = [];
    const good = [];
    for (const a of facts) {
      for (const b of facts) {
        if (a === b) continue;
        const note = listedTankmate(a, b);
        if (!note) continue;
        if (note.good) {
          listedOk.add(`${a.name}|${b.name}`);
          good.push(`${a.name} lists ${b.name}: ${sentence(note.text) || "a good tankmate."}`);
        } else {
          bad.push(`${a.name} lists ${b.name} as a poor tankmate: ${sentence(note.text) || "no reason given."}`);
        }
      }
    }
    if (bad.length) rows.push({ key: "tankmates", status: MATCH.BAD, label: "Listed as poor tankmates", detail: bad.join(" ") });
    else if (good.length) rows.push({ key: "tankmates", status: MATCH.GOOD, label: "Listed as good tankmates", detail: good.join(" ") });
  }
  const clearedFor = (f) => facts.every((o) => o === f || listedOk.has(`${f.name}|${o.name}`));

  // ── Temperament ───────────────────────────────────────────────────────────
  if (many || t) {
    const rough = facts.filter((f) => (f.temperament === TEMPERAMENT.AGGRESSIVE || f.temperament === TEMPERAMENT.PREDATORY) && !f.ownKindOnly && !(many && clearedFor(f)));
    const ownKind = facts.filter((f) => f.ownKindOnly && !(many && clearedFor(f)));
    const touchy = facts.filter((f) => (f.temperament === TEMPERAMENT.TERRITORIAL || f.temperament === TEMPERAMENT.SEMI_AGGRESSIVE) && !f.ownKindOnly && !(many && clearedFor(f)));
    const unknown = facts.filter((f) => !f.temperament);
    const quote = (f) => (f.temperamentText ? ` The catalog says: "${sentence(f.temperamentText.slice(0, 160))}"` : "");
    if (rough.length && many) {
      rows.push({ key: "temperament", status: MATCH.BAD, label: `${rough.map((f) => f.name).join(", ")} can be ${TEMPERAMENT_WORD[rough[0].temperament]}`, detail: `That puts the other fish at risk.${quote(rough[0])}` });
    } else if (ownKind.length) {
      rows.push({ key: "temperament", status: MATCH.CARE, label: `${ownKind.map((f) => f.name).join(", ")}: rough on its own kind`, detail: `The aggression is toward its own kind, not other species.${quote(ownKind[0])}` });
    } else if (touchy.length) {
      rows.push({ key: "temperament", status: MATCH.CARE, label: `${touchy.map((f) => f.name).join(", ")} can be ${TEMPERAMENT_WORD[touchy[0].temperament]}`, detail: touchy[0].temperament === TEMPERAMENT.TERRITORIAL ? "Especially when breeding. Rocks, wood and plants that break up sight lines help." : "Some fish nip fins. Long-finned tankmates are the usual target." });
    } else if (rough.length) {
      // One species on its own in a tank: nothing to be at risk yet, but the
      // keeper should see it before adding anything.
      rows.push({ key: "temperament", status: MATCH.CARE, label: `${rough[0].name} can be ${TEMPERAMENT_WORD[rough[0].temperament]}`, detail: `The catalog records this temperament.${quote(rough[0])}` });
    } else if (facts.length && !unknown.length) {
      const allPeaceful = facts.every((f) => f.temperament === TEMPERAMENT.PEACEFUL);
      rows.push({
        key: "temperament",
        status: MATCH.GOOD,
        label: !many ? "Peaceful" : allPeaceful ? "All peaceful" : "No temperament problems",
        detail: !many || allPeaceful ? "The catalog records a peaceful temperament." : "The catalog's tankmate notes clear this group.",
      });
    }
    if (unknown.length && facts.length) {
      rows.push({ key: "temperament-missing", status: MATCH.UNKNOWN, label: "Temperament not recorded", detail: `No temperament in the catalog for ${unknown.map((f) => f.name).join(", ")}.` });
    }
  }

  // ── Size difference ───────────────────────────────────────────────────────
  const withSize = facts.filter((f) => f.sizeCm);
  if (withSize.length > 1) {
    const big = withSize.reduce((a, b) => (b.sizeCm > a.sizeCm ? b : a));
    const small = withSize.reduce((a, b) => (b.sizeCm < a.sizeCm ? b : a));
    if (big.sizeCm >= small.sizeCm * 4) {
      rows.push({ key: "sizes", status: MATCH.CARE, label: "Big size difference", detail: `${big.name} grows to ${big.sizeCm} cm, ${small.name} to ${small.sizeCm} cm. Fish that fit in a mouth often get eaten.` });
    }
  }

  const known = rows.filter((r) => r.status !== MATCH.UNKNOWN);
  let verdict;
  if (rows.some((r) => r.status === MATCH.BAD)) verdict = MATCH.BAD;
  else if (rows.some((r) => r.status === MATCH.CARE)) verdict = MATCH.CARE;
  else if (known.length >= 2) verdict = MATCH.GOOD;
  else verdict = MATCH.UNKNOWN;

  const title = names.length ? names.join(" + ") + (t && !many ? ` in ${t.name}` : "") : "Your tank";
  return {
    verdict,
    title,
    headline: VERDICT_TEXT[verdict],
    mood: VERDICT_MOOD[verdict],
    rows,
    names,
    members: facts.map((f) => ({ name: f.name, scientificName: f.scientificName, specCode: f.specCode, photo: f.photo })),
  };
}

// ─── Finding species in a question ──────────────────────────────────────────

const WORD = /[a-z0-9]/;

/**
 * The ways a catalog name can appear in a question. "Betta / Siamese Fighting
 * Fish" is two names people type, and "(Veiltail)" is a note, not a name.
 */
function aliases(name) {
  const raw = String(name || "").replace(/\([^)]*\)/g, " ");
  const parts = raw.split("/").map((p) => p.toLowerCase().replace(/\s+/g, " ").trim());
  return [...new Set([raw.toLowerCase().replace(/\s+/g, " ").trim(), ...parts])].filter((p) => p.length >= 3);
}

function variants(name) {
  const out = new Set();
  for (const n of aliases(name)) {
    out.add(n);
    if (/(s|x|z|ch|sh)$/.test(n)) out.add(`${n}es`);
    else if (/y$/.test(n) && !/[aeiou]y$/.test(n)) out.add(`${n.slice(0, -1)}ies`);
    else out.add(`${n}s`);
  }
  return [...out];
}

/**
 * Catalog species named in a piece of text, longest names first so "German
 * blue ram" wins over "blue ram". Whole words only; plurals count.
 *
 * @param {string} text
 * @param {object[]} catalog
 * @param {{ max?: number }} [opts]
 * @returns {object[]} matched records, in the order they appear in the text
 */
export function findSpeciesInText(text, catalog = [], { max = 4 } = {}) {
  const hay = ` ${String(text || "").toLowerCase().replace(/\s+/g, " ")} `;
  if (!hay.trim() || !Array.isArray(catalog)) return [];
  const candidates = [];
  for (const rec of catalog) {
    if (!rec || rec.duplicateOf) continue;
    for (const name of [rec.commonName, rec.scientificName]) {
      for (const v of variants(name)) candidates.push({ v, rec });
    }
  }
  candidates.sort((a, b) => b.v.length - a.v.length);

  const taken = [];
  const found = [];
  for (const { v, rec } of candidates) {
    let from = 0;
    for (;;) {
      const at = hay.indexOf(v, from);
      if (at < 0) break;
      from = at + 1;
      const before = hay[at - 1];
      const after = hay[at + v.length];
      if (WORD.test(before || " ") || WORD.test(after || " ")) continue;
      if (taken.some(([s, e]) => at < e && at + v.length > s)) continue;
      taken.push([at, at + v.length]);
      if (!found.some((f) => f.rec === rec)) found.push({ rec, at });
      break;
    }
    if (found.length >= max) break;
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.rec);
}

const COMPAT_CUE = /\b(can i (add|keep|put|mix)|compatib\w*|together|tank ?mates?|get along|live with|go with|in with|house with|alongside|safe with)\b/i;

/** Does a question read like "can these live together?" */
export function looksLikeCompatibilityQuestion(text) {
  return COMPAT_CUE.test(String(text || ""));
}

const WATER_TYPE = Object.freeze({ fresh: "freshwater", salt: "marine", brackish: "brackish" });

/**
 * Catalog search for the planner: every word must appear in the common or
 * scientific name. Names that start with the query come first. Plants and
 * records for a different water type are left out; a record with no water
 * type recorded stays in, because missing is not the same as wrong.
 *
 * @param {object[]} catalog
 * @param {string} query
 * @param {{ water?: "fresh"|"salt"|"brackish", exclude?: object[], max?: number }} [opts]
 */
export function searchCatalog(catalog = [], query = "", { water = null, exclude = [], max = 8 } = {}) {
  const words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length || !Array.isArray(catalog)) return [];
  const skip = new Set(exclude.map((r) => r?.scientificName).filter(Boolean));
  const want = WATER_TYPE[water] || null;
  const q = words.join(" ");
  const hits = [];
  for (const rec of catalog) {
    if (!rec || rec.duplicateOf || skip.has(rec.scientificName)) continue;
    if (String(rec.type || "").toLowerCase() === "plant") continue;
    const types = Array.isArray(rec.waterTypes) ? rec.waterTypes : [];
    if (want && types.length && !types.includes(want)) continue;
    const common = String(rec.commonName || "").toLowerCase();
    const sci = String(rec.scientificName || "").toLowerCase();
    const hay = `${common} ${sci}`;
    if (!words.every((w) => hay.includes(w))) continue;
    const rank = common.startsWith(q) ? 0 : sci.startsWith(q) ? 1 : common.includes(` ${q}`) ? 2 : 3;
    hits.push({ rec, rank });
  }
  hits.sort((a, b) => a.rank - b.rank || String(a.rec.commonName || a.rec.scientificName).length - String(b.rec.commonName || b.rec.scientificName).length);
  return hits.slice(0, max).map((h) => h.rec);
}

// ─── Tanks in a question ────────────────────────────────────────────────────

/**
 * Catalog records for what lives in a tank, once each. Plants are left out:
 * they have no temperament and would only add "not recorded" rows.
 *
 * @param {object} tank Dexie tank row
 * @param {object[]} catalog
 */
export function recordsInTank(tank, catalog = []) {
  const out = [];
  for (const spec of livingInhabitants(tank)) {
    const rec = speciesRecordFor(spec, catalog);
    if (!rec || String(rec.type || "").toLowerCase() === "plant") continue;
    if (!out.some((r) => r.scientificName === rec.scientificName)) out.push(rec);
  }
  return out;
}

/**
 * The keeper's tank a question is about: one named in it, or their only tank
 * when they say "my tank". Null when it is not clear which.
 *
 * @param {string} text
 * @param {object[]} tanks Dexie tank rows
 */
export function findTankInText(text, tanks = []) {
  const hay = ` ${String(text || "").toLowerCase().replace(/\s+/g, " ")} `;
  const list = (Array.isArray(tanks) ? tanks : []).filter((t) => t && t.active !== false);
  const named = list
    .filter((t) => String(t.name || "").trim().length >= 3)
    .sort((a, b) => String(b.name).length - String(a.name).length)
    .find((t) => hay.includes(` ${String(t.name).toLowerCase().replace(/\s+/g, " ").trim()}`));
  if (named) return named;
  if (list.length === 1 && /\bmy (tank|aquarium|fish)\b/.test(hay)) return list[0];
  return null;
}

/**
 * The card for a question, or null when a card would not help.
 *
 * Shown when the question reads like compatibility (or the caller already
 * knows it is, `force`), and there is something to compare: two species, or
 * one species and a tank.
 *
 * @param {object} args
 * @param {string} args.text the keeper's question
 * @param {object[]} args.catalog
 * @param {object|null} [args.tank] tank row with `reading: { temp, ph }`
 * @param {object[]} [args.tankRecords] from recordsInTank()
 * @param {boolean} [args.force]
 */
export function compatForQuestion({ text, catalog = [], tank = null, tankRecords = [], force = false }) {
  if (!force && !looksLikeCompatibilityQuestion(text)) return null;
  const mentioned = findSpeciesInText(text, catalog);
  const species = [...mentioned];
  for (const rec of tankRecords) {
    if (!species.some((r) => r.scientificName === rec.scientificName)) species.push(rec);
  }
  if (species.length === 0) return null;
  if (species.length === 1 && !tank) return null;
  return checkGroup({ species: species.slice(0, 8), tank });
}
