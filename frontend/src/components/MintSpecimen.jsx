import React, { useState, useEffect } from "react";
import { ethers, Contract } from "ethers";
import aquadexAbi from "../abi/AquadexManager.json";
import { addXp, XP_ACTIONS } from "../utils/xp";
import { getProvider } from "../utils/smartAccount";
import { compressImage } from "../utils/imageCompression";
import { mapContractError } from "../utils/errorHandler";
import { relayMintSpecimen } from "../services/relayer";
import { db } from "../db";

export function MintSpecimen({ contractAddress, walletAccount }) {
  const [speciesList, setSpeciesList] = useState([]);
  const [tankList, setTankList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [txHash, setTxHash] = useState(null);
  const [successId, setSuccessId] = useState(null);
  const [error, setError] = useState(null);
  const [selectedPhoto, setSelectedPhoto] = useState("");
  const [toastMessage, setToastMessage] = useState(null);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const handlePhotoChange = async (e) => {
    const file = e.target.files[0];
    if (file) {
      try {
        const compressed = await compressImage(file);
        setSelectedPhoto(compressed);
      } catch (err) {
        console.error("Error compressing image:", err);
        setError("Failed to process selected image.");
      }
    }
  };

  // Form Fields State
  const [formData, setFormData] = useState({
    speciesId: "",
    birthDate: "",
    breeder: walletAccount || "",
    currentTankId: "0",
    sireId: "0",
    damId: "0",
    ipfsMetadataUri: "ipfs://bafybeidflm24zspeciemensample/meta.json"
  });
  const [breederEditable, setBreederEditable] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (walletAccount) {
      setFormData((prev) => ({ ...prev, breeder: walletAccount }));
      loadMetadata();
    }
  }, [walletAccount, contractAddress]);

  const loadMetadata = async () => {
    try {
      setLoading(true);
      setError(null);
      const provider = getProvider();
      const contract = new Contract(contractAddress, aquadexAbi, provider);

      // 1. Fetch Curator species catalog (parallelized)
      const nextId = await contract.nextSpeciesId();
      const totalCount = Number(nextId) - 1;
      const speciesPromises = [];
      for (let i = 1; i <= totalCount; i++) {
        speciesPromises.push(
          contract.speciesCatalog(i)
            .then(spec => spec.active ? { id: i, scientificName: spec.scientificName, commonName: spec.commonName } : null)
            .catch(() => null)
        );
      }
      const speciesResults = await Promise.all(speciesPromises);
      const tempSpecies = speciesResults.filter(Boolean);
      setSpeciesList(tempSpecies);
      if (tempSpecies.length > 0) {
        setFormData((prev) => ({ ...prev, speciesId: tempSpecies[0].id.toString() }));
      }

      // 2. Fetch owner's tanks — merge on-chain + local Dexie tanks
      const tempTanks = [];

      // On-chain tanks (may exist from before beta local-first switch)
      let idx = 0;
      while (true) {
        try {
          const id = await contract.ownerTanks(walletAccount, idx);
          const t = await contract.tanks(id);
          if (t.active) {
            tempTanks.push({
              id: Number(id),
              name: t.name
            });
          }
          idx++;
        } catch (err) {
          break; // Out of bounds reached
        }
      }

      // Local Dexie tanks (beta mode)
      try {
        const localTanks = await db.tanks.where("ownerAddress").equals(walletAccount).toArray();
        for (const lt of localTanks) {
          if (lt.active && !tempTanks.some(t => t.id === lt.id)) {
            tempTanks.push({ id: lt.id, name: lt.name });
          }
        }
      } catch (e) {
        console.warn("Could not load local tanks for mint form:", e);
      }

      setTankList(tempTanks);
    } catch (err) {
      console.error("Error loading mint form metadata:", err);
      setError("Failed to resolve catalog species or tanks from the contract.");
    } finally {
      setLoading(false);
    }
  };

  const handleMintSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setTxHash(null);
    setSuccessId(null);
    setSubmitting(true);

    try {
      const birthTimestamp = formData.birthDate 
        ? Math.round(new Date(formData.birthDate).getTime() / 1000) 
        : 0;

      const speciesMatch = speciesList.find(s => s.id.toString() === formData.speciesId);
      const commonName = speciesMatch?.commonName || "Unknown";
      const scientificName = speciesMatch?.scientificName || "Unknown";

      // Beta: store locally via relayer (no MetaMask, no gas)
      const result = await relayMintSpecimen({
        speciesId: Number(formData.speciesId),
        birthTimestamp,
        breeder: formData.breeder || walletAccount,
        currentTankId: Number(formData.currentTankId),
        sireId: Number(formData.sireId),
        damId: Number(formData.damId),
        ipfsMetadataUri: formData.ipfsMetadataUri,
        ownerAddress: walletAccount,
        commonName,
        scientificName,
      });

      if (!result.success) {
        throw new Error(result.error || "Failed to register specimen");
      }

      const mintedTokenId = result.specimenId;

      // Trigger Breeding telemetry
      const isSpawn = Number(formData.sireId) > 0 || Number(formData.damId) > 0;
      if (isSpawn) {
        addXp(XP_ACTIONS.SPAWN_BREED?.points, XP_ACTIONS.SPAWN_BREED?.label);
      } else {
        addXp(XP_ACTIONS.MINT_SPECIMEN?.points, XP_ACTIONS.MINT_SPECIMEN?.label);
      }

      if (mintedTokenId) {
        try {
          if (selectedPhoto) {
            localStorage.setItem(`aquadex_specimen_photo_${mintedTokenId}`, selectedPhoto);
          }
          
          const speciesName = commonName;
          const metadata = {
            name: `${speciesName} Specimen`,
            description: `Registered Birth Certificate. Species ID: ${formData.speciesId}.`,
            attributes: [
              { trait_type: "Sire ID", value: formData.sireId !== "0" ? formData.sireId : "None" },
              { trait_type: "Dam ID", value: formData.damId !== "0" ? formData.damId : "None" },
              { trait_type: "Containment Tank ID", value: formData.currentTankId !== "0" ? formData.currentTankId : "None" },
              { trait_type: "Registration Date", value: formData.birthDate || new Date().toLocaleDateString() }
            ]
          };
          localStorage.setItem(`aquadex_specimen_metadata_${mintedTokenId}`, JSON.stringify(metadata));
        } catch (storageErr) {
          console.error("Storage quota error:", storageErr);
          showToast("⚠️ Storage Quota Exceeded! Specimen registered, but device is out of space for local photos.");
        }
      }

      setSuccessId(mintedTokenId || "Success!");
      // Notify onboarding tour / listeners that a specimen was added (no behavioral change)
      window.dispatchEvent(new CustomEvent("aquadex:specimen_added", { detail: { tokenId: mintedTokenId } }));
      // Reset form variables
      setFormData((prev) => ({
        ...prev,
        sireId: "0",
        damId: "0"
      }));
      setSelectedPhoto("");
      // Trigger a clean state re-fetch of available metadata
      await loadMetadata();
    } catch (err) {
      console.error("Specimen minting transaction failed:", err);
      setError(mapContractError(err, false));
    } finally {
      setSubmitting(false);
    }
  };

  if (!walletAccount) {
    return (
      <div className="glass-card" style={{ padding: "3rem", textAlign: "center" }}>
        <h2 style={{ marginBottom: "1rem", color: "var(--text-secondary)" }}>Not Connected</h2>
        <p style={{ color: "var(--text-muted)" }}>Connect your account to register new specimens.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="glass-card shimmer-placeholder" style={{ height: "450px", maxWidth: "600px", margin: "0 auto", borderRadius: "var(--radius-md)" }} />
    );
  }

  return (
    <div className="glass-card" style={{ maxWidth: "600px", margin: "0 auto", padding: "2.5rem" }}>
      <h2 style={{ fontSize: "1.75rem", marginBottom: "0.25rem", color: "#fff" }}>Register Birth Certificate</h2>
      <p style={{ color: "var(--text-muted)", fontSize: "0.875rem", marginBottom: "2rem" }}>
        Record a successful birth and register a premium birth certificate linked to the Master Catalog.
      </p>

      {error && (
        <div style={{ 
          padding: "1rem", 
          background: "rgba(248, 113, 113, 0.1)", 
          border: "1px solid rgba(248, 113, 113, 0.3)", 
          borderRadius: "var(--radius-sm)", 
          color: "var(--accent-red)", 
          marginBottom: "1.5rem", 
          fontSize: "0.85rem" 
        }}>
          <strong>Registration Error:</strong> {error}
        </div>
      )}

      {txHash && !successId && (
        <div style={{ 
          padding: "1rem", 
          background: "var(--accent-blue-glow)", 
          border: "1px solid rgba(56, 189, 248, 0.3)", 
          borderRadius: "var(--radius-sm)", 
          color: "var(--accent-blue)", 
          marginBottom: "1.5rem", 
          fontSize: "0.85rem" 
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
            <div style={{
              width: "14px",
              height: "14px",
              border: "2px solid rgba(56, 189, 248, 0.3)",
              borderTopColor: "var(--accent-blue)",
              borderRadius: "50%",
              animation: "shimmer 1s linear infinite",
            }} />
            <strong>Confirming on Base…</strong>
          </div>
          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
            This usually takes 5–15 seconds. Your registration is being secured.
          </span>
          <br />
          <a 
            href={`https://sepolia.basescan.org/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: "0.7rem", color: "var(--accent-blue)", fontFamily: "monospace", textDecoration: "underline" }}
          >
            View on BaseScan →
          </a>
        </div>
      )}

      {successId && (
        <div style={{ 
          padding: "1rem", 
          background: "var(--accent-green-glow)", 
          border: "1px solid rgba(52, 211, 153, 0.3)", 
          borderRadius: "var(--radius-sm)", 
          color: "var(--accent-green)", 
          marginBottom: "1.5rem", 
          fontSize: "0.85rem" 
        }}>
          <strong>Birth Registered Successfully!</strong> Birth Certificate Serial No. registered: <strong style={{ textDecoration: "underline" }}>{typeof successId === "number" ? successId.toString().padStart(3, "0") : successId}</strong>
        </div>
      )}

      <form onSubmit={handleMintSubmit} style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
        <div>
          <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
            Species Selection
          </label>
          <select 
            value={formData.speciesId}
            onChange={(e) => setFormData({ ...formData, speciesId: e.target.value })}
            required
            style={{ width: "100%", padding: "0.75rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px" }}
          >
            {speciesList.map((spec) => (
              <option key={spec.id} value={spec.id} style={{ background: "var(--bg-secondary)" }}>
                {spec.commonName} ({spec.scientificName})
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
              Containment Tank
            </label>
            <select 
              value={formData.currentTankId}
              onChange={(e) => setFormData({ ...formData, currentTankId: e.target.value })}
              style={{ width: "100%", padding: "0.75rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px" }}
            >
              <option value="0" style={{ background: "var(--bg-secondary)" }}>None (Unassigned)</option>
              {tankList.map((tank) => (
                <option key={tank.id} value={tank.id} style={{ background: "var(--bg-secondary)" }}>
                  {tank.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
              Approx Birth Date
            </label>
            <input 
              type="date"
              value={formData.birthDate}
              onChange={(e) => setFormData({ ...formData, birthDate: e.target.value })}
              style={{ width: "100%", padding: "0.7rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px" }}
            />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
              Male Parent (Sire Cert. Serial No.)
            </label>
            <input 
              type="number"
              value={formData.sireId}
              onChange={(e) => setFormData({ ...formData, sireId: e.target.value })}
              style={{ width: "100%", padding: "0.75rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px" }}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
              Female Parent (Dam Cert. Serial No.)
            </label>
            <input 
              type="number"
              value={formData.damId}
              onChange={(e) => setFormData({ ...formData, damId: e.target.value })}
              style={{ width: "100%", padding: "0.75rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px" }}
            />
          </div>
        </div>

        <div>
          <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
            Breeder Account Address
          </label>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <input 
              type="text"
              value={formData.breeder}
              onChange={(e) => setFormData({ ...formData, breeder: e.target.value })}
              placeholder="0x..."
              readOnly={!breederEditable}
              style={{ 
                flex: 1, 
                padding: "0.75rem", 
                background: breederEditable ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.015)", 
                border: "1px solid var(--glass-border)", 
                color: breederEditable ? "#fff" : "var(--text-secondary)", 
                borderRadius: "4px", 
                fontFamily: "monospace",
                opacity: breederEditable ? 1 : 0.8,
              }}
            />
            <button
              type="button"
              onClick={() => setBreederEditable(!breederEditable)}
              className="btn-secondary"
              style={{ padding: "0.5rem 0.75rem", fontSize: "0.7rem", whiteSpace: "nowrap" }}
            >
              {breederEditable ? "Lock" : "Edit"}
            </button>
          </div>
        </div>

        <div>
          <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
            Specimen Photo
          </label>
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <label style={{ 
              flex: 1, 
              padding: "0.75rem", 
              background: "rgba(255,255,255,0.03)", 
              border: "1px dashed var(--glass-border)", 
              borderRadius: "4px", 
              fontSize: "0.8rem", 
              color: "var(--text-secondary)", 
              cursor: "pointer", 
              textAlign: "center" 
            }}>
              {selectedPhoto ? "✓ Photo Selected" : "📁 Upload Custom Photo"}
              <input 
                type="file" 
                accept="image/*"
                onChange={handlePhotoChange}
                style={{ display: "none" }}
              />
            </label>
            {selectedPhoto && (
              <div style={{ position: "relative", width: "40px", height: "40px", borderRadius: "4px", overflow: "hidden", border: "1px solid var(--glass-border)" }}>
                <img src={selectedPhoto} alt="Specimen Preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                <button 
                  type="button" 
                  onClick={() => setSelectedPhoto("")}
                  style={{ position: "absolute", top: 0, right: 0, background: "rgba(0,0,0,0.7)", color: "#fff", border: "none", width: "100%", height: "100%", fontSize: "14px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", opacity: 0, transition: "opacity 0.2s" }}
                  onMouseEnter={(e) => e.target.style.opacity = 1}
                  onMouseLeave={(e) => e.target.style.opacity = 0}
                >
                  &times;
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Advanced section — hidden by default */}
        <div>
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              fontSize: "0.8rem",
              cursor: "pointer",
              padding: "0.25rem 0",
              display: "flex",
              alignItems: "center",
              gap: "0.4rem",
            }}
          >
            <span style={{ 
              transform: showAdvanced ? "rotate(90deg)" : "rotate(0deg)", 
              transition: "transform 0.2s ease",
              display: "inline-block",
            }}>▶</span>
            Advanced Options
          </button>
          {showAdvanced && (
            <div style={{ marginTop: "0.75rem" }}>
              <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
                Metadata URI
              </label>
              <input 
                type="text" 
                value={formData.ipfsMetadataUri}
                onChange={(e) => setFormData({ ...formData, ipfsMetadataUri: e.target.value })}
                required
                style={{ width: "100%", padding: "0.75rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px", fontFamily: "monospace", fontSize: "0.8rem" }}
              />
              <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: "0.25rem", display: "block" }}>
                Auto-generated. Only edit if you have a custom IPFS metadata file.
              </span>
            </div>
          )}
        </div>

        <button 
          type="submit" 
          className="btn-primary" 
          disabled={submitting || speciesList.length === 0}
          style={{ justifyContent: "center", width: "100%", marginTop: "1rem" }}
        >
          {submitting ? "Registering Certificate..." : "Confirm Birth Registration"}
        </button>
      </form>

      {toastMessage && (
        <div style={{
          position: "fixed",
          bottom: "2rem",
          right: "2rem",
          background: "rgba(10, 15, 30, 0.9)",
          backdropFilter: "blur(8px)",
          border: "1px solid var(--accent-red)",
          color: "#fff",
          padding: "1rem 1.5rem",
          borderRadius: "var(--radius-md)",
          boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 0 15px rgba(248, 113, 113, 0.2)",
          zIndex: 9999,
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          animation: "fadeIn 0.3s ease"
        }}>
          {toastMessage}
        </div>
      )}
    </div>
  );
}
