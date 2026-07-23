import { useState, useCallback } from "react";
import { previewPromotion } from "../services/stripePayments";
import { formatUSD } from "../services/stripePayments";

/**
 * PromoCodeField — the buyer's promo-code entry at checkout (Task 21B UI).
 *
 * Read-only preview: on "Apply" it asks the server (?action=preview-promo) to
 * resolve + evaluate the seller's promotion against the current cart and shows
 * either "✓ CODE applied − $X" or a plain-language reason ("That code isn't
 * valid…"). It never charges — the authoritative discount is applied by the
 * server at create-checkout. The parent is told the applied code + discount via
 * `onApply(code, preview)` so it can pass `promoCode` into the checkout call and
 * reflect the discount in its total.
 *
 * @param {Object} props
 * @param {string} props.sellerWallet
 * @param {Array} props.items - cart items ({tokenId|listingId} + price fields)
 * @param {string} props.purchaseType - "batch" switches the preview cart shape
 * @param {(code:(string|null), preview:(Object|null)) => void} props.onApply
 * @param {boolean} [props.casualModeActive]
 */
export function PromoCodeField({ sellerWallet, items, purchaseType, onApply, casualModeActive = true }) {
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [preview, setPreview] = useState(null); // { applicable, discountCents, reason }

  const applied = !!preview?.applicable;

  const handleApply = useCallback(async () => {
    const trimmed = code.trim();
    if (!trimmed || checking) return;
    setChecking(true);
    const result = await previewPromotion({ sellerWallet, promoCode: trimmed, items, purchaseType });
    setPreview(result);
    setChecking(false);
    // Only surface an applied code upward when it actually discounts.
    onApply?.(result?.applicable ? trimmed : null, result?.applicable ? result : null);
  }, [code, checking, sellerWallet, items, purchaseType, onApply]);

  const handleClear = useCallback(() => {
    setCode("");
    setPreview(null);
    onApply?.(null, null);
  }, [onApply]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleApply();
    }
  };

  return (
    <div style={{ marginTop: "0.5rem" }}>
      {applied ? (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "0.5rem",
            fontSize: "0.75rem",
            color: "var(--accent-amber, #fbbf24)",
            background: "rgba(251, 191, 36, 0.06)",
            border: "1px solid rgba(251, 191, 36, 0.2)",
            padding: "0.4rem 0.6rem",
            borderRadius: "6px",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
            <span aria-hidden="true">🎟️</span>
            <span>
              Code <strong style={{ fontFamily: "monospace" }}>{(preview.promotion?.code || code).toUpperCase()}</strong> applied
            </span>
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontFamily: "monospace" }}>−{formatUSD(preview.discountCents)}</span>
            <button
              type="button"
              onClick={handleClear}
              aria-label="Remove promo code"
              style={{
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                fontSize: "0.9rem",
                lineHeight: 1,
                padding: 0,
              }}
            >
              &times;
            </button>
          </span>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
          <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={casualModeActive ? "Promo code" : "Discount code"}
              aria-label="Promo code"
              autoComplete="off"
              autoCapitalize="characters"
              style={{
                flex: 1,
                minWidth: 0,
                background: "rgba(0,0,0,0.3)",
                border: "1px solid rgba(255,255,255,0.1)",
                color: "#fff",
                borderRadius: "6px",
                padding: "0.4rem 0.6rem",
                fontSize: "0.8rem",
                outline: "none",
                textTransform: "uppercase",
              }}
            />
            <button
              type="button"
              onClick={handleApply}
              disabled={!code.trim() || checking}
              style={{
                flexShrink: 0,
                background: !code.trim() || checking ? "rgba(255,255,255,0.06)" : "rgba(251, 191, 36, 0.15)",
                border: "1px solid rgba(251, 191, 36, 0.3)",
                color: !code.trim() || checking ? "var(--text-muted)" : "var(--accent-amber, #fbbf24)",
                borderRadius: "6px",
                padding: "0.4rem 0.9rem",
                fontSize: "0.75rem",
                fontWeight: 600,
                cursor: !code.trim() || checking ? "not-allowed" : "pointer",
              }}
            >
              {checking ? "Checking…" : "Apply"}
            </button>
          </div>
          {preview && !preview.applicable && (
            <span role="status" style={{ fontSize: "0.7rem", color: "var(--accent-red, #f87171)" }}>
              {preview.reason || "That code can't be applied to this order."}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
