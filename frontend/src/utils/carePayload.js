/**
 * carePayload.js — Derive a structured payload for a care action (Logbook Rework
 * Task 1/2 spine). Kept as a tiny pure module so both the care-log service
 * (services/careLog.js) and any UI can produce the same typed payload that the
 * Breeder Terminal analytics consume, alongside the human-readable `details`.
 *
 * The v23 migration has its own inline parser for one-time backfill; this is the
 * forward path for newly-written logs.
 */

function parsePercent(s) {
  const m = typeof s === "string" && s.match(/(\d{1,3})\s*%/);
  return m ? Number(m[1]) : undefined;
}

function parseLabeledNumber(s, label) {
  const re = new RegExp(`${label}:\\s*([\\d.]+)`, "i");
  const m = typeof s === "string" && s.match(re);
  return m ? Number(m[1]) : undefined;
}

/**
 * @param {string} actionType  e.g. "Feed", "Water Change", "Quick Water Test"
 * @param {string} [details]   human-readable summary
 * @returns {{kind:string, [k:string]:any}}
 */
export function inferCarePayload(actionType, details = "") {
  switch (actionType) {
    case "Water Change":
    case "Log Immediate Water Change": {
      const percent = parsePercent(details);
      return { kind: "waterChange", ...(percent !== undefined ? { percent } : {}) };
    }
    case "Feed":
      return { kind: "feed" };
    case "Scraped Algae":
      return { kind: "clean" };
    case "Quick Water Test":
    case "Water Test":
    case "Detailed Test": {
      const temp = parseLabeledNumber(details, "Temp");
      const ph = parseLabeledNumber(details, "pH");
      return { kind: "test", ...(temp !== undefined ? { temp } : {}), ...(ph !== undefined ? { ph } : {}) };
    }
    case "Treatment":
      return { kind: "treatment" };
    case "Observation":
      return { kind: "observation" };
    default:
      return { kind: "other" };
  }
}
