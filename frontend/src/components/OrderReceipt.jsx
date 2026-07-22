import React, { useEffect, useState } from "react";
import { generateAlias } from "../utils/generateAlias";
import { OrderTimeline } from "./OrderTimeline";
import { getRelativeTime } from "../utils/arrivalNudge";
import { useAuth } from "../contexts/AuthContext";
import { resolveCanonicalState, resolveMethod } from "../services/buyerOrderView";
import { isOrderReviewable } from "../services/reviewEligibility";
import { fetchReviewForOrder } from "../services/reviewsApi";
import { ReviewComposer } from "./reviews/ReviewComposer";
import { ReviewStars } from "./reviews/ReviewStars";

/**
 * OrderReceipt — Expandable inline receipt/breakdown for completed orders.
 * Shows date, items, fee breakdown, seller info, and status timeline.
 *
 * Props:
 *  - order: the local marketOrders record (shipping or batch)
 *  - isExpanded: whether to show the receipt
 *  - onToggle: callback to toggle expanded state
 *  - casualModeActive: adjusts language
 */
export function OrderReceipt({ order, isExpanded, onToggle, casualModeActive = false }) {
  if (!order) return null;

  const isShipping = order.orderType === "shipping";
  const isBatch = order.orderType === "batch";
  const isFiat = order.orderType === "fiat_pending" || order.orderType === "fiat_settled";

  // Parse financials
  const price = parseFloat(order.price || "0");
  const shippingFee = parseFloat(order.shippingFee || "0");
  const amountLocked = parseFloat(order.amountLocked || "0");
  const platformFee = amountLocked * 0.04; // 4% fee
  const sellerReceives = amountLocked - platformFee;

  // Determine final status label
  const getStatusLabel = () => {
    if (isShipping) {
      switch (order.status) {
        case 2: return { label: "Completed", color: "#34d399", icon: "✅" };
        case 4: return { label: "Refunded", color: "#fbbf24", icon: "↩️" };
        case 3: return { label: "Disputed", color: "#f87171", icon: "⚠️" };
        default: return { label: "In Progress", color: "#7dd3fc", icon: "⏳" };
      }
    }
    if (isBatch) {
      switch (order.state) {
        case 1: return { label: "Completed", color: "#34d399", icon: "✅" };
        case 2: return { label: "Refunded", color: "#fbbf24", icon: "↩️" };
        default: return { label: "Pending", color: "#7dd3fc", icon: "🔒" };
      }
    }
    if (order.status === "settled") return { label: "Settled", color: "#34d399", icon: "✅" };
    if (order.status === "failed") return { label: "Failed", color: "#f87171", icon: "❌" };
    return { label: "Pending", color: "#7dd3fc", icon: "⏳" };
  };

  const status = getStatusLabel();
  const orderDate = order.createdAt ? new Date(order.createdAt * 1000) : null;

  return (
    <div style={{ width: "100%" }}>
      {/* Toggle button */}
      <button
        onClick={onToggle}
        style={{
          width: "100%",
          padding: "0.4rem 0.75rem",
          fontSize: "0.72rem",
          fontWeight: "600",
          background: isExpanded ? "rgba(56, 189, 248, 0.06)" : "rgba(255, 255, 255, 0.02)",
          border: isExpanded ? "1px solid rgba(56, 189, 248, 0.2)" : "1px solid rgba(255, 255, 255, 0.06)",
          borderRadius: "4px",
          color: isExpanded ? "var(--accent-blue)" : "var(--text-secondary)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "0.4rem",
          transition: "all 0.2s ease",
        }}
      >
        <span>{isExpanded ? "▾" : "▸"}</span>
        {isExpanded ? "Hide Receipt" : "View Receipt"}
      </button>

      {/* Expanded receipt card */}
      {isExpanded && (
        <div
          style={{
            marginTop: "0.75rem",
            padding: "1.25rem",
            background: "rgba(0, 0, 0, 0.2)",
            border: "1px solid rgba(255, 255, 255, 0.06)",
            borderRadius: "8px",
            fontSize: "0.78rem",
          }}
        >
          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
            <div>
              <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {casualModeActive ? "Order Receipt" : "Transaction Ledger"}
              </div>
              <div style={{ fontSize: "1rem", fontWeight: "700", color: "#fff", marginTop: "0.2rem" }}>
                {order.commonName || "Specimen"}
              </div>
              {isBatch && order.quantity && (
                <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
                  Quantity: {order.quantity}
                </div>
              )}
            </div>
            <div style={{
              padding: "0.25rem 0.6rem",
              borderRadius: "12px",
              background: `${status.color}15`,
              border: `1px solid ${status.color}30`,
              color: status.color,
              fontSize: "0.68rem",
              fontWeight: "600",
              display: "flex",
              alignItems: "center",
              gap: "0.3rem",
            }}>
              <span>{status.icon}</span> {status.label}
            </div>
          </div>

          {/* Date & Serial */}
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "1rem", padding: "0.5rem 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <div>
              <span style={{ color: "var(--text-muted)" }}>Date: </span>
              <span style={{ color: "#fff" }}>
                {orderDate ? orderDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
              </span>
            </div>
            <div>
              <span style={{ color: "var(--text-muted)" }}>Serial: </span>
              <span style={{ fontFamily: "monospace", color: "#fff" }}>
                #{isShipping ? order.tokenId?.toString().padStart(4, "0") : order.purchaseId?.toString().padStart(4, "0")}
              </span>
            </div>
          </div>

          {/* Parties */}
          <div style={{ marginBottom: "1rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-muted)" }}>Buyer:</span>
              <span style={{ fontFamily: "monospace", fontSize: "0.7rem", color: "var(--accent-blue)" }}>
                {generateAlias(order.buyer || "")}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-muted)" }}>Seller:</span>
              <span style={{ fontFamily: "monospace", fontSize: "0.7rem", color: "var(--accent-green)" }}>
                {generateAlias(order.seller || "")}
              </span>
            </div>
          </div>

          {/* Financial Breakdown */}
          <div style={{
            padding: "0.75rem",
            background: "rgba(255, 255, 255, 0.02)",
            borderRadius: "6px",
            border: "1px solid rgba(255, 255, 255, 0.04)",
            display: "flex",
            flexDirection: "column",
            gap: "0.4rem",
            marginBottom: "1rem",
          }}>
            <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "0.25rem" }}>
              {casualModeActive ? "Price Breakdown" : "Financial Ledger"}
            </div>

            {isShipping && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--text-secondary)" }}>Specimen Price:</span>
                  <span style={{ fontFamily: "monospace", color: "#fff" }}>${price.toFixed(2)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--text-secondary)" }}>Shipping Fee:</span>
                  <span style={{ fontFamily: "monospace", color: "#fff" }}>${shippingFee.toFixed(2)}</span>
                </div>
              </>
            )}

            {isBatch && (
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-secondary)" }}>
                  {order.quantity > 1 ? `${order.quantity} fish` : "Batch Total"}:
                </span>
                <span style={{ fontFamily: "monospace", color: "#fff" }}>${amountLocked.toFixed(2)}</span>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text-muted)", fontSize: "0.7rem" }}>
              <span>Platform Fee (4%):</span>
              <span style={{ fontFamily: "monospace" }}>-${platformFee.toFixed(2)}</span>
            </div>

            <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "0.4rem", marginTop: "0.2rem", display: "flex", justifyContent: "space-between" }}>
              <strong style={{ color: "#fff" }}>
                {order.role === "Buyer" ? "You Paid:" : "You Received:"}
              </strong>
              <strong style={{ fontFamily: "monospace", color: "var(--accent-green)" }}>
                ${order.role === "Buyer" ? amountLocked.toFixed(2) : sellerReceives.toFixed(2)}
              </strong>
            </div>
          </div>

          {/* Shipping Details (if available) */}
          {isShipping && order.trackingNumber && (
            <div style={{
              padding: "0.5rem 0.75rem",
              background: "rgba(56, 189, 248, 0.04)",
              border: "1px solid rgba(56, 189, 248, 0.12)",
              borderRadius: "6px",
              marginBottom: "1rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.3rem",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-muted)" }}>Tracking #:</span>
                <span style={{ fontFamily: "monospace", color: "var(--accent-blue)", fontWeight: "600" }}>
                  {order.trackingNumber}
                </span>
              </div>
              {order.dispatchTimestamp > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--text-muted)" }}>Dispatched:</span>
                  <span style={{ color: "#fff" }}>
                    {new Date(order.dispatchTimestamp * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    {" "}({getRelativeTime(order.dispatchTimestamp)})
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Seller payout transparency — when their held funds land. */}
          {order.role === "Seller" && (order.orderType === "shipping" || order.isFiat) && (() => {
            const s = Number(order.status ?? 0);
            const WINDOW_SEC = 3 * 24 * 60 * 60;
            let icon = "💵";
            let color = "var(--text-muted)";
            let text = "Payout releases after you ship, plus a 3-day arrival check.";
            if (s === 2) {
              icon = "✅"; color = "#34d399"; text = "Paid out to you.";
            } else if (s === 4) {
              icon = "↩️"; color = "#fbbf24"; text = "Refunded to the buyer.";
            } else if (s === 3) {
              icon = "⏳"; color = "#f87171"; text = "On hold — under review.";
            } else if (s === 1 && order.dispatchTimestamp) {
              const whenMs = (Number(order.dispatchTimestamp) + WINDOW_SEC) * 1000;
              if (Date.now() >= whenMs) {
                icon = "💵"; color = "#34d399"; text = "Payout available now.";
              } else {
                const d = new Date(whenMs).toLocaleDateString("en-US", { month: "short", day: "numeric" });
                icon = "💵"; color = "#7dd3fc"; text = `Payout available ${d} (once the arrival window closes).`;
              }
            }
            return (
              <div style={{
                display: "flex", alignItems: "center", gap: "0.4rem",
                fontSize: "0.72rem", color, marginBottom: "0.75rem",
                padding: "0.4rem 0.6rem", borderRadius: "6px",
                background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
              }}>
                <span>{icon}</span>
                <span>{text}</span>
              </div>
            );
          })()}

          {/* Shared, buyer- and seller-facing status timeline (derived locally) */}
          <OrderTimeline order={order} casualModeActive={casualModeActive} compact />

          {/* Leave-a-review entry point (Task 20 §4) — buyer-only, and only
              once the order has reached a verified completed state. Uses the
              same canonical-state resolution as OrderTimeline/buyerOrderView
              rather than re-deriving "is this order done" locally. */}
          {order.role === "Buyer" && <OrderReviewSection order={order} casualModeActive={casualModeActive} />}
        </div>
      )}
    </div>
  );
}

/**
 * OrderReviewSection — the buyer-facing "leave a review" entry point wired
 * into the receipt. Composes isOrderReviewable (never re-derives eligibility)
 * and only ever shows the composer when eligible; otherwise shows the
 * existing review (if the buyer already left one) or a plain, non-alarming
 * reason why not yet ("available after your fish arrives").
 */
function OrderReviewSection({ order, casualModeActive }) {
  const { account } = useAuth() || {};
  const [existingReview, setExistingReview] = useState(undefined); // undefined = loading
  const [justSubmitted, setJustSubmitted] = useState(null);
  const [showComposer, setShowComposer] = useState(false);

  const canonicalState = resolveCanonicalState(order);
  const method = resolveMethod(order);
  const orderRef = orderReviewRef(order);

  useEffect(() => {
    let cancelled = false;
    if (!orderRef) {
      setExistingReview(null);
      return;
    }
    (async () => {
      const res = await fetchReviewForOrder(orderRef);
      if (!cancelled) setExistingReview(res.success ? res.review : null);
    })();
    return () => { cancelled = true; };
  }, [orderRef]);

  if (existingReview === undefined) return null; // loading — avoid a layout flash

  const review = justSubmitted || existingReview;

  if (review) {
    return (
      <div style={{ marginTop: "0.75rem", paddingTop: "0.75rem", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.4rem" }}>
          {casualModeActive ? "Your review" : "Your review"}
        </div>
        <ReviewStars average={review.overall} count={0} size={13} showCount={false} />
        {review.body && (
          <p style={{ margin: "0.4rem 0 0", fontSize: "0.76rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>{review.body}</p>
        )}
      </div>
    );
  }

  const decision = isOrderReviewable(
    { buyerWallet: order.buyer, canonicalState },
    { viewerWallet: account, existingReview: null }
  );

  if (!decision.eligible) {
    // Only surface the "not yet" state for the case a buyer would actually
    // expect a review affordance (post-purchase, not-yet-completed) — never
    // for refunded/cancelled orders where a review CTA would be confusing.
    const showPending = ["created", "payment_pending", "payment_protected", "preparing", "in_transit", "pickup_ready", "delivered", "review_window", "non_delivery"].includes(canonicalState);
    if (!showPending) return null;
    return (
      <div style={{ marginTop: "0.75rem", paddingTop: "0.75rem", borderTop: "1px solid rgba(255,255,255,0.06)", fontSize: "0.72rem", color: "var(--text-muted)" }}>
        {casualModeActive ? "You can leave a review once your fish arrives." : "Review available after arrival is confirmed."}
      </div>
    );
  }

  if (!showComposer) {
    return (
      <div style={{ marginTop: "0.75rem", paddingTop: "0.75rem", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <button
          type="button"
          onClick={() => setShowComposer(true)}
          className="btn-secondary"
          style={{ minHeight: "36px", padding: "0.4rem 0.9rem", fontSize: "0.75rem" }}
        >
          {casualModeActive ? "Leave a review" : "Submit review"}
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginTop: "0.75rem" }}>
      <ReviewComposer
        orderRef={orderRef}
        fulfillmentMethod={method}
        casualModeActive={casualModeActive}
        onCancel={() => setShowComposer(false)}
        onSubmitted={(newReview) => {
          setJustSubmitted(newReview);
          setShowComposer(false);
        }}
      />
    </div>
  );
}

/**
 * Stable order reference for review lookups. MUST match what the server's
 * loadOrderForReview() resolves against — the cloud `orders.local_key`
 * (ordersSync.js's mapLocalToCloud sets `p_local_key: String(localOrder.key)`)
 * or `stripe_session_id` for fiat orders — NOT the UI-only composite key
 * buyerOrderView.js's orderKey() uses (that one is a display/routing id,
 * never synced to the cloud orders row).
 */
function orderReviewRef(order) {
  if (!order) return null;
  if (order.stripeSessionId) return order.stripeSessionId;
  if (order.key != null) return String(order.key);
  return null;
}
