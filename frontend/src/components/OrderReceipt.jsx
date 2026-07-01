import React, { useState, useEffect } from "react";
import { fetchOrderTimeline } from "../services/ordersSync";
import { generateAlias } from "../utils/generateAlias";
import { getRelativeTime } from "../utils/arrivalNudge";

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
  const [timeline, setTimeline] = useState([]);
  const [loadingTimeline, setLoadingTimeline] = useState(false);

  // Fetch cloud timeline when expanded (if cloud order ID is available)
  useEffect(() => {
    if (isExpanded && order?.cloudId) {
      setLoadingTimeline(true);
      fetchOrderTimeline(order.cloudId)
        .then(setTimeline)
        .finally(() => setLoadingTimeline(false));
    }
  }, [isExpanded, order?.cloudId]);

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
                  <span style={{ fontFamily: "monospace", color: "#fff" }}>${(price * 1000).toFixed(2)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--text-secondary)" }}>Shipping Fee:</span>
                  <span style={{ fontFamily: "monospace", color: "#fff" }}>${(shippingFee * 1000).toFixed(2)}</span>
                </div>
              </>
            )}

            {isBatch && (
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-secondary)" }}>
                  {order.quantity > 1 ? `${order.quantity} fish` : "Batch Total"}:
                </span>
                <span style={{ fontFamily: "monospace", color: "#fff" }}>${(amountLocked * 1000).toFixed(2)}</span>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text-muted)", fontSize: "0.7rem" }}>
              <span>Platform Fee (4%):</span>
              <span style={{ fontFamily: "monospace" }}>-${(platformFee * 1000).toFixed(2)}</span>
            </div>

            <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "0.4rem", marginTop: "0.2rem", display: "flex", justifyContent: "space-between" }}>
              <strong style={{ color: "#fff" }}>
                {order.role === "Buyer" ? "You Paid:" : "You Received:"}
              </strong>
              <strong style={{ fontFamily: "monospace", color: "var(--accent-green)" }}>
                ${order.role === "Buyer" ? (amountLocked * 1000).toFixed(2) : (sellerReceives * 1000).toFixed(2)}
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

          {/* Status Timeline (from cloud) */}
          {timeline.length > 0 && (
            <div style={{ marginBottom: "0.5rem" }}>
              <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "0.5rem" }}>
                Order Timeline
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", paddingLeft: "0.5rem", borderLeft: "2px solid rgba(255,255,255,0.06)" }}>
                {timeline.map((event, idx) => (
                  <div key={event.id || idx} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <div style={{
                      width: "8px", height: "8px", borderRadius: "50%",
                      background: idx === timeline.length - 1 ? "#34d399" : "rgba(255,255,255,0.2)",
                      marginLeft: "-5px",
                      flexShrink: 0,
                    }} />
                    <div style={{ flex: 1 }}>
                      <span style={{ color: "#fff", fontSize: "0.72rem" }}>
                        {event.from_status ? `${event.from_status} → ` : ""}{event.to_status}
                      </span>
                      <span style={{ color: "var(--text-muted)", fontSize: "0.65rem", marginLeft: "0.5rem" }}>
                        {new Date(event.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {loadingTimeline && (
            <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", textAlign: "center", padding: "0.5rem" }}>
              Loading timeline...
            </div>
          )}
        </div>
      )}
    </div>
  );
}
