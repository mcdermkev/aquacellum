/**
 * mockDeliveryAdapter.js
 *
 * Sandbox/mock local-delivery adapter (Task 12, Tier B). A deterministic,
 * in-memory implementation of the provider-agnostic contract defined in
 * `../localDeliveryAdapter.js`. Lets the marketplace exercise the full local
 * courier lifecycle without any real provider, and is the reference adapter
 * validated by `deliveryAdapterContract.js`.
 *
 * Composes:
 *   - `../deliveryEligibility.js` for checkEligibility (no eligibility rules
 *     are reimplemented here).
 *   - `../localDeliveryAdapter.js` for the DELIVERY_STATUS enum, the terminal
 *     set, and isValidDeliveryTransition (no forked status graph here).
 *
 * Pure and dependency-free aside from those two Tier A modules. `now` is
 * injectable so tests are deterministic; there are no real timers.
 */

import {
  DELIVERY_STATUS,
  TERMINAL_DELIVERY_STATUS,
  isValidDeliveryTransition,
  isQuoteValid,
} from "../localDeliveryAdapter.js";
import { evaluateDeliveryEligibility } from "../deliveryEligibility.js";

const DEFAULT_QUOTE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_BASE_CENTS = 500; // $5.00 base fee
const DEFAULT_PER_MILE_CENTS = 150; // $1.50/mile
const DEFAULT_ETA_BASE_MINUTES = 20;
const DEFAULT_ETA_PER_MILE_MINUTES = 3;

let seq = 0;
function nextId(prefix) {
  seq += 1;
  return `${prefix}_${seq}`;
}

/**
 * Create a sandbox local-delivery adapter.
 *
 * @param {Object} [options]
 * @param {() => number} [options.now] - clock injection; defaults to Date.now
 * @param {number} [options.quoteTtlMs] - quote lifetime in ms (default 5 min)
 * @param {boolean} [options.unavailableDrivers] - when true, `schedule` fails
 *   with a FAILED delivery instead of assigning a driver (no-driver simulation)
 * @param {boolean} [options.forceDelivered] - when true, `advance` calls that
 *   land on IN_TRANSIT are immediately followed by an auto-DELIVERED step,
 *   letting tests simulate an instantly-completed courier run
 * @returns {Object} an adapter satisfying `assertValidDeliveryAdapter`
 */
export function createMockDeliveryAdapter(options = {}) {
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const quoteTtlMs = Number.isFinite(options.quoteTtlMs) ? options.quoteTtlMs : DEFAULT_QUOTE_TTL_MS;
  const unavailableDrivers = options.unavailableDrivers === true;
  const forceDelivered = options.forceDelivered === true;

  /** @type {Map<string, Object>} deliveryId -> Delivery (mutable internal record) */
  const deliveries = new Map();
  /** @type {Map<string, Object>} quoteId -> Quote */
  const quotes = new Map();
  /** @type {Set<string>} eventIds already applied, for webhook-replay idempotency */
  const appliedEvents = new Set();

  // ── checkEligibility — delegates entirely to the Tier A safety engine ────

  async function checkEligibility(request = {}) {
    const result = evaluateDeliveryEligibility(request.ctx || {});
    return {
      eligible: result.eligibleNow,
      verdict: result.verdict,
      reasons: [...result.blockers, ...result.timingIssues].map((r) => r.message),
    };
  }

  // ── getQuote — deterministic pricing from distance ───────────────────────

  async function getQuote(request = {}) {
    const distanceMiles = Number(request.distanceMiles) || 0;
    const amountCents = Math.round(DEFAULT_BASE_CENTS + distanceMiles * DEFAULT_PER_MILE_CENTS);
    const etaMinutes = Math.round(DEFAULT_ETA_BASE_MINUTES + distanceMiles * DEFAULT_ETA_PER_MILE_MINUTES);
    const quoteId = nextId("quote");
    const quote = {
      quoteId,
      amountCents,
      currency: "usd",
      etaMinutes,
      expiresAt: now() + quoteTtlMs,
    };
    quotes.set(quoteId, quote);
    return { ...quote };
  }

  // ── createDelivery — requires a valid, unexpired quote ────────────────────

  async function createDelivery(request = {}) {
    const quoteId = request.quoteId;
    const quote = quotes.get(quoteId);
    if (!quote) {
      throw new Error(`mockDeliveryAdapter.createDelivery: unknown quoteId "${quoteId}"`);
    }
    if (!isQuoteValid(quote, now())) {
      throw new Error(`mockDeliveryAdapter.createDelivery: quote "${quoteId}" has expired`);
    }

    const deliveryId = nextId("delivery");
    const delivery = {
      deliveryId,
      status: DELIVERY_STATUS.REQUESTED,
      quoteId,
      driver: null,
      window: null,
      updatedAt: now(),
    };
    deliveries.set(deliveryId, delivery);
    return cloneDelivery(delivery);
  }

  // ── schedule — REQUESTED/QUOTED -> SCHEDULED, or a simulated no-driver fail ─

  async function schedule(deliveryId, window) {
    const delivery = getRequired(deliveryId);

    // The shared transition graph only allows REQUESTED -> QUOTED -> SCHEDULED
    // (no direct REQUESTED -> SCHEDULED hop). Hop through QUOTED first so a
    // freshly created delivery (still REQUESTED) can still be scheduled,
    // without forking isValidDeliveryTransition's graph.
    if (delivery.status === DELIVERY_STATUS.REQUESTED) {
      transition(delivery, DELIVERY_STATUS.QUOTED, {});
    }

    if (unavailableDrivers) {
      transition(delivery, DELIVERY_STATUS.FAILED, { window: window || null, failureReason: "no_drivers_available" });
      return cloneDelivery(delivery);
    }

    transition(delivery, DELIVERY_STATUS.SCHEDULED, { window: window || null });
    return cloneDelivery(delivery);
  }

  // ── cancel — throws if the delivery is already terminal ──────────────────

  async function cancel(deliveryId, reason) {
    const delivery = getRequired(deliveryId);
    if (TERMINAL_DELIVERY_STATUS.includes(delivery.status)) {
      throw new Error(`mockDeliveryAdapter.cancel: delivery "${deliveryId}" is already terminal (${delivery.status})`);
    }
    transition(delivery, DELIVERY_STATUS.CANCELLED, { cancelReason: reason || null });
    return cloneDelivery(delivery);
  }

  // ── getStatus ──────────────────────────────────────────────────────────────

  async function getStatus(deliveryId) {
    return cloneDelivery(getRequired(deliveryId));
  }

  // ── getProofOfDelivery — null until DELIVERED ─────────────────────────────

  async function getProofOfDelivery(deliveryId) {
    const delivery = getRequired(deliveryId);
    if (delivery.status !== DELIVERY_STATUS.DELIVERED) return null;
    return delivery.proofOfDelivery ? { ...delivery.proofOfDelivery } : null;
  }

  // ── normalizeWebhook — stable eventId for replay dedupe ───────────────────

  async function normalizeWebhook(rawEvent = {}) {
    const eventId = rawEvent.eventId || `${rawEvent.deliveryId}:${rawEvent.status}:${rawEvent.at}`;
    return {
      eventId,
      deliveryId: rawEvent.deliveryId,
      status: rawEvent.status,
      at: rawEvent.at != null ? rawEvent.at : now(),
      raw: rawEvent,
    };
  }

  // ── advance / emit — test-only lifecycle drivers, guarded by the shared
  //    transition graph. `emit` additionally dedupes by eventId so replaying
  //    the same normalized webhook event twice is a no-op. ───────────────────

  /**
   * Force a delivery directly to a new status, validating the transition.
   * Test-only helper for driving the lifecycle deterministically.
   */
  function advance(deliveryId, toStatus, extra = {}) {
    const delivery = getRequired(deliveryId);
    transition(delivery, toStatus, extra);
    return cloneDelivery(delivery);
  }

  /**
   * Apply a normalized DeliveryEvent (from normalizeWebhook) to its delivery.
   * Idempotent by eventId: applying the same event twice only changes state
   * once. Test-only helper; illegal transitions still throw.
   */
  function emit(event) {
    const delivery = getRequired(event.deliveryId);
    if (appliedEvents.has(event.eventId)) {
      return cloneDelivery(delivery); // already applied — no-op replay
    }
    transition(delivery, event.status, { lastEventAt: event.at });
    appliedEvents.add(event.eventId);
    return cloneDelivery(delivery);
  }

  // ── internal helpers ───────────────────────────────────────────────────────

  function getRequired(deliveryId) {
    const delivery = deliveries.get(deliveryId);
    if (!delivery) {
      throw new Error(`mockDeliveryAdapter: unknown deliveryId "${deliveryId}"`);
    }
    return delivery;
  }

  function transition(delivery, toStatus, extra = {}) {
    if (!isValidDeliveryTransition(delivery.status, toStatus)) {
      throw new Error(`mockDeliveryAdapter: illegal delivery transition ${delivery.status} -> ${toStatus}`);
    }
    delivery.status = toStatus;
    delivery.updatedAt = now();
    if (extra.window !== undefined) delivery.window = extra.window;
    if (extra.driver !== undefined) delivery.driver = extra.driver;
    if (extra.failureReason !== undefined) delivery.failureReason = extra.failureReason;
    if (extra.cancelReason !== undefined) delivery.cancelReason = extra.cancelReason;

    if (toStatus === DELIVERY_STATUS.DRIVER_ASSIGNED && !delivery.driver) {
      delivery.driver = { id: nextId("driver"), name: "Sandbox Driver" };
    }

    if (toStatus === DELIVERY_STATUS.DELIVERED) {
      delivery.proofOfDelivery = {
        type: "photo",
        ref: nextId("pod"),
        capturedAt: delivery.updatedAt,
      };
    }

    // Simulated auto-completion: an in-transit delivery immediately arrives.
    if (forceDelivered && toStatus === DELIVERY_STATUS.IN_TRANSIT) {
      transition(delivery, DELIVERY_STATUS.DELIVERED, {});
    }
  }

  function cloneDelivery(delivery) {
    return {
      deliveryId: delivery.deliveryId,
      status: delivery.status,
      quoteId: delivery.quoteId,
      driver: delivery.driver ? { ...delivery.driver } : null,
      window: delivery.window ? { ...delivery.window } : null,
      updatedAt: delivery.updatedAt,
      ...(delivery.failureReason !== undefined ? { failureReason: delivery.failureReason } : {}),
      ...(delivery.cancelReason !== undefined ? { cancelReason: delivery.cancelReason } : {}),
    };
  }

  return {
    checkEligibility,
    getQuote,
    createDelivery,
    schedule,
    cancel,
    getStatus,
    getProofOfDelivery,
    normalizeWebhook,
    advance,
    emit,
  };
}
