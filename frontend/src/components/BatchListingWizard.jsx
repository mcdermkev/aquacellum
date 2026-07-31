import React, { useState, useEffect } from "react";
import { Modal } from "./Modal";
import { db } from "../db";
import { addXp, XP_ACTIONS } from "../utils/xp";
import { syncListingToCloud } from "../services/cloudSync";
import { loadSpeciesCareLookup, deriveCareFields } from "../utils/speciesCarePrefill";
import {
  LIFE_STAGE,
  LIFE_STAGE_COPY,
  LIFE_STAGE_OPTIONS,
  lifeStageOptionLabel,
  requiresCohort,
} from "../utils/lifeStage";
import { attachPedigreeToListing, sealLotPedigree } from "../services/listingPedigree";

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
  // Default to shipping — reaches the most buyers; sellers can switch to local
  // pickup (fee-free at live events). Shipping itself is buyer-paid and quoted
  // live at checkout — no flat fee to set here.
  const [isShipping, setIsShipping] = useState(true);
  const [description, setDescription] = useState("");
  const [carePrefilled, setCarePrefilled] = useState(false);

  // Enhanced batch listing fields
  // Life stage is the structured field that `age`/`size` never were: those are free
  // text ("4 weeks", "0.75 inches"), so nothing could tell an egg from a juvenile —
  // which is what §4.2's certificate-vs-cohort rule needs to read. Defaults to Fry
  // because this wizard sells fry batches; a seller listing eggs must say so.
  const [lifeStage, setLifeStage] = useState(LIFE_STAGE.FRY);
  const [fryAge, setFryAge] = useState("");
  const [fryAgeUnit, setFryAgeUnit] = useState("weeks");
  const [frySize, setFrySize] = useState("");
  const [careLevel, setCareLevel] = useState(0);
  const [minTemp, setMinTemp] = useState("");
  const [maxTemp, setMaxTemp] = useState("");
  const [minPh, setMinPh] = useState("");
  const [maxPh, setMaxPh] = useState("");
  const [tankSizeMin, setTankSizeMin] = useState("");
  const [healthStatus, setHealthStatus] = useState("healthy");
  const [doaGuarantee, setDoaGuarantee] = useState(true);
  const [diet, setDiet] = useState("");

  // Reset on close
  useEffect(() => {
    if (!isOpen) {
      setStep(1);
      setSelectedSpawn(null);
      setQuantity("");
      setPricePerFish("");
      setIsShipping(true);
      setDescription("");
      setError(null);
      setCarePrefilled(false);
      // Reset enhanced fields
      setLifeStage(LIFE_STAGE.FRY);
      setFryAge("");
      setFryAgeUnit("weeks");
      setFrySize("");
      setCareLevel(0);
      setMinTemp("");
      setMaxTemp("");
      setMinPh("");
      setMaxPh("");
      setTankSizeMin("");
      setHealthStatus("healthy");
      setDoaGuarantee(true);
      setDiet("");
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

  const handleSelectSpawn = async (spawn) => {
    setSelectedSpawn(spawn);
    setStep(2);

    // Reuse what the fry already are: pre-fill species-level care fields from
    // reference data. Only fills EMPTY fields so any seller edits stick.
    if (spawn?.scientificName) {
      try {
        const lookup = await loadSpeciesCareLookup();
        const care = deriveCareFields(spawn.scientificName, lookup);
        if (care) {
          let filledAny = false;
          if (care.minTemp) { setMinTemp((v) => v || care.minTemp); filledAny = true; }
          if (care.maxTemp) { setMaxTemp((v) => v || care.maxTemp); filledAny = true; }
          if (care.minPh) { setMinPh((v) => v || care.minPh); filledAny = true; }
          if (care.maxPh) { setMaxPh((v) => v || care.maxPh); filledAny = true; }
          if (care.tankSizeMin) { setTankSizeMin((v) => v || care.tankSizeMin); filledAny = true; }
          if (care.careLevel != null) setCareLevel(care.careLevel);
          if (filledAny) setCarePrefilled(true);
        }
      } catch (e) { /* prefill is best-effort */ }
    }
  };

  const handleSubmit = async () => {
    if (!selectedSpawn) { setError("No spawn selected."); return; }
    if (!quantity || Number(quantity) <= 0) { setError("Please enter a valid quantity."); return; }
    if (!pricePerFish || Number(pricePerFish) <= 0) { setError("Please enter a valid price per fish."); return; }

    setError(null);
    setSubmitting(true);

    try {
      const listingId = Date.now();
      // USD is canonical (Web2-masked marketplace). Store dollars for display and
      // cents for Stripe checkout. Shipping itself is buyer-paid and quoted live
      // at checkout (ShipEngine) — sellers never set a flat shipping fee.
      const priceUsd = parseFloat(pricePerFish).toFixed(2);
      const shippingUsd = "0.00";
      const priceCentsUSD = Math.round(parseFloat(pricePerFish) * 100);
      const shippingFeeCents = 0;

      const listing = {
        id: listingId,
        listingId,
        spawnId: selectedSpawn.spawnId,
        quantity: Number(quantity),
        price: priceUsd,
        priceUsd,
        priceCentsUSD,
        rawPrice: priceUsd,
        shippingFee: shippingUsd,
        shippingFeeCents,
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
        // Structured stage, plus the free-text detail it does NOT replace. `age` and
        // `size` remain useful to a buyer; they just can't be reasoned about.
        lifeStage,
        age: fryAge ? `${fryAge} ${fryAgeUnit}` : "",
        size: frySize ? `${frySize} inches` : "",
        diet: diet || "",
        careLevel: Number(careLevel),
        minTemp: minTemp ? Number(minTemp) : 0,
        maxTemp: maxTemp ? Number(maxTemp) : 0,
        minPh: minPh ? Number(minPh) : 0,
        maxPh: maxPh ? Number(maxPh) : 0,
        tankSizeMin: tankSizeMin ? Number(tankSizeMin) : 0,
        healthStatus: healthStatus || "healthy",
        doaGuarantee: !!doaGuarantee,
        createdAt: Math.floor(Date.now() / 1000),
      };

      // ── Seal the pedigree, here, on the seller's device ────────────────────
      // This is the moment it CAN be sealed. Settlement happens later in a
      // server-side Stripe webhook, and the pedigree lives in this browser's Dexie
      // (§3), so there is no later point where it is readable (§9.30). Listing time
      // is when the spawn, its parents, and its grandparents are all resolvable.
      //
      // It rides on the listing: `aquadex_listings.data` is a jsonb blob of the whole
      // listing object, so this reaches buyers with no migration.
      //
      // Non-blocking on purpose. A listing that fails to seal is a listing without a
      // published pedigree — which the trust ladder reports honestly — and that is far
      // better than refusing to let a breeder sell.
      let listingWithPedigree = listing;
      try {
        const sealed = await sealLotPedigree({
          spawnId: selectedSpawn.spawnId,
          issuer: walletAccount,
        });
        // The ancestor documents ride along too, so a buyer can VERIFY the chain
        // rather than only read the root's claims (§9.31).
        listingWithPedigree = attachPedigreeToListing(
          listing,
          sealed.ok ? sealed.document : null,
          sealed.ok ? sealed.chain : []
        );
      } catch (pedigreeErr) {
        console.warn("Pedigree sealing failed; listing without one:", pedigreeErr);
        listingWithPedigree = attachPedigreeToListing(listing, null);
      }

      // Save locally
      await db.localListings.put(listingWithPedigree);
      try { await db.listings.put(listingWithPedigree); } catch (e) { /* non-critical */ }

      // Sync to cloud for cross-user visibility
      syncListingToCloud(listingWithPedigree).catch(() => {});

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
                <span style={{ fontSize: "0.55rem", color: "#34d399", fontWeight: 600 }}>Recommended · reaches the most buyers</span>
              </div>
            </div>
            <p style={{ fontSize: "0.65rem", color: "var(--text-muted)", margin: "0.4rem 0 0" }}>
              Tip: local pickup is fee-free during live events.
            </p>
          </div>

          {/* Shipping is buyer-paid at checkout via live ShipEngine rates —
              sellers don't set a flat fee. Just a heads-up here. */}
          {isShipping && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", padding: "0.65rem 0.75rem", background: "rgba(56,189,248,0.05)", border: "1px solid rgba(56,189,248,0.15)", borderRadius: "6px" }}>
              <span style={{ fontSize: "0.9rem" }}>🚚</span>
              <span style={{ fontSize: "0.7rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                Shipping is quoted live at checkout based on the buyer's address — you don't set a fee. Add your ship-from address in Settings so buyers can get accurate rates.
              </span>
            </div>
          )}

          {/* Description */}
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
              Description / Seller Notes
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Active, eating well, growing fast. Parents are proven breeders with vibrant coloration..."
              rows={3}
              maxLength={500}
              style={{ width: "100%", padding: "0.65rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "6px", outline: "none", resize: "vertical", fontFamily: "inherit", fontSize: "0.85rem" }}
            />
            <span style={{ fontSize: "0.6rem", color: "var(--text-muted)", float: "right" }}>{description.length}/500</span>
          </div>

          {/* --- Enhanced Fry Details Section --- */}
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "1rem", marginTop: "0.25rem" }}>
            <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: "600", letterSpacing: "0.04em" }}>
              Fry Details (helps buyers decide)
            </span>
            {carePrefilled && (
              <div style={{ fontSize: "0.65rem", color: "#34d399", marginTop: "0.35rem" }}>
                ✨ Prefilled from {selectedSpawn.commonName} care data — edit anything.
              </div>
            )}
          </div>

          {/* Life stage — the structured field. `age` and `size` below stay as
              free-text detail, but they cannot answer "is this an egg?", and §4.2's
              rule (eggs and fry are counts, not certificates) needs an answer. */}
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
              {LIFE_STAGE_COPY.stageLabel.pro}
            </label>
            <select
              value={lifeStage}
              onChange={(e) => setLifeStage(e.target.value)}
              style={{ width: "100%", padding: "0.65rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "6px", outline: "none" }}
            >
              {LIFE_STAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {lifeStageOptionLabel(option)}
                </option>
              ))}
            </select>

            {requiresCohort(lifeStage) && (
              <p style={{ fontSize: "0.68rem", color: "var(--text-muted)", margin: "0.4rem 0 0", lineHeight: 1.45 }}>
                {LIFE_STAGE_COPY.cohortOnly.pro}
              </p>
            )}

            {/* Selling eggs is a materially different transaction, and the risk
                belongs here rather than in a support conversation afterwards. */}
            {lifeStage === LIFE_STAGE.EGG && (
              <p style={{ fontSize: "0.68rem", color: "var(--accent-amber)", margin: "0.35rem 0 0", lineHeight: 1.45 }}>
                ⚠️ {LIFE_STAGE_COPY.hatchRisk.pro}
              </p>
            )}
          </div>

          {/* Age & Size Row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
                Fry Age
              </label>
              <div style={{ display: "flex", gap: "0.35rem" }}>
                <input
                  type="number"
                  min="0"
                  value={fryAge}
                  onChange={(e) => setFryAge(e.target.value)}
                  placeholder="e.g. 4"
                  style={{ flex: 1, padding: "0.65rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "6px", outline: "none" }}
                />
                <select
                  value={fryAgeUnit}
                  onChange={(e) => setFryAgeUnit(e.target.value)}
                  style={{ padding: "0.5rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "6px", outline: "none", fontSize: "0.75rem" }}
                >
                  <option value="days">days</option>
                  <option value="weeks">wks</option>
                  <option value="months">mo</option>
                </select>
              </div>
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
                Current Size (inches)
              </label>
              <input
                type="number"
                step="0.25"
                min="0"
                value={frySize}
                onChange={(e) => setFrySize(e.target.value)}
                placeholder="e.g. 0.75"
                style={{ width: "100%", padding: "0.65rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "6px", outline: "none" }}
              />
            </div>
          </div>

          {/* Diet */}
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
              Current Diet
            </label>
            <input
              type="text"
              value={diet}
              onChange={(e) => setDiet(e.target.value)}
              placeholder="e.g. Baby brine shrimp, crushed flake"
              style={{ width: "100%", padding: "0.65rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "6px", outline: "none" }}
            />
          </div>

          {/* Care Level */}
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
              Care Level
            </label>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              {[
                { val: 0, label: "Beginner", icon: "✨", color: "rgba(34,211,238,0.15)", border: "rgba(34,211,238,0.4)" },
                { val: 1, label: "Intermediate", icon: "⚡", color: "rgba(251,191,36,0.15)", border: "rgba(251,191,36,0.4)" },
                { val: 2, label: "Advanced", icon: "🔥", color: "rgba(248,113,113,0.15)", border: "rgba(248,113,113,0.4)" },
              ].map(({ val, label, icon, color, border }) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setCareLevel(val)}
                  style={{
                    flex: 1, padding: "0.5rem 0.25rem", borderRadius: "6px", cursor: "pointer",
                    background: careLevel === val ? color : "rgba(255,255,255,0.02)",
                    border: `1px solid ${careLevel === val ? border : "var(--glass-border)"}`,
                    color: careLevel === val ? "#fff" : "var(--text-muted)",
                    fontSize: "0.7rem", fontWeight: careLevel === val ? "600" : "400",
                    transition: "all 0.15s ease", textAlign: "center"
                  }}
                >
                  {icon} {label}
                </button>
              ))}
            </div>
          </div>

          {/* Water Parameters */}
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
              Water Parameters (recommended)
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.5rem" }}>
              <div>
                <span style={{ fontSize: "0.6rem", color: "var(--text-muted)", display: "block", marginBottom: "0.2rem" }}>Temp (°F)</span>
                <div style={{ display: "flex", gap: "0.2rem", alignItems: "center" }}>
                  <input type="number" value={minTemp} onChange={(e) => setMinTemp(e.target.value)} placeholder="72" style={{ width: "100%", padding: "0.45rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px", outline: "none", fontSize: "0.75rem" }} />
                  <span style={{ color: "var(--text-muted)", fontSize: "0.7rem" }}>-</span>
                  <input type="number" value={maxTemp} onChange={(e) => setMaxTemp(e.target.value)} placeholder="82" style={{ width: "100%", padding: "0.45rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px", outline: "none", fontSize: "0.75rem" }} />
                </div>
              </div>
              <div>
                <span style={{ fontSize: "0.6rem", color: "var(--text-muted)", display: "block", marginBottom: "0.2rem" }}>pH</span>
                <div style={{ display: "flex", gap: "0.2rem", alignItems: "center" }}>
                  <input type="number" step="0.1" value={minPh} onChange={(e) => setMinPh(e.target.value)} placeholder="6.5" style={{ width: "100%", padding: "0.45rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px", outline: "none", fontSize: "0.75rem" }} />
                  <span style={{ color: "var(--text-muted)", fontSize: "0.7rem" }}>-</span>
                  <input type="number" step="0.1" value={maxPh} onChange={(e) => setMaxPh(e.target.value)} placeholder="7.5" style={{ width: "100%", padding: "0.45rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px", outline: "none", fontSize: "0.75rem" }} />
                </div>
              </div>
              <div>
                <span style={{ fontSize: "0.6rem", color: "var(--text-muted)", display: "block", marginBottom: "0.2rem" }}>Min Tank (gal)</span>
                <input type="number" value={tankSizeMin} onChange={(e) => setTankSizeMin(e.target.value)} placeholder="10" style={{ width: "100%", padding: "0.45rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px", outline: "none", fontSize: "0.75rem" }} />
              </div>
            </div>
          </div>

          {/* Health & DOA Guarantee */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
                Health Status
              </label>
              <select
                value={healthStatus}
                onChange={(e) => setHealthStatus(e.target.value)}
                style={{ width: "100%", padding: "0.65rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "6px", outline: "none" }}
              >
                <option value="healthy">Healthy — No Issues</option>
                <option value="treated">Recently Treated</option>
                <option value="quarantine">In Quarantine</option>
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
                DOA Guarantee
              </label>
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.2rem" }}>
                <button
                  type="button"
                  onClick={() => setDoaGuarantee(true)}
                  style={{
                    flex: 1, padding: "0.5rem", borderRadius: "6px", cursor: "pointer",
                    background: doaGuarantee ? "rgba(34,197,94,0.12)" : "rgba(255,255,255,0.02)",
                    border: `1px solid ${doaGuarantee ? "rgba(34,197,94,0.4)" : "var(--glass-border)"}`,
                    color: doaGuarantee ? "#34d399" : "var(--text-muted)",
                    fontSize: "0.7rem", fontWeight: doaGuarantee ? "600" : "400"
                  }}
                >
                  ✓ Yes
                </button>
                <button
                  type="button"
                  onClick={() => setDoaGuarantee(false)}
                  style={{
                    flex: 1, padding: "0.5rem", borderRadius: "6px", cursor: "pointer",
                    background: !doaGuarantee ? "rgba(248,113,113,0.12)" : "rgba(255,255,255,0.02)",
                    border: `1px solid ${!doaGuarantee ? "rgba(248,113,113,0.4)" : "var(--glass-border)"}`,
                    color: !doaGuarantee ? "#f87171" : "var(--text-muted)",
                    fontSize: "0.7rem", fontWeight: !doaGuarantee ? "600" : "400"
                  }}
                >
                  ✕ No
                </button>
              </div>
            </div>
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
