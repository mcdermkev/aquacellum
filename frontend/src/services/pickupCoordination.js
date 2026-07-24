/**
 * pickupCoordination.js
 *
 * Pure core for Task 25 (Local Pickup Coordination). Answers "where/when
 * does this prepaid-pickup handoff happen?" — nothing else. No network, no
 * timers, no side effects. See docs/TASK_25_PICKUP_COORDINATION_SPEC.md §3.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * GUARDRAIL 1 (spec §0.1, review-critical): this module NEVER imports from
 * settlementCoordinator.js, paymentLedger.js, any reservation* module, or
 * canonicalSettlement.js. A pickup arrangement (spot + time) never holds
 * inventory and never changes an order's payment/escrow/settlement state —
 * the money is already committed via the existing prepaid-pickup Stripe
 * held-payment path before this coordination even starts. This file only
 * decides validity of a spot/time; it does not persist, charge, or transfer
 * anything. Enforced at the code level by this import list staying exactly
 * as it is below, and by a source-guard test in pickupCoordination.test.js.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Availability window shape (stored as pickup_locations.availability jsonb):
 *   { dow: 0-6 (recurring, Sun=0) | date: 'YYYY-MM-DD' (one-off),
 *     start: 'HH:mm', end: 'HH:mm', tz: IANA timezone string }
 * Exactly one of `dow`/`date` must be present per window.
 */

import { containsProhibitedTerm } from "./orderCopy.js";

// ─── Constants ───────────────────────────────────────────────────────────────

export const MAX_LABEL_LENGTH = 80;
export const MAX_NOTES_LENGTH = 500;
export const DEFAULT_HORIZON_DAYS = 14;

// ─── Normalization ───────────────────────────────────────────────────────────

/**
 * Normalize a pickup_locations row (snake_case DB row or camelCase draft)
 * into one canonical camelCase shape. Mirrors storeMerchandising.js's
 * normalizeSection convention.
 * @param {Object} row
 * @returns {Object}
 */
export function normalizePickupLocation(row = {}) {
  const wallet = row.wallet_address ?? row.walletAddress ?? null;
  const availabilityRaw = row.availability;

  return {
    id: row.id ?? null,
    walletAddress: wallet ? String(wallet).toLowerCase() : null,
    label: typeof row.label === "string" ? row.label : "",
    lat: Number.isFinite(Number(row.lat)) ? Number(row.lat) : null,
    lng: Number.isFinite(Number(row.lng)) ? Number(row.lng) : null,
    addressText: row.address_text ?? row.addressText ?? null,
    notes: row.notes ?? null,
    availability: Array.isArray(availabilityRaw) ? availabilityRaw : [],
    active: row.active !== false,
    sortOrder: Number.isFinite(Number(row.sort_order ?? row.sortOrder)) ? Number(row.sort_order ?? row.sortOrder) : 0,
    createdAt: row.created_at ?? row.createdAt ?? null,
    updatedAt: row.updated_at ?? row.updatedAt ?? null,
  };
}

// ─── Validation ──────────────────────────────────────────────────────────────

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate a single availability window. Pure, defensive — never throws.
 * @param {*} window
 * @returns {{ok:boolean, error:(string|null)}}
 */
export function validateAvailabilityWindow(window) {
  if (!window || typeof window !== "object") {
    return { ok: false, error: "each availability window must be an object" };
  }
  const hasDow = window.dow != null;
  const hasDate = window.date != null;
  if (hasDow === hasDate) {
    return { ok: false, error: "each availability window must set exactly one of dow or date" };
  }
  if (hasDow) {
    const dow = Number(window.dow);
    if (!Number.isInteger(dow) || dow < 0 || dow > 6) {
      return { ok: false, error: "dow must be an integer from 0 (Sun) to 6 (Sat)" };
    }
  }
  if (hasDate && !DATE_RE.test(String(window.date))) {
    return { ok: false, error: "date must be in YYYY-MM-DD format" };
  }
  if (!HHMM_RE.test(String(window.start))) {
    return { ok: false, error: "start must be in HH:mm format" };
  }
  if (!HHMM_RE.test(String(window.end))) {
    return { ok: false, error: "end must be in HH:mm format" };
  }
  if (String(window.start) >= String(window.end)) {
    return { ok: false, error: "start must be before end" };
  }
  if (typeof window.tz !== "string" || window.tz.trim().length === 0) {
    return { ok: false, error: "tz is required and must be a non-empty IANA timezone string" };
  }
  // Validate the tz string is usable by the runtime's Intl implementation —
  // catches typos ("Americ/New_York") without hardcoding an IANA name list.
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: window.tz });
  } catch {
    return { ok: false, error: `tz "${window.tz}" is not a recognized timezone` };
  }
  return { ok: true, error: null };
}

/**
 * Validate a pickup-location draft (the shape the seller authoring UI and
 * the server's write path both check).
 * @param {Object} draft
 * @returns {{ok:boolean, error:(string|null)}}
 */
export function validatePickupLocationDraft(draft = {}) {
  if (!draft || typeof draft !== "object") {
    return { ok: false, error: "pickup location must be an object" };
  }

  const label = typeof draft.label === "string" ? draft.label.trim() : "";
  if (!label) {
    return { ok: false, error: "label is required" };
  }
  if (label.length > MAX_LABEL_LENGTH) {
    return { ok: false, error: `label must be ${MAX_LABEL_LENGTH} characters or fewer` };
  }

  if (draft.lat != null) {
    const lat = Number(draft.lat);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      return { ok: false, error: "lat must be a number between -90 and 90" };
    }
  }
  if (draft.lng != null) {
    const lng = Number(draft.lng);
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      return { ok: false, error: "lng must be a number between -180 and 180" };
    }
  }

  if (draft.notes != null && String(draft.notes).length > MAX_NOTES_LENGTH) {
    return { ok: false, error: `notes must be ${MAX_NOTES_LENGTH} characters or fewer` };
  }

  const availability = draft.availability ?? [];
  if (!Array.isArray(availability)) {
    return { ok: false, error: "availability must be an array" };
  }
  for (const window of availability) {
    const result = validateAvailabilityWindow(window);
    if (!result.ok) return result;
  }

  return { ok: true, error: null };
}

// ─── Timezone-aware slot math ────────────────────────────────────────────────
//
// No date/timezone library is used elsewhere in this codebase (grep-
// confirmed), so this uses the standard Intl.DateTimeFormat offset-probe
// technique rather than adding a new dependency for one feature.

/**
 * The UTC-vs-local offset (in minutes, positive = ahead of UTC) that `tz`
 * observes at the instant `utcMs`. Probes via Intl.DateTimeFormat rather
 * than parsing a locale string, so it isn't sensitive to ICU locale
 * formatting differences across runtimes.
 * @param {number} utcMs
 * @param {string} tz
 * @returns {number}
 */
function tzOffsetMinutesAt(utcMs, tz) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  const hour = Number(map.hour) === 24 ? 0 : Number(map.hour);
  const asUTC = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), hour, Number(map.minute), Number(map.second));
  return (asUTC - utcMs) / 60000;
}

/**
 * Resolve the UTC epoch ms instant corresponding to a wall-clock date+time
 * in a given IANA timezone. Converges in at most two probes — sufficient
 * for this feature's scheduling-window use (not a general-purpose tz
 * library; DST-transition instants themselves are an accepted edge case).
 * @param {string} dateStr - 'YYYY-MM-DD'
 * @param {string} timeStr - 'HH:mm'
 * @param {string} tz
 * @returns {number} epoch ms
 */
function zonedWallTimeToUtcMs(dateStr, timeStr, tz) {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const [h, mi] = timeStr.split(":").map(Number);
  const naiveUtc = Date.UTC(y, mo - 1, d, h, mi, 0);
  let guess = naiveUtc - tzOffsetMinutesAt(naiveUtc, tz) * 60000;
  const offset2 = tzOffsetMinutesAt(guess, tz);
  const refined = naiveUtc - offset2 * 60000;
  return refined;
}

/** Add `days` calendar days to a 'YYYY-MM-DD' string, calendar-only (no tz math). */
function addCalendarDays(dateStr, days) {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const ms = Date.UTC(y, mo - 1, d) + days * 86400000;
  const dt = new Date(ms);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** Day-of-week (0=Sun..6=Sat) for a 'YYYY-MM-DD' string, calendar-only. */
function calendarDow(dateStr) {
  const [y, mo, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

/** 'YYYY-MM-DD' for an epoch ms instant, as observed in `tz`. */
function dateStringInTz(utcMs, tz) {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  const parts = dtf.formatToParts(new Date(utcMs));
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  return `${map.year}-${map.month}-${map.day}`;
}

/**
 * Expand a pickup location's recurring/one-off availability windows into
 * concrete upcoming slots within a horizon. Deterministic for a fixed
 * `now`; each window's start/end times are computed in that window's own
 * `tz`. Malformed windows are skipped defensively rather than throwing
 * (validatePickupLocationDraft is the authoritative gate before a window is
 * ever persisted; this function must still degrade gracefully on bad data).
 *
 * @param {Object} location - a normalized (or raw) pickup location with an
 *   `availability` array
 * @param {{ now?: (number|Date), horizonDays?: number }} [opts]
 * @returns {Array<{ startISO:string, endISO:string }>} sorted ascending by start
 */
export function resolveAvailableSlots(location, opts = {}) {
  const nowMs = opts.now instanceof Date ? opts.now.getTime() : Number.isFinite(opts.now) ? opts.now : Date.now();
  const horizonDays = Number.isFinite(opts.horizonDays) ? opts.horizonDays : DEFAULT_HORIZON_DAYS;
  const horizonMs = nowMs + horizonDays * 86400000;

  const windows = Array.isArray(location?.availability) ? location.availability : [];
  const slots = [];

  for (const window of windows) {
    const result = validateAvailabilityWindow(window);
    if (!result.ok) continue;

    const tz = window.tz;
    // Walk the calendar (in `tz`) from "today" through the horizon, matching
    // either a fixed one-off date or a recurring day-of-week.
    const todayInTz = dateStringInTz(nowMs, tz);
    for (let offset = 0; offset <= horizonDays; offset++) {
      const candidateDate = addCalendarDays(todayInTz, offset);
      const matches = window.date != null ? window.date === candidateDate : calendarDow(candidateDate) === Number(window.dow);
      if (!matches) continue;

      const startMs = zonedWallTimeToUtcMs(candidateDate, window.start, tz);
      const endMs = zonedWallTimeToUtcMs(candidateDate, window.end, tz);

      // Skip windows that have already fully elapsed or start beyond the horizon.
      if (endMs <= nowMs) continue;
      if (startMs > horizonMs) continue;

      slots.push({ startISO: new Date(startMs).toISOString(), endISO: new Date(endMs).toISOString() });
    }
  }

  slots.sort((a, b) => a.startISO.localeCompare(b.startISO));
  return slots;
}

/**
 * Validate a buyer-proposed pickup time against a location's availability.
 * Must land inside some availability window instance, must not be in the
 * past, and must be within the scheduling horizon.
 *
 * @param {Object} location
 * @param {string} proposedISO - an ISO-8601 instant
 * @param {{ now?: (number|Date), horizonDays?: number }} [opts]
 * @returns {{ok:boolean, error:(string|null)}}
 */
export function validateProposedTime(location, proposedISO, opts = {}) {
  const proposedMs = Date.parse(proposedISO);
  if (!Number.isFinite(proposedMs)) {
    return { ok: false, error: "proposed time is not a valid date/time" };
  }

  const nowMs = opts.now instanceof Date ? opts.now.getTime() : Number.isFinite(opts.now) ? opts.now : Date.now();
  if (proposedMs < nowMs) {
    return { ok: false, error: "proposed time is in the past" };
  }

  const horizonDays = Number.isFinite(opts.horizonDays) ? opts.horizonDays : DEFAULT_HORIZON_DAYS;
  const horizonMs = nowMs + horizonDays * 86400000;
  if (proposedMs > horizonMs) {
    return { ok: false, error: `proposed time is beyond the ${horizonDays}-day scheduling horizon` };
  }

  const slots = resolveAvailableSlots(location, { now: nowMs, horizonDays });
  const withinAWindow = slots.some((slot) => proposedMs >= Date.parse(slot.startISO) && proposedMs <= Date.parse(slot.endISO));
  if (!withinAWindow) {
    return { ok: false, error: "proposed time does not fall within any of the seller's availability windows" };
  }

  return { ok: true, error: null };
}

// ─── Presentation copy (Web2-safe, PROHIBITED_TERMS-clean) ─────────────────

export const ARRANGEMENT_STATUS_KIND = Object.freeze({
  NONE: "none",
  PROPOSED: "proposed",
  CONFIRMED: "confirmed",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
});

const AK = ARRANGEMENT_STATUS_KIND;

const ARRANGEMENT_COPY = Object.freeze({
  [AK.NONE]: {
    label: { casual: "No pickup time set yet", pro: "No arrangement yet" },
    nextAction: { casual: "Choose a pickup time", pro: "Propose a pickup time" },
  },
  [AK.PROPOSED]: {
    label: { casual: "Time proposed — waiting on the seller", pro: "Proposed — awaiting seller confirmation" },
    nextAction: { casual: "Waiting for the seller to confirm", pro: "Awaiting seller confirmation" },
  },
  [AK.CONFIRMED]: {
    label: { casual: "Pickup time confirmed", pro: "Confirmed" },
    nextAction: { casual: "You're all set for pickup", pro: "Handoff scheduled" },
  },
  [AK.COMPLETED]: {
    label: { casual: "Pickup complete", pro: "Completed" },
    nextAction: { casual: "", pro: "" },
  },
  [AK.CANCELLED]: {
    label: { casual: "Pickup time cancelled", pro: "Cancelled" },
    nextAction: { casual: "Choose a new pickup time", pro: "Propose a new time" },
  },
});

/**
 * Presentation-safe view of a pickup arrangement's status. Web2 copy only —
 * covered by the same PROHIBITED_TERMS invariant as orderCopy.js.
 * @param {Object} arrangement - a pickup_arrangements row/draft (needs `.status`)
 * @param {{ casual?: boolean }} [opts]
 * @returns {{ status:string, label:string, nextAction:string }}
 */
export function arrangementStatusView(arrangement, opts = {}) {
  const casual = opts.casual !== false;
  const raw = arrangement?.status;
  const kind = Object.values(AK).includes(raw) ? raw : AK.NONE;
  const entry = ARRANGEMENT_COPY[kind];
  return {
    status: kind,
    label: casual ? entry.label.casual : entry.label.pro,
    nextAction: casual ? entry.nextAction.casual : entry.nextAction.pro,
  };
}

/** Re-exported so tests/components can run the same Web2-language check used by orderCopy.js. */
export { containsProhibitedTerm };
