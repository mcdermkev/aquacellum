import React, { useState, useEffect, useMemo } from "react";
import { Modal } from "./Modal";
import { TankSelector } from "./TankSelector";
import { AcclimationNotes } from "./AcclimationNotes";
import { useUserTanks } from "../hooks/useUserTanks";
import { relayMoveSpecimen } from "../services/relayer";
import { releaseFiatOrder } from "../services/stripePayments";
import { addXp, XP_ACTIONS } from "../utils/xp";
import { db } from "../db";

/**
 * ArrivalModal — Shared modal for all arrival confirmations.
 * Handles individual specimens, batch orders, and merged shipping+arrival flows.
 *
 * Props:
 *  - isOpen: boolean
 *  - onClose: () => void
 *  - item: specimen or batch order object
 *  - itemType: "specimen" | "batch"
 *  - isShippingMerge: boolean (true when combining escrow release + tank assign)
 *  - shippingOrder: order object (when isShippingMerge)
 *  - walletAccount: string
 *  - contractAddress: string
 *  - casualModeActive: boolean
 *  - onComplete: (result) => void
 */

const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS || "";

/**
 * Resolve the best default tank for the user.
 * - Single tank → auto-select
 * - Multiple → pick most recently interacted
 */
function resolveDefaultTank(tanks) {
  if (!tanks || tanks.length === 0) return { tankId: null, auto: false };
  if (tanks.length === 1) return { tankId: tanks[0].id, auto: true };

  // Most recently interacted tank
  const sorted = [...tanks].sort((a, b) => {
    const aTime = Math.max(a.latestTestTimestamp || 0, a.latestChangeTimestamp || 0, a.creationTimestamp || 0);
    const bTime = Math.max(b.latestTestTimestamp || 0, b.latestChangeTimestamp || 0, b.creationTimestamp || 0);
    return bTime - aTime;
  });
  return { tankId: sorted[0].id, auto: false, suggested: true };
}

function ArrivalModal({
  isOpen,
  onClose,
  item,
  itemType = "specimen",
  isShippingMerge = false,
  shippingOrder = null,
  walletAccount = "",
  contractAddress: contractAddressProp,
  casualModeActive = true,
  onComplete,
}) {
  const address = contractAddressProp || CONTRACT_ADDRESS;
  const { data: tanks = [], isLoading: tanksLoading } = useUserTanks(address, walletAccount);

  const [selectedTankId, setSelectedTankId] = useState(null);
  const [acclimationNotes, setAcclimationNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Resolve default tank when tanks load
  const defaultResolution = useMemo(() => resolveDefaultTank(tanks), [tanks]);

  useEffect(() => {
    if (isOpen && tanks.length > 0 && selectedTankId === null) {
      setSelectedTankId(defaultResolution.tankId);
    }
  }, [isOpen, tanks, selectedTankId, defaultResolution.tankId]);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setAcclimationNotes("");
      setError(null);
      setSubmitting(false);
      setSelectedTankId(null);
    }
  }, [isOpen]);

  const handleConfirm = async () => {
    if (submitting) return;
    setError(null);
    setSubmitting(true);

    try {
      // Guard: check if already arrived (prevent double assignment)
      if (itemType === "specimen" && item?.id) {
        const current = await db.specimens.get(Number(item.id));
        if (current && current.arrivalStatus === "arrived") {
          const tankName = tanks.find(t => Number(t.id) === Number(current.currentTankId))?.name || "a tank";
          setError(`Already assigned to ${tankName}.`);
          setSubmitting(false);
          return;
        }
      }

      // Step 1: If shipping merge, release escrow on-chain first. This confirms
      // safe arrival: it finalizes the fiat shipping escrow and transfers the
      // specimen NFT to the buyer (the USD was captured by Stripe at checkout).
      // The tank assignment below only runs once the release is confirmed.
      if (isShippingMerge && shippingOrder) {
        const tokenId = shippingOrder.tokenId || item?.id;
        const releaseResult = await releaseFiatOrder({
          tokenId,
          sessionId: shippingOrder.stripeSessionId,
          paymentIntentId: shippingOrder.paymentIntentId,
        });
        if (!releaseResult.success) {
          throw new Error(releaseResult.error || "Failed to release shipping escrow");
        }
      }

      // Step 2: Move specimen to tank (if tank selected)
      if (itemType === "specimen" && selectedTankId && item?.id) {
        const moveResult = await relayMoveSpecimen({
          specimenId: Number(item.id),
          targetTankId: Number(selectedTankId),
        });
        if (!moveResult.success) {
          throw new Error(moveResult.error || "Failed to assign to tank");
        }

        // Write arrival metadata
        await db.specimens.update(Number(item.id), {
          arrivalStatus: "arrived",
          arrivedAt: Math.floor(Date.now() / 1000),
          acclimationNotes: acclimationNotes || null,
        });

        // Award XP
        addXp(XP_ACTIONS.ARRIVAL_CONFIRMED.points, XP_ACTIONS.ARRIVAL_CONFIRMED.label);
      }

      // Step 2 (batch): Write arrival metadata on the order record
      if (itemType === "batch" && item?.key != null) {
        await db.marketOrders.update(item.key, {
          assignedTankId: selectedTankId ? Number(selectedTankId) : null,
          arrivedAt: Math.floor(Date.now() / 1000),
          acclimationNotes: acclimationNotes || null,
        });

        // Award batch XP
        addXp(XP_ACTIONS.BATCH_ARRIVAL_CONFIRMED.points, XP_ACTIONS.BATCH_ARRIVAL_CONFIRMED.label);
      }

      // Success
      if (onComplete) {
        onComplete({ success: true, tankId: selectedTankId });
      }
      onClose();
    } catch (err) {
      console.error("[ArrivalModal] Confirmation failed:", err);
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSkip = async () => {
    // For shipping merge: still release escrow, just don't assign a tank
    if (isShippingMerge && shippingOrder) {
      setSubmitting(true);
      try {
        const tokenId = shippingOrder.tokenId || item?.id;
        const releaseResult = await relayUpdateShippingOrder(tokenId, { status: 2 });
        if (!releaseResult.success) {
          throw new Error(releaseResult.error || "Failed to release shipping escrow");
        }
      } catch (err) {
        setError(err.message || "Failed to release escrow");
        setSubmitting(false);
        return;
      }
      setSubmitting(false);
    }

    if (onComplete) {
      onComplete({ success: true, tankId: null, skipped: true });
    }
    onClose();
  };

  // Determine display name
  const itemName = item?.commonName || item?.scientificName || "Specimen";

  // No-tanks state
  const hasNoTanks = !tanksLoading && tanks.length === 0;
  // Single-tank auto state
  const isSingleTankAuto = !tanksLoading && tanks.length === 1;

  const modalTitle = casualModeActive
    ? (isShippingMerge ? "Confirm Receipt & Place Fish" : "Place Fish in Tank")
    : (isShippingMerge ? "Confirm Receipt & Assign Specimen" : "Assign Specimen to Containment");

  return (
    <Modal isOpen={isOpen} onClose={onClose} ariaLabel={modalTitle}>
      <div style={{ padding: "1.25rem", maxWidth: "420px", width: "100%" }}>
        {/* Header */}
        <h3 style={{
          margin: "0 0 0.75rem 0",
          fontSize: "1rem",
          fontWeight: 700,
          color: "var(--text-primary, #f1f5f9)",
        }}>
          {modalTitle}
        </h3>

        {/* Item info */}
        <div style={{
          padding: "0.5rem 0.75rem",
          borderRadius: "8px",
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.08)",
          marginBottom: "0.75rem",
          fontSize: "0.8rem",
          color: "var(--text-secondary, #cbd5e1)",
        }}>
          <strong style={{ color: "var(--text-primary, #f1f5f9)" }}>
            {itemType === "batch" ? `${item?.quantity || "?"}x ${itemName}` : itemName}
          </strong>
          {isShippingMerge && shippingOrder?.trackingNumber && (
            <div style={{ marginTop: "0.3rem", fontSize: "0.72rem" }}>
              Tracking: {shippingOrder.trackingNumber}
            </div>
          )}
        </div>

        {/* Loading state */}
        {tanksLoading && (
          <p style={{ color: "var(--text-muted, #94a3b8)", fontSize: "0.8rem", textAlign: "center", padding: "1rem 0" }}>
            Loading your tanks...
          </p>
        )}

        {/* No tanks state */}
        {hasNoTanks && (
          <div style={{ textAlign: "center", padding: "0.75rem 0" }}>
            <p style={{ color: "var(--text-muted, #94a3b8)", fontSize: "0.8rem", marginBottom: "0.75rem" }}>
              {casualModeActive
                ? "You haven't registered a tank yet."
                : "No containment units registered."}
            </p>
            <button
              type="button"
              className={casualModeActive ? "btn-primary" : "btn-primary-pro"}
              onClick={handleSkip}
              style={{ marginBottom: "0.5rem", width: "100%" }}
            >
              {casualModeActive ? "Skip for Now" : "Defer Assignment"}
            </button>
          </div>
        )}

        {/* Tank selector (multi-tank) */}
        {!tanksLoading && tanks.length > 1 && (
          <div style={{ marginBottom: "0.75rem" }}>
            <label style={{
              fontSize: "0.75rem",
              fontWeight: 600,
              color: "var(--text-secondary, #cbd5e1)",
              display: "block",
              marginBottom: "0.35rem",
            }}>
              {casualModeActive ? "Which tank?" : "Target containment unit"}
            </label>
            <TankSelector
              tanks={tanks}
              selectedTankId={selectedTankId}
              onSelect={setSelectedTankId}
              suggestedTankId={defaultResolution.suggested ? defaultResolution.tankId : null}
              casualModeActive={casualModeActive}
            />
          </div>
        )}

        {/* Single-tank auto info */}
        {isSingleTankAuto && (
          <div style={{
            padding: "0.5rem 0.75rem",
            borderRadius: "8px",
            background: "rgba(34,211,238,0.06)",
            border: "1px solid rgba(34,211,238,0.2)",
            marginBottom: "0.75rem",
            fontSize: "0.78rem",
            color: "var(--accent-cyan, #22d3ee)",
          }}>
            {casualModeActive
              ? `Will be placed in "${tanks[0]?.name || "your tank"}"`
              : `Auto-assigning to "${tanks[0]?.name || "containment unit"}"`}
          </div>
        )}

        {/* Acclimation notes */}
        {!tanksLoading && tanks.length > 0 && (
          <div style={{ marginBottom: "0.75rem" }}>
            <AcclimationNotes
              value={acclimationNotes}
              onChange={setAcclimationNotes}
              casualModeActive={casualModeActive}
            />
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{
            padding: "0.4rem 0.6rem",
            borderRadius: "6px",
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.3)",
            color: "#fca5a5",
            fontSize: "0.75rem",
            marginBottom: "0.75rem",
          }}>
            {error}
          </div>
        )}

        {/* Actions */}
        {!tanksLoading && tanks.length > 0 && (
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              type="button"
              className={casualModeActive ? "btn-primary" : "btn-primary-pro"}
              onClick={handleConfirm}
              disabled={submitting || !selectedTankId}
              style={{ flex: 1 }}
            >
              {submitting
                ? "Assigning..."
                : (isShippingMerge
                  ? (casualModeActive ? "Confirm & Assign" : "Release & Assign")
                  : (casualModeActive ? "Place in Tank" : "Confirm Assignment")
                )
              }
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={handleSkip}
              disabled={submitting}
              style={{ flex: 0, whiteSpace: "nowrap", padding: "0.5rem 0.75rem" }}
            >
              {casualModeActive ? "Skip" : "Defer"}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

export { ArrivalModal };
export default ArrivalModal;
