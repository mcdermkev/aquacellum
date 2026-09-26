import { useEffect, useRef, useState } from "react";
import { Modal } from "../Modal";
import { confirmGuestHandoff } from "../../services/stripePayments";

/**
 * GuestPickupConfirm.jsx — seller surface for confirming a GUEST (no-login)
 * local-pickup handoff.
 *
 * The guest buyer shows the code from their order page (order.html). The seller
 * scans it (camera) or pastes it here and confirms. That confirmation is the
 * money-release trigger: the server verifies the buyer's signed code against
 * this authenticated seller and transfers the held funds to them
 * (confirmGuestHandoff → POST /api/stripe?action=guest-handoff-confirm).
 *
 * Deliberately separate from CashPickupConfirm (which settles an on-chain NFT
 * cash pickup via a different endpoint) — guest batch/pickup orders are
 * off-chain, so this path only moves the Stripe payout.
 */
export function GuestPickupConfirm({ isOpen, onClose, onSuccess }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const [pastedToken, setPastedToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null); // { transferId } once confirmed

  const startCamera = async () => {
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      }
    } catch {
      /* camera denied — manual paste is the first-class path */
    }
  };
  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
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
    if (!token) { setError("Scan or paste the buyer's pickup code first."); return; }
    setLoading(true);
    setError(null);
    try {
      const result = await confirmGuestHandoff({ token });
      if (!result.success) {
        setError(result.error || "Could not confirm the handoff.");
        return;
      }
      setSuccess({ transferId: result.transferId });
      stopCamera();
    } catch (err) {
      setError(err.message || "Could not confirm the handoff.");
    } finally {
      setLoading(false);
    }
  };

  const handleDone = () => { if (onSuccess) onSuccess(); onClose(); };

  return (
    <Modal isOpen={isOpen} onClose={onClose} ariaLabel="Confirm guest pickup handoff">
      <div style={{ padding: "1.25rem", maxWidth: "420px", width: "100%", display: "flex", flexDirection: "column", gap: "1rem" }}>
        <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700, color: "var(--text-primary, #f1f5f9)" }}>
          Confirm pickup handoff
        </h3>

        {success ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.75rem", padding: "1rem 0", textAlign: "center" }}>
            <span style={{ fontSize: "2rem" }} aria-hidden="true">✅</span>
            <strong style={{ color: "#fff", fontSize: "0.95rem" }}>Handoff confirmed — you've been paid</strong>
            <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--text-secondary, #cbd5e1)" }}>
              The held funds have been released to your Stripe balance and the order is complete.
            </p>
            <button type="button" className="btn-primary" onClick={handleDone} style={{ width: "100%" }}>Done</button>
          </div>
        ) : (
          <>
            <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--text-secondary, #cbd5e1)", lineHeight: 1.5 }}>
              Have the buyer open their order page and show the pickup code. Scan it or paste it below — confirming releases the payment to you.
            </p>
            <div style={{ position: "relative", width: "100%", height: "150px", borderRadius: "8px", overflow: "hidden", background: "#0a0b0f", border: "1px solid var(--glass-border, rgba(255,255,255,.1))" }}>
              <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
            <label style={{ fontSize: "0.75rem", color: "var(--text-muted, #94a3b8)" }}>
              Or paste the buyer's code
              <textarea
                value={pastedToken}
                onChange={(e) => setPastedToken(e.target.value)}
                rows={3}
                placeholder="Paste the pickup code here"
                style={{ width: "100%", marginTop: "0.35rem", fontFamily: "ui-monospace, monospace", fontSize: "0.72rem", padding: "0.6rem", borderRadius: "8px", background: "#0a0b0f", color: "#fff", border: "1px solid var(--glass-border, rgba(255,255,255,.12))", resize: "vertical" }}
              />
            </label>
            {error && (
              <div style={{ fontSize: "0.78rem", color: "#f87171", background: "rgba(248,113,113,.08)", border: "1px solid rgba(248,113,113,.25)", borderRadius: "8px", padding: "0.5rem 0.65rem" }}>
                {error}
              </div>
            )}
            <button type="button" className="btn-primary" onClick={handleConfirm} disabled={loading} style={{ width: "100%", minHeight: "44px" }}>
              {loading ? "Confirming…" : "Confirm handoff & release payment"}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
