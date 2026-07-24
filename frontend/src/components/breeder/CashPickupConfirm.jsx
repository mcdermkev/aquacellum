import { useEffect, useRef, useState } from "react";
import { Modal } from "../Modal";
import { confirmCashPickup } from "../../services/stripePayments";
import { cashNoProtectionDisclosure } from "../../services/orderCopy";
import { prefersReducedMotion } from "../../utils/a11y";

/**
 * CashPickupConfirm.jsx (Task 15, seller surface)
 *
 * Presentation-only "confirm the buyer's pickup code" modal for the
 * canonical cash-pickup order's `confirm_cash` action
 * (docs/TASK_15_CASH_PICKUP_UI_SPEC.md §3.B). This component:
 *   - offers a camera scan affordance (simulated live preview — no on-device
 *     QR decode library is available in this codebase, matching the existing
 *     HandshakeVerification pattern) AND a manual paste field as a
 *     first-class path (camera-denied / offline)
 *   - calls confirmCashPickup({ token }) with the pasted/scanned opaque
 *     challenge token — never parses it, never signs anything, never touches
 *     the contract; all of that lives inside confirmCashPickup already
 *   - on success, shows a plain "ownership transferred" confirmation (no
 *     money/payout copy — there is none for cash) and hands control back to
 *     the caller's onSuccess (BreederTerminal's handleHandoffSettled)
 *   - on error, surfaces the server's message and lets the seller retry
 *
 * Deliberately does NOT import relaySettleHandshake — that is the legacy,
 * forgeable plain-JSON event-cash flow used by HandshakeVerification, which
 * does not settle the canonical cash-pickup order.
 *
 * Dialog semantics (role="dialog", aria-modal, Escape-to-close, initial
 * focus, focus trap) come from the shared <Modal> component.
 */
export function CashPickupConfirm({ isOpen, onClose, casualModeActive = true, onSuccess }) {
  const casual = casualModeActive !== false;
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const [cameraActive, setCameraActive] = useState(false);
  const [pastedToken, setPastedToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null); // { txHash } once confirmed
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    setReducedMotion(prefersReducedMotion());
  }, []);

  const startCamera = async () => {
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setCameraActive(true);
      }
    } catch (err) {
      console.warn("[CashPickupConfirm] Camera access denied or unavailable, use manual paste:", err);
      setCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    if (isOpen) {
      startCamera();
    } else {
      stopCamera();
      setPastedToken("");
      setError(null);
      setSuccess(null);
      setLoading(false);
    }
    return () => stopCamera();
  }, [isOpen]);

  const handleConfirm = async () => {
    const token = pastedToken.trim();
    if (!token) {
      setError(casual ? "Enter or scan the buyer's pickup code first." : "A handoff code is required.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await confirmCashPickup({ token });
      if (!result.success) {
        setError(result.error || (casual ? "Could not confirm the handoff." : "Handoff confirmation failed."));
        return;
      }
      setSuccess({ txHash: result.txHash });
      stopCamera();
    } catch (err) {
      setError(err.message || "Could not confirm the handoff.");
    } finally {
      setLoading(false);
    }
  };

  const handleDone = () => {
    if (onSuccess) onSuccess();
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} ariaLabel={casual ? "Confirm cash pickup" : "Confirm cash pickup handoff"}>
      <div style={{ padding: "1.25rem", maxWidth: "420px", width: "100%", display: "flex", flexDirection: "column", gap: "1rem" }}>
        <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700, color: "var(--text-primary, #f1f5f9)" }}>
          {casual ? "Confirm cash pickup" : "Confirm cash pickup handoff"}
        </h3>

        {!success && (
          <div
            style={{
              padding: "0.6rem 0.75rem",
              borderRadius: "8px",
              background: "rgba(251,191,36,0.06)",
              border: "1px solid rgba(251,191,36,0.25)",
              fontSize: "0.76rem",
              color: "var(--text-secondary, #cbd5e1)",
            }}
          >
            {cashNoProtectionDisclosure({ casual })}
          </div>
        )}

        {success ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.75rem", padding: "1rem 0", textAlign: "center" }}>
            <span style={{ fontSize: "2rem" }} aria-hidden="true">✅</span>
            <strong style={{ color: "#fff", fontSize: "0.95rem" }}>
              {casual ? "Ownership transferred — handoff complete" : "Ownership transferred — handoff confirmed"}
            </strong>
            <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--text-secondary, #cbd5e1)" }}>
              {casual
                ? "The fish now belongs to the buyer. This was a cash sale, so there's no payout to process."
                : "Ownership record updated. Cash sales carry no platform payout."}
            </p>
            <button type="button" className="btn-primary" onClick={handleDone} style={{ width: "100%" }}>
              {casual ? "Done" : "Close"}
            </button>
          </div>
        ) : (
          <>
            {/* Camera scan affordance — simulated live preview, matching the
                existing HandshakeVerification camera pattern. Manual paste
                below is the first-class, always-available path. */}
            <div
              style={{
                position: "relative",
                width: "100%",
                height: "160px",
                borderRadius: "8px",
                overflow: "hidden",
                background: "#020617",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                style={{ width: "100%", height: "100%", objectFit: "cover", opacity: cameraActive ? 0.85 : 0.2 }}
              />
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <div
                  style={{
                    width: "110px",
                    height: "110px",
                    border: "2px solid var(--accent-blue)",
                    borderRadius: "6px",
                    boxShadow: "0 0 0 1000px rgba(0,0,0,0.55)",
                    position: "relative",
                  }}
                >
                  {!reducedMotion && (
                    <div
                      style={{
                        position: "absolute",
                        left: 0,
                        width: "100%",
                        height: "2px",
                        background: "var(--accent-blue)",
                        boxShadow: "0 0 8px var(--accent-blue-glow)",
                        top: "10%",
                        animation: "radarScan 2s linear infinite",
                      }}
                    />
                  )}
                </div>
              </div>
              {!cameraActive && (
                <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "0.25rem" }}>
                  <span style={{ fontSize: "1.4rem" }} aria-hidden="true">📷</span>
                  <span style={{ fontSize: "0.72rem", color: "var(--text-muted, #94a3b8)", textAlign: "center", padding: "0 1rem" }}>
                    {casual ? "Camera not available — paste the code below" : "Camera unavailable — use manual entry"}
                  </span>
                </div>
              )}
            </div>

            {/* Manual paste — first-class path (camera-denied / offline). */}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              <label htmlFor="cash-pickup-token-input" style={{ fontSize: "0.75rem", color: "var(--text-secondary, #cbd5e1)", fontWeight: 600 }}>
                {casual ? "Or paste the buyer's pickup code" : "Handoff code"}
              </label>
              <textarea
                id="cash-pickup-token-input"
                value={pastedToken}
                onChange={(e) => setPastedToken(e.target.value)}
                placeholder={casual ? "Paste the code the buyer showed you" : "Paste handoff code"}
                rows={3}
                style={{
                  width: "100%",
                  padding: "0.5rem 0.6rem",
                  background: "rgba(0,0,0,0.3)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  color: "#fff",
                  borderRadius: "6px",
                  fontSize: "0.75rem",
                  fontFamily: "monospace",
                  resize: "vertical",
                }}
              />
            </div>

            {error && (
              <div
                style={{
                  padding: "0.5rem 0.7rem",
                  borderRadius: "6px",
                  background: "rgba(239,68,68,0.08)",
                  border: "1px solid rgba(239,68,68,0.3)",
                  color: "#fca5a5",
                  fontSize: "0.78rem",
                }}
              >
                {error}
              </div>
            )}

            <button
              type="button"
              className="btn-primary"
              disabled={loading || !pastedToken.trim()}
              onClick={handleConfirm}
              style={{ width: "100%" }}
            >
              {loading ? (casual ? "Confirming…" : "Confirming handoff…") : (casual ? "Confirm cash received" : "Confirm cash handoff")}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}

export default CashPickupConfirm;
