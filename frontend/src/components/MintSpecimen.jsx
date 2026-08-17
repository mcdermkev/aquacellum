import React, { useState, useEffect } from "react";
import { ethers, Contract } from "ethers";
import aquadexAbi from "../abi/AquadexManager.json";
import { awardXp } from "../utils/xp";
import { getProvider } from "../utils/smartAccount";
import { compressImage } from "../utils/imageCompression";
import { mapContractError } from "../utils/errorHandler";
import { relayMintSpecimen } from "../services/relayer";
import { putSpecimenPhoto } from "../services/tankMedia";
import { SEX, SEX_OPTIONS, normalizeSex, sexOptionLabel } from "../utils/specimenSex";
import { LIFE_STAGE_OPTIONS, lifeStageOptionLabel, canBeCertificated } from "../utils/lifeStage";
import { PROVENANCE } from "../utils/provenance";
import {
  METADATA_URI_NONE,
  buildSpecimenMetadata,
  validateMetadataUri,
} from "../services/specimenMetadata";
import { db } from "../db";
import { supabase, isSupabaseConfigured } from "../services/supabaseClient";
import { loadOwnedSpecimens, specimenOptionLabel } from "../utils/ownedSpecimens";
import { useProfile } from "../hooks/useReefProfile";
import { generateAlias } from "../utils/generateAlias";

export function MintSpecimen({ contractAddress, walletAccount, casualModeActive }) {
  const [speciesList, setSpeciesList] = useState([]);
  const [tankList, setTankList] = useState([]);
  const [specimenOptions, setSpecimenOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [txHash, setTxHash] = useState(null);
  const [successId, setSuccessId] = useState(null);
  const [error, setError] = useState(null);
  const [selectedPhoto, setSelectedPhoto] = useState("");
  const [toastMessage, setToastMessage] = useState(null);

  const { data: reefProfile } = useProfile(walletAccount, !!walletAccount);
  const displayNameResolved = reefProfile?.display_name || (walletAccount ? generateAlias(walletAccount) : "");

  const inputStyle = {
    width: "100%",
    padding: "0.75rem",
    background: "rgba(255, 255, 255, 0.03)",
    border: casualModeActive ? "1px solid var(--glass-border)" : "1px solid rgba(168, 85, 247, 0.3)",
    color: "#fff",
    borderRadius: "4px",
    outline: "none",
    transition: "all 0.2s"
  };

  const handleInputFocus = (e) => {
    if (!casualModeActive) {
      e.target.style.borderColor = "rgba(168, 85, 247, 0.8)";
      e.target.style.boxShadow = "0 0 8px rgba(168, 85, 247, 0.4)";
    }
  };

  const handleInputBlur = (e) => {
    if (!casualModeActive) {
      e.target.style.borderColor = "rgba(168, 85, 247, 0.3)";
      e.target.style.boxShadow = "none";
    }
  };

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
    // "" means not recorded. An exact birth date is often a guess for bought-in
    // stock, whereas the stage is knowable — so both are collected and neither is
    // inferred from the other.
    lifeStage: "",
    currentTankId: "0",
    sireId: "0",
    damId: "0",
    gender: SEX.UNSEXED,
    breederStockTag: "",
    // Empty by default. This value becomes the certificate's on-chain
    // `tokenURI` verbatim, so a placeholder here would publish a permanent
    // pointer to a document that doesn't exist. It used to default to a
    // hardcoded fake CID, identical on every specimen ever registered.
    // See services/specimenMetadata.js.
    ipfsMetadataUri: METADATA_URI_NONE
  });
  const [metadataUriError, setMetadataUriError] = useState(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (walletAccount) {
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

      // Local Dexie tanks (beta mode) — match owner case-insensitively.
      //
      // OWNERSHIP IS A HARD FILTER here for the same reason it is in
      // utils/ownedSpecimens.js: the selected tank is written onto the birth
      // certificate as its containment unit. The old "beta single-device
      // fallback" listed every tank on the device when none matched the current
      // account, so on a shared browser profile a certificate could be filed
      // into someone else's tank. An empty tank dropdown ("None (Unassigned)")
      // is the correct answer; tanks are created over in My Aquariums.
      try {
        const acct = (walletAccount || "").toLowerCase();
        const allLocalTanks = acct ? await db.tanks.toArray() : [];
        const localTanks = allLocalTanks.filter(t => {
          if (t.active === false) return false;
          const owner = (t.ownerAddress || "").toLowerCase();
          // Match this user, or include legacy tanks with no owner recorded
          return owner === acct || owner === "";
        });

        for (const lt of localTanks) {
          if (!tempTanks.some(t => Number(t.id) === Number(lt.id))) {
            tempTanks.push({ id: lt.id, name: lt.name });
          }
        }
      } catch (e) {
        console.warn("Could not load local tanks for mint form:", e);
      }

      setTankList(tempTanks);

      // 3. Load owner's existing specimens for the Sire/Dam parent pickers.
      // Selecting from real specimens stores the correct serial ID automatically,
      // so parent references resolve in the lineage family tree.
      try {
        const ownedSpecimens = await loadOwnedSpecimens(walletAccount);
        setSpecimenOptions(ownedSpecimens);
      } catch (e) {
        console.warn("Could not load specimens for parent pickers:", e);
        setSpecimenOptions([]);
      }
    } catch (err) {
      console.error("Error loading mint form metadata:", err);
      setError("Failed to load species catalog or tank data. Please try again.");
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

      // Gate the on-chain metadata URI. Refuse to publish an invalid pointer
      // rather than silently writing it to tokenURI.
      const uriCheck = validateMetadataUri(formData.ipfsMetadataUri);
      if (!uriCheck.ok) {
        setMetadataUriError(uriCheck.error);
        throw new Error(uriCheck.error);
      }
      setMetadataUriError(null);

      // Look up the breeder's species mastery at THIS moment. The result is
      // stamped into the certificate and determines its visual frame forever —
      // it is never re-derived or updated after mint.
      let breederMasteryAtMint = null;
      try {
        if (isSupabaseConfigured()) {
          const { data: rows } = await supabase
            .from("species_mastery")
            .select("mastery_tier")
            .eq("wallet_address", walletAccount.toLowerCase())
            .eq("species_key", (commonName || "").toLowerCase().trim())
            .limit(1);
          breederMasteryAtMint = rows?.[0]?.mastery_tier || null;
        }
      } catch {
        // Non-fatal — a certificate without a frame is still a certificate.
      }

      // Built once and used twice: published to the certificate's hosted URL by
      // the relayer, and mirrored locally for the offline detail view.
      const certificateMetadata = buildSpecimenMetadata({
        commonName,
        speciesId: formData.speciesId,
        sireId: formData.sireId,
        damId: formData.damId,
        tankId: formData.currentTankId,
        registrationDate: formData.birthDate,
        sex: normalizeSex(formData.gender),
        breederStockTag: formData.breederStockTag,
        breederMasteryAtMint,
      });

      // Beta: store locally via relayer (no MetaMask, no gas)
      const result = await relayMintSpecimen({
        speciesId: Number(formData.speciesId),
        birthTimestamp,
        // Breeder attribution is the signed-in account, always. It is a
        // canonical lowercase EOA per the address rule in services/relayer.js —
        // never a display name and never user-supplied. The display name below
        // is presentation only, resolved from the profile at render time.
        breeder: walletAccount,
        currentTankId: Number(formData.currentTankId),
        sireId: Number(formData.sireId),
        damId: Number(formData.damId),
        ipfsMetadataUri: uriCheck.uri,
        // When the breeder hasn't supplied their own URI, the relayer publishes
        // this document to a deterministic hosted URL and uses that as the
        // certificate's tokenURI.
        metadataDocument: uriCheck.uri ? null : certificateMetadata,
        ownerAddress: walletAccount,
        commonName,
        scientificName,
        gender: normalizeSex(formData.gender),
        breederStockTag: formData.breederStockTag,
        lifeStage: formData.lifeStage || null,
        // Recorded parents ARE the evidence, so a parented registration is
        // bredByKeeper. Without them the honest reading is that the trail starts
        // here — which is what the beta feedback asked for, and what stops the
        // absence of parents being rendered as the claim "wild caught".
        provenance:
          Number(formData.sireId) > 0 || Number(formData.damId) > 0
            ? PROVENANCE.BRED_BY_KEEPER
            : PROVENANCE.UNVERIFIED,
      });

      if (!result.success) {
        throw new Error(result.error || "Failed to register specimen");
      }

      const mintedTokenId = result.specimenId;

      // Trigger Breeding telemetry
      const isSpawn = Number(formData.sireId) > 0 || Number(formData.damId) > 0;
      if (isSpawn) {
        awardXp("SPAWN_BREED");
      } else {
        awardXp("MINT_SPECIMEN");
      }

      if (mintedTokenId) {
        // Photo → the durable Dexie `tankMedia` store (BREEDER_STATE_MODEL §9.3).
        // This used to be a raw localStorage.setItem, which meant a breeder's
        // specimen photos shared one ~5MB origin quota, weren't synced, and
        // vanished on a cache clear. `putSpecimenPhoto` writes Dexie and mirrors
        // to localStorage, so the readers still on the old key keep working and a
        // quota failure no longer loses the photo.
        if (selectedPhoto) {
          try {
            await putSpecimenPhoto(mintedTokenId, selectedPhoto);
          } catch (photoErr) {
            console.warn("Specimen photo save failed:", photoErr);
            showToast("⚠️ Specimen registered, but its photo could not be saved.");
          }
        }

        // Metadata is still a localStorage blob. It's small text (not the quota
        // problem the photo was) and is read back by SpecimenDetailModal and
        // counted by the onboarding tour, so relocating it needs those readers
        // moved too — tracked in BREEDER_STATE_MODEL §9.14.
        try {
          localStorage.setItem(`aquadex_specimen_metadata_${mintedTokenId}`, JSON.stringify(certificateMetadata));
        } catch (storageErr) {
          console.warn("Specimen metadata save failed (quota?):", storageErr);
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
    <div 
      className="glass-card" 
      style={{ 
        maxWidth: "600px", 
        margin: "0 auto", 
        padding: "2.5rem",
        border: !casualModeActive 
          ? "1px solid rgba(168, 85, 247, 0.22)" 
          : "1px solid var(--glass-border)",
        boxShadow: !casualModeActive
          ? "0 8px 32px rgba(0, 0, 0, 0.4), 0 0 15px rgba(168, 85, 247, 0.1)"
          : "var(--glass-shadow)",
        transition: "border-color 0.35s ease, box-shadow 0.35s ease"
      }}
    >
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
            <strong>Saving registration...</strong>
          </div>
          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
            This usually takes a few seconds. Your registration is being saved securely.
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
            style={inputStyle}
            onFocus={handleInputFocus}
            onBlur={handleInputBlur}
          >
            {speciesList.map((spec) => (
              <option key={spec.id} value={spec.id} style={{ background: "var(--bg-secondary)" }}>
                {spec.commonName} ({spec.scientificName})
              </option>
            ))}
          </select>
        </div>

        <div className="form-grid-2col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
              Containment Tank
            </label>
            <select 
              value={formData.currentTankId}
              onChange={(e) => setFormData({ ...formData, currentTankId: e.target.value })}
              style={inputStyle}
              onFocus={handleInputFocus}
              onBlur={handleInputBlur}
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
              Approx Birth Date <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", fontWeight: "400" }}>(optional)</span>
            </label>
            <input 
              type="date"
              value={formData.birthDate}
              onChange={(e) => setFormData({ ...formData, birthDate: e.target.value })}
              style={inputStyle}
              onFocus={handleInputFocus}
              onBlur={handleInputBlur}
            />
            <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginTop: "0.25rem", display: "block" }}>
              Left blank stays blank. We never fill in a date we don&apos;t know.
            </span>
          </div>
        </div>

        {/* Life stage. Added because a birth date is the wrong question for
            bought-in stock — most keepers know they bought a young adult, not the
            day it hatched. Recorded separately so neither value is derived from
            the other, and unknown stays unknown (utils/lifeStage.js). */}
        <div>
          <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
            Life stage <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", fontWeight: "400" }}>(optional)</span>
          </label>
          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
            {LIFE_STAGE_OPTIONS.filter((o) => canBeCertificated(o.value)).map((option) => {
              const selected = formData.lifeStage === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setFormData({ ...formData, lifeStage: selected ? "" : option.value })}
                  aria-pressed={selected}
                  style={{
                    flex: "1 1 auto",
                    minHeight: "40px",
                    padding: "0.5rem 0.9rem",
                    borderRadius: "6px",
                    cursor: "pointer",
                    fontSize: "0.8rem",
                    fontWeight: selected ? 600 : 400,
                    color: selected ? "#fff" : "var(--text-muted)",
                    background: selected
                      ? (casualModeActive ? "rgba(56, 189, 248, 0.18)" : "rgba(168, 85, 247, 0.22)")
                      : "rgba(0,0,0,0.2)",
                    border: selected
                      ? (casualModeActive ? "1px solid var(--accent-blue)" : "1px solid rgba(168, 85, 247, 0.5)")
                      : "1px solid var(--glass-border)",
                    transition: "all 0.2s ease",
                  }}
                >
                  {lifeStageOptionLabel(option, { casual: casualModeActive })}
                </button>
              );
            })}
          </div>
          <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginTop: "0.25rem", display: "block" }}>
            Eggs and fry are tracked as cohorts rather than individual certificates, so they aren&apos;t offered here.
          </span>
        </div>

        {/* Sex — the certificate form was the ONLY add-a-fish surface that didn't
            collect it, so every registered specimen defaulted to Unsexed and the
            Spawning wizard's pair pickers had nothing to validate against.
            Unknown stays a first-class answer: most species can't be sexed by eye
            and it never blocks a pairing. See BREEDER_TOOLS_T1_PAIRING_SPEC §2.3. */}
        <div>
          <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
            Sex
          </label>
          <div style={{ display: "flex", background: "rgba(0,0,0,0.2)", border: casualModeActive ? "1px solid var(--glass-border)" : "1px solid rgba(168, 85, 247, 0.3)", borderRadius: "6px", padding: "2px" }}>
            {SEX_OPTIONS.map((option) => {
              const selected = formData.gender === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setFormData({ ...formData, gender: option.value })}
                  aria-pressed={selected}
                  style={{
                    flex: 1,
                    padding: "0.55rem 0.5rem",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "0.8rem",
                    fontWeight: selected ? 600 : 400,
                    color: selected ? "#fff" : "var(--text-muted)",
                    background: selected
                      ? (casualModeActive ? "rgba(56, 189, 248, 0.18)" : "rgba(168, 85, 247, 0.22)")
                      : "transparent",
                    transition: "all 0.2s ease",
                  }}
                >
                  {option.symbol ? `${option.symbol} ` : ""}
                  {sexOptionLabel(option, { casual: casualModeActive })}
                </button>
              );
            })}
          </div>
          <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginTop: "0.25rem", display: "block" }}>
            Optional. Recording it lets the Spawning tools check a pairing before you breed.
          </span>
        </div>

        <div className="form-grid-2col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
              Male Parent (Sire)
            </label>
            <select
              value={formData.sireId}
              onChange={(e) => setFormData({ ...formData, sireId: e.target.value })}
              style={inputStyle}
              onFocus={handleInputFocus}
              onBlur={handleInputBlur}
            >
              <option value="0" style={{ background: "var(--bg-secondary)" }}>None (Wild / Unregistered)</option>
              {specimenOptions.map((spec) => (
                <option key={spec.id} value={spec.id} style={{ background: "var(--bg-secondary)" }}>
                  {specimenOptionLabel(spec)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
              Female Parent (Dam)
            </label>
            <select
              value={formData.damId}
              onChange={(e) => setFormData({ ...formData, damId: e.target.value })}
              style={inputStyle}
              onFocus={handleInputFocus}
              onBlur={handleInputBlur}
            >
              <option value="0" style={{ background: "var(--bg-secondary)" }}>None (Wild / Unregistered)</option>
              {specimenOptions.map((spec) => (
                <option key={spec.id} value={spec.id} style={{ background: "var(--bg-secondary)" }}>
                  {specimenOptionLabel(spec)}
                </option>
              ))}
            </select>
          </div>
        </div>
        {specimenOptions.length === 0 && (
          <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: "-0.5rem", display: "block" }}>
            No registered specimens yet — register parents first to link a family tree.
          </span>
        )}

        <div>
          <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
            Breeder Stock Tag <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", fontWeight: "400" }}>(optional — e.g. "esgIV")</span>
          </label>
          <input 
            type="text"
            value={formData.breederStockTag}
            onChange={(e) => setFormData({ ...formData, breederStockTag: e.target.value.slice(0, 16) })}
            placeholder="Your personal lineage tag..."
            maxLength={16}
            style={inputStyle}
            onFocus={handleInputFocus}
            onBlur={handleInputBlur}
          />
          <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginTop: "0.25rem", display: "block" }}>
            A short tag to trace this specimen back to your personal breedstock lineage.
          </span>
        </div>

        {/* Breeder attribution — derived, not entered.
            This used to be an editable field with an Edit button, but in Pro
            mode any edit threw "you do not have permission" (so the button
            could only ever produce an error), while in Casual mode the check
            was skipped entirely and the value was written to the certificate
            unvalidated. Worse, the Pro default wrote the *display name* into
            specimen.breeder, which the relayer defines as a canonical lowercase
            EOA. Attribution is now simply the signed-in account. Registering on
            behalf of another breeder needs a real permission model, not a
            free-text box. */}
        <div>
          <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
            Breeder Attribution
          </label>
          <div
            style={{
              ...inputStyle,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "0.75rem",
              background: "rgba(255,255,255,0.015)",
              cursor: "default",
            }}
          >
            <span style={{ color: "#fff", fontSize: "0.85rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {displayNameResolved || "—"}
            </span>
            <span
              title={walletAccount || ""}
              style={{ fontFamily: "monospace", fontSize: "0.7rem", color: "var(--text-muted)", flexShrink: 0 }}
            >
              {walletAccount ? `${walletAccount.slice(0, 6)}…${walletAccount.slice(-4)}` : ""}
            </span>
          </div>
          <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginTop: "0.25rem", display: "block" }}>
            This certificate is credited to your account. Change your display name in Settings.
          </span>
        </div>

        <div>
          <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
            Specimen Photo
          </label>
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <label style={{ 
              flex: 1, 
              padding: "0.75rem", 
              background: "rgba(255, 255, 255, 0.03)", 
              border: !casualModeActive ? "1px dashed rgba(168, 85, 247, 0.4)" : "1px dashed var(--glass-border)", 
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

        {/* Advanced section.
            Previously gated on `casualModeActive`, which had it backwards: the
            metadata URI is a Pro concern (a breeder who has actually pinned a
            document), and Pro was the one mode that couldn't reach the field.
            Now shown in Pro, where it belongs. */}
        {!casualModeActive && (
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
                  Metadata URI <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", fontWeight: "400" }}>(optional)</span>
                </label>
                <input 
                  type="text" 
                  value={formData.ipfsMetadataUri}
                  onChange={(e) => {
                    setFormData({ ...formData, ipfsMetadataUri: e.target.value });
                    if (metadataUriError) setMetadataUriError(null);
                  }}
                  onBlur={(e) => {
                    const check = validateMetadataUri(e.target.value);
                    setMetadataUriError(check.ok ? null : check.error);
                  }}
                  placeholder="ipfs://… or https://… — leave blank if none"
                  style={{
                    width: "100%", padding: "0.75rem", background: "rgba(255,255,255,0.03)",
                    border: metadataUriError ? "1px solid var(--accent-red)" : "1px solid var(--glass-border)",
                    color: "#fff", borderRadius: "4px", fontFamily: "monospace", fontSize: "0.8rem",
                  }}
                />
                {metadataUriError ? (
                  <span style={{ fontSize: "0.7rem", color: "var(--accent-red)", marginTop: "0.25rem", display: "block" }}>
                    {metadataUriError}
                  </span>
                ) : (
                  <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: "0.25rem", display: "block" }}>
                    Only set this if you have already published a metadata file for this specimen. Left blank, the certificate simply publishes no external document — which is accurate.
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        <button 
          type="submit" 
          className={!casualModeActive ? "btn-primary-pro" : "btn-primary"} 
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
