import React, { useState, useEffect } from "react";
import { ethers, Contract } from "ethers";
import aquadexAbi from "../abi/AquadexManager.json";
import { addXp, XP_ACTIONS } from "../utils/xp";
import { getProvider } from "../utils/smartAccount";
import { relaySpawn } from "../services/relayer";
import { compressImage } from "../utils/imageCompression";
import { db } from "../db";

const PHENOTYPES = [
  { id: "standard", label: "Standard Wildtype" },
  { id: "albino", label: "Albino (Amelanistic)" },
  { id: "longfin", label: "Longfin Gene" },
  { id: "veil", label: "Veiltail Mutation" },
  { id: "melanistic", label: "Melanistic (Dark)" },
  { id: "metallic", label: "Metallic / Iridescent Scale" }
];

export function SpawningWizard({ contractAddress, walletAccount, onComplete, casualModeActive = false }) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [specimens, setSpecimens] = useState([]);
  const [tanks, setTanks] = useState([]);
  const [speciesCatalog, setSpeciesCatalog] = useState({});
  const [error, setError] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  // Wizard state
  const [selectedSireId, setSelectedSireId] = useState("0");
  const [selectedDamId, setSelectedDamId] = useState("0");
  const [selectedTankId, setSelectedTankId] = useState("0");
  const [snappedParameters, setSnappedParameters] = useState(null);
  const [geneticMarkers, setGeneticMarkers] = useState({
    standard: true,
    albino: false,
    longfin: false,
    veil: false,
    melanistic: false,
    metallic: false,
    custom: ""
  });
  const [offspringCount, setOffspringCount] = useState(1);
  const [selectedCohortPhoto, setSelectedCohortPhoto] = useState("");

  const handleCohortPhotoChange = async (e) => {
    const file = e.target.files[0];
    if (file) {
      try {
        const compressed = await compressImage(file);
        setSelectedCohortPhoto(compressed);
      } catch (err) {
        console.error("Error compressing cohort image:", err);
        setTxState({ status: "error", message: "Failed to process selected cohort image.", txHash: "" });
      }
    }
  };

  // Tx/Fulfillment state
  const [txState, setTxState] = useState({
    status: "idle", // "idle" | "initiating" | "minting" | "success" | "error"
    message: "",
    txHash: ""
  });

  const loadWizardData = async () => {
    if (!walletAccount || !contractAddress) return;
    try {
      setLoading(true);
      setError(null);
      const provider = getProvider();
      const contract = new Contract(contractAddress, aquadexAbi, provider);

      // 1. Load Species Catalog (parallelized)
      const nextId = await contract.nextSpeciesId();
      const totalSpeciesCount = Number(nextId) - 1;
      const catalogPromises = [];
      for (let i = 1; i <= totalSpeciesCount; i++) {
        catalogPromises.push(
          contract.speciesCatalog(i)
            .then(spec => spec.active ? { id: i, scientificName: spec.scientificName, commonName: spec.commonName } : null)
            .catch(() => null)
        );
      }
      const catalogResults = await Promise.all(catalogPromises);
      const catalog = {};
      for (const item of catalogResults) {
        if (item) catalog[item.id] = { scientificName: item.scientificName, commonName: item.commonName };
      }
      setSpeciesCatalog(catalog);

      // 2. Load all specimens to choose Sire/Dam (parallelized ownership checks)
      const totalSpecimens = Number(await contract.totalSpecimensMinted());
      let specimenToLocation = {};
      try {
        const cachedTanks = await db.tanks.toArray();
        for (const tank of cachedTanks) {
          if (tank.specimens) {
            for (const spec of tank.specimens) {
              specimenToLocation[Number(spec.id)] = {
                tankId: Number(tank.id),
                facility: tank.facility || "Main Room",
                parentUnitId: Number(tank.parentUnitId || 0)
              };
            }
          }
        }
      } catch (dbErr) {
        console.warn("Failed to load tanks from Dexie:", dbErr);
      }

      // Batch ownership checks in groups of 10
      const BATCH_SIZE = 10;
      const fetchedSpecimens = [];
      for (let batchStart = 1; batchStart <= totalSpecimens; batchStart += BATCH_SIZE) {
        const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, totalSpecimens);
        const batchPromises = [];
        for (let i = batchStart; i <= batchEnd; i++) {
          batchPromises.push(
            contract.ownerOf(i)
              .then(async (owner) => {
                if (owner.toLowerCase() === walletAccount.toLowerCase()) {
                  const spec = await contract.specimens(i);
                  if (Number(spec.status) === 0) {
                    const loc = specimenToLocation[i] || { tankId: 0, facility: "Unknown", parentUnitId: 0 };
                    return {
                      id: i,
                      speciesId: Number(spec.speciesId),
                      sireId: Number(spec.sireId),
                      damId: Number(spec.damId),
                      breeder: spec.breeder,
                      status: Number(spec.status),
                      tankId: loc.tankId,
                      facility: loc.facility,
                      parentUnitId: loc.parentUnitId
                    };
                  }
                }
                return null;
              })
              .catch(() => null)
          );
        }
        const batchResults = await Promise.all(batchPromises);
        fetchedSpecimens.push(...batchResults.filter(Boolean));
      }
      setSpecimens(fetchedSpecimens);

      // 3. Load user tanks (sequential — typically few tanks)
      const tempTanks = [];
      let idx = 0;
      while (true) {
        try {
          const id = await contract.ownerTanks(walletAccount, idx);
          const t = await contract.tanks(id);
          if (t.active) {
            // Fetch latest parameter log
            let latestLog = null;
            try {
              let logIndex = 0;
              while (true) {
                try {
                  const log = await contract.tankParameterLogs(id, logIndex);
                  latestLog = log;
                  logIndex++;
                } catch (e) {
                  break;
                }
              }
            } catch (e) {}

            tempTanks.push({
              id: Number(id),
              name: t.name,
              volumeLiters: Number(t.volumeLiters),
              latestLog
            });
          }
          idx++;
        } catch (err) {
          break;
        }
      }
      setTanks(tempTanks);
    } catch (err) {
      console.error("Error loading wizard metadata:", err);
      setError("Failed to resolve registry data for spawning setup.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWizardData();
  }, [contractAddress, walletAccount]);

  const getSpecimenLabel = (spec) => {
    const breedInfo = speciesCatalog[spec.speciesId] || { commonName: `Species ID ${spec.speciesId}` };
    return `Cert. Serial No. ${spec.id.toString().padStart(3, "0")} - ${breedInfo.commonName} (Sire: ${spec.sireId || "None"}, Dam: ${spec.damId || "None"})`;
  };

  // Inbreeding Coefficient Calculation
  const calculateInbreeding = () => {
    const sire = specimens.find(s => s.id === Number(selectedSireId));
    const dam = specimens.find(s => s.id === Number(selectedDamId));

    if (!sire || !dam) return { coefficient: 0, text: "Safe (0%)", type: "safe" };
    if (sire.speciesId !== dam.speciesId) return { coefficient: 0, text: "Hybrid / Species Mismatch", type: "warning" };

    // Sibling Pair (Shared father and mother)
    const shareSire = sire.sireId > 0 && sire.sireId === dam.sireId;
    const shareDam = sire.damId > 0 && sire.damId === dam.damId;

    if (shareSire && shareDam) {
      return { coefficient: 25, text: "Critical Sibling Pair (25% Inbreeding)", type: "critical" };
    }
    // Half Sibling Pair (Shared sire OR dam, but not both)
    if (shareSire || shareDam) {
      return { coefficient: 12.5, text: "High Half-Sibling Pair (12.5% Inbreeding)", type: "warning" };
    }
    // Parent-Offspring Pair
    if (sire.id === dam.sireId || sire.id === dam.damId || dam.id === sire.sireId || dam.id === sire.damId) {
      return { coefficient: 25, text: "Critical Parent-Offspring Pair (25% Inbreeding)", type: "critical" };
    }

    return { coefficient: 0, text: "Safe Lineage (0% Shared Parents)", type: "safe" };
  };

  const inbreedingResult = calculateInbreeding();

  // Snapshot water parameter triggers
  const handleTankSelect = (tankId) => {
    setSelectedTankId(tankId);
    const selectedTank = tanks.find(t => t.id === Number(tankId));
    if (selectedTank && selectedTank.latestLog) {
      const log = selectedTank.latestLog;
      setSnappedParameters({
        temp: (Number(log.tempCelsiusX10) / 10).toFixed(1),
        ph: (Number(log.phX10) / 10).toFixed(1),
        salinity: (Number(log.salinitySgX10000) / 10000).toFixed(4),
        ammonia: (Number(log.ammoniaPpmX100) / 100).toFixed(2),
        nitrite: (Number(log.nitritePpmX100) / 100).toFixed(2),
        nitrate: (Number(log.nitratePpmX100) / 100).toFixed(1),
        timestamp: Number(log.timestamp)
      });
    } else {
      setSnappedParameters(null);
    }
  };

  const handleCheckboxChange = (marker) => {
    setGeneticMarkers(prev => ({
      ...prev,
      [marker]: !prev[marker]
    }));
  };

  const handleSpawningExecution = async () => {
    setTxState({ status: "initiating", message: "Initiating Spawn Record in secure registry...", txHash: "" });
    try {
      // Sire/Dam species ID verification
      const sire = specimens.find(s => s.id === Number(selectedSireId));
      if (!sire) throw new Error("Please select a valid Sire.");
      const speciesId = sire.speciesId;

      // Metadata compilation
      const activeMarkers = Object.keys(geneticMarkers)
        .filter(k => k !== "custom" && geneticMarkers[k])
        .concat(geneticMarkers.custom ? [geneticMarkers.custom] : []);

      const mockMetadata = {
        name: `${speciesCatalog[speciesId]?.commonName || "Specimen"} Spawn Offspring`,
        description: `Bred via Aquadex Spawning Wizard. Parent Sire: #${selectedSireId}, Parent Dam: #${selectedDamId}.`,
        attributes: [
          { trait_type: "Sire ID", value: selectedSireId },
          { trait_type: "Dam ID", value: selectedDamId },
          { trait_type: "Inbreeding Coefficient", value: `${inbreedingResult.coefficient}%` },
          { trait_type: "Containment Tank ID", value: selectedTankId },
          { trait_type: "Genetic Markers", value: activeMarkers.join(", ") },
          ...snappedParameters ? [
            { trait_type: "Snapped Temp", value: `${snappedParameters.temp}°C` },
            { trait_type: "Snapped pH", value: snappedParameters.ph },
            { trait_type: "Snapped Salinity", value: snappedParameters.salinity },
            { trait_type: "Snapped Ammonia", value: `${snappedParameters.ammonia} ppm` }
          ] : []
        ]
      };

      const ipfsHash = "ipfs://bafkreispawnlogscompiledmetadata" + Math.random().toString(36).substring(2, 7);

      // Beta: register spawn + mint offspring locally (no MetaMask, no gas)
      setTxState({ status: "minting", message: `Registering ${offspringCount} offspring birth certificates...`, txHash: "" });
      const result = await relaySpawn({
        sireId: Number(selectedSireId),
        damId: Number(selectedDamId),
        tankId: Number(selectedTankId),
        speciesId,
        offspringCount: Number(offspringCount),
        ownerAddress: walletAccount,
        commonName: speciesCatalog[speciesId]?.commonName || "Specimen",
        scientificName: speciesCatalog[speciesId]?.scientificName || "Unknown",
        ipfsMetadataUri: ipfsHash,
        metadata: mockMetadata,
      });

      if (!result.success) {
        throw new Error(result.error || "Breeding registration failed.");
      }

      const spawnId = result.spawnId;

      // Persist offspring photos/metadata locally
      for (const offspringId of result.offspringIds) {
        try {
          if (selectedCohortPhoto) {
            localStorage.setItem(`aquadex_specimen_photo_${offspringId}`, selectedCohortPhoto);
          }
          localStorage.setItem(`aquadex_specimen_metadata_${offspringId}`, JSON.stringify(mockMetadata));
        } catch (storageErr) {
          console.error("Storage quota error:", storageErr);
          showToast("⚠️ Storage Quota Exceeded! Offspring registered, but device is out of space for local photos/metadata.");
        }
      }

      // Add Breeder XP points
      addXp(XP_ACTIONS.SPAWN_BREED.points, XP_ACTIONS.SPAWN_BREED.label);

      setTxState({ status: "success", message: `Successfully registered Spawn Record Serial No. ${spawnId.toString().slice(-3)} with ${offspringCount} birth certificates!`, txHash: "" });
    } catch (err) {
      console.error(err);
      setTxState({ status: "error", message: err.reason || err.message || "Breeding registration failed.", txHash: "" });
    }
  };

  if (loading) {
    return <div className="glass-card shimmer-placeholder" style={{ height: "400px", borderRadius: "var(--radius-md)" }} />;
  }

  if (error) {
    return (
      <div className="glass-card" style={{ padding: "2rem", border: "1px solid rgba(248,113,113,0.2)" }}>
        <p style={{ color: "var(--accent-red)" }}>{error}</p>
        <button className="btn-primary" onClick={loadWizardData} style={{ marginTop: "1rem" }}>Retry</button>
      </div>
    );
  }

  const selectedSire = specimens.find(s => s.id === Number(selectedSireId));
  const selectedDam = specimens.find(s => s.id === Number(selectedDamId));

  return (
    <div className="glass-card spawning-wizard-card" style={{ maxWidth: "680px", margin: "0 auto", padding: "2.5rem" }}>
      <h2 style={{ fontSize: "1.75rem", color: "#fff", display: "flex", alignItems: "center", gap: "0.5rem" }}>
        🐶 Breeding Pair Setup
      </h2>
      <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
        Follow the simple steps below to pair your fish, pick a tank, and register new fry — no technical knowledge needed!
      </p>

      {/* Stepper Node header */}
      <div className="wizard-steps-header" style={{ marginTop: "1rem" }}>
        <div className="wizard-steps-line"></div>
        <div className="wizard-steps-line-fill" style={{ width: `${((step - 1) / 3) * 100}%` }}></div>
        {[1, 2, 3, 4].map((num) => (
          <div 
            key={num} 
            className={`wizard-step-node ${step === num ? "active" : step > num ? "completed" : ""}`}
          >
            {step > num ? "✓" : num}
          </div>
        ))}
      </div>

      {txState.status !== "idle" && txState.status !== "success" && txState.status !== "error" && (
        <div className="glass-card" style={{ padding: "1.5rem", border: "1px solid var(--accent-blue)", textAlign: "center" }}>
          <div className="shimmer-placeholder" style={{ height: "4px", borderRadius: "2px", marginBottom: "1rem" }}></div>
          <p style={{ color: "#fff" }}>{txState.message}</p>
          {txState.txHash && (
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontFamily: "monospace", display: "block", wordBreak: "break-all", marginTop: "0.5rem" }}>
              Pending: {txState.txHash}
            </span>
          )}
        </div>
      )}

      {txState.status === "success" && (
        <div className="glass-card" style={{ padding: "2rem", border: "1px solid var(--accent-green)", textAlign: "center" }}>
          <span style={{ fontSize: "2rem" }}>🎉</span>
          <h3 style={{ color: "var(--accent-green)", marginTop: "0.5rem" }}>Spawn Logged!</h3>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", margin: "0.75rem 0" }}>{txState.message}</p>
          <button className="btn-primary" onClick={() => {
            setStep(1);
            setSelectedSireId("0");
            setSelectedDamId("0");
            setSelectedTankId("0");
            setSnappedParameters(null);
            setSelectedCohortPhoto("");
            setTxState({ status: "idle", message: "", txHash: "" });
            loadWizardData();
            if (onComplete) onComplete();
          }}>
            Pair Up & Try Again
          </button>
        </div>
      )}

      {txState.status === "error" && (
        <div className="glass-card" style={{ padding: "1.5rem", border: "1px solid var(--accent-red)" }}>
          <h4 style={{ color: "var(--accent-red)" }}>Something Went Wrong</h4>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", margin: "0.5rem 0" }}>{txState.message}</p>
          <button className="btn-secondary" onClick={() => setTxState({ status: "idle", message: "", txHash: "" })} style={{ width: "100%" }}>
            Go Back & Adjust
          </button>
        </div>
      )}

      {txState.status === "idle" && (
        <>
          {/* STEP 1: PARENTAL PAIR SELECTION */}
          {step === 1 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              <h3 style={{ fontSize: "1.1rem", color: "var(--accent-blue)" }}>Step 1: Find a Compatible Match</h3>

              <div className="spawning-pair-grid">
                {/* SIRE CARD TOKEN */}
                <div className={`specimen-token-card ${selectedSire ? (selectedSire.sireId === 0 && selectedSire.damId === 0 ? "wild" : (selectedSire.sireId !== 0 && selectedSire.damId !== 0 ? "purebred" : "f1")) : ""} ${selectedSireId !== "0" ? "active" : ""}`}>
                  <h4 style={{ color: "var(--accent-blue)", fontSize: "0.85rem", marginBottom: "0.75rem", textTransform: "uppercase" }}>Sire (Father / Cohort)</h4>
                  
                  <div className="token-avatar-container">
                    {selectedSireId !== "0" ? "🐟" : "🧬"}
                  </div>

                  <select 
                    value={selectedSireId}
                    onChange={(e) => setSelectedSireId(e.target.value)}
                    style={{ width: "100%", padding: "0.5rem", background: "rgba(8,12,20,0.9)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px", fontSize: "0.8rem", marginBottom: "0.5rem" }}
                  >
                    <option value="0">🐟 Select a Male Fish…</option>
                    {specimens.map(s => (
                      <option key={`sire-${s.id}`} value={s.id}>{getSpecimenLabel(s)}</option>
                    ))}
                  </select>
                  
                  {selectedSireId !== "0" && selectedSire ? (
                    <div className="token-metadata">
                      <span className="token-title">Cert. Serial No. {selectedSire.id.toString().padStart(3, "0")}</span>
                      <span className="token-subtitle">
                        {speciesCatalog[selectedSire.speciesId]?.commonName || `Species ID ${selectedSire.speciesId}`}
                      </span>
                      <span className="badge" style={{ 
                        fontSize: "0.6rem", 
                        padding: "0.1rem 0.4rem", 
                        marginTop: "0.25rem",
                        alignSelf: "center",
                        backgroundColor: selectedSire.sireId === 0 && selectedSire.damId === 0 ? "var(--accent-green-glow)" : (selectedSire.sireId !== 0 && selectedSire.damId !== 0 ? "var(--accent-amber-glow)" : "var(--accent-blue-glow)"),
                        color: selectedSire.sireId === 0 && selectedSire.damId === 0 ? "var(--accent-green)" : (selectedSire.sireId !== 0 && selectedSire.damId !== 0 ? "var(--accent-amber)" : "var(--accent-blue)"),
                        border: selectedSire.sireId === 0 && selectedSire.damId === 0 ? "1px solid rgba(52, 211, 153, 0.3)" : (selectedSire.sireId !== 0 && selectedSire.damId !== 0 ? "1px solid rgba(251, 191, 36, 0.3)" : "1px solid rgba(56, 189, 248, 0.3)")
                      }}>
                        {selectedSire.sireId === 0 && selectedSire.damId === 0 ? "Wild Caught" : (selectedSire.sireId !== 0 && selectedSire.damId !== 0 ? "Purebred" : "Ancestral F1")}
                      </span>
                      <span className="token-pedigree-info">
                        Parents: Sire Cert. Serial No. {selectedSire.sireId ? selectedSire.sireId.toString().padStart(3, "0") : "000"} | Dam Cert. Serial No. {selectedSire.damId ? selectedSire.damId.toString().padStart(3, "0") : "000"}
                      </span>
                    </div>
                  ) : (
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>
                      Choose a father certificate to display registry lineage.
                    </div>
                  )}
                </div>

                {/* INBREEDING CONNECTOR / BADGE OVERLAY */}
                {selectedSireId !== "0" && selectedDamId !== "0" && (
                  <div className="inbreeding-badge-connector">
                    <span className={`badge ${
                      inbreedingResult.type === "critical" ? "badge-red pulsate-red-badge" : 
                      inbreedingResult.type === "warning" ? "badge-amber" : 
                      "badge-green"
                    }`} style={{ fontSize: "0.75rem", padding: "0.5rem 1rem", border: "1px solid currentColor", boxShadow: "0 4px 15px rgba(0,0,0,0.5)", whiteSpace: "nowrap" }}>
                      {inbreedingResult.text}
                    </span>
                  </div>
                )}

                {/* DAM CARD TOKEN */}
                <div className={`specimen-token-card ${selectedDam ? (selectedDam.sireId === 0 && selectedDam.damId === 0 ? "wild" : (selectedDam.sireId !== 0 && selectedDam.damId !== 0 ? "purebred" : "f1")) : ""} ${selectedDamId !== "0" ? "active" : ""}`}>
                  <h4 style={{ color: "var(--accent-blue)", fontSize: "0.85rem", marginBottom: "0.75rem", textTransform: "uppercase" }}>Dam (Mother / Cohort)</h4>
                  
                  <div className="token-avatar-container">
                    {selectedDamId !== "0" ? "🐟" : "🧬"}
                  </div>

                  <select 
                    value={selectedDamId}
                    onChange={(e) => setSelectedDamId(e.target.value)}
                    style={{ width: "100%", padding: "0.5rem", background: "rgba(8,12,20,0.9)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px", fontSize: "0.8rem", marginBottom: "0.5rem" }}
                  >
                    <option value="0">🐟 Find a Compatible Match…</option>
                    {specimens
                      .filter(d => {
                        if (selectedSireId === "0") return true;
                        const sire = specimens.find(s => s.id === Number(selectedSireId));
                        if (!sire) return true;
                        if (d.id === sire.id) return false;
                        if (d.speciesId !== sire.speciesId) return false;
                        if (!casualModeActive) {
                          const sameFacility = d.facility && sire.facility && d.facility.toLowerCase() === sire.facility.toLowerCase() && d.facility !== "Unknown";
                          const sameTank = d.tankId > 0 && sire.tankId > 0 && d.tankId === sire.tankId;
                          const sireTankParent = sire.parentUnitId || 0;
                          const damTankParent = d.parentUnitId || 0;
                          const sameParentUnit = (sireTankParent > 0 && sireTankParent === damTankParent) ||
                                                 (sireTankParent > 0 && sireTankParent === d.tankId) ||
                                                 (damTankParent > 0 && damTankParent === sire.tankId);
                          return sameFacility || sameTank || sameParentUnit;
                        }
                        return true;
                      })
                      .map(d => (
                        <option key={`dam-${d.id}`} value={d.id}>{getSpecimenLabel(d)}</option>
                      ))}
                  </select>
                  
                  {selectedDamId !== "0" && selectedDam ? (
                    <div className="token-metadata">
                      <span className="token-title">Cert. Serial No. {selectedDam.id.toString().padStart(3, "0")}</span>
                      <span className="token-subtitle">
                        {speciesCatalog[selectedDam.speciesId]?.commonName || `Species ID ${selectedDam.speciesId}`}
                      </span>
                      <span className="badge" style={{ 
                        fontSize: "0.6rem", 
                        padding: "0.1rem 0.4rem", 
                        marginTop: "0.25rem",
                        alignSelf: "center",
                        backgroundColor: selectedDam.sireId === 0 && selectedDam.damId === 0 ? "var(--accent-green-glow)" : (selectedDam.sireId !== 0 && selectedDam.damId !== 0 ? "var(--accent-amber-glow)" : "var(--accent-blue-glow)"),
                        color: selectedDam.sireId === 0 && selectedDam.damId === 0 ? "var(--accent-green)" : (selectedDam.sireId !== 0 && selectedDam.damId !== 0 ? "var(--accent-amber)" : "var(--accent-blue)"),
                        border: selectedDam.sireId === 0 && selectedDam.damId === 0 ? "1px solid rgba(52, 211, 153, 0.3)" : (selectedDam.sireId !== 0 && selectedDam.damId !== 0 ? "1px solid rgba(251, 191, 36, 0.3)" : "1px solid rgba(56, 189, 248, 0.3)")
                      }}>
                        {selectedDam.sireId === 0 && selectedDam.damId === 0 ? "Wild Caught" : (selectedDam.sireId !== 0 && selectedDam.damId !== 0 ? "Purebred" : "Ancestral F1")}
                      </span>
                      <span className="token-pedigree-info">
                        Parents: Sire Cert. Serial No. {selectedDam.sireId ? selectedDam.sireId.toString().padStart(3, "0") : "000"} | Dam Cert. Serial No. {selectedDam.damId ? selectedDam.damId.toString().padStart(3, "0") : "000"}
                      </span>
                    </div>
                  ) : (
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>
                      Choose a mother certificate to display registry lineage.
                    </div>
                  )}
                </div>
              </div>

              {selectedSireId !== "0" && selectedDamId !== "0" && (
                <div 
                  className="glass-card" 
                  style={{ 
                    padding: "1.25rem", 
                    display: "flex", 
                    justifyContent: "space-between", 
                    alignItems: "center",
                    border: inbreedingResult.coefficient > 0 ? "1px solid rgba(251, 191, 36, 0.3)" : "1px solid rgba(52, 211, 153, 0.3)",
                    background: inbreedingResult.coefficient > 0 ? "rgba(251, 191, 36, 0.02)" : "rgba(52, 211, 153, 0.02)"
                  }}
                >
                  <div>
                    <strong style={{ color: "#fff", fontSize: "0.9rem", display: "block" }}>Ancestry Safety Audit</strong>
                    <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                      Analyzed parent genetic indices back to F0 ancestors.
                    </span>
                  </div>

                  <span className={`badge ${
                    inbreedingResult.type === "critical" ? "badge-red pulsate-red-badge" : 
                    inbreedingResult.type === "warning" ? "badge-amber" : 
                    "badge-green"
                  }`} style={{ fontSize: "0.7rem", padding: "0.3rem 0.75rem" }}>
                    {inbreedingResult.text}
                  </span>
                </div>
              )}

              <button 
                className="btn-primary" 
                disabled={selectedSireId === "0" || selectedDamId === "0" || (selectedSire && selectedDam && selectedSire.speciesId !== selectedDam.speciesId)} 
                onClick={() => setStep(2)}
                style={{ marginLeft: "auto", marginTop: "1rem" }}
              >
                Next Step: Snap Telemetry
              </button>
            </div>
          )}

          {/* STEP 2: CONTAINMENT TELEMETRY SNAP */}
          {step === 2 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              <h3 style={{ fontSize: "1.1rem", color: "var(--accent-blue)" }}>Step 2: Choose a Home Tank</h3>

              <div>
                <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.5rem" }}>Which tank will they breed in?</label>
                <select 
                  value={selectedTankId}
                  onChange={(e) => handleTankSelect(e.target.value)}
                  style={{ width: "100%", padding: "0.75rem", background: "rgba(8,12,20,0.9)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px" }}
                >
                  <option value="0">🧴 Pick a tank…</option>
                  {tanks.map(t => (
                    <option key={`tank-${t.id}`} value={t.id}>{t.name} (Serial No. {t.id.toString().padStart(3, "0")})</option>
                  ))}
                </select>
              </div>

              {selectedTankId !== "0" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>Environmental Chemistry Snapshot:</span>
                    <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                      {snappedParameters ? `Last Water Test: ${new Date(snappedParameters.timestamp * 1000).toLocaleString()}` : "No telemetry logs found"}
                    </span>
                  </div>

                  {snappedParameters ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                        <div className="telemetry-tile-premium">
                          <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>Temp</span>
                          <strong style={{ fontSize: "1.2rem", color: "#fff" }}>{snappedParameters.temp}°C</strong>
                        </div>
                        <div className="telemetry-tile-premium">
                          <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>pH</span>
                          <strong style={{ fontSize: "1.2rem", color: "#fff" }}>{snappedParameters.ph}</strong>
                        </div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem" }}>
                        <div className="telemetry-tile-premium">
                          <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>Ammonia</span>
                          <strong style={{ fontSize: "1.2rem", color: Number(snappedParameters.ammonia) > 0.05 ? "var(--accent-red)" : "#fff" }}>
                            {snappedParameters.ammonia} ppm
                          </strong>
                        </div>
                        <div className="telemetry-tile-premium">
                          <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>Nitrite</span>
                          <strong style={{ fontSize: "1.2rem", color: Number(snappedParameters.nitrite) > 0.05 ? "var(--accent-red)" : "#fff" }}>
                            {snappedParameters.nitrite} ppm
                          </strong>
                        </div>
                        <div className="telemetry-tile-premium">
                          <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>Nitrate</span>
                          <strong style={{ fontSize: "1.2rem", color: Number(snappedParameters.nitrate) > 20.0 ? "var(--accent-amber)" : "#fff" }}>
                            {snappedParameters.nitrate} ppm
                          </strong>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="glass-card" style={{ padding: "2rem", textAlign: "center", border: "1px dashed var(--glass-border)" }}>
                      <p style={{ color: "var(--accent-amber)" }}>⚠️ No water parameters have been logged in the registry for this unit. We will record empty telemetry traits.</p>
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "1rem" }}>
                <button className="btn-secondary" onClick={() => setStep(1)}>Back</button>
                <button className="btn-primary" disabled={selectedTankId === "0"} onClick={() => setStep(3)}>
                  Next Step: Genetic Checklist
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: GENETIC MUTATION CHECKLIST */}
          {step === 3 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              <h3 style={{ fontSize: "1.1rem", color: "var(--accent-blue)" }}>Step 3: Genetic Checklist</h3>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                {PHENOTYPES.map(p => (
                  <div 
                    key={p.id} 
                    className="glass-card" 
                    onClick={() => handleCheckboxChange(p.id)}
                    style={{ 
                      padding: "1rem", 
                      display: "flex", 
                      alignItems: "center", 
                      gap: "0.75rem", 
                      cursor: "pointer",
                      border: geneticMarkers[p.id] ? "1px solid var(--accent-blue)" : "1px solid var(--glass-border)",
                      background: geneticMarkers[p.id] ? "rgba(56, 189, 248, 0.05)" : "var(--glass-bg)"
                    }}
                  >
                    <input 
                      type="checkbox" 
                      checked={geneticMarkers[p.id]} 
                      onChange={() => {}} // handled by click
                      style={{ cursor: "pointer" }}
                    />
                    <span style={{ fontSize: "0.9rem", color: "#fff" }}>{p.label}</span>
                  </div>
                ))}
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.5rem" }}>Other Specific Mutations / Phenotypes</label>
                <input 
                  type="text" 
                  value={geneticMarkers.custom} 
                  onChange={(e) => setGeneticMarkers(prev => ({ ...prev, custom: e.target.value }))}
                  placeholder="e.g. Platinum Red-Ear Mosaic, Dumbo Ear"
                  style={{ width: "100%", padding: "0.75rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px" }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "1rem" }}>
                <button className="btn-secondary" onClick={() => setStep(2)}>Back</button>
                <button className="btn-primary" onClick={() => setStep(4)}>
                  Next Step: Bulk Allocation
                </button>
              </div>
            </div>
          )}

          {/* STEP 4: BULK ALLOCATION SUMMARY */}
          {step === 4 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              <h3 style={{ fontSize: "1.1rem", color: "var(--accent-blue)" }}>Step 4: Bulk Offspring Allocation</h3>

              <div>
                <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.5rem" }}>Number of Offspring Fry to Register (1-10)</label>
                <input 
                  type="number" 
                  min="1" 
                  max="10" 
                  value={offspringCount} 
                  onChange={(e) => setOffspringCount(Math.min(10, Math.max(1, Number(e.target.value))))}
                  style={{ width: "100%", padding: "0.75rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px" }}
                />
                <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: "0.25rem", display: "block" }}>
                  To prevent resource limits, a maximum of 10 offspring certificates can be registered in a single wizard flow.
                </span>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.5rem" }}>Cohort Photo (Optional)</label>
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
                    {selectedCohortPhoto ? "✓ Cohort Photo Selected" : "📁 Upload Cohort Photo"}
                    <input 
                      type="file" 
                      accept="image/*"
                      onChange={handleCohortPhotoChange}
                      style={{ display: "none" }}
                    />
                  </label>
                  {selectedCohortPhoto && (
                    <div style={{ position: "relative", width: "40px", height: "40px", borderRadius: "4px", overflow: "hidden", border: "1px solid var(--glass-border)" }}>
                      <img src={selectedCohortPhoto} alt="Cohort Preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      <button 
                        type="button" 
                        onClick={() => setSelectedCohortPhoto("")}
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

              <div className="glass-card" style={{ padding: "1.25rem", background: "rgba(0,0,0,0.2)", display: "flex", flexDirection: "column", gap: "0.75rem", fontSize: "0.85rem" }}>
                <strong style={{ color: "#fff", fontSize: "0.95rem" }}>Breeding Registry Summary</strong>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>Breeding Pair:</span>
                  <strong>Sire Cert. Serial No. {selectedSireId.padStart(3, "0")} & Dam Cert. Serial No. {selectedDamId.padStart(3, "0")}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>Inbreeding Risk:</span>
                  <span style={{ color: inbreedingResult.coefficient > 0 ? "var(--accent-amber)" : "var(--accent-green)" }}>
                    {inbreedingResult.text}
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>Target Unit:</span>
                  <strong>Tank Serial No. {selectedTankId.padStart(3, "0")}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>Offspring Yield:</span>
                  <strong>{offspringCount} Birth Certificates</strong>
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "1rem" }}>
                <button className="btn-secondary" onClick={() => setStep(3)}>Back</button>
                <button className="btn-primary" onClick={handleSpawningExecution} style={{ background: "linear-gradient(135deg, var(--accent-green) 0%, #047857 100%)", boxShadow: "0 4px 14px 0 rgba(16, 185, 129, 0.4)" }}>
                  Submit & Log Breeding Event
                </button>
              </div>
            </div>
          )}
        </>
      )}

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
