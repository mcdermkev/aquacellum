import React, { useState, useEffect, useMemo } from "react";
import { Modal } from "./Modal";
import { TankSelector } from "./TankSelector";
import { AcclimationNotes } from "./AcclimationNotes";
import { useUserTanks } from "../hooks/useUserTanks";
import { relayMoveSpecimen, relayUpdateShippingOrder } from "../services/relayer";
import { releaseFiatOrder, disputeFiatOrder, openDoaClaim } from "../services/stripePayments";
import { awardXp } from "../utils/xp";
import { receivePurchasedLot, resolvePurchaseChain, resolvePurchasePedigree } from "../services/lotIntake";
import { receiveTransferredCertificate } from "../services/certificateTransfer";
import { lotStage } from "../services/listingPedigree";
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

  // "Report a problem" (DOA) flow — only offered for shipping-merge orders.
  const [showReport, setShowReport] = useState(false);
  const [reportReason, setReportReason] = useState("dead_on_arrival");
  const [reportNote, setReportNote] = useState("");
  const [reportSubmitted, setReportSubmitted] = useState(false);

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
      setShowReport(false);
      setReportReason("dead_on_arrival");
      setReportNote("");
      setReportSubmitted(false);
    }
  }, [isOpen]);

  const handleConfirm = async () => {
    if (submitting) return;
    setError(null);
    setSubmitting(true);

    try {
      // Guard: check if already arrived (prevent double assignment)
      let localSpecimen = null;
      if (itemType === "specimen" && item?.id) {
        localSpecimen = await db.specimens.get(Number(item.id));
        if (localSpecimen && localSpecimen.arrivalStatus === "arrived") {
          const tankName = tanks.find(t => Number(t.id) === Number(localSpecimen.currentTankId))?.name || "a tank";
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

      // Step 1b: A certificate arriving from ANOTHER wallet has no record on this
      // device — the normal cross-device case, and BREEDER_STATE_MODEL §9.25. Before
      // this, `relayMoveSpecimen` simply returned "Specimen not found" and the
      // arrival failed outright.
      //
      // The seller's serial (`item.id`) is theirs, not ours, so receiving assigns a
      // NEW local serial and everything below uses that. Ancestry comes from the
      // attached pedigree document, never from the seller's sireId/damId — those name
      // different fish here (§12.2). `receiveTransferredCertificate` is idempotent on
      // the document hash, so a retry cannot produce a second certificate for one
      // fish, which matters because §4.1 means it could never be deleted.
      //
      // With no document to consume this is INERT and the flow behaves exactly as
      // before — the same pattern as the canonical DOA attempt below, and it
      // self-activates as sellers publish pedigrees.
      let specimenId = item?.id != null ? Number(item.id) : null;
      if (itemType === "specimen" && !localSpecimen && walletAccount) {
        const source = shippingOrder || item;
        const document = await resolvePurchasePedigree(source);
        if (document) {
          const received = await receiveTransferredCertificate({
            document,
            buyerAddress: walletAccount,
            tankId: selectedTankId ? Number(selectedTankId) : 0,
            // The generations above, kept so this buyer can republish them on resale.
            // Dropping them would break the chain one boundary later (§9.31).
            chain: await resolvePurchaseChain(source),
          });
          if (received.ok) {
            specimenId = received.specimenId;
          } else {
            console.warn("[ArrivalModal] Could not record the incoming certificate:", received.reason);
          }
        }
      }

      // Step 2: Move specimen to tank (if tank selected)
      if (itemType === "specimen" && selectedTankId && specimenId != null) {
        const moveResult = await relayMoveSpecimen({
          specimenId: Number(specimenId),
          targetTankId: Number(selectedTankId),
        });
        if (!moveResult.success) {
          throw new Error(moveResult.error || "Failed to assign to tank");
        }

        // Write arrival metadata
        await db.specimens.update(Number(specimenId), {
          arrivalStatus: "arrived",
          arrivedAt: Math.floor(Date.now() / 1000),
          acclimationNotes: acclimationNotes || null,
        });

        // Award XP
        awardXp("ARRIVAL_CONFIRMED");
      }

      // Step 2 (batch): Write arrival metadata on the order record
      if (itemType === "batch" && item?.key != null) {
        await db.marketOrders.update(item.key, {
          assignedTankId: selectedTankId ? Number(selectedTankId) : null,
          arrivedAt: Math.floor(Date.now() / 1000),
          acclimationNotes: acclimationNotes || null,
        });

        // ── Step 2c: open the cohort (§9.25 / §9.26, T3 §2.6) ────────────────
        //
        // Until now a batch arrival wrote an order row and nothing else: the buyer
        // got some fish and no way to track them, no way to promote keepers, and no
        // lineage — which is the gap that undercut the whole point of the pedigree.
        //
        // A purchased lot is a COHORT THAT CHANGED HANDS (§12.4), so it becomes a
        // spawn-shaped row and `spawnGrowout` plus
        // `cohortPromotion.promoteCohortToCertificates` then work on it unchanged.
        // Certificates appear when the buyer promotes keepers out of it — which is
        // also what makes a sale decrement a cohort (§9.26).
        //
        // Non-blocking on the arrival itself: a failure here must not leave the
        // buyer unable to confirm their fish turned up. It is logged and the lot can
        // be re-taken-in, because intake is idempotent on the document hash.
        try {
          const lot = await receivePurchasedLot({
            buyerAddress: walletAccount,
            quantity: Number(item.quantity) || 0,
            document: await resolvePurchasePedigree(item),
            chain: await resolvePurchaseChain(item),
            lifeStage: lotStage(item),
            tankId: selectedTankId ? Number(selectedTankId) : 0,
            purchaseOrderKey: item.key,
            speciesId: item.speciesId ?? null,
            scientificName: item.scientificName || "",
          });
          if (!lot.ok) {
            console.warn("[ArrivalModal] Could not open the purchased cohort:", lot.reason);
          }
        } catch (lotErr) {
          console.warn("[ArrivalModal] Purchased cohort intake failed:", lotErr);
        }

        // Award batch XP
        awardXp("BATCH_ARRIVAL_CONFIRMED");
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

  // Report a problem (DOA): flags the order for review instead of confirming
  // arrival. This does NOT release payment to the seller — it holds the order
  // so the buyer is protected if the fish arrived dead or sick.
  //
  // Two paths, in order (Task 18 §2.3 / §5 — the canonical path is reviewed
  // separately from the rest of this UI consolidation, since it touches the
  // claim/refund seam):
  //   1. Canonical DOA claim (openDoaClaim) — the Task 17 workflow with
  //      structured per-line-item evidence and resolution. Only attempted
  //      when the order carries canonical line item ids (shippingOrder.
  //      canonicalLineItemIds), which nothing populates client-side yet — the
  //      Task 16 delivery-event plumbing that advances canonical orders to
  //      `delivered` (a precondition for opening a claim) is not wired. This
  //      keeps the attempt inert today and self-activating once that lands,
  //      with no further changes needed here.
  //   2. disputeFiatOrder — the ACTIVE legacy dispute path (unchanged). Always
  //      runs when the canonical attempt is unavailable or fails, so buyers
  //      remain protected regardless of canonical readiness.
  const handleReportProblem = async () => {
    if (submitting || !shippingOrder) return;
    setError(null);
    setSubmitting(true);
    try {
      const tokenId = shippingOrder.tokenId || item?.id;
      const canonicalLineItemIds = shippingOrder.canonicalLineItemIds;

      let result = null;
      if (Array.isArray(canonicalLineItemIds) && canonicalLineItemIds.length > 0) {
        const canonicalResult = await openDoaClaim({
          orderId: shippingOrder.canonicalOrderId,
          paymentIntentId: shippingOrder.paymentIntentId,
          sessionId: shippingOrder.stripeSessionId,
          affectedLineItemIds: canonicalLineItemIds,
          evidence: { photos: [], description: reportNote || reportReason },
        });
        if (canonicalResult.success) {
          result = canonicalResult;
        } else {
          console.warn("[ArrivalModal] Canonical DOA claim unavailable, falling back to legacy dispute:", canonicalResult.error);
        }
      }

      if (!result) {
        result = await disputeFiatOrder({
          tokenId,
          sessionId: shippingOrder.stripeSessionId,
          paymentIntentId: shippingOrder.paymentIntentId,
          reason: reportReason,
          note: reportNote || null,
        });
      }

      if (!result.success) {
        throw new Error(result.error || "Could not report the problem");
      }
      setReportSubmitted(true);
      if (onComplete) {
        onComplete({ success: true, disputed: true });
      }
    } catch (err) {
      console.error("[ArrivalModal] Report a problem failed:", err);
      setError(err.message || "Could not report the problem. Please try again.");
    } finally {
      setSubmitting(false);
    }
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

        {/* Report a problem (DOA) — only for shipping arrivals */}
        {isShippingMerge && shippingOrder && (
          <div style={{ marginTop: "0.85rem", paddingTop: "0.75rem", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            {reportSubmitted ? (
              <div style={{
                padding: "0.6rem 0.75rem",
                borderRadius: "8px",
                background: "rgba(34,211,238,0.06)",
                border: "1px solid rgba(34,211,238,0.2)",
                fontSize: "0.78rem",
                color: "var(--text-secondary, #cbd5e1)",
              }}>
                <strong style={{ color: "var(--text-primary, #f1f5f9)", display: "block", marginBottom: "0.25rem" }}>
                  Thanks — we're on it.
                </strong>
                We've flagged this order for review and put it on hold. Your payment stays protected until it's sorted out.
                <div style={{ marginTop: "0.6rem" }}>
                  <button type="button" className="btn-secondary" onClick={onClose} style={{ width: "100%" }}>
                    Close
                  </button>
                </div>
              </div>
            ) : !showReport ? (
              <button
                type="button"
                onClick={() => setShowReport(true)}
                disabled={submitting}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--text-muted, #94a3b8)",
                  fontSize: "0.75rem",
                  textDecoration: "underline",
                  cursor: "pointer",
                  padding: "0.25rem 0",
                }}
              >
                Something wrong? Report a problem
              </button>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <div style={{ fontSize: "0.78rem", color: "var(--text-secondary, #cbd5e1)" }}>
                  {casualModeActive
                    ? "Sorry to hear it. Tell us what happened and we'll hold your payment while we help."
                    : "Report an issue. Payment stays held pending review — the seller is not paid until this resolves."}
                </div>
                <select
                  value={reportReason}
                  onChange={(e) => setReportReason(e.target.value)}
                  disabled={submitting}
                  style={{
                    width: "100%",
                    padding: "0.5rem 0.6rem",
                    borderRadius: "6px",
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    color: "var(--text-primary, #f1f5f9)",
                    fontSize: "0.8rem",
                  }}
                >
                  <option value="dead_on_arrival">Arrived dead</option>
                  <option value="arrived_sick">Arrived sick or injured</option>
                  <option value="wrong_or_missing">Wrong or missing fish</option>
                  <option value="other">Something else</option>
                </select>
                <textarea
                  value={reportNote}
                  onChange={(e) => setReportNote(e.target.value)}
                  disabled={submitting}
                  placeholder={casualModeActive ? "Add a few details (optional)" : "Details (optional)"}
                  rows={3}
                  style={{
                    width: "100%",
                    padding: "0.5rem 0.6rem",
                    borderRadius: "6px",
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    color: "var(--text-primary, #f1f5f9)",
                    fontSize: "0.8rem",
                    resize: "vertical",
                  }}
                />
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button
                    type="button"
                    onClick={handleReportProblem}
                    disabled={submitting}
                    style={{
                      flex: 1,
                      padding: "0.5rem 0.75rem",
                      borderRadius: "6px",
                      background: "rgba(239,68,68,0.12)",
                      border: "1px solid rgba(239,68,68,0.4)",
                      color: "#fca5a5",
                      fontSize: "0.8rem",
                      fontWeight: 600,
                      cursor: submitting ? "default" : "pointer",
                    }}
                  >
                    {submitting ? "Reporting..." : "Report a problem"}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setShowReport(false)}
                    disabled={submitting}
                    style={{ flex: 0, whiteSpace: "nowrap", padding: "0.5rem 0.75rem" }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

export { ArrivalModal };
export default ArrivalModal;
