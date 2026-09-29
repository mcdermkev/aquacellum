/**
 * Species photo credits, read from /species-images/ATTRIBUTIONS.json.
 *
 * The file is fetched once per page load (module-level promise) and matched to
 * a species by scientificName. When a species has several entries, the last
 * one wins: new photos are appended, so it describes the current image.
 */

const ATTRIBUTIONS_URL = "/species-images/ATTRIBUTIONS.json";
const SOURCE_LABELS = { inaturalist: "iNaturalist", wikimedia: "Wikimedia Commons" };

let attributionsPromise = null;

export function loadPhotoAttributions(fetchImpl = globalThis.fetch) {
  if (!attributionsPromise) {
    if (typeof fetchImpl !== "function") return Promise.resolve([]);
    attributionsPromise = Promise.resolve()
      .then(() => fetchImpl(ATTRIBUTIONS_URL))
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => (Array.isArray(data) ? data : []))
      .catch(() => {
        attributionsPromise = null; // let a later mount retry
        return [];
      });
  }
  return attributionsPromise;
}

export function findPhotoAttribution(entries, scientificName) {
  const key = String(scientificName || "").trim().toLowerCase();
  if (!key || !Array.isArray(entries)) return null;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (String(entries[i]?.species || "").trim().toLowerCase() === key) return entries[i];
  }
  return null;
}

/** "cc-by-sa" → "CC BY-SA", "cc0" → "CC0"; already-readable names pass through. */
export function formatLicense(license) {
  const raw = String(license || "").trim();
  if (/^cc0$/i.test(raw)) return "CC0";
  if (/^pd$/i.test(raw)) return "Public domain";
  const m = /^cc-(by(?:-[a-z]{2})*)$/i.exec(raw);
  return m ? `CC ${m[1].toUpperCase()}` : raw;
}

/** Author from either a bare name or an iNaturalist "(c) Name, some rights reserved (…)" line. */
export function formatAuthor(attribution) {
  const raw = String(attribution || "").trim();
  const m = /^\(c\)\s*(.+?),\s*(?:some|all|no) rights reserved/i.exec(raw);
  return (m ? m[1] : raw).trim();
}

export function formatPhotoCredit(entry) {
  if (!entry) return null;
  const sourceUrl = /^https:\/\//i.test(entry.sourceUrl || "") ? entry.sourceUrl : "";
  return {
    author: formatAuthor(entry.attribution),
    license: formatLicense(entry.license),
    sourceLabel: SOURCE_LABELS[entry.source] || String(entry.source || ""),
    sourceUrl,
  };
}
