import React, { useState, useEffect } from "react";
import { Modal } from "./Modal";
import { db } from "../db";
import { addXp, XP_ACTIONS } from "../utils/xp";
import { syncListingToCloud } from "../services/cloudSync";

/**
 * BatchListingWizard — Guided form for sellers to list fry batches for sale.
 *
 * Steps:
 *   1. Select a spawn event (from their local spawn records)
 *   2. Set quantity available, price per fish, and delivery method
 *   3. Confirm and create listing
 *
 * Props:
 *   isOpen, onClose, walletAccount, onSuccess
 */
export function BatchListingWizard({ isOpen, onClose, walletAccount, onSuccess }) {
  const [step, setStep] = useState(1);
  const [spawns, setSpawns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [selectedSpawn, setSelectedSpawn] = useState(null);
  const [quantity, setQuantity] = useState("");
  const [pricePerFish, setPricePerFish] = useState("");
  const [isShipping, setIsShipping] = useState(false);
  const [shippingFee, setShippingFee] = useState("5.00");
  const [description, setDescription] = useState("");

  // Reset on close
  useEffect(() => {
    if (!isOpen) {
      setStep(1);
      setSelectedSpawn(null);
      setQuantity("");
      setPricePerFish("");
      setIsShipping(false);
      setShippingFee("5.00");
      setDescription("");
      setError(null);
    }
  }, [isOpen]);

  // Load spawns
  useEffect(() => {
    if (!isOpen || !walletAccount) return;
    setLoading(true);

    (async () => {
      try {
        const allSpawns = await db.spawns.toArray();
        const userSpawns = allSpawns.filter(
          (s) => (s.ownerAddress || "").toLowerCase() === walletAccount.toLowerCase()
        );
        // Sort newest first
        userSpawns.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        // Enrich with species info
        const enriched = [];
        for (const spawn of userSpawns) {
          let commonName = "Unknown Species";
          let scientificName = "";
          try {
            const species = await db.species.get(Number(spawn.speciesId));
            if (species) {
              commonName = species.commonName || commonName;
              scientificName = species.scientificName || "";
            }
          } catch (e) { /* skip */ }
          enriched.push({ ...spawn, commonName, scientificName });
        }

        setSpawns(enriched);
      } catch (e) {
        console.error("Failed to load spawns:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, [isOpen, walletAccount]);

  const handleSelectSpawn = (spawn) => {
    setSelectedSpawn(spawn);
    setStep(2);
  };

  const handleSubmit = async () => {
    if (!selectedSpawn) { setError("No spawn selected."); return; }
    if (!quantity || Number(quantity) <= 0) { setError("Please enter a valid quantity."); return; }
    if (!pricePerFish || Number(pricePerFish) <= 0) { setError("Please enter a valid price per fish."); return; }
    if (isShipping && (!shippingFee || Number(shippingFee) < 0)) { setError("Please enter a valid shipping fee."); return; }

    setError(null);
    setSubmitting(true);

    try {
      const listingId = Date.now();
      const priceEth = (parseFloat(pricePerFish) / 1000).toString();
      const shippingFeeEth = isShipping ? (parseFloat(shippingFee) / 1000).toString() : "0";

      const listing = {
        id: listingId,
        listingId,
        spawnId: selectedSpawn.spawnId,
        quantity: Number(quantity),
        price: priceEth,
        rawPrice: priceEth,
        shippingFee: shippingFeeEth,
        isShipping: !!isShipping,
        seller: walletAccount.toLowerCase(),
        speciesId: Number(selectedSpawn.speciesId),
        commonName: (selectedSpawn.commonName || "Fry") + " Fry Batch",
        scientificName: selectedSpawn.scientificName || "",
        sireId: Number(selectedSpawn.sireId || 0),
        damId: Number(selectedSpawn.damId || 0),
        isBatch: true,
        active: true,
        description: description || "",
        createdAt: Math.floor(Date.now() / 1000),
      };

      // Save locally
      await db.localListings.put(listing);
      try { await db.listings.put(listing); } catch (e) { /* non-critical */ }

      // Sync to cloud for cross-user visibility
      syncListingToCloud(listing).catch(() => {});

      // XP
      addXp(XP_ACTIONS.LIST_DIRECTORY?.points || 50, "Listed Batch Fry for Sale");

      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      console.error("Batch listing creation failed:", err);
      setError(err.message || "Failed to create batch listing.");
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return "Unknown date";
    const d = new Date(timestamp * 1000);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  const parseVal = parseFloat(pricePerFish) || 0;
  const qty = parseInt(quantity) || 0;
  const totalRevenue = parseVal * qty;
  const fee = totalRevenue * 0.04;
  const netPayout = totalRevenue - fee;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel="List Fry Batch for Sale"
      className="sliding-drawer-content"
      fullScreenMobile={true}
    >
      <button
        onClick={onClose}
        style={{
          position: "absolute", top: "1.5rem", right: "1.5rem",
          background: "none", border: "none", color: "var(--text-muted)",
          fontSize: "1.75rem", cursor: "pointer", zIndex: 10
        }}
      >
        &times;
      </button>

      <h3 style={{ fontSize: "1.5rem", color: "#fff", marginTop: "1rem" }}>
        List Fry Batch for Sale
      </h3>
      <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: "1.5rem" }}>
        Sell juveniles from your spawn events. Buyers can purchase individual fish from your batch.
      </p>

      {error && (
        <div style={{
          padding: "0.75rem",
          backgroundColor: "rgba(248, 113, 113, 0.08)",
          border: "1px solid rgba(248, 113, 113, 0.2)",
          color: "var(--accent-red)",
          borderRadius: "6px",
          fontSize: "0.8rem",
          marginBottom: "1rem"
        }}>
          {error}
        </div>
      )}

      {/* Step Progress */}
      <div className="listing-timeline" style={{ marginBottom: "1.5rem" }}>
        <div className="listing-timeline-line">
          <div
            className="listing-timeline-line-fill"
            style={{ width: step === 1 ? "0%" : step === 2 ? "50%" : "100%" }}
          />
        </div>
        <div className={`listing-timeline-node ${step >= 1 ? "completed" : ""}`}>
          <div className="listing-timeline-circle">{step > 1 ? "✓" : "1"}</div>
          <div className="listing-timeline-label">Select Spawn</div>
        </div>
        <div className={`listing-timeline-node ${step > 1 ? "completed" : step === 2 ? "active" : ""}`}>
          <div className="listing-timeline-circle">{step > 2 ? "✓" : "2"}</div>
          <div className="listing-timeline-label">Set Details</div>
        </div>
        <div className={`listing-timeline-node ${step === 3 ? "active" : ""}`}>
          <div className="listing-timeline-circle">3</div>
          <div className="listing-timeline-label">Confirm</div>
        </div>
      </div>

      {/* Step 1: Select Spawn */}
      {step === 1 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {loading ? (
            <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-muted)" }}>
              Loading your spawn records...
            </div>
          ) : spawns.length === 0 ? (
            <div style={{ textAlign: "center", padding: "2rem" }}>
              <span style={{ fontSize: "2rem", display: "block", marginBottom: "0.75rem" }}>🥚</span>
              <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
                No spawn events found. Log a spawn in Breeder Tools first, then come back to list the fry.
              </p>
            </div>
          ) : (
            spawns.map((spawn) => (
              <button
                key={spawn.spawnId}
                onClick={() => handleSelectSpawn(spawn)}
                style={{
                  display: "flex", alignItems: "center", gap: "1rem",
                  padding: "1rem", background: "rgba(255,255,255,0.02)",
                  border: "1px solid var(--glass-border)", borderRadius: "10px",
                  cursor: "pointer", transition: "all 0.2s ease",
                  textAlign: "left", width: "100%", color: "#fff"
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(139,92,246,0.4)"; e.currentTarget.style.background = "rgba(139,92,246,0.04)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--glass-border)"; e.currentTarget.style.background = "rgba(255,255,255,0.02)"; }}
              >
                <span style={{ fontSize: "1.5rem" }}>🐟</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: "600", fontSize: "0.9rem" }}>{spawn.commonName}</div>
                  <div style={{ fontSize: "0.72rem", fontStyle: "italic", color: "var(--text-secondary)" }}>
                    {spawn.scientificName}
                  </div>
                  <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>
                    Spawned {formatDate(spawn.timestamp)} • {spawn.offspringIds?.length || 0} offspring minted
                  </div>
                </div>
                <span style={{ color: "var(--text-muted)", fontSize: "1.2rem" }}>→</span>
              </button>
            ))
          )}
        </div>
      )}

      {/* Step 2: Set Details */}
      {step === 2 && selectedSpawn && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          {/* Selected spawn card */}
          <div style={{
            display: "flex", alignItems: "center", gap: "0.75rem",
            padding: "0.75rem", background: "rgba(139,92,246,0.04)",
            border: "1px solid rgba(139,92,246,0.15)", borderRadius: "8px"
          }}>
            <span style={{ fontSize: "1.2rem" }}>🐟</span>
            <div>
              <div style={{ fontWeight: "600", fontSize: "0.85rem", color: "#fff" }}>{selectedSpawn.commonName}</div>
              <div style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>Spawned {formatDate(selectedSpawn.timestamp)}</div>
            </div>
            <button
              onClick={() => setStep(1)}
              style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "0.75rem", textDecoration: "underline" }}
            >
              Change
            </button>
          </div>

          {/* Quantity */}
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
              Available Quantity (fry)
            </label>
            <input
              type="number"
              min="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="e.g. 50"
              style={{ width: "100%", padding: "0.65rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "6px", outline: "none" }}
            />
          </div>

          {/* Price per fish */}
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
              Price per Fish ($)
            </label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={pricePerFish}
              onChange={(e) => setPricePerFish(e.target.value)}
              placeholder="e.g. 3.50"
              style={{ width: "100%", padding: "0.65rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "6px", outline: "none" }}
            />
          </div>

          {/* Delivery method */}
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
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

          {/* Shipping fee */}
          {isShipping && (
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
                Shipping Fee ($)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={shippingFee}
                onChange={(e) => setShippingFee(e.target.value)}
                placeholder="e.g. 5.00"
                style={{ width: "100%", padding: "0.65rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "6px", outline: "none" }}
              />
            </div>
          )}

          {/* Description */}
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
              Notes (optional)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Age, size, feeding routine, health notes..."
              rows={3}
              style={{ width: "100%", padding: "0.65rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "6px", outline: "none", resize: "vertical", fontFamily: "inherit", fontSize: "0.85rem" }}
            />
          </div>

          {/* Revenue calculator */}
          {parseVal > 0 && qty > 0 && (
            <div className="receipt-ledger">
              <div className="receipt-row">
                <span>Batch Revenue ({qty} × ${parseVal.toFixed(2)}):</span>
                <span className="receipt-val-usd">${totalRevenue.toFixed(2)}</span>
              </div>
              <div className="receipt-row">
                <span>Marketplace Fee (4%):</span>
                <span className="receipt-val-usd" style={{ color: "var(--accent-red)" }}>-${fee.toFixed(2)}</span>
              </div>
              <div className="receipt-row total">
                <span>Est. Net Payout:</span>
                <span className="receipt-val-usd">${netPayout.toFixed(2)}</span>
              </div>
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
            <button
              onClick={() => setStep(1)}
              className="btn-secondary"
              style={{ flex: 1 }}
            >
              Back
            </button>
            <button
              onClick={handleSubmit}
              className="btn-primary-pro"
              disabled={submitting || !quantity || !pricePerFish}
              style={{ flex: 2, justifyContent: "center" }}
            >
              {submitting ? "Creating listing..." : "Create Batch Listing"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
