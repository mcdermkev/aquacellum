import React, { useState, useEffect, useCallback } from "react";
import { db } from "../db";
import { ArrivalModal } from "./ArrivalModal";
import { generateAlias } from "../utils/generateAlias";
import { isNudgeActive, isBatchNudgeActive, getRelativeTime, getPurchaseTypeLabel } from "../utils/arrivalNudge";

/**
 * IncomingSpecimens — Main view listing all specimens and batches in transit.
 * Shows a dedicated "Incoming Fish" / "Specimens in Transit" section that is
 * hidden when empty.
 */

const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS || "";

function IncomingCard({ specimen, casualModeActive, onMarkArrived }) {
  const nudge = isNudgeActive(specimen);
  const typeLabel = getPurchaseTypeLabel(specimen.purchaseType, casualModeActive);
  const timeAgo = getRelativeTime(specimen.purchasedAt);

  return (
    <div style={{
      padding: "0.75rem",
      borderRadius: "10px",
      border: nudge
        ? "1px solid rgba(251,191,36,0.3)"
        : "1px solid rgba(255,255,255,0.08)",
      background: nudge
        ? "rgba(251,191,36,0.04)"
        : "rgba(255,255,255,0.02)",
      display: "flex",
      alignItems: "center",
      gap: "0.75rem",
      transition: "border-color 0.2s",
    }}>
      {/* Fish icon */}
      <div style={{
        width: "40px",
        height: "40px",
        borderRadius: "8px",
        background: "rgba(34,211,238,0.08)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "1.2rem",
        flexShrink: 0,
      }}>
        🐟
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontWeight: 600,
          fontSize: "0.85rem",
          color: "var(--text-primary, #f1f5f9)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}>
          {specimen.commonName || specimen.scientificName || `Specimen #${specimen.id}`}
        </div>
        <div style={{
          fontSize: "0.7rem",
          color: "var(--text-muted, #94a3b8)",
          marginTop: "0.15rem",
          display: "flex",
          alignItems: "center",
          gap: "0.4rem",
          flexWrap: "wrap",
        }}>
          {/* Purchase type badge */}
          <span style={{
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "10px",
            padding: "0.05rem 0.4rem",
            fontSize: "0.65rem",
          }}>
            {typeLabel}
          </span>

          {/* Seller */}
          {specimen.seller && (
            <span>from {generateAlias(specimen.seller)}</span>
          )}

          {/* Time */}
          {timeAgo && <span>· {timeAgo}</span>}
        </div>

        {/* Tracking info for shipping */}
        {specimen.purchaseType === "shipping" && specimen.trackingNumber && (
          <div style={{
            fontSize: "0.65rem",
            color: "var(--accent-cyan, #22d3ee)",
            marginTop: "0.2rem",
          }}>
            Tracking: {specimen.trackingNumber}
          </div>
        )}
      </div>

      {/* Nudge badge + CTA */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexShrink: 0 }}>
        {nudge && (
          <span style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            background: "var(--accent-amber, #fbbf24)",
            flexShrink: 0,
          }} title="Ready to assign" />
        )}
        <button
          type="button"
          className={casualModeActive ? "btn-primary" : "btn-primary-pro"}
          onClick={() => onMarkArrived(specimen)}
          style={{
            fontSize: "0.7rem",
            padding: "0.35rem 0.6rem",
            whiteSpace: "nowrap",
          }}
        >
          {casualModeActive ? "Mark as Arrived" : "Confirm Arrival"}
        </button>
      </div>
    </div>
  );
}

function IncomingBatchCard({ order, casualModeActive, onBatchArrived }) {
  const nudge = isBatchNudgeActive(order);
  const timeAgo = getRelativeTime(order.createdAt);

  return (
    <div style={{
      padding: "0.75rem",
      borderRadius: "10px",
      border: nudge
        ? "1px solid rgba(251,191,36,0.3)"
        : "1px solid rgba(255,255,255,0.08)",
      background: nudge
        ? "rgba(251,191,36,0.04)"
        : "rgba(255,255,255,0.02)",
      display: "flex",
      alignItems: "center",
      gap: "0.75rem",
      transition: "border-color 0.2s",
    }}>
      {/* Batch icon */}
      <div style={{
        width: "40px",
        height: "40px",
        borderRadius: "8px",
        background: "rgba(168,85,247,0.08)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "1.2rem",
        flexShrink: 0,
      }}>
        🐠
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontWeight: 600,
          fontSize: "0.85rem",
          color: "var(--text-primary, #f1f5f9)",
        }}>
          {order.quantity || "?"}x {order.commonName || "Juvenile Fry"}
        </div>
        <div style={{
          fontSize: "0.7rem",
          color: "var(--text-muted, #94a3b8)",
          marginTop: "0.15rem",
        }}>
          {order.seller && <span>from {generateAlias(order.seller)}</span>}
          {timeAgo && <span> · {timeAgo}</span>}
        </div>
      </div>

      {/* Nudge + CTA */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexShrink: 0 }}>
        {nudge && (
          <span style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            background: "var(--accent-amber, #fbbf24)",
            flexShrink: 0,
          }} title="Ready to assign" />
        )}
        <button
          type="button"
          className={casualModeActive ? "btn-primary" : "btn-primary-pro"}
          onClick={() => onBatchArrived(order)}
          style={{
            fontSize: "0.7rem",
            padding: "0.35rem 0.6rem",
            whiteSpace: "nowrap",
          }}
        >
          {casualModeActive ? "Batch Arrived" : "Confirm Batch"}
        </button>
      </div>
    </div>
  );
}

function IncomingSpecimens({
  walletAccount = "",
  casualModeActive = true,
  contractAddress: contractAddressProp,
  onNavigateToTank,
}) {
  const address = contractAddressProp || CONTRACT_ADDRESS;
  const [incomingSpecimens, setIncomingSpecimens] = useState([]);
  const [incomingBatches, setIncomingBatches] = useState([]);
  const [arrivalModalOpen, setArrivalModalOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedItemType, setSelectedItemType] = useState("specimen");

  const fetchIncoming = useCallback(async () => {
    if (!walletAccount) return;
    const acct = walletAccount.toLowerCase();

    try {
      // Specimens in transit
      const specimens = await db.specimens
        .where("ownerAddress")
        .equals(acct)
        .filter((s) => s.arrivalStatus === "transit")
        .toArray();
      setIncomingSpecimens(specimens);
    } catch (e) {
      // Fallback: try without compound index
      try {
        const all = await db.specimens
          .where("ownerAddress")
          .equals(acct)
          .toArray();
        setIncomingSpecimens(all.filter((s) => s.arrivalStatus === "transit"));
      } catch (e2) {
        console.warn("[IncomingSpecimens] Failed to query specimens:", e2);
        setIncomingSpecimens([]);
      }
    }

    try {
      // Batch orders awaiting arrival (state=1 means released/settled, no assignedTankId yet)
      const orders = await db.marketOrders.toArray();
      const batches = orders.filter(
        (o) =>
          o.orderType === "batch" &&
          (o.buyer || "").toLowerCase() === acct &&
          (o.state === 1 || o.state === 0) &&
          !o.assignedTankId
      );
      setIncomingBatches(batches);
    } catch (e) {
      console.warn("[IncomingSpecimens] Failed to query batch orders:", e);
      setIncomingBatches([]);
    }
  }, [walletAccount]);

  useEffect(() => {
    fetchIncoming();
  }, [fetchIncoming]);

  const handleMarkArrived = (specimen) => {
    setSelectedItem(specimen);
    setSelectedItemType("specimen");
    setArrivalModalOpen(true);
  };

  const handleBatchArrived = (order) => {
    setSelectedItem(order);
    setSelectedItemType("batch");
    setArrivalModalOpen(true);
  };

  const handleModalComplete = (result) => {
    fetchIncoming(); // Refresh the list
    if (result?.tankId && onNavigateToTank) {
      // Optionally navigate to the tank view
    }
  };

  // Compute nudge state
  const nudgedSpecimens = incomingSpecimens.filter((s) => isNudgeActive(s));
  const nudgedBatches = incomingBatches.filter((o) => isBatchNudgeActive(o));
  const totalNudged = nudgedSpecimens.length + nudgedBatches.length;

  // Dismiss nudge banner (suppresses for 7 days per item)
  const handleDismissNudge = async () => {
    const now = Math.floor(Date.now() / 1000);
    for (const spec of nudgedSpecimens) {
      try {
        await db.specimens.update(Number(spec.id), { nudgeDismissedAt: now });
      } catch (e) {}
    }
    for (const order of nudgedBatches) {
      try {
        await db.marketOrders.update(order.key, { nudgeDismissedAt: now });
      } catch (e) {}
    }
    fetchIncoming(); // Refresh to clear nudge badges
  };

  // Don't render anything if no incoming items (Req 1.4)
  const totalCount = incomingSpecimens.length + incomingBatches.length;
  if (totalCount === 0) return null;

  return (
    <div style={{ padding: "0.5rem 0" }}>
      {/* Nudge banner — shown when items are past threshold */}
      {totalNudged > 0 && (
        <div style={{
          padding: "0.5rem 0.75rem",
          borderRadius: "8px",
          background: "rgba(251,191,36,0.06)",
          border: "1px solid rgba(251,191,36,0.2)",
          marginBottom: "0.6rem",
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          fontSize: "0.75rem",
          color: "var(--accent-amber, #fbbf24)",
        }}>
          <span style={{ flex: 1 }}>
            {casualModeActive
              ? `You have ${totalNudged} fish waiting to be placed in a tank.`
              : `${totalNudged} unassigned specimen${totalNudged > 1 ? "s" : ""} detected \u2014 assign to containment unit.`}
          </span>
          <button
            type="button"
            onClick={handleDismissNudge}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted, #94a3b8)",
              cursor: "pointer",
              fontSize: "0.9rem",
              padding: "0.2rem",
              lineHeight: 1,
            }}
            aria-label="Dismiss"
            title="Dismiss for 7 days"
          >
            &times;
          </button>
        </div>
      )}
      {/* Section header */}
      <h3 style={{
        fontSize: "0.9rem",
        fontWeight: 700,
        color: "var(--text-primary, #f1f5f9)",
        margin: "0 0 0.6rem 0",
        display: "flex",
        alignItems: "center",
        gap: "0.4rem",
      }}>
        {casualModeActive ? "Incoming Fish" : "Specimens in Transit"}
        <span style={{
          fontSize: "0.65rem",
          background: "rgba(34,211,238,0.1)",
          color: "var(--accent-cyan, #22d3ee)",
          borderRadius: "10px",
          padding: "0.1rem 0.45rem",
          fontWeight: 600,
        }}>
          {totalCount}
        </span>
      </h3>

      {/* Specimen cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
        {incomingSpecimens.map((spec) => (
          <IncomingCard
            key={spec.id}
            specimen={spec}
            casualModeActive={casualModeActive}
            onMarkArrived={handleMarkArrived}
          />
        ))}
        {incomingBatches.map((order) => (
          <IncomingBatchCard
            key={order.key || order.purchaseId}
            order={order}
            casualModeActive={casualModeActive}
            onBatchArrived={handleBatchArrived}
          />
        ))}
      </div>

      {/* Arrival Modal */}
      <ArrivalModal
        isOpen={arrivalModalOpen}
        onClose={() => setArrivalModalOpen(false)}
        item={selectedItem}
        itemType={selectedItemType}
        isShippingMerge={false}
        walletAccount={walletAccount}
        contractAddress={address}
        casualModeActive={casualModeActive}
        onComplete={handleModalComplete}
      />
    </div>
  );
}

export { IncomingSpecimens };
export default IncomingSpecimens;
