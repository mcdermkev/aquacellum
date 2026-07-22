import { getRelativeTime } from "../utils/arrivalNudge";
import { assembleBuyerOrderView } from "../services/buyerOrderView";
import { ORDER_STATES } from "../services/marketplaceStateMachine";

/**
 * OrderTimeline — a shared, buyer- and seller-facing status tracker.
 *
 * Derives the canonical order journey directly from the LOCAL order record
 * (no cloud dependency), so it renders instantly, works offline, and both
 * parties see the same steps once the order syncs between them:
 *
 *   Order placed → Shipped → Arrived → Confirmed
 *
 * Terminal problem states (Reported / Refunded) replace the tail of the
 * journey when applicable. Works for shipping (and fiat surfaced as shipping),
 * batch, pickup, and instant orders.
 *
 * Step-building itself is delegated to buyerOrderView.assembleBuyerOrderView
 * (Task 18) so every buyer surface — this timeline, the order list, and the
 * detail drawer — shares one canonical-state-aware timeline instead of each
 * re-deriving it. This component renders the resulting array + adds the
 * live, time-sensitive safety-window note (which depends on Date.now() at
 * render time, so it stays here rather than in the pure module).
 *
 * Props:
 *  - order: local marketOrders record (shipping/batch/fiat/etc.)
 *  - casualModeActive: softens copy for hobbyists
 *  - compact: smaller vertical spacing when embedded in a receipt
 */

const COLORS = {
  done: "#34d399",     // green — completed step
  current: "#38bdf8",  // blue — where the order is now
  pending: "rgba(255,255,255,0.18)",
  alert: "#f87171",    // red — problem/refund
};

// Mirrors the contract's SHIPPING_SAFETY_WINDOW (3 days).
const SAFETY_WINDOW_SECS = 3 * 24 * 60 * 60;

/**
 * Live, time-sensitive note shown while a shipping order is in transit
 * (safety-window countdown) or in a claim/refund state. Kept separate from
 * the pure timeline builder because it reads Date.now() at render time.
 */
function buildNote(view, order, casual) {
  const { canonicalState } = view;

  if (canonicalState === ORDER_STATES.CLAIM_OPEN) {
    return casual
      ? "We're reviewing this order. Your payment is protected while we help."
      : "Under review. Payment held pending resolution.";
  }
  if (canonicalState === ORDER_STATES.REFUNDED) {
    return casual ? "You were refunded for this order." : "Order refunded to the buyer.";
  }

  // Shipping-only, in-transit: surface the buyer-protection safety window.
  const isShippingLike = view.method === "shipping" || view.method === "courier";
  const dispatched = order?.dispatchTimestamp || null;
  if (isShippingLike && canonicalState === ORDER_STATES.IN_TRANSIT && dispatched) {
    const remainDays = Math.ceil((dispatched + SAFETY_WINDOW_SECS - Date.now() / 1000) / 86400);
    if (remainDays > 0) {
      const d = `${remainDays} day${remainDays === 1 ? "" : "s"}`;
      return casual
        ? `🛡️ Confirm arrival anytime to release payment to the breeder. If all stays quiet, it auto-releases in about ${d}.`
        : `🛡️ 3-day safety window active. Buyer can confirm to release now; otherwise funds auto-release in ~${d}. Report a problem to hold them.`;
    }
    return casual
      ? "🛡️ The safe-arrival window has passed — payment can now release to the breeder."
      : "🛡️ Safety window elapsed — funds are eligible for release to the seller.";
  }

  return null;
}

export function OrderTimeline({ order, casualModeActive = false, compact = false }) {
  if (!order) return null;
  const view = assembleBuyerOrderView(order, { casual: casualModeActive });
  const steps = view.timeline;
  const note = buildNote(view, order, casualModeActive);
  if (!steps || steps.length === 0) return null;

  const gap = compact ? "0.35rem" : "0.5rem";

  return (
    <div style={{ width: "100%" }}>
      <div
        style={{
          fontSize: "0.68rem",
          color: "var(--text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          marginBottom: "0.5rem",
        }}
      >
        {casualModeActive ? "Where's my order" : "Order status"}
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap,
          paddingLeft: "0.5rem",
          borderLeft: "2px solid rgba(255,255,255,0.06)",
        }}
      >
        {steps.map((step) => {
          const color = COLORS[step.state] || COLORS.pending;
          const isPending = step.state === "pending";
          return (
            <div key={step.key} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <div
                style={{
                  width: step.state === "current" ? "10px" : "8px",
                  height: step.state === "current" ? "10px" : "8px",
                  borderRadius: "50%",
                  background: color,
                  marginLeft: step.state === "current" ? "-6px" : "-5px",
                  flexShrink: 0,
                  boxShadow: step.state === "current" ? `0 0 0 3px rgba(56,189,248,0.18)` : "none",
                }}
              />
              <div style={{ flex: 1, display: "flex", alignItems: "baseline", gap: "0.5rem" }}>
                <span
                  style={{
                    color: isPending ? "var(--text-muted)" : "#fff",
                    fontSize: "0.74rem",
                    fontWeight: step.state === "current" ? 600 : 400,
                  }}
                >
                  {step.label}
                </span>
                {step.ts ? (
                  <span style={{ color: "var(--text-muted)", fontSize: "0.65rem" }}>
                    {getRelativeTime(step.ts)}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {note && (
        <div style={{ marginTop: "0.5rem", fontSize: "0.7rem", color: "var(--text-secondary)" }}>
          {note}
        </div>
      )}
    </div>
  );
}

export default OrderTimeline;
