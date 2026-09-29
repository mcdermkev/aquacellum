/**
 * ProductDetailModal.jsx
 *
 * Product-detail overlay for a marketplace listing (Task 8, Tier B). Thin
 * presentation component: all evaluation logic lives in
 * `assembleProductDetailView` (productDetailView.js), which itself composes
 * the compatibility, care, DOA-window, and delivery-eligibility engines.
 * This component only renders the resulting view model plus a gallery and
 * the Add to cart handoff.
 *
 * Supports three states:
 *   - loading listing data (parent controls this via `listing` being null
 *     while a deep-linked id hasn't resolved yet)
 *   - not found (deep link pointed at an id that doesn't match any listing)
 *   - loaded (renders the full assembled view model)
 */

import React, { useMemo } from "react";
import { Modal } from "./Modal";
import { FishSilhouetteSVG, PlantSilhouetteSVG } from "./SilhouetteSVG";
import { assembleProductDetailView } from "../services/productDetailView";
import { normalizeSpeciesProfile } from "../services/shippingSafety";
import { deriveDefaultPackingProfile, normalizeParcelPreset, canAddToParcel } from "../services/packingEngine";
import { FRAG_MOUNT_LABELS, FRAG_ORIGIN_LABELS, cleanHttpsUrl, fragSizeLabel, isFragListing } from "../services/fragListing";

const isPlantEntry = (specCodeOrItem) => {
  if (typeof specCodeOrItem === "object" && specCodeOrItem !== null) {
    return specCodeOrItem.type === "plant";
  }
  return false;
};

export function ProductDetailModal({
  listing,
  notFound = false,
  speciesRecord,
  displayTank,
  onClose,
  onBuyNow,
  onAddToCart,
  onMessage,
  onCancelMessage,
  messageIntent = false,
  walletAccount,
  casualModeActive = false,
}) {
  const isOpen = !!listing || notFound;
  const isPlant = listing ? isPlantEntry(speciesRecord || { specCode: listing.speciesId || 0 }) : false;

  // Task 11 §3.C — a minimal, no-cart-required packing hint. Keep this hook
  // above the loading/not-found returns so opening a route-resolved listing
  // never changes the component's hook order.
  const packingHint = useMemo(() => {
    if (!listing || isPlant) return null;
    const speciesProfile = normalizeSpeciesProfile(speciesRecord || {
      scientificName: listing.scientificName,
      commonName: listing.commonName,
      minTemp: listing.minTemp,
      maxTemp: listing.maxTemp,
      minPh: listing.minPh,
      maxPh: listing.maxPh,
    });
    // A frag carries its own per-unit profile (one small bag); the fish default
    // would overstate it several times over.
    const profile = isFragListing(listing) && listing.packingProfile
      ? listing.packingProfile
      : deriveDefaultPackingProfile(speciesProfile, 1);
    const preset = normalizeParcelPreset({});
    const fit = canAddToParcel(preset, [], profile);
    return { fitsStandardBox: !fit.addedBox };
  }, [isPlant, listing, speciesRecord]);

  if (!isOpen) return null;

  if (notFound) {
    return (
      <Modal isOpen={true} onClose={onClose} ariaLabel="Listing not found" className="glass-card">
        <div style={{ padding: "2.5rem", textAlign: "center" }}>
          <h3 style={{ color: "var(--text-primary)", marginBottom: "0.75rem" }}>Listing not found</h3>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginBottom: "1.5rem" }}>
            This listing may have sold or been removed from the directory.
          </p>
          <button className="btn-secondary" onClick={onClose} style={{ justifyContent: "center" }}>
            Back to Directory
          </button>
        </div>
      </Modal>
    );
  }

  const view = assembleProductDetailView(listing, speciesRecord, { displayTank });
  const isCoral = !!view.frag || speciesRecord?.type === "coral";
  const headerIcon = isPlant ? "🌿" : isCoral ? "🪸" : "🐟";
  const fragSize = view.frag ? fragSizeLabel(view.frag) : "";
  const fragPhoto = view.frag ? cleanHttpsUrl(listing.photoUrl) : null;
  const isOwner = walletAccount && listing.seller && listing.seller.toLowerCase() === walletAccount.toLowerCase();

  const compatColor =
    view.compatibility.verdict === "ok" ? "var(--accent-green)"
    : view.compatibility.verdict === "blocked" ? "var(--accent-red)"
    : view.compatibility.verdict === "no_tank" ? "var(--text-muted)"
    : "#b45309"; // caution
  const compatIcon =
    view.compatibility.verdict === "ok" ? "✅"
    : view.compatibility.verdict === "blocked" ? "🚫"
    : view.compatibility.verdict === "no_tank" ? "🏡"
    : "⚠️";

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      ariaLabel={`Product detail: ${view.identity.commonName}`}
      className="glass-card"
      fullScreenMobile={true}
    >
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "1.25rem 1.5rem", borderBottom: "1px solid var(--glass-border)"
        }}>
          <h3 style={{ fontSize: "1.15rem", color: "var(--text-primary)", margin: 0, display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span aria-hidden="true">{headerIcon}</span> {view.identity.commonName}
          </h3>
          <button
            onClick={onClose}
            aria-label="Close product detail"
            style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: "1.5rem", cursor: "pointer", padding: "0.25rem", lineHeight: 1 }}
          >
            &times;
          </button>
        </div>

        <div style={{ padding: "1.5rem", overflowY: "auto", display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {/* Gallery */}
          <div style={{
            height: "12rem", width: "100%", borderRadius: "0.75rem",
            background: "linear-gradient(135deg, rgba(var(--ink-rgb), 0.03) 0%, rgba(var(--ink-rgb), 0.01) 100%)",
            border: "1px solid rgba(var(--ink-rgb), 0.13)", display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {fragPhoto ? (
              <img
                src={fragPhoto}
                alt={`${view.identity.commonName}${view.frag?.wysiwyg ? " (this exact frag)" : ""}`}
                style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "0.75rem" }}
              />
            ) : isPlant ? (
              <PlantSilhouetteSVG specCode={listing.speciesId || 9001} style={{ width: "110px", height: "110px" }} />
            ) : (
              <FishSilhouetteSVG specimenId={view.listingId} style={{ width: "130px", height: "130px" }} />
            )}
          </div>

          {/* Identity + price */}
          <div>
            {view.identity.scientificName && (
              <span style={{ fontSize: "0.85rem", fontStyle: "italic", color: "var(--text-secondary)", display: "block", marginBottom: "0.5rem" }}>
                {view.identity.scientificName}
              </span>
            )}
            <strong style={{ fontSize: "1.4rem", color: "var(--accent-green)", fontFamily: "monospace" }}>
              {view.price.display}{view.price.unit ? ` / ${view.price.unit}` : ""}
            </strong>
          </div>

          {/* Coral frag facts (fragListing.js) */}
          {view.frag && (
            <div className="glass-card" style={{ padding: "1rem", border: "1px solid rgba(244,114,182,0.3)" }}>
              <h4 style={{ fontSize: "0.85rem", color: "#be185d", margin: "0 0 0.6rem 0" }}>
                <span aria-hidden="true">🪸</span> Frag Details
              </h4>
              <dl style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", fontSize: "0.78rem", margin: 0 }}>
                <div>
                  <dt style={{ color: "var(--text-muted)" }}>Size</dt>
                  <dd style={{ color: "var(--text-primary)", fontWeight: 600, margin: 0 }}>{fragSize || "Not stated"}</dd>
                </div>
                <div>
                  <dt style={{ color: "var(--text-muted)" }}>Mounted on</dt>
                  <dd style={{ color: "var(--text-primary)", fontWeight: 600, margin: 0 }}>{FRAG_MOUNT_LABELS[view.frag.mount] || "Not stated"}</dd>
                </div>
                <div>
                  <dt style={{ color: "var(--text-muted)" }}>Origin</dt>
                  <dd style={{ color: "var(--text-primary)", fontWeight: 600, margin: 0 }}>{FRAG_ORIGIN_LABELS[view.frag.origin] || "Not stated"}</dd>
                </div>
                <div>
                  <dt style={{ color: "var(--text-muted)" }}>Photo</dt>
                  <dd style={{ color: "var(--text-primary)", fontWeight: 600, margin: 0 }}>
                    {view.frag.wysiwyg ? "WYSIWYG: this exact frag" : "Representative of the colony"}
                  </dd>
                </div>
                {view.frag.grownUnder && (
                  <div style={{ gridColumn: "1 / -1" }}>
                    <dt style={{ color: "var(--text-muted)" }}>Grown under</dt>
                    <dd style={{ color: "var(--text-primary)", margin: 0 }}>{view.frag.grownUnder}</dd>
                  </div>
                )}
              </dl>
              {view.frag.motherPhotoUrl && (
                <figure style={{ margin: "0.75rem 0 0" }}>
                  <img
                    src={view.frag.motherPhotoUrl}
                    alt={`Mother colony of ${view.identity.commonName}`}
                    loading="lazy"
                    style={{ width: "100%", maxHeight: "12rem", objectFit: "cover", borderRadius: "0.5rem" }}
                  />
                  <figcaption style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: "0.3rem" }}>
                    Mother colony
                  </figcaption>
                </figure>
              )}
            </div>
          )}

          {/* Species-level reef care from the catalog */}
          {view.coralCare && (
            <div className="glass-card" style={{ padding: "1rem" }}>
              <h4 style={{ fontSize: "0.85rem", color: "var(--accent-blue)", margin: "0 0 0.6rem 0" }}>💡 Reef Care</h4>
              <dl style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", fontSize: "0.78rem", margin: 0 }}>
                {[
                  ["Type", view.coralCare.coralType],
                  ["Light", view.coralCare.light],
                  ["Flow", view.coralCare.flow],
                  ["Placement", view.coralCare.placement],
                  ["Aggression", view.coralCare.aggression],
                  ["Feeding", view.coralCare.feeding],
                ].filter(([, v]) => v).map(([label, value]) => (
                  <div key={label}>
                    <dt style={{ color: "var(--text-muted)" }}>{label}</dt>
                    <dd style={{ color: "var(--text-primary)", fontWeight: 600, margin: 0, textTransform: label === "Type" ? "none" : "capitalize" }}>{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {/* Compatibility explanation */}
          <div className="glass-card" style={{ padding: "1rem", border: `1px solid ${compatColor}55` }}>
            <h4 style={{ fontSize: "0.85rem", color: compatColor, margin: "0 0 0.5rem 0", display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <span aria-hidden="true">{compatIcon}</span> {view.compatibility.headline}
            </h4>
            <ul style={{ margin: 0, paddingLeft: "1.1rem", display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              {view.compatibility.reasons.map((reason, idx) => (
                <li key={idx} style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>{reason}</li>
              ))}
            </ul>
          </div>

          {/* Care requirements */}
          <div className="glass-card" style={{ padding: "1rem" }}>
            <h4 style={{ fontSize: "0.85rem", color: "var(--accent-blue)", margin: "0 0 0.6rem 0" }}>🏠 Care Requirements</h4>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", fontSize: "0.78rem" }}>
              <div>
                <span style={{ color: "var(--text-muted)", display: "block" }}>Min. Tank Size</span>
                <strong style={{ color: "var(--text-primary)" }}>{view.careRequirements.minTankSizeGallons != null ? `${view.careRequirements.minTankSizeGallons} gal` : "Unknown"}</strong>
              </div>
              <div>
                <span style={{ color: "var(--text-muted)", display: "block" }}>Temperament</span>
                <strong style={{ color: "var(--text-primary)", textTransform: "capitalize" }}>{view.careRequirements.temperament.replace(/_/g, " ")}</strong>
              </div>
              <div>
                <span style={{ color: "var(--text-muted)", display: "block" }}>Temperature</span>
                <strong style={{ color: "var(--text-primary)" }}>
                  {view.careRequirements.temperatureRangeCelsius ? `${view.careRequirements.temperatureRangeCelsius[0]}–${view.careRequirements.temperatureRangeCelsius[1]}°C` : "Unknown"}
                </strong>
              </div>
              <div>
                <span style={{ color: "var(--text-muted)", display: "block" }}>pH</span>
                <strong style={{ color: "var(--text-primary)" }}>
                  {view.careRequirements.phRange ? `${view.careRequirements.phRange[0]}–${view.careRequirements.phRange[1]}` : "Unknown"}
                </strong>
              </div>
            </div>
          </div>

          {/* Seller policies */}
          <div className="glass-card" style={{ padding: "1rem" }}>
            <h4 style={{ fontSize: "0.85rem", color: "var(--accent-amber)", margin: "0 0 0.6rem 0" }}>🛡️ Seller Policies</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: "0.78rem" }}>
              <span>
                {view.sellerPolicies.doaGuarantee
                  ? `DOA guarantee: claim within ${view.sellerPolicies.doaWindowHours}h of confirmed arrival.`
                  : "This listing does not carry a DOA guarantee."}
              </span>
              <span style={{ color: "var(--text-secondary)" }}>
                Health status: <strong style={{ color: "var(--text-primary)", textTransform: "capitalize" }}>{view.sellerPolicies.healthStatus}</strong>
              </span>
            </div>
          </div>

          {/* Fulfillment options */}
          <div className="glass-card" style={{ padding: "1rem" }}>
            <h4 style={{ fontSize: "0.85rem", color: "var(--accent-blue)", margin: "0 0 0.6rem 0" }}>📦 Fulfillment</h4>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: view.fulfillment.localDelivery ? "0.6rem" : 0 }}>
              {view.fulfillment.shipping && <span className="badge badge-blue" style={{ fontSize: "0.65rem" }}>🚚 Ships Nationwide</span>}
              {view.fulfillment.pickup && <span className="badge badge-amber" style={{ fontSize: "0.65rem" }}>📍 Local Pickup</span>}
            </div>
            {view.fulfillment.localDelivery && (
              <p style={{ fontSize: "0.75rem", color: "var(--text-secondary)", margin: 0 }}>
                {view.fulfillment.localDelivery.summary}
              </p>
            )}
            {view.fulfillment.shipping && packingHint?.fitsStandardBox && (
              <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", margin: "0.5rem 0 0 0" }}>
                📦 Ships in a standard box
              </p>
            )}
          </div>

          {/* Reviews slot (display-only; backend is a future task) */}
          <div className="glass-card" style={{ padding: "1rem" }}>
            <h4 style={{ fontSize: "0.85rem", color: "var(--text-secondary)", margin: "0 0 0.4rem 0" }}>⭐ Reviews</h4>
            {view.reviews.count > 0 ? (
              <p style={{ fontSize: "0.78rem", color: "var(--text-secondary)", margin: 0 }}>
                {view.reviews.averageRating.toFixed(1)} / 5 from {view.reviews.count} review{view.reviews.count === 1 ? "" : "s"}
              </p>
            ) : (
              <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", margin: 0 }}>No reviews yet.</p>
            )}
          </div>

          {/* A restored protected message intent opens only this confirmation.
              Conversation creation happens after the explicit Continue click;
              no message body or mutation is replayed after authentication. */}
          {!isOwner && messageIntent && (
            <div className="glass-card" style={{ padding: "1rem", border: "1px solid rgba(56, 189, 248, 0.35)" }}>
              <h4 style={{ color: "var(--text-primary)", margin: "0 0 0.4rem" }}>Ask this breeder?</h4>
              <p style={{ color: "var(--text-secondary)", fontSize: "0.78rem", margin: "0 0 0.8rem" }}>
                Continue to open a conversation about {view.identity.commonName}. Nothing will be sent until you write and submit a message.
              </p>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <button className="btn-primary" onClick={() => onMessage?.(listing)}>Continue to messages</button>
                <button className="btn-secondary" onClick={onCancelMessage}>Cancel</button>
              </div>
            </div>
          )}

          {/* Add to cart (Task 10) + Buy Now shortcut (preserves the existing one-tap purchase) */}
          {!isOwner && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <button
                className={casualModeActive ? "btn-primary" : "btn-primary-pro"}
                onClick={() => onBuyNow && onBuyNow(listing)}
                style={{ width: "100%", padding: "0.65rem 1rem", justifyContent: "center" }}
              >
                {walletAccount
                  ? (casualModeActive ? "Buy Now" : "Secure Livestock")
                  : "Sign in to buy"}
              </button>
              <button
                className="btn-secondary"
                onClick={() => onAddToCart && onAddToCart(listing)}
                style={{ width: "100%", padding: "0.55rem 1rem", justifyContent: "center" }}
              >
                Add to Cart
              </button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
