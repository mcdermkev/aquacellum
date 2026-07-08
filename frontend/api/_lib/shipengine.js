/**
 * shipengine.js — Shared ShipEngine v1 client for Vercel API routes
 *
 * Buyer-paid live-fish shipping. Rates are calculated at CHECKOUT from the
 * seller's private origin to the buyer's destination (distance-fair). The
 * seller later buys the label in-app; the returned tracking number
 * auto-populates the dispatch.
 *
 * Not deployed as its own serverless function (files under api/_lib/ are
 * imported, not routed). The HTTP-facing actions live in stripe.js.
 *
 * Docs: https://www.shipengine.com/docs/  (API base https://api.shipengine.com)
 * Auth: every request carries the `API-Key` header.
 *
 * Env:
 *   SHIPENGINE_API_KEY       — required
 *   SHIPENGINE_CARRIER_IDS   — optional comma-separated carrier_ids to quote
 *                              (blank = all carriers on the account)
 */

const SHIPENGINE_BASE = "https://api.shipengine.com";

// Live fish must move fast. We only ever quote/buy expedited services — never
// ground — regardless of what the carrier account offers. Matching is done by
// substring against the ShipEngine service_code (lowercased).
const EXPEDITED_SERVICE_MATCHERS = [
  "priority_mail_express", // USPS Priority Mail Express (overnight-ish)
  "priority_mail",         // USPS Priority Mail (1-3 day) — acceptable fallback
  "next_day",              // UPS/FedEx next day air
  "2day",                  // 2-day air
  "second_day",
  "overnight",
  "express",
  "priority_overnight",
  "standard_overnight",
  "first_overnight",
];

// Services we explicitly refuse for livestock even if they match above.
const GROUND_SERVICE_MATCHERS = ["ground", "parcel_select", "media_mail", "surepost", "smartpost"];

/**
 * Low-level ShipEngine fetch. Throws on non-2xx with the parsed error body.
 * @param {string} path e.g. "/v1/rates"
 * @param {object} [options] { method, body }
 */
async function shipengineFetch(path, { method = "GET", body } = {}) {
  const apiKey = process.env.SHIPENGINE_API_KEY;
  if (!apiKey) {
    throw new Error("SHIPENGINE_API_KEY not configured");
  }

  const res = await fetch(`${SHIPENGINE_BASE}${path}`, {
    method,
    headers: {
      "API-Key": apiKey,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const message =
      data?.errors?.map((e) => e.message).join("; ") ||
      data?.message ||
      `ShipEngine ${method} ${path} failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    err.body = data;
    throw err;
  }

  return data;
}

/** Parse SHIPENGINE_CARRIER_IDS into an array (empty = quote all carriers). */
export function configuredCarrierIds() {
  return (process.env.SHIPENGINE_CARRIER_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** True if a ShipEngine service_code is an acceptable expedited live-fish service. */
export function isExpeditedService(serviceCode = "") {
  const code = String(serviceCode).toLowerCase();
  if (GROUND_SERVICE_MATCHERS.some((m) => code.includes(m))) return false;
  return EXPEDITED_SERVICE_MATCHERS.some((m) => code.includes(m));
}

/**
 * Normalize a ShipEngine ship_from/ship_to address from our stored shape.
 * Accepts either our seller_ship_from columns or a raw ShipEngine address.
 */
export function toShipEngineAddress(a = {}) {
  return {
    name: a.name || a.contactName || "Aquacellum Seller",
    phone: a.phone || undefined,
    company_name: a.company_name || a.companyName || undefined,
    address_line1: a.address_line1 || a.addressLine1 || a.line1,
    address_line2: a.address_line2 || a.addressLine2 || a.line2 || undefined,
    city_locality: a.city_locality || a.city,
    state_province: a.state_province || a.state,
    postal_code: a.postal_code || a.postalCode || a.zip,
    country_code: a.country_code || a.countryCode || "US",
    address_residential_indicator:
      a.address_residential_indicator || a.residential || "unknown",
  };
}

/**
 * Build the packages[] array from a parcel preset (weight in oz + inches).
 * Falls back to a sensible medium insulated-box default.
 */
export function toPackages(parcel = {}) {
  const weightOz = Number(parcel.weight_oz ?? parcel.weightOz ?? 48); // ~3 lb default
  return [
    {
      weight: { value: weightOz, unit: "ounce" },
      dimensions: {
        unit: "inch",
        length: Number(parcel.length_in ?? parcel.length ?? 12),
        width: Number(parcel.width_in ?? parcel.width ?? 10),
        height: Number(parcel.height_in ?? parcel.height ?? 8),
      },
    },
  ];
}

/**
 * Validate an address. Returns { status, normalized, messages }.
 * status ∈ 'verified' | 'unverified' | 'warning' | 'error'.
 */
export async function validateAddress(address) {
  const data = await shipengineFetch("/v1/addresses/validate", {
    method: "POST",
    body: [toShipEngineAddress(address)],
  });
  const result = Array.isArray(data) ? data[0] : data;
  return {
    status: result?.status || "unverified",
    normalized: result?.matched_address || null,
    messages: result?.messages || [],
  };
}

/**
 * Get live rates from origin -> destination for a parcel.
 * Returns only expedited (live-fish-safe) rates, sorted cheapest first.
 *
 * @returns {Promise<{rates: Array, invalid: Array, errors: Array}>}
 *   rate = { rateId, carrierId, carrierFriendlyName, serviceCode, serviceType,
 *            amountCents, currency, deliveryDays, estimatedDeliveryDate, shipDate }
 */
export async function getRates({ shipFrom, shipTo, parcel, carrierIds, shipDate }) {
  const carriers = (carrierIds && carrierIds.length ? carrierIds : configuredCarrierIds());

  const body = {
    rate_options: {
      // If no carriers are configured, omit carrier_ids so ShipEngine quotes all.
      ...(carriers.length ? { carrier_ids: carriers } : {}),
    },
    shipment: {
      validate_address: "no_validation", // addresses validated separately/at save
      ship_to: toShipEngineAddress(shipTo),
      ship_from: toShipEngineAddress(shipFrom),
      packages: toPackages(parcel),
      ...(shipDate ? { ship_date: shipDate } : {}),
    },
  };

  const data = await shipengineFetch("/v1/rates", { method: "POST", body });
  const rr = data?.rate_response || {};
  const rawRates = rr.rates || [];

  const rates = rawRates
    .filter((r) => isExpeditedService(r.service_code))
    .map(normalizeRate)
    .sort((a, b) => a.amountCents - b.amountCents);

  return {
    rates,
    invalid: rr.invalid_rates || [],
    errors: rr.errors || [],
  };
}

/** Normalize a raw ShipEngine rate into our compact, cents-based shape. */
export function normalizeRate(r) {
  const amount = r.shipping_amount?.amount ?? 0;
  const otherAmount = r.other_amount?.amount ?? 0;
  const confirmationAmount = r.confirmation_amount?.amount ?? 0;
  const totalAmount = amount + otherAmount + confirmationAmount;
  return {
    rateId: r.rate_id,
    carrierId: r.carrier_id,
    carrierFriendlyName: r.carrier_friendly_name || r.carrier_code,
    serviceCode: r.service_code,
    serviceType: r.service_type,
    amountCents: Math.round(totalAmount * 100),
    currency: r.shipping_amount?.currency || "usd",
    deliveryDays: r.delivery_days ?? null,
    estimatedDeliveryDate: r.estimated_delivery_date ?? null,
    shipDate: r.ship_date ?? null,
    packageType: r.package_type ?? null,
    trackable: r.trackable ?? true,
  };
}

/**
 * Buy a label directly from a full shipment + service_code. Preferred for the
 * seller's in-app "Buy label" because rate_ids expire — we re-rate implicitly
 * by creating the label from the shipment using the service the buyer paid for.
 *
 * @returns { labelId, shipmentId, trackingNumber, carrierId, carrierCode,
 *            serviceCode, labelPdfUrl, costCents, estimatedDeliveryDate }
 */
export async function buyLabelFromShipment({ shipFrom, shipTo, parcel, serviceCode, carrierId, shipDate }) {
  const body = {
    shipment: {
      service_code: serviceCode,
      ...(carrierId ? { carrier_id: carrierId } : {}),
      ship_to: toShipEngineAddress(shipTo),
      ship_from: toShipEngineAddress(shipFrom),
      packages: toPackages(parcel),
      ...(shipDate ? { ship_date: shipDate } : {}),
    },
    label_layout: "4x6",
    label_format: "pdf",
  };
  const data = await shipengineFetch("/v1/labels", { method: "POST", body });
  return normalizeLabel(data);
}

/**
 * Buy a label from a previously returned rate_id (valid only briefly).
 * Used when the seller buys immediately off a fresh quote.
 */
export async function buyLabelFromRate(rateId) {
  const data = await shipengineFetch(`/v1/labels/rates/${rateId}`, {
    method: "POST",
    body: { label_layout: "4x6", label_format: "pdf" },
  });
  return normalizeLabel(data);
}

/** Normalize a ShipEngine label response. */
export function normalizeLabel(l) {
  const cost = l.shipment_cost?.amount ?? l.insurance_cost?.amount ?? null;
  return {
    labelId: l.label_id,
    shipmentId: l.shipment_id,
    trackingNumber: l.tracking_number,
    carrierId: l.carrier_id,
    carrierCode: l.carrier_code,
    serviceCode: l.service_code,
    labelPdfUrl: l.label_download?.pdf || l.label_download?.href || null,
    costCents: cost != null ? Math.round(cost * 100) : null,
    estimatedDeliveryDate: l.estimated_delivery_date ?? null,
    status: l.status ?? null,
  };
}

/** Void/refund a purchased label (e.g. seller cancels before handoff). */
export async function voidLabel(labelId) {
  return shipengineFetch(`/v1/labels/${labelId}/void`, { method: "PUT" });
}

/** List carriers connected to the ShipEngine account (for seller/admin setup). */
export async function listCarriers() {
  const data = await shipengineFetch("/v1/carriers");
  return (data?.carriers || []).map((c) => ({
    carrierId: c.carrier_id,
    carrierCode: c.carrier_code,
    friendlyName: c.friendly_name,
    services: (c.services || []).map((s) => ({ serviceCode: s.service_code, name: s.name })),
  }));
}

// ── Live-fish scheduling guardrails ────────────────────────────────────────

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Recommend whether it's safe to ship live fish TODAY given transit time, so a
 * shipment never sits in a facility over the weekend. Carriers deliver Mon–Sat
 * (Sun rare); we treat Sunday as a non-delivery day and steer sellers to ship
 * early in the week for slower routes.
 *
 * @param {number} deliveryDays estimated transit days for the chosen service
 * @param {Date}   [now] injectable for testing
 * @returns {{ canShipToday: boolean, arrivesOnWeekend: boolean,
 *             recommendedShipDate: string, reason: string }}
 */
export function shippingWindowAdvice(deliveryDays, now = new Date()) {
  const transit = Math.max(1, Number(deliveryDays) || 2);
  const arrival = new Date(now.getTime() + transit * MS_PER_DAY);
  const arrivalDow = arrival.getDay(); // 0=Sun ... 6=Sat
  const todayDow = now.getDay();

  // Sunday = no delivery. Saturday delivery is fine (most carriers).
  const arrivesOnSunday = arrivalDow === 0;
  // Anything arriving Sunday, or shipped Fri/Sat on a multi-day route that would
  // idle over the weekend, is discouraged.
  const shippedLateWeek = todayDow === 5 || todayDow === 6; // Fri or Sat
  const idlesOverWeekend = shippedLateWeek && transit > 1;

  const canShipToday = !arrivesOnSunday && !idlesOverWeekend;

  // Next safe ship day: roll forward to Monday if we shouldn't ship now.
  let recommended = new Date(now);
  if (!canShipToday) {
    // advance to next Monday
    const daysUntilMonday = ((8 - todayDow) % 7) || 7;
    recommended = new Date(now.getTime() + daysUntilMonday * MS_PER_DAY);
  }

  let reason;
  if (canShipToday) {
    reason = "Safe to ship today.";
  } else if (arrivesOnSunday) {
    reason = "Would arrive Sunday (no delivery). Hold and ship early next week.";
  } else {
    reason = "Shipping now risks the package idling in transit over the weekend. Ship Monday.";
  }

  return {
    canShipToday,
    arrivesOnWeekend: arrivalDow === 0 || arrivalDow === 6,
    recommendedShipDate: recommended.toISOString().slice(0, 10),
    reason,
  };
}

/**
 * Heat/cold pack nudge from origin+destination + month. Coarse heuristic (no
 * external weather call) that flags likely thermal risk so the seller adds the
 * right pack. Sellers can override.
 *
 * @param {string} fromState 2-letter origin state
 * @param {string} toState   2-letter destination state
 * @param {Date}   [now]
 * @returns {{ recommend: 'heat'|'cold'|'none', reason: string }}
 */
export function thermalPackAdvice(fromState, toState, now = new Date()) {
  const month = now.getMonth(); // 0=Jan
  const isWinter = month <= 1 || month === 11;       // Dec–Feb
  const isSummer = month >= 5 && month <= 8;          // Jun–Sep

  // States that skew cold in winter / hot in summer (coarse buckets).
  const COLD_STATES = new Set(["AK","MT","ND","SD","MN","WI","MI","ME","VT","NH","WY","ID","CO","NY","MA","IA","NE"]);
  const HOT_STATES = new Set(["AZ","TX","FL","NV","LA","MS","AL","GA","SC","NM","OK","CA"]);

  const dest = String(toState || "").toUpperCase();
  const orig = String(fromState || "").toUpperCase();

  if (isWinter && (COLD_STATES.has(dest) || COLD_STATES.has(orig))) {
    return { recommend: "heat", reason: "Cold-weather route in winter — include a 72hr heat pack." };
  }
  if (isSummer && (HOT_STATES.has(dest) || HOT_STATES.has(orig))) {
    return { recommend: "cold", reason: "Hot-weather route in summer — include a cold/gel pack." };
  }
  if (isWinter) {
    return { recommend: "heat", reason: "Winter shipment — a heat pack is recommended for live fish." };
  }
  if (isSummer) {
    return { recommend: "cold", reason: "Summer shipment — a cold pack helps on warm routes." };
  }
  return { recommend: "none", reason: "Mild season — no thermal pack strictly required." };
}
