import React, { useState } from "react";
import { Modal } from "./Modal";
import { supabase, isSupabaseConfigured } from "../services/supabaseClient";
import { generateAlias } from "../utils/generateAlias";
import { notifyOfferReceived } from "../services/marketplaceNotifications";

/**
 * OfferModal — Buyer submits an offer on a listing below asking price.
 *
 * Props:
 *   isOpen, onClose, listing, walletAccount, casualModeActive, onSuccess
 */
export function OfferModal({ isOpen, onClose, listing, walletAccount, casualModeActive, onSuccess }) {
  const [offerAmount, setOfferAmount] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  if (!listing) return null;

  // USD-canonical: listing.price/priceUsd are already dollars. (Legacy code
  // multiplied by 1000 to fake USD from ETH — that's wrong now and showed a
  // $50 fish as $50,000.)
  const askingPrice =
    parseFloat(listing.priceUsd ?? listing.price ?? 0) ||
    (Number(listing.priceCentsUSD) || 0) / 100;
  const offerVal = parseFloat(offerAmount) || 0;
  const discount = askingPrice > 0 ? Math.round((1 - offerVal / askingPrice) * 100) : 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!offerVal || offerVal <= 0) {
      setError("Please enter a valid offer amount.");
      return;
    }
    if (offerVal >= askingPrice) {
      setError("Your offer should be below the asking price. Use the Buy button to purchase at full price.");
      return;
    }
    if (!walletAccount) {
      setError("Please connect your account first.");
      return;
    }

    setSubmitting(true);

    try {
      if (!isSupabaseConfigured()) {
        throw new Error("Marketplace service unavailable. Please try again later.");
      }

      const offerData = {
        listing_id: String(listing.id || listing.tokenId || listing.listingId),
        listing_type: listing.isBatch ? "batch" : "specimen",
        seller_wallet: (listing.seller || "").toLowerCase(),
        buyer_wallet: walletAccount.toLowerCase(),
        buyer_name: generateAlias(walletAccount),
        asking_price_usd: askingPrice,
        offer_price_usd: offerVal,
        species_name: listing.commonName || "Unknown",
        message: message.trim() || null,
        status: "pending",
        created_at: new Date().toISOString(),
      };

      const { error: insertError } = await supabase
        .from("marketplace_offers")
        .insert(offerData);

      if (insertError) {
        // Table might not exist yet — provide graceful fallback
        if (insertError.code === "42P01" || insertError.message?.includes("does not exist")) {
          throw new Error("The offers feature is being set up. Please try again soon.");
        }
        throw new Error(insertError.message || "Failed to submit offer.");
      }

      // Notify the seller via Sonar (delivered to their notification bell).
      notifyOfferReceived({
        recipientWallet: listing.seller,
        buyerName: generateAlias(walletAccount),
        speciesName: listing.commonName || "Unknown",
        offerAmount: offerVal,
        listingId: String(listing.id || listing.tokenId || listing.listingId),
      }).catch(() => {});

      setSuccess(true);
      if (onSuccess) onSuccess();
    } catch (err) {
      console.error("Offer submission failed:", err);
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setOfferAmount("");
    setMessage("");
    setError(null);
    setSuccess(false);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      ariaLabel="Make an Offer"
      className="sliding-drawer-content"
      fullScreenMobile={true}
    >
      <button
        onClick={handleClose}
        style={{
          position: "absolute", top: "1.5rem", right: "1.5rem",
          background: "none", border: "none", color: "var(--text-muted)",
          fontSize: "1.75rem", cursor: "pointer", zIndex: 10
        }}
      >
        &times;
      </button>

      {success ? (
        <div style={{ textAlign: "center", padding: "3rem 1.5rem" }}>
          <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>🤝</div>
          <h3 style={{ color: "#fff", fontSize: "1.3rem", marginBottom: "0.5rem" }}>Offer Sent!</h3>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", lineHeight: "1.5", marginBottom: "1.5rem" }}>
            The breeder has been notified of your ${offerVal.toFixed(2)} offer for {listing.commonName}.
            You'll receive a notification when they respond.
          </p>
          <button className="btn-primary" onClick={handleClose} style={{ padding: "0.6rem 2rem" }}>
            Done
          </button>
        </div>
      ) : (
        <>
          <h3 style={{ fontSize: "1.4rem", color: "#fff", marginTop: "1rem" }}>
            Make an Offer
          </h3>
          <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: "1.25rem" }}>
            Propose a price below asking. The breeder can accept, counter, or decline.
          </p>

          {/* Listing summary */}
          <div style={{
            display: "flex", alignItems: "center", gap: "0.75rem",
            padding: "0.75rem 1rem", background: "rgba(255,255,255,0.02)",
            border: "1px solid var(--glass-border)", borderRadius: "10px",
            marginBottom: "1.25rem"
          }}>
            <span style={{ fontSize: "1.5rem" }}>🐟</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: "600", fontSize: "0.9rem", color: "#fff" }}>{listing.commonName}</div>
              <div style={{ fontSize: "0.72rem", fontStyle: "italic", color: "var(--text-secondary)" }}>{listing.scientificName}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>Asking</div>
              <div style={{ fontFamily: "monospace", fontWeight: "700", color: "var(--accent-green)", fontSize: "0.95rem" }}>
                ${askingPrice.toFixed(2)}
              </div>
            </div>
          </div>

          {error && (
            <div style={{
              padding: "0.65rem", marginBottom: "1rem",
              backgroundColor: "rgba(248, 113, 113, 0.08)",
              border: "1px solid rgba(248, 113, 113, 0.2)",
              color: "var(--accent-red)", borderRadius: "6px", fontSize: "0.8rem"
            }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {/* Offer amount */}
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
                Your Offer ($)
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                max={askingPrice - 0.01}
                value={offerAmount}
                onChange={(e) => setOfferAmount(e.target.value)}
                placeholder={`e.g. ${(askingPrice * 0.8).toFixed(2)}`}
                required
                style={{ width: "100%", padding: "0.75rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "8px", outline: "none", fontSize: "1rem", fontFamily: "monospace" }}
              />
              {offerVal > 0 && offerVal < askingPrice && (
                <div style={{ marginTop: "0.4rem", fontSize: "0.72rem", color: discount > 30 ? "var(--accent-red)" : "var(--accent-amber)" }}>
                  {discount}% below asking price
                  {discount > 40 && " — aggressive offers are less likely to be accepted"}
                </div>
              )}
            </div>

            {/* Optional message */}
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
                Message to Breeder (optional)
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={casualModeActive ? "I'm really interested in this fish! Would you consider..." : "Interested in bulk purchase, or pickup this weekend..."}
                rows={3}
                maxLength={280}
                style={{ width: "100%", padding: "0.65rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "8px", outline: "none", resize: "vertical", fontFamily: "inherit", fontSize: "0.85rem" }}
              />
              <div style={{ fontSize: "0.6rem", color: "var(--text-muted)", textAlign: "right", marginTop: "0.2rem" }}>
                {message.length}/280
              </div>
            </div>

            {/* Summary */}
            {offerVal > 0 && (
              <div style={{
                padding: "0.75rem", borderRadius: "8px",
                background: "rgba(52,211,153,0.04)",
                border: "1px solid rgba(52,211,153,0.12)"
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                  <span>You're offering:</span>
                  <strong style={{ color: "#fff", fontFamily: "monospace" }}>${offerVal.toFixed(2)}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: "0.25rem" }}>
                  <span>You'd save:</span>
                  <strong style={{ color: "var(--accent-green)", fontFamily: "monospace" }}>${(askingPrice - offerVal).toFixed(2)}</strong>
                </div>
              </div>
            )}

            <button
              type="submit"
              className="btn-primary-pro"
              disabled={submitting || !offerVal || offerVal >= askingPrice}
              style={{ width: "100%", justifyContent: "center", padding: "0.75rem", marginTop: "0.25rem" }}
            >
              {submitting ? "Sending offer..." : `Send Offer — $${offerVal > 0 ? offerVal.toFixed(2) : "0.00"}`}
            </button>
          </form>
        </>
      )}
    </Modal>
  );
}
