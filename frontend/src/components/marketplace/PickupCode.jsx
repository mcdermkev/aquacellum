import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Modal } from "../Modal";
import { issueCashHandoff } from "../../services/stripePayments";
import { cashNoProtectionDisclosure } from "../../services/orderCopy";
import { announce } from "../../utils/a11y";

/**
 * PickupCode.jsx (Task 15, buyer surface)
 *
 * Presentation-only wrapper around the already-verified cash-pickup handoff
 * challenge (docs/TASK_15_CASH_PICKUP_UI_SPEC.md). This component:
 *   - calls issueCashHandoff({ tokenId, buyerWallet }) — the only network call
 *   - renders the returned opaque `token` as a LOCALLY-rendered QR (qrcode's
 *     QRCode.toCanvas — never a third-party QR image API, which would leak
 *     the code and fail offline)
 *   - shows a live expiry countdown derived from `expiresAt`, with a
 *     "Get a new code" re-issue action once expired
 *   - shows a copyable text fallback of the token (accessible, non-camera
 *     path for the seller to key/paste if scanning fails)
 *   - shows the plan's no-protection cash disclosure before handoff
 *
 * It does NOT sign anything, parse the nonce, or touch the contract — all of
 * that lives inside issueCashHandoff/confirmCashPickup already.
 *
 * Dialog semantics (role="dialog", aria-modal, Escape-to-close, initial
 * focus, focus trap) come from the shared <Modal> component — not
 * reimplemented here.
 */
export function PickupCode({ isOpen, onClose, tokenId, buyerWallet, casualModeActive = true }) {
  const casual = casualModeActive !== false;
  const canvasRef = useRef(null);
  const announcedExpiredRef = useRef(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [token, setToken] = useState(null);
  const [expiresAt, setExpiresAt] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);

  const requestCode = useCallback(async () => {
    if (tokenId == null || !buyerWallet) {
      setError(
        casual
          ? "We're missing some info to make your code. Please try again from your order."
          : "Missing item or account reference for this order."
      );
      return;
    }
    setLoading(true);
    setError(null);
    setToken(null);
    setExpiresAt(null);
    setCopied(false);
    try {
      const result = await issueCashHandoff({ tokenId, buyerWallet });
      if (!result.success) {
        setError(result.error || (casual ? "Could not create your pickup code." : "Could not issue a handoff code."));
        return;
      }
      setToken(result.token);
      setExpiresAt(result.expiresAt || null);
    } catch (err) {
      setError(err.message || "Could not create your pickup code.");
    } finally {
      setLoading(false);
    }
  }, [tokenId, buyerWallet, casual]);

  // Issue a fresh code every time the modal opens; reset on close.
  useEffect(() => {
    if (isOpen) {
      requestCode();
    } else {
      setToken(null);
      setExpiresAt(null);
      setError(null);
      setCopied(false);
      setLoading(false);
      announcedExpiredRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Live countdown tick while a code is outstanding.
  useEffect(() => {
    if (!isOpen || !expiresAt) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isOpen, expiresAt]);

  const isExpired = !!expiresAt && now >= expiresAt;

  // Render the QR locally/offline once we have an unexpired token — never an
  // external QR image service (see TankQRCode.jsx's established pattern).
  useEffect(() => {
    if (!canvasRef.current || !token || isExpired) return;
    QRCode.toCanvas(canvasRef.current, token, {
      width: 200,
      margin: 1,
      color: { dark: "#0f172a", light: "#ffffff" },
    }).catch((err) => console.warn("[PickupCode] QR render failed:", err));
  }, [token, isExpired]);

  useEffect(() => {
    if (isExpired && !announcedExpiredRef.current) {
      announcedExpiredRef.current = true;
      announce(casual ? "Your pickup code has expired." : "Pickup code expired.");
    }
    if (!isExpired) announcedExpiredRef.current = false;
  }, [isExpired, casual]);

  const secondsLeft = expiresAt ? Math.max(0, Math.floor((expiresAt - now) / 1000)) : 0;
  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const countdownLabel = `${minutes}:${seconds.toString().padStart(2, "0")}`;

  const handleCopy = async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — the text field remains readable/selectable.
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} ariaLabel={casual ? "Your pickup code" : "Cash pickup handoff code"}>
      <div style={{ padding: "1.25rem", maxWidth: "380px", width: "100%", display: "flex", flexDirection: "column", gap: "1rem" }}>
        <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700, color: "var(--text-primary, #f1f5f9)" }}>
          {casual ? "Your pickup code" : "Cash pickup handoff code"}
        </h3>

        {/* No-protection disclosure — non-dismissible, shown before handoff. */}
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

        {loading && (
          <p style={{ textAlign: "center", color: "var(--text-muted, #94a3b8)", fontSize: "0.85rem", padding: "1rem 0" }}>
            {casual ? "Getting your code ready…" : "Requesting handoff code…"}
          </p>
        )}

        {!loading && error && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
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
            <button type="button" className="btn-secondary" onClick={requestCode} style={{ width: "100%" }}>
              {casual ? "Try again" : "Retry"}
            </button>
          </div>
        )}

        {!loading && !error && token && !isExpired && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.85rem" }}>
            <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--text-secondary, #cbd5e1)", textAlign: "center" }}>
              {casual
                ? "Show this code to the seller when you have your fish in hand."
                : "Present this code to the seller at handoff."}
            </p>

            <div style={{ background: "#fff", padding: "0.75rem", borderRadius: "10px", display: "inline-block" }}>
              <canvas ref={canvasRef} width={200} height={200} style={{ display: "block", borderRadius: "4px" }} />
            </div>

            <div aria-live="polite" style={{ fontSize: "0.78rem", color: "var(--text-secondary, #cbd5e1)" }}>
              {casual ? "Expires in " : "Code expires in "}
              <strong style={{ color: "#fff", fontFamily: "monospace" }}>{countdownLabel}</strong>
            </div>

            {/* Copyable text fallback — accessible, non-camera path (a QR
                canvas alone is not an accessible text alternative). */}
            <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              <label htmlFor="pickup-code-fallback" style={{ fontSize: "0.7rem", color: "var(--text-muted, #94a3b8)" }}>
                {casual ? "Or share this code" : "Text fallback"}
              </label>
              <div style={{ display: "flex", gap: "0.4rem" }}>
                <input
                  id="pickup-code-fallback"
                  type="text"
                  readOnly
                  value={token}
                  onFocus={(e) => e.target.select()}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    padding: "0.5rem 0.6rem",
                    background: "rgba(0,0,0,0.3)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    color: "#fff",
                    borderRadius: "6px",
                    fontSize: "0.72rem",
                    fontFamily: "monospace",
                  }}
                />
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleCopy}
                  style={{ flexShrink: 0, padding: "0.4rem 0.7rem", fontSize: "0.72rem" }}
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>
          </div>
        )}

        {!loading && !error && isExpired && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.75rem", padding: "1rem 0" }}>
            <div aria-live="polite" style={{ fontSize: "0.85rem", color: "var(--text-secondary, #cbd5e1)", textAlign: "center" }}>
              {casual ? "This code expired." : "Code expired."}
            </div>
            <button type="button" className="btn-primary" onClick={requestCode} style={{ width: "100%" }}>
              {casual ? "Get a new code" : "Reissue code"}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

export default PickupCode;
