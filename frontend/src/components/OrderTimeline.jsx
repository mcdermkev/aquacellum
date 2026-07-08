import { getRelativeTime } from "../utils/arrivalNudge";

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

/**
 * Build the ordered list of steps + which one is "current" for a given order.
 * Returns { steps: [{ key, label, ts, state }], note }.
 */
function buildSteps(order, casual) {
  const created = order?.createdAt || null;
  const dispatched = order?.dispatchTimestamp || null;
  const arrived = order?.arrivedAt || null;

  const isShippingLike =
    order?.orderType === "shipping" || order?.isFiat === true || order?.orderType === "fiat" || order?.orderType === "fiat_pending";
  const isBatch = order?.orderType === "batch";

  // Shipping-style status integer: 0 paid/awaiting dispatch, 1 dispatched,
  // 2 confirmed/released, 3 disputed, 4 refunded.
  if (isShippingLike) {
    const s = Number(order?.status ?? 0);

    const placed = { key: "placed", label: casual ? "Order placed" : "Order placed", ts: created, state: "done" };
    const shipped = {
      key: "shipped",
      label: casual ? "On its way" : "Shipped",
      ts: dispatched,
      state: s >= 1 ? "done" : "pending",
    };
    const arrivedStep = {
      key: "arrived",
      label: casual ? "Arrived" : "Delivered",
      ts: arrived,
      state: s >= 2 || arrived ? "done" : s === 1 ? "current" : "pending",
    };
    const confirmed = {
      key: "confirmed",
      label: casual ? "All good — confirmed" : "Arrival confirmed",
      ts: s === 2 ? arrived : null,
      state: s === 2 ? "done" : "pending",
    };

    if (s === 3) {
      // Disputed — buyer reported a problem; under review.
      return {
        steps: [
          placed,
          { ...shipped, state: "done" },
          { key: "reported", label: casual ? "Problem reported" : "Reported — under review", ts: null, state: "alert" },
        ],
        note: casual
          ? "We're reviewing this order. Your payment is protected while we help."
          : "Under review. Payment held pending resolution.",
      };
    }
    if (s === 4) {
      return {
        steps: [
          placed,
          { key: "refunded", label: "Refunded", ts: null, state: "alert" },
        ],
        note: casual ? "You were refunded for this order." : "Order refunded to the buyer.",
      };
    }

    // Set the "current" marker to the first non-done step.
    const steps = [placed, shipped, arrivedStep, confirmed];
    markCurrent(steps);
    return { steps, note: null };
  }

  if (isBatch) {
    const st = Number(order?.state ?? 0);
    const placed = { key: "placed", label: "Order placed", ts: created, state: "done" };
    if (st === 2) {
      return { steps: [placed, { key: "refunded", label: "Refunded", ts: null, state: "alert" }], note: null };
    }
    const confirmed = {
      key: "confirmed",
      label: casual ? "All good — confirmed" : "Arrival confirmed",
      ts: arrived,
      state: st === 1 ? "done" : "pending",
    };
    const steps = [placed, confirmed];
    markCurrent(steps);
    return { steps, note: null };
  }

  // Generic / instant / pickup — placed then completed.
  const placed = { key: "placed", label: "Order placed", ts: created, state: "done" };
  const completed = {
    key: "completed",
    label: "Completed",
    ts: arrived,
    state: order?.status === "settled" || order?.status === 2 || arrived ? "done" : "pending",
  };
  const steps = [placed, completed];
  markCurrent(steps);
  return { steps, note: null };
}

/** Mark the first non-done step as the current step (blue). */
function markCurrent(steps) {
  const idx = steps.findIndex((s) => s.state !== "done");
  if (idx >= 0 && steps[idx].state === "pending") {
    steps[idx].state = "current";
  }
}

export function OrderTimeline({ order, casualModeActive = false, compact = false }) {
  if (!order) return null;
  const { steps, note } = buildSteps(order, casualModeActive);
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
