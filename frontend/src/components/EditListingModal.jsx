import React, { useState, useEffect } from "react";
import { Modal } from "./Modal";
import { compressImage } from "../utils/imageCompression";
import { relayUpdateListing } from "../services/relayer";
import { syncListingToCloud } from "../services/cloudSync";
import { uploadSpecimenPhoto } from "../services/photoUpload";

const getSpecimenPhotoUrl = (commonName) => {
  if (!commonName) return "";
  const formatted = commonName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return `https://oexctbbybpfvslgxlscg.supabase.co/storage/v1/object/public/fish-photos/${formatted}.jpg?width=150&height=150&resize=contain&quality=80`;
};

export function EditListingModal({ isOpen, onClose, item, onSuccess }) {
  const [price, setPrice] = useState("");
  // Shipping itself is buyer-paid and quoted live at checkout (ShipEngine) —
  // sellers only toggle whether shipping is offered, never a flat fee.
  const [isShipping, setIsShipping] = useState(false);
  const [tempPhotos, setTempPhotos] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Initialize form fields when the modal opens or item changes
  useEffect(() => {
    if (isOpen && item) {
      setError(null);
      
      // Prices are stored in USD dollars (canonical). Show them directly, falling
      // back to cents if a legacy record only has priceCentsUSD.
      const displayPrice = item.priceUsd != null
        ? parseFloat(item.priceUsd).toFixed(2)
        : (item.priceCentsUSD != null
            ? (Number(item.priceCentsUSD) / 100).toFixed(2)
            : parseFloat(item.price || 0).toFixed(2));
      setPrice(displayPrice);
      
      const shippingActive = !!item.isShipping;
      setIsShipping(shippingActive);

      // Load photos from localStorage into local temp state (so changes don't persist unless saved)
      if (!item.isBatch) {
        const primaryPhoto = localStorage.getItem(`aquadex_specimen_photo_${item.tokenId}`);
        let additional = [];
        try {
          const stored = localStorage.getItem(`aquadex_specimen_photos_${item.tokenId}`);
          if (stored) {
            additional = JSON.parse(stored);
          }
        } catch (e) {
          console.warn("Error parsing additional photos:", e);
        }
        setTempPhotos([primaryPhoto, ...additional].filter(Boolean));
      } else {
        setTempPhotos([]);
      }
    } else {
      // Clear state on close
      setPrice("");
      setIsShipping(false);
      setTempPhotos([]);
      setError(null);
    }
  }, [isOpen, item]);

  if (!isOpen || !item) return null;

  const handleUploadPhoto = async (e) => {
    const file = e.target.files[0];
    if (file) {
      try {
        const compressed = await compressImage(file);
        setTempPhotos((prev) => [...prev, compressed]);
      } catch (err) {
        console.error("Error compressing image:", err);
        setError("Failed to compress and upload image.");
      }
    }
  };

  const handleDeletePhoto = (idx) => {
    setTempPhotos((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSave = async (e) => {
    if (e) e.preventDefault();
    if (!price || isNaN(price) || Number(price) <= 0) {
      setError("Please specify a valid price greater than zero.");
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      const priceCentsUSD = Math.round(parseFloat(price) * 100);
      // Shipping is buyer-paid and quoted live at checkout — always 0 here.
      const shippingFeeCents = 0;

      // Call relayer update function
      const result = await relayUpdateListing({
        tokenId: item.tokenId,
        listingId: item.listingId,
        isBatch: item.isBatch,
        priceCentsUSD,
        shippingFeeCents,
        priceUsd: parseFloat(price).toFixed(2),
        isShipping,
      });

      if (!result.success) {
        throw new Error(result.error || "Update failed");
      }

      // Persist photos to localStorage for single specimens
      if (!item.isBatch) {
        const tokenId = item.tokenId;
        if (tempPhotos.length === 0) {
          localStorage.removeItem(`aquadex_specimen_photo_${tokenId}`);
          localStorage.removeItem(`aquadex_specimen_photos_${tokenId}`);
        } else {
          localStorage.setItem(`aquadex_specimen_photo_${tokenId}`, tempPhotos[0]);
          localStorage.setItem(`aquadex_specimen_photos_${tokenId}`, JSON.stringify(tempPhotos.slice(1)));

          // Upload primary photo to cloud storage (non-blocking)
          uploadSpecimenPhoto(tempPhotos[0], item.seller || "", tokenId)
            .then((result) => {
              if (result.success && result.url) {
                // Store cloud URL for cross-device access
                localStorage.setItem(`aquadex_specimen_photo_url_${tokenId}`, result.url);
              }
            })
            .catch(() => { /* localStorage fallback is fine */ });
        }
      }

      // Re-sync listing to cloud so photos are visible to other users
      try {
        const { db } = await import("../db");
        const listing = await db.localListings.get(Number(item.tokenId || item.listingId));
        if (listing) {
          syncListingToCloud(listing).catch(() => {});
        }
      } catch (e) { /* non-critical */ }

      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      console.error("Listing update failed:", err);
      setError(err.message || "Failed to update listing.");
    } finally {
      setSubmitting(false);
    }
  };

  const matchedPhotoFallback = getSpecimenPhotoUrl(item.commonName);
  const pedigreeLabel = item.isBatch 
    ? "Batch Fry Stock" 
    : (Number(item.sireId || 0) === 0 && Number(item.damId || 0) === 0)
      ? "Wild Caught"
      : ((Number(item.sireId || 0) !== 0 && Number(item.damId || 0) === 0) || (Number(item.sireId || 0) === 0 && Number(item.damId || 0) !== 0))
        ? "Ancestral F1"
        : "Purebred Pedigree";

  const pedigreeClass = item.isBatch 
    ? "pedigree-f1"
    : (Number(item.sireId || 0) === 0 && Number(item.damId || 0) === 0)
      ? "pedigree-wild"
      : "pedigree-purebred";

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel="Edit Directory Listing"
      className="sliding-drawer-content"
      fullScreenMobile={true}
    >
      <button 
        onClick={onClose} 
        style={{
          position: "absolute",
          top: "1.5rem",
          right: "1.5rem",
          background: "none",
          border: "none",
          color: "var(--text-muted)",
          fontSize: "1.75rem",
          cursor: "pointer",
          zIndex: 10
        }}
      >
        &times;
      </button>

      <h3 style={{ fontSize: "1.5rem", color: "#fff", marginTop: "1rem" }}>
        Edit Listing
      </h3>
      <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
        Modify pricing, shipping status, and media for your directory entry.
      </p>

      {error && (
        <div style={{
          padding: "0.75rem",
          backgroundColor: "rgba(248, 113, 113, 0.08)",
          border: "1px solid rgba(248, 113, 113, 0.2)",
          color: "var(--accent-red)",
          borderRadius: "4px",
          fontSize: "0.8rem",
          marginBottom: "1rem"
        }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem", marginTop: "1rem" }}>
        {/* Specimen Info Card Preview */}
        <div className={`registry-cert-card ${pedigreeClass}`} style={{ marginBottom: "0.5rem" }}>
          <img 
            src={tempPhotos[0] || matchedPhotoFallback} 
            alt={item.commonName} 
            className="registry-cert-img" 
            onError={(e) => {
              e.target.src = "https://images.unsplash.com/photo-1522069169874-c58ec4b76be5?auto=format&fit=crop&w=150&h=150&q=80";
            }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem", flex: 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "0.6rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: "600" }}>
                {item.isBatch ? "Batch Fry Details" : "Specimen Registry"}
              </span>
              <span className={`badge ${pedigreeClass === "pedigree-wild" ? "badge-amber" : pedigreeClass === "pedigree-f1" ? "badge-blue" : "badge-green"}`} style={{ fontSize: "0.55rem" }}>
                {pedigreeLabel}
              </span>
            </div>
            <strong style={{ color: "#fff", fontSize: "0.95rem" }}>{item.commonName}</strong>
            <span style={{ fontSize: "0.7rem", fontStyle: "italic", color: "var(--text-secondary)" }}>
              {item.scientificName}
            </span>
            <div style={{ display: "flex", gap: "0.35rem", marginTop: "0.25rem", alignItems: "center" }}>
              <span style={{ fontSize: "0.55rem", padding: "0.1rem 0.35rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", borderRadius: "4px", color: "var(--text-muted)", fontFamily: "monospace" }}>
                {item.isBatch ? `BATCH #${item.listingId}` : `CERT #${item.tokenId.toString().padStart(3, "0")}`}
              </span>
            </div>
          </div>
        </div>

        {/* Specimen Media/Photos (only for single listings) */}
        {!item.isBatch && (
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
              Listing Photos (Primary is first)
            </label>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
              {tempPhotos.map((photo, idx) => (
                <div key={idx} style={{ position: "relative", width: "75px", height: "75px", borderRadius: "6px", overflow: "hidden", border: "1px solid var(--glass-border)" }}>
                  <img src={photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  <button
                    type="button"
                    onClick={() => handleDeletePhoto(idx)}
                    style={{
                      position: "absolute",
                      top: "2px",
                      right: "2px",
                      background: "rgba(239, 68, 68, 0.9)",
                      color: "#fff",
                      border: "none",
                      borderRadius: "50%",
                      width: "18px",
                      height: "18px",
                      fontSize: "12px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: "bold",
                      lineHeight: "1"
                    }}
                  >
                    &times;
                  </button>
                </div>
              ))}
              {tempPhotos.length < 5 && (
                <label style={{
                  width: "75px",
                  height: "75px",
                  borderRadius: "6px",
                  border: "1px dashed var(--glass-border)",
                  background: "rgba(255, 255, 255, 0.02)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  fontSize: "0.65rem",
                  color: "var(--text-muted)",
                  textAlign: "center"
                }}>
                  <span style={{ fontSize: "1.2rem", marginBottom: "2px" }}>+</span>
                  <span>Add Photo</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleUploadPhoto}
                    style={{ display: "none" }}
                  />
                </label>
              )}
            </div>
          </div>
        )}

        {/* Delivery Method selector */}
        <div>
          <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.25rem" }}>
            Delivery Method
          </label>
          <div className="delivery-tile-group">
            <div 
              className={`delivery-tile ${!isShipping ? "active" : ""}`}
              onClick={() => setIsShipping(false)}
            >
              <span className="delivery-tile-icon">📍</span>
              <span className="delivery-tile-label">Local Pickup Only</span>
            </div>
            <div 
              className={`delivery-tile ${isShipping ? "active" : ""}`}
              onClick={() => setIsShipping(true)}
            >
              <span className="delivery-tile-icon">🚚</span>
              <span className="delivery-tile-label">Shipping Available</span>
            </div>
          </div>
        </div>

        {/* Price Fields */}
        <div>
          <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
            {item.isBatch ? "Price per fish ($)" : "Exchange Price ($)"}
          </label>
          <input 
            type="number"
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="e.g. 50.00"
            required
            style={{ width: "100%", padding: "0.65rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px", outline: "none" }}
          />
        </div>

        {/* Shipping is buyer-paid at checkout via live ShipEngine rates —
            sellers don't set a flat fee. Just a heads-up here. */}
        {isShipping && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", padding: "0.65rem 0.75rem", background: "rgba(56,189,248,0.05)", border: "1px solid rgba(56,189,248,0.15)", borderRadius: "6px" }}>
            <span style={{ fontSize: "0.9rem" }}>🚚</span>
            <span style={{ fontSize: "0.7rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
              Shipping is quoted live at checkout based on the buyer's address — you don't set a fee.
            </span>
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: "flex", gap: "0.75rem", marginTop: "1rem" }}>
          <button 
            type="button" 
            className="btn-secondary" 
            style={{ flex: 1, justifyContent: "center" }}
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button 
            type="button" 
            className="btn-primary-pro" 
            style={{ flex: 1, justifyContent: "center" }}
            onClick={handleSave}
            disabled={submitting}
          >
            {submitting ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
