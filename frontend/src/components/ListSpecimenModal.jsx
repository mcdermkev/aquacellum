import React, { useState, useEffect } from "react";
import { ethers, Contract, parseEther } from "ethers";
import aquadexAbi from "../abi/AquadexManager.json";
import marketplaceAbi from "../abi/AquadexMarketplace.json";
import { addXp, XP_ACTIONS } from "../utils/xp";
import { getProvider } from "../utils/smartAccount";
import { relayCreateListing } from "../services/relayer";
import { db } from "../db";
import { Modal } from "./Modal";

const getSpecimenPhotoUrl = (commonName) => {
  if (!commonName) return "";
  const formatted = commonName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return `https://oexctbbybpfvslgxlscg.supabase.co/storage/v1/object/public/fish-photos/${formatted}.jpg?width=150&height=150&resize=contain&quality=80`;
};

export function ListSpecimenModal({ 
  isOpen, 
  onClose, 
  contractAddress, 
  marketplaceAddress, 
  walletAccount, 
  onSuccess,
  preselectedListSpecimen,
  preselectedListTank
}) {
  const [tokenId, setTokenId] = useState("");
  const [price, setPrice] = useState("");
  const [isShipping, setIsShipping] = useState(false);
  const [shippingFee, setShippingFee] = useState("5.00");
  const [step, setStep] = useState(1); // 1: Input/Check, 2: Approve, 3: List
  const [isApproved, setIsApproved] = useState(false);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [txHash, setTxHash] = useState(null);
  const [error, setError] = useState(null);
  const [specimenInfo, setSpecimenInfo] = useState(null);

  // Enhanced listing fields
  const [description, setDescription] = useState("");
  const [age, setAge] = useState("");
  const [ageUnit, setAgeUnit] = useState("months");
  const [size, setSize] = useState("");
  const [diet, setDiet] = useState("");
  const [temperament, setTemperament] = useState("");
  const [careLevel, setCareLevel] = useState(0); // 0=Beginner, 1=Intermediate, 2=Advanced
  const [minTemp, setMinTemp] = useState("");
  const [maxTemp, setMaxTemp] = useState("");
  const [minPh, setMinPh] = useState("");
  const [maxPh, setMaxPh] = useState("");
  const [tankSizeMin, setTankSizeMin] = useState("");
  const [healthStatus, setHealthStatus] = useState("healthy"); // healthy, treated, quarantine
  const [doaGuarantee, setDoaGuarantee] = useState(true);
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);

  useEffect(() => {
    if (!isOpen) {
      // Reset state on close
      setTokenId("");
      setPrice("");
      setIsShipping(false);
      setShippingFee("5.00");
      setStep(1);
      setIsApproved(false);
      setError(null);
      setSpecimenInfo(null);
      setTxHash(null);
      // Reset enhanced fields
      setDescription("");
      setAge("");
      setAgeUnit("months");
      setSize("");
      setDiet("");
      setTemperament("");
      setCareLevel(0);
      setMinTemp("");
      setMaxTemp("");
      setMinPh("");
      setMaxPh("");
      setTankSizeMin("");
      setHealthStatus("healthy");
      setDoaGuarantee(true);
      setPhotoFile(null);
      setPhotoPreview(null);
    }
  }, [isOpen]);

  const handlePhotoSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError("Photo must be under 5MB.");
      return;
    }
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onloadend = () => setPhotoPreview(reader.result);
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    if (isOpen && preselectedListSpecimen) {
      const tid = preselectedListSpecimen.id || preselectedListSpecimen.specimenId || preselectedListSpecimen.tokenId;
      if (tid && !isNaN(Number(tid))) {
        setTokenId(tid.toString());
        verifyToken(Number(tid));
      } else {
        setError("This specimen cannot be listed (batch pending individual registration).");
      }
    }
  }, [isOpen, preselectedListSpecimen]);


  const verifyToken = async (idToVerify) => {
    if (!idToVerify || isNaN(idToVerify)) {
      setError("Invalid specimen ID. Please enter a valid Certificate Serial No.");
      return;
    }

    setChecking(true);
    setError(null);
    setSpecimenInfo(null);

    try {
      const provider = getProvider();
      const contract = new Contract(contractAddress, aquadexAbi, provider);

      // Verify owner
      const owner = await contract.ownerOf(Number(idToVerify));
      if (owner.toLowerCase() !== walletAccount.toLowerCase()) {
        setError("You do not own this Certificate Serial No.");
        setChecking(false);
        return;
      }

      // Fetch Specimen Detail
      const data = await contract.specimens(Number(idToVerify));
      if (Number(data.specimenId) === 0) {
        setError("Certificate does not exist.");
        setChecking(false);
        return;
      }

      // Get Species Common Name
      const speciesInfo = await contract.speciesCatalog(Number(data.speciesId));

      setSpecimenInfo({
        id: Number(data.specimenId),
        speciesId: Number(data.speciesId),
        commonName: speciesInfo.commonName,
        scientificName: speciesInfo.scientificName,
        sireId: Number(data.sireId),
        damId: Number(data.damId),
      });

      // Check approval
      const approvedAddr = await contract.getApproved(Number(idToVerify));
      const approvedForMarket = approvedAddr.toLowerCase() === marketplaceAddress.toLowerCase();
      setIsApproved(approvedForMarket);

      if (approvedForMarket) {
        setStep(3); // Skip approval step
      } else {
        setStep(2); // Go to approval step
      }
    } catch (err) {
      // Beta fallback: check local-first specimens (Dexie) before failing
      try {
        const local = await db.specimens.get(Number(idToVerify));
        if (local && (local.ownerAddress || "").toLowerCase() === walletAccount.toLowerCase()) {
          setSpecimenInfo({
            id: local.id,
            speciesId: Number(local.speciesId),
            commonName: local.commonName,
            scientificName: local.scientificName,
            sireId: Number(local.sireId || 0),
            damId: Number(local.damId || 0),
          });
          setIsApproved(false);
          setStep(2);
          setChecking(false);
          return;
        }
      } catch (localErr) {
        console.warn("Local specimen lookup failed:", localErr);
      }
      console.error("Verification failed:", err);
      setError(err.reason || err.message || "Failed to verify birth certificate ownership.");
    } finally {
      setChecking(false);
    }
  };

  const verifyAndCheckApproval = async (e) => {
    if (e) e.preventDefault();
    if (!tokenId || isNaN(tokenId)) return;
    await verifyToken(Number(tokenId));
  };

  const handleApprove = async () => {
    setError(null);
    setSubmitting(true);
    setTxHash(null);

    try {
      // Beta: no on-chain ERC-721 approval needed for local-first listings.
      setIsApproved(true);
      setStep(3);
    } catch (err) {
      console.error("Approval failed:", err);
      setError(err.message || "Approval failed.");
    } finally {
      setSubmitting(false);
      setTxHash(null);
    }
  };

  const handleList = async () => {
    if (!price || isNaN(price) || Number(price) <= 0) {
      setError("Please specify a valid price greater than zero.");
      return;
    }
    if (isShipping && (!shippingFee || isNaN(shippingFee) || Number(shippingFee) < 0)) {
      setError("Please specify a valid shipping fee.");
      return;
    }

    setError(null);
    setSubmitting(true);
    setTxHash(null);

    try {
      // USD is the canonical price (this is a Web2-masked marketplace: buyers pay
      // dollars via Stripe). The seller enters dollars; store cents for Stripe.
      const priceCentsUSD = Math.round(parseFloat(price) * 100);
      const shippingFeeCents = isShipping ? Math.round(parseFloat(shippingFee) * 100) : 0;

      // Beta: store listing locally (no MetaMask, no gas)
      const result = await relayCreateListing({
        tokenId: Number(tokenId),
        priceCentsUSD,
        shippingFeeCents,
        priceUsd: parseFloat(price).toFixed(2),
        isShipping,
        seller: walletAccount,
        speciesId: specimenInfo?.speciesId || 0,
        commonName: specimenInfo?.commonName || "Specimen",
        scientificName: specimenInfo?.scientificName || "Unknown",
        sireId: specimenInfo?.sireId || 0,
        damId: specimenInfo?.damId || 0,
        // Enhanced listing details
        description: description.trim(),
        age: age ? `${age} ${ageUnit}` : "",
        size: size ? `${size} inches` : "",
        diet: diet.trim(),
        temperament: temperament.trim(),
        careLevel: Number(careLevel),
        minTemp: minTemp ? Number(minTemp) : 0,
        maxTemp: maxTemp ? Number(maxTemp) : 0,
        minPh: minPh ? Number(minPh) : 0,
        maxPh: maxPh ? Number(maxPh) : 0,
        tankSizeMin: tankSizeMin ? Number(tankSizeMin) : 0,
        healthStatus,
        doaGuarantee,
        photoDataUrl: photoPreview || "",
      });

      if (!result.success) {
        throw new Error(result.error || "Listing failed");
      }

      // Trigger XP Telemetry & Toast
      addXp(XP_ACTIONS.LIST_DIRECTORY?.points, XP_ACTIONS.LIST_DIRECTORY?.label);

      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      console.error("Listing failed:", err);
      setError(err.message || "Listing failed.");
    } finally {
      setSubmitting(false);
      setTxHash(null);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel="Publish Directory Entry"
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
          List Specimen for Sale
        </h3>
        <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
          List your verified specimen in the marketplace catalog. Other breeders will be able to discover and purchase it.
        </p>

        {error && (
          <div style={{
            padding: "0.75rem",
            backgroundColor: "rgba(248, 113, 113, 0.08)",
            border: "1px solid rgba(248, 113, 113, 0.2)",
            color: "var(--accent-red)",
            borderRadius: "4px",
            fontSize: "0.8rem"
          }}>
            {error}
          </div>
        )}

        {txHash && (
          <div style={{
            padding: "0.75rem",
            backgroundColor: "var(--accent-blue-glow)",
            border: "1px solid rgba(56, 189, 248, 0.2)",
            color: "var(--accent-blue)",
            borderRadius: "4px",
            fontSize: "0.8rem",
            wordBreak: "break-all"
          }}>
            <strong>Creating Listing:</strong> Syncing listing entry to directory catalog...
          </div>
        )}

        {step === 1 && (
          preselectedListSpecimen ? (
            <div style={{ textAlign: "center", padding: "2.5rem 1rem", display: "flex", flexDirection: "column", gap: "0.75rem", alignItems: "center" }}>
              <div style={{ width: "24px", height: "24px", border: "2px solid rgba(255,255,255,0.1)", borderTopColor: "var(--accent-blue)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
              <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                Retrieving registry certificate details...
              </span>
            </div>
          ) : (
            <form onSubmit={verifyAndCheckApproval} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.25rem" }}>
                  Certificate Serial No.
                </label>
                <input 
                  type="number"
                  value={tokenId}
                  onChange={(e) => setTokenId(e.target.value)}
                  placeholder="e.g. 001"
                  required
                  style={{ width: "100%", padding: "0.65rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px" }}
                />
              </div>
              <button 
                type="submit" 
                className="btn-primary-pro" 
                disabled={checking}
                style={{ justifyContent: "center" }}
              >
                {checking ? "Verifying Access..." : "Verify Ownership"}
              </button>
            </form>
          )
        )}


        {step > 1 && specimenInfo && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            
            {/* Step Progress Timeline */}
            <div className="listing-timeline">
              <div className="listing-timeline-line">
                <div 
                  className="listing-timeline-line-fill" 
                  style={{ width: step === 2 ? "0%" : step === 3 ? "50%" : "100%" }}
                />
              </div>
              <div className="listing-timeline-node completed">
                <div className="listing-timeline-circle">✓</div>
                <div className="listing-timeline-label">Verify</div>
              </div>
              <div className={`listing-timeline-node ${step === 2 ? "active" : "completed"}`}>
                <div className="listing-timeline-circle">{step > 2 ? "✓" : "2"}</div>
                <div className="listing-timeline-label">Confirm</div>
              </div>
              <div className={`listing-timeline-node ${step === 3 ? "active" : ""}`}>
                <div className="listing-timeline-circle">3</div>
                <div className="listing-timeline-label">List</div>
              </div>
            </div>


            {/* Digital Collector's Certificate Card */}
            {(() => {
              const sireId = Number(specimenInfo.sireId || 0);
              const damId = Number(specimenInfo.damId || 0);
              let pedigreeClass = "pedigree-wild";
              let pedigreeLabel = "Wild Caught";
              
              if (sireId === 0 && damId === 0) {
                pedigreeClass = "pedigree-wild";
                pedigreeLabel = "Wild Caught";
              } else if ((sireId !== 0 && damId === 0) || (sireId === 0 && damId !== 0)) {
                pedigreeClass = "pedigree-f1";
                pedigreeLabel = "Ancestral F1";
              } else {
                pedigreeClass = "pedigree-purebred";
                pedigreeLabel = "Purebred Pedigree";
              }

              const photoUrl = getSpecimenPhotoUrl(specimenInfo.commonName);

              return (
                <div className={`registry-cert-card ${pedigreeClass}`}>
                  <img 
                    src={photoUrl} 
                    alt={specimenInfo.commonName} 
                    className="registry-cert-img" 
                    onError={(e) => {
                      e.target.src = "https://images.unsplash.com/photo-1522069169874-c58ec4b76be5?auto=format&fit=crop&w=150&h=150&q=80";
                    }}
                  />
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem", flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: "0.6rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: "600" }}>
                        Verified Birth Certificate
                      </span>

                      <span className={`badge ${pedigreeClass === "pedigree-wild" ? "badge-amber" : pedigreeClass === "pedigree-f1" ? "badge-blue" : "badge-green"}`} style={{ fontSize: "0.55rem" }}>
                        {pedigreeLabel}
                      </span>
                    </div>
                    <strong style={{ color: "#fff", fontSize: "0.95rem" }}>{specimenInfo.commonName}</strong>
                    <span style={{ fontSize: "0.7rem", fontStyle: "italic", color: "var(--text-secondary)" }}>
                      {specimenInfo.scientificName}
                    </span>
                    <div style={{ display: "flex", gap: "0.35rem", marginTop: "0.25rem", alignItems: "center" }}>
                      <span style={{ fontSize: "0.55rem", padding: "0.1rem 0.35rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", borderRadius: "4px", color: "var(--text-muted)", fontFamily: "monospace" }}>
                        CERT #{specimenInfo.id.toString().padStart(3, "0")}
                      </span>
                      {sireId > 0 && (
                        <span style={{ fontSize: "0.55rem", padding: "0.1rem 0.35rem", background: "rgba(56,189,248,0.06)", border: "1px solid rgba(56,189,248,0.15)", borderRadius: "4px", color: "var(--accent-blue)" }}>
                          Sire: #{sireId}
                        </span>
                      )}
                      {damId > 0 && (
                        <span style={{ fontSize: "0.55rem", padding: "0.1rem 0.35rem", background: "rgba(244,63,94,0.06)", border: "1px solid rgba(244,63,94,0.15)", borderRadius: "4px", color: "#fda4af" }}>
                          Dam: #{damId}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Step 2 Render */}
            {step === 2 && (
              <div>
                <p style={{ fontSize: "0.825rem", color: "var(--text-secondary)", marginBottom: "1rem" }}>
                  <strong>Step 2 of 3: Confirm Listing Rights</strong><br />
                  Confirm your permission to list this specimen certificate in the public directory catalog.
                </p>
                <button 
                  onClick={handleApprove} 
                  className="btn-primary-pro" 
                  disabled={submitting}
                  style={{ width: "100%", justifyContent: "center" }}
                >
                  {submitting ? "Confirming..." : "Confirm Listing Rights"}
                </button>

              </div>
            )}

            {/* Step 3 Render */}
            {step === 3 && (() => {
              const sireId = Number(specimenInfo.sireId || 0);
              const damId = Number(specimenInfo.damId || 0);
              let globalAvg = "$50.00";
              let lineageVal = "$48.00";

              if (sireId === 0 && damId === 0) {
                globalAvg = "$35.00";
                lineageVal = "$32.00";
              } else if ((sireId !== 0 && damId === 0) || (sireId === 0 && damId !== 0)) {
                globalAvg = "$50.00";
                lineageVal = "$48.00";
              } else {
                globalAvg = "$75.00";
                lineageVal = "$72.00";
              }

              const parseVal = parseFloat(price) || 0;
              const feeVal = parseVal * 0.04;
              const payoutVal = Math.max(0, parseVal - feeVal);

              const maxScale = parseFloat(globalAvg.replace("$", "")) * 2;
              const markerPercent = Math.min(100, Math.max(0, (parseVal / maxScale) * 100));

              return (
                <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
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

                  {/* Price fields */}
                  <div>
                    <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
                      Price per fish ($)
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

                  {/* Shipping Fee field if shipping is enabled */}
                  {isShipping && (
                    <div>
                      <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
                        Shipping Fee ($)
                      </label>
                      <input 
                        type="number"
                        step="0.01"
                        value={shippingFee}
                        onChange={(e) => setShippingFee(e.target.value)}
                        placeholder="e.g. 5.00"
                        required
                        style={{ width: "100%", padding: "0.65rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px", outline: "none" }}
                      />
                    </div>
                  )}

                  {/* --- Enhanced Listing Details Section --- */}
                  <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "1rem", marginTop: "0.5rem" }}>
                    <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: "600", letterSpacing: "0.04em" }}>
                      Specimen Details (helps buyers decide)
                    </span>
                  </div>

                  {/* Photo Upload */}
                  <div>
                    <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
                      Specimen Photo
                    </label>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                      {photoPreview ? (
                        <div style={{ position: "relative" }}>
                          <img
                            src={photoPreview}
                            alt="Specimen preview"
                            style={{ width: "64px", height: "64px", borderRadius: "8px", objectFit: "cover", border: "1px solid var(--glass-border)" }}
                          />
                          <button
                            type="button"
                            onClick={() => { setPhotoFile(null); setPhotoPreview(null); }}
                            style={{ position: "absolute", top: "-6px", right: "-6px", width: "18px", height: "18px", borderRadius: "50%", background: "rgba(248,113,113,0.9)", border: "none", color: "#fff", fontSize: "0.6rem", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <label style={{
                          width: "64px", height: "64px", borderRadius: "8px",
                          border: "2px dashed var(--glass-border)", cursor: "pointer",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          flexDirection: "column", gap: "0.15rem",
                          background: "rgba(255,255,255,0.02)", transition: "border-color 0.2s"
                        }}>
                          <span style={{ fontSize: "1.2rem" }}>📷</span>
                          <span style={{ fontSize: "0.55rem", color: "var(--text-muted)" }}>Add</span>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={handlePhotoSelect}
                            style={{ display: "none" }}
                          />
                        </label>
                      )}
                      <span style={{ fontSize: "0.68rem", color: "var(--text-muted)", maxWidth: "180px" }}>
                        Upload a clear photo of this specific fish. Max 5MB.
                      </span>
                    </div>
                  </div>

                  {/* Description */}
                  <div>
                    <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
                      Description / Seller Notes
                    </label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="e.g. Beautiful coloration, eats pellets eagerly, peaceful in community tank..."
                      rows={3}
                      maxLength={500}
                      style={{ width: "100%", padding: "0.65rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "6px", outline: "none", resize: "vertical", fontSize: "0.8rem", fontFamily: "inherit" }}
                    />
                    <span style={{ fontSize: "0.6rem", color: "var(--text-muted)", float: "right" }}>{description.length}/500</span>
                  </div>

                  {/* Age & Size Row */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                    <div>
                      <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
                        Age
                      </label>
                      <div style={{ display: "flex", gap: "0.35rem" }}>
                        <input
                          type="number"
                          min="0"
                          value={age}
                          onChange={(e) => setAge(e.target.value)}
                          placeholder="e.g. 6"
                          style={{ flex: 1, padding: "0.65rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "6px", outline: "none" }}
                        />
                        <select
                          value={ageUnit}
                          onChange={(e) => setAgeUnit(e.target.value)}
                          style={{ padding: "0.5rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "6px", outline: "none", fontSize: "0.75rem" }}
                        >
                          <option value="weeks">wks</option>
                          <option value="months">mo</option>
                          <option value="years">yr</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
                        Size (inches)
                      </label>
                      <input
                        type="number"
                        step="0.25"
                        min="0"
                        value={size}
                        onChange={(e) => setSize(e.target.value)}
                        placeholder="e.g. 3.5"
                        style={{ width: "100%", padding: "0.65rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "6px", outline: "none" }}
                      />
                    </div>
                  </div>

                  {/* Diet & Temperament Row */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                    <div>
                      <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
                        Diet
                      </label>
                      <input
                        type="text"
                        value={diet}
                        onChange={(e) => setDiet(e.target.value)}
                        placeholder="e.g. Pellets, frozen brine"
                        style={{ width: "100%", padding: "0.65rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "6px", outline: "none" }}
                      />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
                        Temperament
                      </label>
                      <select
                        value={temperament}
                        onChange={(e) => setTemperament(e.target.value)}
                        style={{ width: "100%", padding: "0.65rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "6px", outline: "none" }}
                      >
                        <option value="">Select...</option>
                        <option value="Peaceful">Peaceful</option>
                        <option value="Semi-Aggressive">Semi-Aggressive</option>
                        <option value="Aggressive">Aggressive</option>
                        <option value="Schooling">Schooling</option>
                        <option value="Territorial">Territorial</option>
                      </select>
                    </div>
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

                  {/* Water Parameters Row */}
                  <div>
                    <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
                      Water Parameters (recommended range)
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
                        <input type="number" value={tankSizeMin} onChange={(e) => setTankSizeMin(e.target.value)} placeholder="20" style={{ width: "100%", padding: "0.45rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px", outline: "none", fontSize: "0.75rem" }} />
                      </div>
                    </div>
                  </div>

                  {/* Health & Guarantee Row */}
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

                  {/* Dynamic Pricing Calculator Ledger */}
                  {parseVal > 0 && (
                    <div className="receipt-ledger">
                      <div className="receipt-row">
                        <span>List Price:</span>
                        <span className="receipt-val-usd">
                          ${parseVal.toFixed(2)} USD
                        </span>
                      </div>
                      <div className="receipt-row">
                        <span>Marketplace Fee (4%):</span>
                        <span className="receipt-val-usd" style={{ color: "var(--accent-red)" }}>
                          -${feeVal.toFixed(2)} USD
                        </span>
                      </div>
                      <div className="receipt-row total">
                        <span>Est. Net Payout:</span>
                        <span className="receipt-val-usd">
                          ${payoutVal.toFixed(2)} USD
                        </span>
                      </div>
                    </div>
                  )}


                  {/* Market Intelligence Block */}
                  {(() => {
                    let pedigreeClass = "pedigree-wild";
                    let pedigreeLabel = "Wild Caught";
                    let pedigreeGlowClass = "";
                    let pedigreeBadgeClass = "badge-amber";

                    if (sireId === 0 && damId === 0) {
                      pedigreeClass = "pedigree-wild";
                      pedigreeLabel = "Wild Caught";
                      pedigreeBadgeClass = "badge-amber";
                    } else if ((sireId !== 0 && damId === 0) || (sireId === 0 && damId !== 0)) {
                      pedigreeClass = "pedigree-f1";
                      pedigreeLabel = "Ancestral F1";
                      pedigreeBadgeClass = "badge-blue";
                    } else {
                      pedigreeClass = "pedigree-purebred";
                      pedigreeLabel = "Purebred Pedigree";
                      pedigreeGlowClass = "pedigree-purebred-glow";
                      pedigreeBadgeClass = "badge-green";
                    }

                    return (
                      <div 
                        className={`glass-card ${pedigreeClass}`} 
                        style={{ 
                          padding: "1rem", 
                          display: "flex", 
                          flexDirection: "column", 
                          gap: "0.5rem", 
                          background: "rgba(255,255,255,0.015)"
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontSize: "0.7rem", color: "var(--text-secondary)", fontWeight: "600", textTransform: "uppercase" }}>
                            📊 Market Intelligence
                          </span>
                          <span className={`badge ${pedigreeBadgeClass} ${pedigreeGlowClass}`} style={{ fontSize: "0.6rem" }}>
                            {pedigreeLabel}
                          </span>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.75rem" }}>
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ color: "var(--text-muted)" }}>Global Platform Avg:</span>
                            <strong style={{ color: "#fff", fontFamily: "monospace" }}>{globalAvg}</strong>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ color: "var(--text-muted)" }}>Lineage Valuation Track:</span>
                            <strong style={{ color: "var(--accent-blue)", fontFamily: "monospace" }}>{lineageVal}</strong>
                          </div>
                        </div>

                        {/* Visual valuation slider */}
                        <div style={{ marginTop: "0.25rem" }}>
                          <div className="price-valuation-bar">
                            <div className="price-valuation-fill" style={{ width: `${markerPercent}%` }} />
                            {parseVal > 0 && (
                              <div className="price-valuation-marker" style={{ left: `${markerPercent}%` }} />
                            )}
                          </div>
                          <div className="price-valuation-labels">
                            <span>$0</span>
                            <span>Avg: {globalAvg}</span>
                            <span>Premium: ${maxScale.toFixed(0)}</span>
                          </div>
                          {parseVal > 0 && (
                            <span style={{ 
                              fontSize: "0.6rem", 
                              color: parseVal < parseFloat(lineageVal.replace("$","")) ? "var(--accent-green)" : parseVal > parseFloat(globalAvg.replace("$","")) ? "#c084fc" : "var(--accent-blue)",
                              display: "block",
                              marginTop: "0.3rem",
                              fontWeight: "600",
                              textAlign: "center"
                            }}>
                              {parseVal < parseFloat(lineageVal.replace("$","")) ? "🔥 Undervalued / Deal Price" : parseVal > parseFloat(globalAvg.replace("$","")) ? "📈 Premium Breed Pricing" : "⚖️ Solid Market Average"}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.25rem" }}>
                    <button 
                      type="button"
                      onClick={() => setStep(1)} 
                      className="btn-secondary" 
                      disabled={submitting}
                      style={{ flex: 1 }}
                    >
                      Back
                    </button>
                    <button 
                      type="button"
                      onClick={handleList} 
                      className="btn-primary-pro" 
                      disabled={submitting}
                      style={{ flex: 2, justifyContent: "center" }}
                    >
                      {submitting ? "Listing..." : "Create Listing"}

                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
    </Modal>
  );
}
