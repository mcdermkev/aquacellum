/**
 * localDeliveryAdapter.js
 *
 * Provider-agnostic local-delivery adapter contract (Task 12, Tier A). Defines
 * the interface every courier adapter (sandbox/mock, DoorDash Drive, etc.) must
 * implement, the normalized status/quote/event shapes, and a validator + a
 * reusable contract-test spec so the marketplace never couples to one provider.
 *
 * The concrete mock/provider adapters are Tier B (see the mock-adapter spec);
 * this module is the contract they conform to.
 *
 * Pure and dependency-free.
 */

// ─── Normalized delivery status (maps onto the canonical order lifecycle) ────
// A courier delivery drives the order's in_transit / delivered states
// (marketplaceStateMachine): PICKED_UP/IN_TRANSIT → in_transit, DELIVERED →
// delivered (which still requires buyer healthy-confirmation to complete).
export const DELIVERY_STATUS = Object.freeze({
  REQUESTED: "requested",
  QUOTED: "quoted",
  SCHEDULED: "scheduled",
  DRIVER_ASSIGNED: "driver_assigned",
  PICKED_UP: "picked_up",
  IN_TRANSIT: "in_transit",
  DELIVERED: "delivered",
  CANCELLED: "cancelled",
  FAILED: "failed",
});

export const TERMINAL_DELIVERY_STATUS = Object.freeze([
  DELIVERY_STATUS.DELIVERED,
  DELIVERY_STATUS.CANCELLED,
  DELIVERY_STATUS.FAILED,
]);

/**
 * Map a normalized delivery status to the canonical order state it should drive
 * (or null when it doesn't change the order state on its own).
 * @param {string} status
 * @returns {('in_transit'|'delivered'|null)}
 */
export function deliveryStatusToOrderState(status) {
  switch (status) {
    case DELIVERY_STATUS.PICKED_UP:
    case DELIVERY_STATUS.IN_TRANSIT:
      return "in_transit";
    case DELIVERY_STATUS.DELIVERED:
      return "delivered";
    default:
      return null;
  }
}

// ─── The adapter interface ───────────────────────────────────────────────────
//
// Every method is async and returns a normalized shape (below). Adapters wrap
// a provider's API/SDK and translate to/from these shapes.
//
//   checkEligibility(request)   → { eligible:boolean, verdict:string, reasons:string[] }
//   getQuote(request)           → Quote
//   createDelivery(request)     → Delivery
//   schedule(deliveryId, window)→ Delivery
//   cancel(deliveryId, reason)  → Delivery (status CANCELLED) | throws if terminal
//   getStatus(deliveryId)       → Delivery
//   getProofOfDelivery(id)      → ProofOfDelivery | null (null until DELIVERED)
//   normalizeWebhook(rawEvent)  → DeliveryEvent  (must be idempotent-friendly:
//                                 carries a stable eventId for replay dedupe)
//
// Quote:            { quoteId, amountCents, currency, etaMinutes, expiresAt }
// Delivery:         { deliveryId, status (DELIVERY_STATUS), quoteId?, driver?, window?, updatedAt }
// ProofOfDelivery:  { type ('photo'|'signature'|'pin'), ref, capturedAt }
// DeliveryEvent:    { eventId, deliveryId, status (DELIVERY_STATUS), at, raw? }

export const REQUIRED_ADAPTER_METHODS = Object.freeze([
  "checkEligibility",
  "getQuote",
  "createDelivery",
  "schedule",
  "cancel",
  "getStatus",
  "getProofOfDelivery",
  "normalizeWebhook",
]);

/**
 * Validate that an object implements the local-delivery adapter interface.
 * Throws with the list of missing methods; returns true when valid. Used by the
 * provider contract tests so any adapter (mock or real) is checked identically.
 *
 * @param {Object} adapter
 * @returns {true}
 */
export function assertValidDeliveryAdapter(adapter) {
  if (!adapter || typeof adapter !== "object") {
    throw new Error("delivery adapter must be an object");
  }
  const missing = REQUIRED_ADAPTER_METHODS.filter((m) => typeof adapter[m] !== "function");
  if (missing.length > 0) {
    throw new Error(`delivery adapter is missing required methods: ${missing.join(", ")}`);
  }
  return true;
}

/**
 * Is a quote still valid at time `now`?
 * @param {{expiresAt:number}} quote
 * @param {number} now - epoch ms
 * @returns {boolean}
 */
export function isQuoteValid(quote, now) {
  return !!quote && Number(quote.expiresAt) > Number(now);
}

/**
 * Whether a status transition is legal for a delivery (guards adapters/webhooks
 * against illegal jumps and, with the terminal set, against reopening a
 * finished delivery). Deterministic and provider-independent.
 * @param {string} from
 * @param {string} to
 * @returns {boolean}
 */
export function isValidDeliveryTransition(from, to) {
  if (!Object.values(DELIVERY_STATUS).includes(from) || !Object.values(DELIVERY_STATUS).includes(to)) return false;
  if (TERMINAL_DELIVERY_STATUS.includes(from)) return false; // terminal is final
  const graph = {
    [DELIVERY_STATUS.REQUESTED]: [DELIVERY_STATUS.QUOTED, DELIVERY_STATUS.CANCELLED, DELIVERY_STATUS.FAILED],
    [DELIVERY_STATUS.QUOTED]: [DELIVERY_STATUS.SCHEDULED, DELIVERY_STATUS.CANCELLED, DELIVERY_STATUS.FAILED],
    [DELIVERY_STATUS.SCHEDULED]: [DELIVERY_STATUS.DRIVER_ASSIGNED, DELIVERY_STATUS.CANCELLED, DELIVERY_STATUS.FAILED],
    [DELIVERY_STATUS.DRIVER_ASSIGNED]: [DELIVERY_STATUS.PICKED_UP, DELIVERY_STATUS.CANCELLED, DELIVERY_STATUS.FAILED],
    [DELIVERY_STATUS.PICKED_UP]: [DELIVERY_STATUS.IN_TRANSIT, DELIVERY_STATUS.FAILED],
    [DELIVERY_STATUS.IN_TRANSIT]: [DELIVERY_STATUS.DELIVERED, DELIVERY_STATUS.FAILED],
  };
  return (graph[from] || []).includes(to);
}
