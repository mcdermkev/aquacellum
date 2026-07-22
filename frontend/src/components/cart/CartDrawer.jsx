/**
 * CartDrawer.jsx
 *
 * The cart slide-over (Task 10, §5). Composes the shared accessible `Modal`
 * (dialog role, focus trap, Escape-to-close, focus return) rather than
 * reimplementing dialog semantics — only the visual treatment (right-side
 * sheet, glass system, brand gradient CTA) is custom here, via `className`.
 *
 * Thin: all cart math/decisions come from useCart() (backed by cartModel.js
 * / cartRevalidation.js). This component only renders the current cart state
 * and dispatches the provided actions.
 */

import React, { useEffect } from "react";
import { Plus, Minus, Trash, Info, Warning, ShoppingCartSimple } from "@phosphor-icons/react";
import { Modal } from "../Modal.jsx";
import { FishSilhouetteSVG } from "../SilhouetteSVG.jsx";
import { useCart } from "../../contexts/CartContext.jsx";
import { generateAlias } from "../../utils/generateAlias.js";
import { CART_CHANGE_TYPE } from "../../services/cartRevalidation.js";
import { useAddOnRecommendations } from "../../hooks/useAddOnRecommendations.js";
import { BoxCapacityMeter } from "./BoxCapacityMeter.jsx";
import { AddOnRecommendationStrip } from "./AddOnRecommendationStrip.jsx";

/** Casual/pro-agnostic, plain-language note for one revalidation change. */
function changeNote(change, casualModeActive) {
  switch (change.type) {
    case CART_CHANGE_TYPE.PRICE_CHANGED:
      return `Price updated to $${(change.to / 100).toFixed(2)}`;
    case CART_CHANGE_TYPE.QUANTITY_REDUCED:
      return casualModeActive
        ? `Only ${change.to} left — quantity adjusted`
        : `Available quantity reduced to ${change.to}`;
    case CART_CHANGE_TYPE.UNAVAILABLE:
    default:
      return "No longer available";
  }
}

export function CartDrawer({ isOpen, onClose, onProceedToCheckout, casualModeActive = false, buyerTank = null }) {
  const { cart, totals, changes, conflict, setItemQuantity, removeItem, resolveConflict, revalidate, addItem } = useCart();
  const { boxStatus, recommendations } = useAddOnRecommendations({ cart, buyerTank });

  // Revalidate every time the drawer opens (spec §4: "on cart open").
  useEffect(() => {
    if (isOpen) revalidate();
  }, [isOpen, revalidate]);

  const changesByKey = new Map();
  for (const change of changes) {
    const list = changesByKey.get(change.listingKey) || [];
    list.push(change);
    changesByKey.set(change.listingKey, list);
  }

  const handleProceed = () => {
    const { changes: freshChanges } = revalidate();
    if (freshChanges.length > 0) {
      // Stay open so the buyer can see what changed before continuing —
      // never route to checkout on a just-revalidated cart without giving
      // the buyer a moment to see the update.
      return;
    }
    onProceedToCheckout?.(cart, totals);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel="Shopping cart"
      className="sliding-drawer-content"
      fullScreenMobile={true}
    >
      <div style={{ display: "flex", flexDirection: "column", height: "100%", margin: "-2.5rem -2rem", padding: 0 }}>
        {/* Header */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "1.25rem 1.5rem", borderBottom: "1px solid var(--glass-border)",
        }}>
          <h3 style={{
            fontSize: "1.1rem", fontWeight: 700, fontFamily: "Outfit, sans-serif",
            color: "var(--text-primary)", margin: 0, display: "flex", alignItems: "center", gap: "0.5rem",
          }}>
            <ShoppingCartSimple size={20} weight="duotone" />
            {casualModeActive ? "Your Cart" : "Cart"}
            {totals.itemCount > 0 && (
              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 400 }}>
                ({totals.itemCount})
              </span>
            )}
          </h3>
          <button
            onClick={onClose}
            aria-label="Close cart"
            style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: "1.5rem", cursor: "pointer", padding: "0.25rem", lineHeight: 1 }}
          >
            &times;
          </button>
        </div>

        {/* Live status region for revalidation feedback — announced to
            assistive tech without stealing visual focus. */}
        <div aria-live="polite" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)" }}>
          {changes.length > 0 ? `Cart updated: ${changes.length} item${changes.length === 1 ? "" : "s"} changed` : ""}
        </div>

        {cart.items.length === 0 ? (
          <EmptyState casualModeActive={casualModeActive} onClose={onClose} />
        ) : (
          <>
            <div style={{ flex: 1, overflowY: "auto", padding: "1rem 1.5rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {cart.items.map((item) => (
                <CartItemRow
                  key={item.listingKey}
                  item={item}
                  changes={changesByKey.get(item.listingKey) || []}
                  onSetQuantity={(qty) => setItemQuantity(item.listingKey, qty)}
                  onRemove={() => removeItem(item.listingKey)}
                  casualModeActive={casualModeActive}
                />
              ))}

              {/* Task 11: box-capacity meter + safe add-on recommendations —
                  both sourced entirely from useAddOnRecommendations (which
                  composes the reviewed packing/ranking engines). */}
              <BoxCapacityMeter boxStatus={boxStatus} casualModeActive={casualModeActive} />
              <AddOnRecommendationStrip
                recommendations={recommendations}
                sellerName={cart.seller ? generateAlias(cart.seller) : null}
                onAdd={(row) => addItem(row.raw, 1)}
                casualModeActive={casualModeActive}
              />
            </div>

            {/* Seller + totals + checkout */}
            <div style={{ borderTop: "1px solid var(--glass-border)", padding: "1.25rem 1.5rem", display: "flex", flexDirection: "column", gap: "0.85rem" }}>
              {cart.seller && (
                <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                  {casualModeActive ? "From" : "Seller"}:{" "}
                  <strong style={{ color: "var(--text-primary)", fontFamily: "monospace", fontSize: "0.72rem" }}>
                    {generateAlias(cart.seller)}
                  </strong>
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                  Subtotal
                </span>
                <strong style={{ fontSize: "1.25rem", color: "var(--text-primary)", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                  {totals.subtotalDisplay}
                </strong>
              </div>

              <button
                type="button"
                onClick={handleProceed}
                disabled={totals.itemCount === 0}
                style={{
                  width: "100%",
                  padding: "0.75rem 1rem",
                  borderRadius: "10px",
                  border: "none",
                  background: totals.itemCount === 0 ? "rgba(255,255,255,0.06)" : "linear-gradient(135deg, var(--teal-400), var(--violet-500))",
                  color: totals.itemCount === 0 ? "var(--text-muted)" : "#04120f",
                  fontWeight: 700,
                  fontSize: "0.9rem",
                  cursor: totals.itemCount === 0 ? "not-allowed" : "pointer",
                  boxShadow: totals.itemCount === 0 ? "none" : "0 0 20px rgba(45, 212, 191, 0.3)",
                  transition: "all 0.3s cubic-bezier(0.4,0,0.2,1)",
                  justifyContent: "center",
                  display: "flex",
                }}
                onMouseEnter={(e) => { if (totals.itemCount > 0) e.currentTarget.style.boxShadow = "0 0 30px rgba(45, 212, 191, 0.5)"; }}
                onMouseLeave={(e) => { if (totals.itemCount > 0) e.currentTarget.style.boxShadow = "0 0 20px rgba(45, 212, 191, 0.3)"; }}
              >
                Proceed to checkout
              </button>
            </div>
          </>
        )}
      </div>

      {/* Seller-conflict confirmation, rendered as a nested overlay on top of
          the drawer (kept inside the same Modal focus scope). */}
      {conflict && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label="Replace cart?"
          style={{
            position: "absolute", inset: 0, background: "rgba(6, 8, 20, 0.75)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: "1.5rem", zIndex: 10,
          }}
        >
          <div style={{
            background: "var(--glass-bg)", border: "1px solid var(--glass-border)", backdropFilter: "blur(24px)",
            borderRadius: "14px", padding: "1.5rem", maxWidth: "360px", display: "flex", flexDirection: "column", gap: "0.85rem",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--amber-400)" }}>
              <Warning size={20} weight="duotone" />
              <strong style={{ fontFamily: "Outfit, sans-serif", color: "var(--text-primary)" }}>Replace cart?</strong>
            </div>
            <p style={{ fontSize: "0.82rem", color: "var(--text-secondary)", margin: 0, lineHeight: 1.5 }}>
              Your cart has fish from <strong style={{ color: "var(--text-primary)" }}>{generateAlias(conflict.currentSeller)}</strong>.
              Start a new cart with <strong style={{ color: "var(--text-primary)" }}>{generateAlias(conflict.incomingSeller)}</strong>?
            </p>
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => resolveConflict(false)}
                style={{ padding: "0.5rem 1rem", borderRadius: "8px", border: "1px solid var(--glass-border)", background: "transparent", color: "var(--text-secondary)", fontSize: "0.8rem", cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => resolveConflict(true)}
                style={{ padding: "0.5rem 1rem", borderRadius: "8px", border: "none", background: "linear-gradient(135deg, var(--teal-400), var(--violet-500))", color: "#04120f", fontWeight: 700, fontSize: "0.8rem", cursor: "pointer" }}
              >
                Replace cart
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function CartItemRow({ item, changes, onSetQuantity, onRemove, casualModeActive }) {
  const isUnavailable = item.unavailable;

  return (
    <div
      className="glass-card"
      style={{
        padding: "0.85rem",
        display: "flex",
        gap: "0.75rem",
        alignItems: "flex-start",
        opacity: isUnavailable ? 0.55 : 1,
        transition: "opacity 0.3s cubic-bezier(0.4,0,0.2,1), transform 0.3s cubic-bezier(0.4,0,0.2,1)",
      }}
    >
      <div style={{
        width: "52px", height: "52px", borderRadius: "10px", flexShrink: 0,
        background: "linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)",
        border: "1px solid var(--glass-border)", display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {item.imageUrl ? (
          <img src={item.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "10px" }} />
        ) : (
          <FishSilhouetteSVG specimenId={item.tokenId ?? item.listingId ?? 0} style={{ width: "32px", height: "32px" }} />
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "0.35rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
          <div style={{ minWidth: 0 }}>
            <strong style={{
              display: "block", fontFamily: "Outfit, sans-serif", fontSize: "0.9rem", fontWeight: 700,
              color: "var(--text-primary)", textDecoration: isUnavailable ? "line-through" : "none",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {item.commonName || "Listing"}
            </strong>
            {item.scientificName && (
              <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", fontStyle: "italic" }}>{item.scientificName}</span>
            )}
          </div>
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${item.commonName || "item"} from cart`}
            style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: "0.2rem", flexShrink: 0 }}
          >
            <Trash size={16} weight="regular" />
          </button>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <strong style={{
            fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: "0.9rem",
            color: isUnavailable ? "var(--text-muted)" : "var(--text-primary)",
            textDecoration: isUnavailable ? "line-through" : "none",
          }}>
            ${(item.unitPriceCents / 100).toFixed(2)}{item.isBatch ? " / fish" : ""}
          </strong>

          {item.isBatch && !isUnavailable ? (
            <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
              <button
                type="button"
                onClick={() => onSetQuantity(item.quantity - 1)}
                aria-label="Decrease quantity"
                style={{ width: "26px", height: "26px", borderRadius: "6px", border: "1px solid var(--glass-border)", background: "rgba(255,255,255,0.02)", color: "var(--text-secondary)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                <Minus size={12} weight="bold" />
              </button>
              <span style={{ fontSize: "0.8rem", color: "var(--text-primary)", minWidth: "1.5rem", textAlign: "center" }}>{item.quantity}</span>
              <button
                type="button"
                onClick={() => onSetQuantity(item.quantity + 1)}
                aria-label="Increase quantity"
                style={{ width: "26px", height: "26px", borderRadius: "6px", border: "1px solid var(--glass-border)", background: "rgba(255,255,255,0.02)", color: "var(--text-secondary)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                <Plus size={12} weight="bold" />
              </button>
            </div>
          ) : (
            !isUnavailable && <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>1 specimen</span>
          )}
        </div>

        {changes.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            {changes.map((change, idx) => (
              <span
                key={idx}
                style={{
                  display: "inline-flex", alignItems: "center", gap: "0.3rem", fontSize: "0.68rem",
                  color: change.type === CART_CHANGE_TYPE.UNAVAILABLE ? "var(--text-muted)" : "var(--amber-400)",
                }}
              >
                {change.type === CART_CHANGE_TYPE.UNAVAILABLE ? <Info size={12} weight="duotone" /> : <Warning size={12} weight="duotone" />}
                {changeNote(change, casualModeActive)}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState({ casualModeActive, onClose }) {
  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: "3rem 1.5rem", textAlign: "center", position: "relative", overflow: "hidden",
    }}>
      {/* Subtle ambient orb per brand motion spec — decorative only. */}
      <div aria-hidden="true" style={{
        position: "absolute", width: "220px", height: "220px", borderRadius: "50%",
        background: "var(--teal-400)", opacity: 0.08, filter: "blur(120px)", top: "20%", left: "50%", transform: "translateX(-50%)",
      }} />
      <ShoppingCartSimple size={48} weight="duotone" color="var(--text-muted)" style={{ marginBottom: "1rem", position: "relative" }} />
      <h4 style={{ fontFamily: "Outfit, sans-serif", color: "var(--text-primary)", fontSize: "1rem", margin: "0 0 0.4rem 0", position: "relative" }}>
        {casualModeActive ? "Your cart is empty" : "No items in cart"}
      </h4>
      <p style={{ color: "var(--text-secondary)", fontSize: "0.8rem", margin: "0 0 1.25rem 0", maxWidth: "260px", position: "relative" }}>
        {casualModeActive
          ? "Browse the reef to find your next fish."
          : "Add a listing from the marketplace to get started."}
      </p>
      <button
        type="button"
        onClick={onClose}
        style={{
          padding: "0.55rem 1.25rem", borderRadius: "10px", border: "1px solid var(--glass-border)",
          background: "rgba(255,255,255,0.02)", color: "var(--text-primary)", fontSize: "0.82rem", cursor: "pointer", position: "relative",
        }}
      >
        Browse the reef
      </button>
    </div>
  );
}
