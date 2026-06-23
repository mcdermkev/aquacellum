/**
 * ListingCard.jsx — Individual specimen or batch listing card.
 * Shows IPFS image, species name, price (ETH + USD), shipping/local badges,
 * pedigree badge, and a prominent "Buy Now" pill button.
 *
 * Spring animations on hover/tap. Routes purchase through existing checkout flow.
 */
import React, { useState, useRef } from "react";
import { ShoppingCart, Truck, MapPin, Tag } from "@phosphor-icons/react";
import { LazyImage } from "../LazyImage";
import { FishSilhouetteSVG } from "../SilhouetteSVG";

const IPFS_GATEWAY = "https://gateway.pinata.cloud/ipfs";

const PEDIGREE_STYLES = {
  "wild-caught": { label: "Wild", bg: "rgba(251,191,36,0.12)", border: "rgba(251,191,36,0.35)", color: "#fbbf24" },
  "purebred": { label: "Purebred", bg: "rgba(52,211,153,0.12)", border: "rgba(52,211,153,0.35)", color: "#34d399" },
  "F1-hybrid": { label: "F1 Hybrid", bg: "rgba(96,165,250,0.12)", border: "rgba(96,165,250,0.35)", color: "#60a5fa" },
};

export function ListingCard({ listing, onBuyNow, casualMode = true }) {
  const [isPressed, setIsPressed] = useState(false);
  const cardRef = useRef(null);

  const imageUrl = listing.imageCid
    ? `${IPFS_GATEWAY}/${listing.imageCid}`
    : listing.imageUrl || null;

  const pedigreeStyle = PEDIGREE_STYLES[listing.pedigree] || null;
  const isBatch = listing.isBatch || listing.type === "batch";
  const priceEth = listing.priceEth || listing.price || "0";
  const priceUsd = listing.priceUsd || listing.approximateUsd || null;
  const quantityRemaining = listing.quantityRemaining || listing.quantity || 1;

  const handleBuyClick = (e) => {
    e.stopPropagation();
    // Haptic feedback on mobile
    if (navigator.vibrate) navigator.vibrate(15);
    onBuyNow?.(listing);
  };

  return (
    <article
      ref={cardRef}
      className={`sf-listing-card glass-card ${isPressed ? "sf-listing-card--pressed" : ""}`}
      onPointerDown={() => setIsPressed(true)}
      onPointerUp={() => setIsPressed(false)}
      onPointerLeave={() => setIsPressed(false)}
      role="article"
      aria-label={`${listing.commonName || "Specimen"} listing, ${priceEth} ETH`}
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") handleBuyClick(e); }}
    >
      {/* Image */}
      <div className="sf-listing-card__image">
        <LazyImage
          src={imageUrl}
          alt={listing.commonName || "Fish specimen"}
          fallbackSvg={<FishSilhouetteSVG />}
          style={{ borderRadius: "var(--radius-sm)" }}
        />
        {/* Pedigree badge */}
        {pedigreeStyle && (
          <span
            className="sf-listing-card__pedigree"
            style={{ background: pedigreeStyle.bg, borderColor: pedigreeStyle.border, color: pedigreeStyle.color }}
          >
            {pedigreeStyle.label}
          </span>
        )}
        {/* Price badge */}
        <span className="sf-listing-card__price-badge">
          {parseFloat(priceEth).toFixed(4)} ETH
        </span>
      </div>

      {/* Body */}
      <div className="sf-listing-card__body">
        {/* Species info */}
        <h3 className="sf-listing-card__name">{listing.commonName || "Unnamed Specimen"}</h3>
        {listing.scientificName && (
          <p className="sf-listing-card__sci">{listing.scientificName}</p>
        )}

        {/* Meta chips */}
        <div className="sf-listing-card__meta">
          {isBatch && (
            <span className="sf-listing-card__chip sf-listing-card__chip--qty">
              <Tag weight="bold" size={11} />
              {quantityRemaining} available
            </span>
          )}
          {listing.shippingAvailable && (
            <span className="sf-listing-card__chip sf-listing-card__chip--ship">
              <Truck weight="bold" size={11} />
              Ships
            </span>
          )}
          {listing.localPickup && (
            <span className="sf-listing-card__chip sf-listing-card__chip--local">
              <MapPin weight="bold" size={11} />
              Local
            </span>
          )}
        </div>

        {/* USD approximate */}
        {priceUsd && (
          <p className="sf-listing-card__usd">
            ≈ ${parseFloat(priceUsd).toFixed(2)} USD
          </p>
        )}

        {/* Buy Now button */}
        <button
          className="sf-listing-card__buy-btn"
          onClick={handleBuyClick}
          aria-label={`Buy ${listing.commonName || "specimen"} for ${priceEth} ETH`}
        >
          <ShoppingCart weight="bold" size={16} />
          {isBatch ? "Buy Fish" : "Buy Now"}
        </button>
      </div>
    </article>
  );
}
