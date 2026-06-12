import React, { useState, useEffect } from "react";
import { ethers, Contract, parseEther } from "ethers";
import aquadexAbi from "../abi/AquadexManager.json";
import marketplaceAbi from "../abi/AquadexMarketplace.json";
import { addXp, XP_ACTIONS } from "../utils/xp";
import { getProvider } from "../utils/smartAccount";
import { relayCreateListing } from "../services/relayer";
import { db } from "../db";
import { Modal } from "./Modal";

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
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && preselectedListSpecimen) {
      const tid = preselectedListSpecimen.id || preselectedListSpecimen.tokenId;
      if (tid) {
        setTokenId(tid.toString());
        verifyToken(Number(tid));
      }
    }
  }, [isOpen, preselectedListSpecimen]);

  const verifyToken = async (idToVerify) => {
    if (!idToVerify || isNaN(idToVerify)) return;

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
      const priceEth = (parseFloat(price) / 1000).toString();
      const shippingFeeEth = isShipping ? (parseFloat(shippingFee) / 1000).toString() : "0";

      // Beta: store listing locally (no MetaMask, no gas)
      const result = await relayCreateListing({
        tokenId: Number(tokenId),
        priceEth,
        shippingFeeEth,
        isShipping,
        seller: walletAccount,
        speciesId: specimenInfo?.speciesId || 0,
        commonName: specimenInfo?.commonName || "Specimen",
        scientificName: specimenInfo?.scientificName || "Unknown",
        sireId: specimenInfo?.sireId || 0,
        damId: specimenInfo?.damId || 0,
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
          Publish Directory Entry
        </h3>
        <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
          Share your certificate listing with the local directory. The registry entry will be securely managed in the cloud.
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
            <strong>Transaction Sent:</strong> Waiting for block confirmation...
            <div style={{ fontSize: "0.7rem", marginTop: "0.25rem", fontFamily: "monospace" }}>{txHash}</div>
          </div>
        )}

        {step === 1 && (
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
              className="btn-primary" 
              disabled={checking}
              style={{ justifyContent: "center" }}
            >
              {checking ? "Verifying Access..." : "Verify Ownership"}
            </button>
          </form>
        )}

        {step > 1 && specimenInfo && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            <div style={{
              padding: "0.75rem",
              background: "rgba(255,255,255,0.02)",
              border: "1px solid var(--glass-border)",
              borderRadius: "4px"
            }}>
              <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase", display: "block" }}>Verified Certificate</span>
              <strong style={{ color: "#fff" }}>{specimenInfo.commonName}</strong>
              <span style={{ fontSize: "0.75rem", fontStyle: "italic", color: "var(--text-secondary)", display: "block" }}>
                {specimenInfo.scientificName} (Cert. Serial No. {specimenInfo.id.toString().padStart(3, "0")})
              </span>
            </div>

            {step === 2 && (
              <div>
                <p style={{ fontSize: "0.825rem", color: "var(--text-secondary)", marginBottom: "1rem" }}>
                  <strong>Step 1 of 2: Authorize Directory</strong><br />
                  Authorize the Local Directory to manage your birth certificate.
                </p>
                <button 
                  onClick={handleApprove} 
                  className="btn-primary" 
                  disabled={submitting}
                  style={{ width: "100%", justifyContent: "center" }}
                >
                  {submitting ? "Authorizing..." : "Authorize Directory"}
                </button>
              </div>
            )}

            {step === 3 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                {/* Delivery Selector Toggle */}
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.5rem" }}>
                    Delivery Method
                  </label>
                  <div style={{ display: "flex", gap: "0.5rem", background: "rgba(255,255,255,0.02)", padding: "0.25rem", borderRadius: "8px", border: "1px solid var(--glass-border)" }}>
                    <button 
                      type="button"
                      className="btn-secondary" 
                      onClick={() => setIsShipping(false)}
                      style={{ 
                        flex: 1, 
                        padding: "0.5rem", 
                        fontSize: "0.8rem", 
                        border: "none", 
                        borderRadius: "6px",
                        background: !isShipping ? "var(--accent-blue-glow)" : "none", 
                        color: !isShipping ? "#fff" : "var(--text-secondary)" 
                      }}
                    >
                      📍 Local Pickup Only
                    </button>
                    <button 
                      type="button"
                      className="btn-secondary" 
                      onClick={() => setIsShipping(true)}
                      style={{ 
                        flex: 1, 
                        padding: "0.5rem", 
                        fontSize: "0.8rem", 
                        border: "none", 
                        borderRadius: "6px",
                        background: isShipping ? "var(--accent-blue-glow)" : "none", 
                        color: isShipping ? "#fff" : "var(--text-secondary)" 
                      }}
                    >
                      🚚 Shipping Available
                    </button>
                  </div>
                </div>

                {/* Price field */}
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.25rem" }}>
                    Price per fish ($)
                  </label>
                  <input 
                    type="number"
                    step="0.01"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="e.g. 50.00"
                    required
                    style={{ width: "100%", padding: "0.65rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px" }}
                  />
                  <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginTop: "0.25rem", display: "block" }}>
                    * Protocol rules apply: A 2% fee will be routed to the DAO Treasury upon successful exchange.
                  </span>
                </div>

                {/* Shipping Fee field if shipping is enabled */}
                {isShipping && (
                  <div>
                    <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.25rem" }}>
                      Shipping Fee ($)
                    </label>
                    <input 
                      type="number"
                      step="0.01"
                      value={shippingFee}
                      onChange={(e) => setShippingFee(e.target.value)}
                      placeholder="e.g. 5.00"
                      required
                      style={{ width: "100%", padding: "0.65rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px" }}
                    />
                  </div>
                )}

                {/* Market Intelligence Block */}
                {(() => {
                  const sireId = Number(specimenInfo.sireId || 0);
                  const damId = Number(specimenInfo.damId || 0);
                  let pedigreeClass = "";
                  let pedigreeLabel = "";
                  let pedigreeGlowClass = "";
                  let pedigreeBadgeClass = "";
                  let globalAvg = "$50.00";
                  let lineageVal = "$48.00";

                  if (sireId === 0 && damId === 0) {
                    pedigreeClass = "pedigree-wild";
                    pedigreeLabel = "Wild Caught";
                    pedigreeBadgeClass = "badge-amber";
                    globalAvg = "$35.00";
                    lineageVal = "$32.00 (Parent Wild-Caught base)";
                  } else if ((sireId !== 0 && damId === 0) || (sireId === 0 && damId !== 0)) {
                    pedigreeClass = "pedigree-f1";
                    pedigreeLabel = "Ancestral F1";
                    pedigreeBadgeClass = "badge-blue";
                    globalAvg = "$50.00";
                    lineageVal = "$48.00 (F1 sibling average)";
                  } else {
                    pedigreeClass = "pedigree-purebred";
                    pedigreeLabel = "Purebred Pedigree";
                    pedigreeGlowClass = "pedigree-purebred-glow";
                    pedigreeBadgeClass = "badge-green";
                    globalAvg = "$75.00";
                    lineageVal = "$72.00 (Purebred pedigree track)";
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
                    </div>
                  );
                })()}

                <div style={{ display: "flex", gap: "0.5rem" }}>
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
                    className="btn-primary" 
                    disabled={submitting}
                    style={{ flex: 2, justifyContent: "center" }}
                  >
                    {submitting ? "Publishing..." : "Publish Entry"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
    </Modal>
  );
}
