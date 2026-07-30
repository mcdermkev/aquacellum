import React, { useState, useEffect } from "react";
import { ethers, Contract } from "ethers";
import aquadexAbi from "../abi/AquadexManager.json";
import { addXp, XP_ACTIONS } from "../utils/xp";
import { getProvider } from "../utils/smartAccount";
import { relaySpawn, relayRegisterTank } from "../services/relayer";
import { putSpecimenPhoto } from "../services/tankMedia";
import { assessPairing, pairingMetadataAttributes } from "../services/pairingAssessment";
import { METADATA_URI_NONE, buildSpecimenMetadata } from "../services/specimenMetadata";
import { COI_RISK_CONFIG } from "../utils/coiCalculator";
import { PAIRING_COPY, pairingCandidateComparator, sexSymbol } from "../utils/specimenSex";
import { formatCertSerial, formatLocalRecordRef } from "../utils/specimenIdentity";
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

  // Inline "create a new tank" state for Step 2
  const [creatingTank, setCreatingTank] = useState(false);
  const [newTankName, setNewTankName] = useState("");
  const [tankBusy, setTankBusy] = useState(false);

  const handleCreateTank = async () => {
    const name = newTankName.trim();
    if (!name) return;
    setTankBusy(true);
    try {
      const res = await relayRegisterTank({ name, ownerAddress: walletAccount });
      if (!res.success) throw new Error(res.error || "Failed to create tank");
      const newTank = { id: Number(res.tankId), name, volumeLiters: 75, latestLog: null };
      setTanks(prev => [...prev, newTank]);
      setSelectedTankId(String(res.tankId));
      setSnappedParameters(null);
      setCreatingTank(false);
      setNewTankName("");
    } catch (err) {
      console.error("[SpawningWizard] Tank creation failed:", err);
      showToast(err.message || "Failed to create tank");
    } finally {
      setTankBusy(false);
    }
  };

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

      // 1. Load Species Catalog (on-chain, with local Dexie fallback)
      const catalog = {};
      try {
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
        for (const item of catalogResults) {
          if (item) catalog[item.id] = { scientificName: item.scientificName, commonName: item.commonName };
        }
      } catch (catalogErr) {
        console.warn("On-chain species catalog query failed:", catalogErr.message);
      }

      // Enrich catalog from local Dexie species data
      try {
        const localSpeciesRecords = await db.table("species").toArray();
        for (const sp of localSpeciesRecords) {
          const spId = Number(sp.speciesId || sp.id);
          if (spId && !catalog[spId]) {
            catalog[spId] = { scientificName: sp.scientificName || "", commonName: sp.commonName || "" };
          }
        }
      } catch (e) {
        // species table may not exist — that's fine
      }
      setSpeciesCatalog(catalog);

      // 2. Load all specimens to choose Sire/Dam (local-first, then on-chain fallback)
      let specimenToLocation = {};
      let localSpecimens = [];
      try {
        const cachedTanks = await db.tanks.where("ownerAddress").equals((walletAccount || "").toLowerCase()).toArray();
        for (const tank of cachedTanks) {
          if (tank.specimens) {
            for (const spec of tank.specimens) {
              specimenToLocation[Number(spec.id)] = {
                tankId: Number(tank.id),
                facility: tank.facility || "Main Room",
                parentUnitId: Number(tank.parentUnitId || 0)
              };
              // Build local specimen list from Dexie tank data
              localSpecimens.push({
                id: Number(spec.id),
                speciesId: Number(spec.speciesId),
                sireId: Number(spec.sireId || 0),
                damId: Number(spec.damId || 0),
                breeder: spec.breeder || walletAccount,
                status: Number(spec.status || 0),
                tankId: Number(tank.id),
                facility: tank.facility || "Main Room",
                parentUnitId: Number(tank.parentUnitId || 0),
                commonName: spec.commonName || "",
                scientificName: spec.scientificName || ""
              });
            }
          }
        }
      } catch (dbErr) {
        console.warn("Failed to load tanks from Dexie:", dbErr);
      }

      // Also check the specimens table directly for any not attached to tanks
      try {
        const dexieSpecimens = await db.specimens.where("ownerAddress").equals((walletAccount || "").toLowerCase()).toArray();
        for (const spec of dexieSpecimens) {
          // Archived certificates are hidden from the parent pickers (they're the
          // mis-entries and unknown-fate fish the keeper asked to stop seeing).
          // They still resolve in lineage — see BREEDER_STATE_MODEL §4.1.
          if (spec.archived) continue;
          if (!localSpecimens.some(ls => ls.id === Number(spec.id)) && Number(spec.status || 0) === 0) {
            const loc = specimenToLocation[Number(spec.id)] || { tankId: 0, facility: "Unknown", parentUnitId: 0 };
            localSpecimens.push({
              id: Number(spec.id),
              speciesId: Number(spec.speciesId),
              sireId: Number(spec.sireId || 0),
              damId: Number(spec.damId || 0),
              breeder: spec.breeder || walletAccount,
              status: 0,
              tankId: loc.tankId,
              facility: loc.facility,
              parentUnitId: loc.parentUnitId,
              commonName: spec.commonName || "",
              scientificName: spec.scientificName || ""
            });
          }
        }
      } catch (e) {
        // specimens table may not exist in all DB versions
      }

      // Try on-chain as well, merge with local data
      let onChainSpecimens = [];
      try {
        const totalSpecimens = Number(await contract.totalSpecimensMinted());
        const BATCH_SIZE = 10;
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
          onChainSpecimens.push(...batchResults.filter(Boolean));
        }
      } catch (chainErr) {
        console.warn("On-chain specimen query failed (expected for Privy-only users):", chainErr.message);
      }

      // Merge: local specimens + on-chain specimens (deduplicate by id)
      const allSpecimens = [...localSpecimens];
      for (const ocs of onChainSpecimens) {
        if (!allSpecimens.some(s => s.id === ocs.id)) {
          allSpecimens.push(ocs);
        }
      }
      // Filter to only active (status 0) specimens
      const activeSpecimens = allSpecimens.filter(s => s.status === 0);
      setSpecimens(activeSpecimens);

      // Enrich species catalog from local specimen names (fallback when on-chain catalog is empty)
      for (const spec of activeSpecimens) {
        if (spec.speciesId && !catalog[spec.speciesId] && (spec.commonName || spec.scientificName)) {
          catalog[spec.speciesId] = { 
            commonName: spec.commonName || `Species ID ${spec.speciesId}`, 
            scientificName: spec.scientificName || "" 
          };
        }
      }
      setSpeciesCatalog({ ...catalog });

      // 3. Load user tanks (local-first from Dexie, then on-chain fallback)
      let localTanks = [];
      try {
        const dexieTanks = await db.tanks.where("ownerAddress").equals((walletAccount || "").toLowerCase()).toArray();
        localTanks = dexieTanks.filter(t => t.active !== false).map(t => ({
          id: Number(t.id),
          name: t.name,
          volumeLiters: Number(t.volumeLiters || 0),
          latestLog: t.latestLog || (t.logs && t.logs.length > 0 ? t.logs[t.logs.length - 1] : null)
        }));
      } catch (e) {
        console.warn("Failed to load local tanks for spawning:", e);
      }

      // Also try on-chain for historical tanks
      let onChainTanks = [];
      try {
        let idx = 0;
        while (true) {
          try {
            const id = await contract.ownerTanks(walletAccount, idx);
            const t = await contract.tanks(id);
            if (t.active) {
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

              onChainTanks.push({
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
      } catch (chainErr) {
        console.warn("On-chain tank query failed:", chainErr.message);
      }

      // Merge local + on-chain tanks (deduplicate by id)
      const mergedTanks = [...localTanks];
      for (const oct of onChainTanks) {
        if (!mergedTanks.some(t => t.id === oct.id)) {
          mergedTanks.push(oct);
        }
      }
      setTanks(mergedTanks);
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
    const symbol = sexSymbol(spec.gender);
    return `Cert. Serial No. ${formatCertSerial(spec.id)}${symbol ? ` ${symbol}` : ""} - ${breedInfo.commonName} (Sire: ${spec.sireId || "None"}, Dam: ${spec.damId || "None"})`;
  };

  /**
   * Candidates for one side of the pair.
   *
   * ORDERS, NEVER FILTERS on sex (spec §1.2). Most aquarium species can't be
   * reliably sexed by eye and nearly every existing record is unsexed, so
   * removing same-sex or unsexed candidates would make this picker unusable on
   * real data. Complementary sex sorts first; everything stays selectable, and a
   * genuinely impossible pair is caught by the blocking signal below.
   */
  const candidatesFor = (counterpartId) => {
    const counterpart = specimens.find(s => s.id === Number(counterpartId));
    const pool = specimens.filter(s => {
      if (!counterpart) return true;
      if (s.id === counterpart.id) return false;
      return s.speciesId === counterpart.speciesId;
    });
    return [...pool].sort(pairingCandidateComparator(counterpart?.gender ?? null));
  };

  // ─── Pairing assessment ───────────────────────────────────────────────────
  //
  // This replaces a hand-rolled `calculateInbreeding` that compared only the two
  // candidates' IMMEDIATE parents, so cousins, half-cousins, and
  // grandparent–grandchild pairings all reported a confident "0% Safe Lineage" —
  // and that number was written onto every offspring's certificate. Relatedness
  // now comes from Wright's path method over three generations via
  // services/pairingAssessment.js. See BREEDER_TOOLS_T1_PAIRING_SPEC.md §2.4.
  //
  // It's async now (it walks the pedigree), so it lives in state rather than
  // being recomputed during render.
  const [assessment, setAssessment] = useState(null);
  const [assessing, setAssessing] = useState(false);

  const selectedSire = specimens.find(s => s.id === Number(selectedSireId));
  const selectedDam = specimens.find(s => s.id === Number(selectedDamId));

  useEffect(() => {
    if (!selectedSire || !selectedDam) {
      setAssessment(null);
      setAssessing(false);
      return;
    }
    // Stale-result guard: the breeder can change a selection while a pedigree
    // walk is in flight, and applying the old answer would mislabel the new pair.
    let active = true;
    setAssessing(true);
    (async () => {
      let contract = null;
      try {
        contract = new Contract(contractAddress, aquadexAbi, getProvider());
      } catch (e) {
        // Local-only is fine — the resolver reads Dexie first regardless.
      }
      const result = await assessPairing({
        contract,
        sire: selectedSire,
        dam: selectedDam,
        casual: casualModeActive,
      });
      if (!active) return;
      setAssessment(result);
      setAssessing(false);
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSireId, selectedDamId, contractAddress, casualModeActive]);

  const sexSignal = assessment?.sex || null;
  const coiSignal = assessment?.coi || null;
  const coiRisk = coiSignal?.available ? COI_RISK_CONFIG[coiSignal.riskLevel] : null;
  // A same-sex pair is the ONLY thing that blocks (spec §1.2). Unknown sex and a
  // high COI both proceed — most records are unsexed, and line-breeding is
  // deliberate practice.
  const pairingBlocked = sexSignal ? !sexSignal.ok : false;

  // Snapshot water parameter triggers
  const handleTankSelect = (tankId) => {
    setSelectedTankId(tankId);
    const selectedTank = tanks.find(t => t.id === Number(tankId));
    if (selectedTank && selectedTank.latestLog) {
      const log = selectedTank.latestLog;
      setSnappedParameters({
        temp: (Number(log.tempCelsiusX10) / 10).toFixed(1),
        ph: (Number(log.phX10) / 10).toFixed(1),
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

      // NOT mock data despite its former name (`mockMetadata`): this object is
      // written as the offspring's real, persisted metadata below and read back by
      // SpecimenDetailModal. Built through the shared builder so the cohort and
      // the Register form produce one document shape.
      const commonNameForSpecies = speciesCatalog[speciesId]?.commonName || "Specimen";
      const offspringMetadata = buildSpecimenMetadata({
        commonName: commonNameForSpecies,
        speciesId,
        sireId: selectedSireId,
        damId: selectedDamId,
        tankId: selectedTankId,
        name: `${commonNameForSpecies} Spawn Offspring`,
        description: `Bred via the Aquadex Spawning Wizard. Sire Cert. ${formatCertSerial(selectedSireId)}, Dam Cert. ${formatCertSerial(selectedDamId)}.`,
        extraAttributes: [
          // Self-describing relatedness claim: the coefficient travels with the
          // method and depth, and an unresolvable pedigree records an explicit
          // unknown instead of a "0%" that would read as verified-outbred.
          // See BREEDER_TOOLS_T1_PAIRING_SPEC.md §1.6 / §1.7.
          ...pairingMetadataAttributes(assessment, selectedSire, selectedDam),
          { trait_type: "Genetic Markers", value: activeMarkers.join(", ") },
          // The "Snapped " prefix is a contract with utils/pdfExport.js, which
          // filters on it to build the water-parameters block.
          ...snappedParameters ? [
            { trait_type: "Snapped Temp", value: `${snappedParameters.temp}°C` },
            { trait_type: "Snapped pH", value: snappedParameters.ph },
            { trait_type: "Snapped Ammonia", value: `${snappedParameters.ammonia} ppm` }
          ] : []
        ],
      });

      // No metadata document is published for a spawn cohort, so the on-chain
      // URI stays empty. This used to be
      // `"ipfs://bafkreispawnlogscompiledmetadata" + Math.random()…` — an invented
      // identifier that became each offspring's ERC-721 tokenURI and resolved to
      // nothing. Empty is the honest answer; see services/specimenMetadata.js.
      const ipfsHash = METADATA_URI_NONE;

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
        metadata: offspringMetadata,
      });

      if (!result.success) {
        throw new Error(result.error || "Breeding registration failed.");
      }

      const spawnId = result.spawnId;

      // Persist offspring photos/metadata locally.
      //
      // The cohort photo goes to the durable Dexie `tankMedia` store rather than
      // raw localStorage (BREEDER_STATE_MODEL §9.3). That matters more here than
      // anywhere else in the app: a single spawn writes the SAME photo once per
      // offspring, so a 10-fry cohort used to burn ten copies of one image
      // through the ~5MB origin quota. `putSpecimenPhoto` mirrors to localStorage
      // so existing readers keep working.
      let photoFailed = false;
      for (const offspringId of result.offspringIds) {
        if (selectedCohortPhoto) {
          try {
            await putSpecimenPhoto(offspringId, selectedCohortPhoto);
          } catch (photoErr) {
            console.warn("Cohort photo save failed:", photoErr);
            photoFailed = true;
          }
        }
        try {
          localStorage.setItem(`aquadex_specimen_metadata_${offspringId}`, JSON.stringify(offspringMetadata));
        } catch (storageErr) {
          console.warn("Offspring metadata save failed (quota?):", storageErr);
        }
      }
      if (photoFailed) {
        showToast("⚠️ Offspring registered, but the cohort photo could not be saved.");
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

  return (
    <div className="glass-card spawning-wizard-card" style={{ maxWidth: "680px", margin: "0 auto", padding: "2.5rem" }}>
      <h2 style={{ fontSize: "1.75rem", color: "#fff", display: "flex", alignItems: "center", gap: "0.5rem" }}>
        🥚 Breeding Pair Setup
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
        <div className="glass-card" style={{ padding: "2rem", border: "1px solid var(--accent-green)", textAlign: "center", position: "relative", overflow: "hidden" }}>
          <span style={{ fontSize: "2rem" }}>🎉</span>
          <h3 style={{ color: "var(--accent-green)", marginTop: "0.5rem" }}>Spawn Logged!</h3>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", margin: "0.75rem 0" }}>{txState.message}</p>

          {/* Morph Registration Prompt — shown when non-standard traits were selected */}
          {(geneticMarkers.albino || geneticMarkers.longfin || geneticMarkers.veil || geneticMarkers.melanistic || geneticMarkers.metallic || geneticMarkers.custom) && (
            <div style={{
              margin: "1rem 0", padding: "0.85rem 1rem", borderRadius: "10px",
              background: "rgba(232, 121, 249, 0.06)", border: "1px solid rgba(232, 121, 249, 0.2)",
              textAlign: "left",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.4rem" }}>
                <span style={{ fontSize: "1rem" }}>🎨</span>
                <span style={{ fontSize: "0.82rem", fontWeight: "700", color: "#e879f9" }}>Novel Traits Detected!</span>
              </div>
              <p style={{ fontSize: "0.75rem", color: "var(--text-secondary)", margin: "0 0 0.6rem", lineHeight: "1.5" }}>
                You selected non-standard phenotypes for this spawn ({[
                  geneticMarkers.albino && "Albino",
                  geneticMarkers.longfin && "Longfin",
                  geneticMarkers.veil && "Veiltail",
                  geneticMarkers.melanistic && "Melanistic",
                  geneticMarkers.metallic && "Metallic",
                  geneticMarkers.custom,
                ].filter(Boolean).join(", ")}). If this is a new morph or strain, consider registering it for verification.
              </p>
              <button
                onClick={() => {
                  setStep(1);
                  setSelectedSireId("0");
                  setSelectedDamId("0");
                  setSelectedTankId("0");
                  setSnappedParameters(null);
                  setSelectedCohortPhoto("");
                  setTxState({ status: "idle", message: "", txHash: "" });
                  if (onComplete) onComplete("morphs");
                }}
                style={{
                  padding: "0.5rem 1rem", borderRadius: "8px", fontSize: "0.78rem", fontWeight: "600",
                  background: "rgba(232, 121, 249, 0.1)", border: "1px solid rgba(232, 121, 249, 0.3)",
                  color: "#e879f9", cursor: "pointer", transition: "all 0.2s",
                }}
              >
                🎨 Register New Morph →
              </button>
            </div>
          )}

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
                    {candidatesFor(selectedDamId).map(s => (
                      <option key={`sire-${s.id}`} value={s.id}>{getSpecimenLabel(s)}</option>
                    ))}
                  </select>
                  
                  {selectedSireId !== "0" && selectedSire ? (
                    <div className="token-metadata">
                      <span className="token-title">
                        Cert. Serial No. {formatCertSerial(selectedSire.id)}
                        {sexSymbol(selectedSire.gender) && (
                          <span style={{ marginLeft: "0.35rem", color: selectedSire.gender === "Male" ? "#38bdf8" : "#f43f5e" }}>
                            {sexSymbol(selectedSire.gender)}
                          </span>
                        )}
                      </span>
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
                        Parents: Sire Cert. Serial No. {formatCertSerial(selectedSire.sireId, { none: "—" })} | Dam Cert. Serial No. {formatCertSerial(selectedSire.damId, { none: "—" })}
                      </span>
                    </div>
                  ) : (
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>
                      Choose a father certificate to display registry lineage.
                    </div>
                  )}
                </div>

                {/* RELATEDNESS CONNECTOR BADGE — real COI, or an honest "no
                    pedigree data" state. Never a fabricated 0%. */}
                {selectedSireId !== "0" && selectedDamId !== "0" && (
                  <div className="inbreeding-badge-connector">
                    {assessing ? (
                      <span className="badge" style={{ fontSize: "0.72rem", padding: "0.5rem 1rem", border: "1px solid var(--glass-border)", background: "rgba(255,255,255,0.04)", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                        {casualModeActive ? PAIRING_COPY.coiChecking.casual : PAIRING_COPY.coiChecking.pro}
                      </span>
                    ) : coiSignal?.available && coiRisk ? (
                      <span
                        className={`badge ${coiSignal.riskLevel === "critical" ? "pulsate-red-badge" : ""}`}
                        style={{
                          fontSize: "0.75rem", padding: "0.5rem 1rem", whiteSpace: "nowrap",
                          border: `1px solid ${coiRisk.color}55`, background: coiRisk.bg, color: coiRisk.color,
                          boxShadow: "0 4px 15px rgba(0,0,0,0.5)",
                        }}
                      >
                        {coiRisk.icon} {coiSignal.coi}% — {coiRisk.label}
                      </span>
                    ) : coiSignal ? (
                      <span style={{ fontSize: "0.72rem", padding: "0.5rem 1rem", whiteSpace: "nowrap", borderRadius: "12px", border: "1px solid var(--glass-border)", background: "rgba(255,255,255,0.04)", color: "var(--text-muted)" }}>
                        {casualModeActive ? PAIRING_COPY.coiUnavailable.casual : PAIRING_COPY.coiUnavailable.pro}
                      </span>
                    ) : null}
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
                    {candidatesFor(selectedSireId).map(d => (
                      <option key={`dam-${d.id}`} value={d.id}>{getSpecimenLabel(d)}</option>
                    ))}
                  </select>
                  
                  {selectedDamId !== "0" && selectedDam ? (
                    <div className="token-metadata">
                      <span className="token-title">
                        Cert. Serial No. {formatCertSerial(selectedDam.id)}
                        {sexSymbol(selectedDam.gender) && (
                          <span style={{ marginLeft: "0.35rem", color: selectedDam.gender === "Male" ? "#38bdf8" : "#f43f5e" }}>
                            {sexSymbol(selectedDam.gender)}
                          </span>
                        )}
                      </span>
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
                        Parents: Sire Cert. Serial No. {formatCertSerial(selectedDam.sireId, { none: "—" })} | Dam Cert. Serial No. {formatCertSerial(selectedDam.damId, { none: "—" })}
                      </span>
                    </div>
                  ) : (
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>
                      Choose a mother certificate to display registry lineage.
                    </div>
                  )}
                </div>
              </div>

              {/* PAIRING SIGNALS — three independent findings, reported
                  separately rather than collapsed into one verdict (the old code
                  reported a species mismatch AS an inbreeding result):
                    1. sex        — the only one that can block
                    2. relatedness — informational, never blocks (line-breeding)
                    3. species     — informational; the Next button keeps its own
                                     long-standing species guard */}
              {selectedSireId !== "0" && selectedDamId !== "0" && (
                <div className="glass-card" style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "0.85rem" }}>
                  {/* Sex */}
                  {sexSignal && (
                    <div style={{
                      display: "flex", gap: "0.6rem", alignItems: "flex-start",
                      padding: "0.7rem 0.85rem", borderRadius: "8px",
                      border: `1px solid ${sexSignal.severity === "error" ? "rgba(248,113,113,0.3)" : sexSignal.severity === "notice" ? "rgba(251,191,36,0.25)" : "rgba(52,211,153,0.25)"}`,
                      background: sexSignal.severity === "error" ? "rgba(248,113,113,0.06)" : sexSignal.severity === "notice" ? "rgba(251,191,36,0.04)" : "rgba(52,211,153,0.04)",
                    }}>
                      <span style={{ fontSize: "0.95rem" }}>
                        {sexSignal.severity === "error" ? "⛔" : sexSignal.severity === "notice" ? "⚠" : "✓"}
                      </span>
                      <span style={{ fontSize: "0.78rem", color: sexSignal.severity === "error" ? "var(--accent-red)" : "var(--text-secondary)", lineHeight: 1.5 }}>
                        {sexSignal.reason}
                      </span>
                    </div>
                  )}

                  {/* Species mismatch */}
                  {assessment?.species && !assessment.species.ok && (
                    <div style={{ display: "flex", gap: "0.6rem", alignItems: "flex-start", padding: "0.7rem 0.85rem", borderRadius: "8px", border: "1px solid rgba(251,191,36,0.25)", background: "rgba(251,191,36,0.04)" }}>
                      <span style={{ fontSize: "0.95rem" }}>⚠</span>
                      <span style={{ fontSize: "0.78rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                        {assessment.species.reason}
                      </span>
                    </div>
                  )}

                  {/* Relatedness */}
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.35rem", gap: "0.75rem", flexWrap: "wrap" }}>
                      <strong style={{ color: "#fff", fontSize: "0.88rem" }}>
                        {casualModeActive ? "How closely related they are" : "Relatedness (Wright's COI)"}
                      </strong>
                      {coiSignal?.available && (
                        <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                          {coiSignal.depth} generations
                        </span>
                      )}
                    </div>

                    {assessing ? (
                      <div className="shimmer-placeholder" style={{ height: "14px", borderRadius: "4px", maxWidth: "220px" }} />
                    ) : coiSignal?.available ? (
                      <>
                        <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem" }}>
                          <span style={{ fontSize: "1.35rem", fontWeight: 800, color: coiRisk?.color, fontFamily: "'JetBrains Mono', monospace" }}>
                            {coiSignal.coi}%
                          </span>
                          {coiRisk && (
                            <span style={{ fontSize: "0.7rem", fontWeight: 700, padding: "2px 8px", borderRadius: "10px", background: `${coiRisk.color}15`, border: `1px solid ${coiRisk.color}33`, color: coiRisk.color }}>
                              {coiRisk.icon} {coiRisk.label}
                            </span>
                          )}
                        </div>
                        <p style={{ fontSize: "0.75rem", color: "var(--text-secondary)", margin: "0.4rem 0 0", lineHeight: 1.55 }}>
                          {coiSignal.recommendation}
                        </p>
                        {coiSignal.sharedAncestors?.length > 0 && (
                          <div style={{ marginTop: "0.6rem", display: "flex", flexWrap: "wrap", gap: "4px" }}>
                            {coiSignal.paths.map((p, i) => (
                              <span key={i} style={{ fontSize: "0.66rem", padding: "2px 8px", borderRadius: "6px", background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.15)", color: "#e0e0e0" }}>
                                {p.ancestorName} <span style={{ color: "var(--text-muted)" }}>#{formatCertSerial(p.ancestorId)}</span>
                                <span style={{ color: "#fbbf24", marginLeft: "4px", fontFamily: "'JetBrains Mono', monospace" }}>
                                  +{(p.contribution * 100).toFixed(2)}%
                                </span>
                              </span>
                            ))}
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-muted)" }}>
                          {casualModeActive ? PAIRING_COPY.coiUnavailable.casual : PAIRING_COPY.coiUnavailable.pro}
                        </span>
                        <p style={{ fontSize: "0.75rem", color: "var(--text-secondary)", margin: "0.3rem 0 0", lineHeight: 1.55 }}>
                          {coiSignal?.unavailableReason
                            || (casualModeActive ? PAIRING_COPY.coiUnavailableDetail.casual : PAIRING_COPY.coiUnavailableDetail.pro)}
                        </p>
                      </>
                    )}
                  </div>
                </div>
              )}

              <button 
                className="btn-primary" 
                disabled={
                  selectedSireId === "0" ||
                  selectedDamId === "0" ||
                  (selectedSire && selectedDam && selectedSire.speciesId !== selectedDam.speciesId) ||
                  // A known same-sex pair is the only new block (spec §1.2).
                  pairingBlocked
                }
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
                  onChange={(e) => {
                    if (e.target.value === "__new__") {
                      setCreatingTank(true);
                      return;
                    }
                    setCreatingTank(false);
                    handleTankSelect(e.target.value);
                  }}
                  style={{ width: "100%", padding: "0.75rem", background: "rgba(8,12,20,0.9)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px" }}
                >
                  <option value="0">🧴 Pick a tank…</option>
                  {tanks.map(t => (
                    <option key={`tank-${t.id}`} value={t.id}>{t.name} (Serial No. {t.id.toString().padStart(3, "0")})</option>
                  ))}
                  <option value="__new__">➕ Create a new tank…</option>
                </select>

                {creatingTank && (
                  <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    <input
                      type="text"
                      value={newTankName}
                      onChange={(e) => setNewTankName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleCreateTank(); }}
                      placeholder={casualModeActive ? "Name your new tank (e.g. Breeding Tank)" : "New containment unit name"}
                      autoFocus
                      style={{ flex: 1, padding: "0.6rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px", fontSize: "0.85rem" }}
                    />
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={handleCreateTank}
                      disabled={tankBusy || !newTankName.trim()}
                      style={{ padding: "0.6rem 1rem", fontSize: "0.8rem", whiteSpace: "nowrap", opacity: tankBusy || !newTankName.trim() ? 0.6 : 1 }}
                    >
                      {tankBusy ? "Creating…" : "Create"}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setCreatingTank(false); setNewTankName(""); }}
                      style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "1rem", padding: "0 0.25rem" }}
                      aria-label="Cancel"
                    >
                      ×
                    </button>
                  </div>
                )}
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

              <div className="form-grid-2col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
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
                <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem" }}>
                  <span>Breeding Pair:</span>
                  <strong style={{ textAlign: "right" }}>
                    Sire Cert. Serial No. {formatCertSerial(selectedSireId)}{sexSymbol(selectedSire?.gender) ? ` ${sexSymbol(selectedSire.gender)}` : ""}
                    {" & "}
                    Dam Cert. Serial No. {formatCertSerial(selectedDamId)}{sexSymbol(selectedDam?.gender) ? ` ${sexSymbol(selectedDam.gender)}` : ""}
                  </strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem" }}>
                  <span>{casualModeActive ? "How related:" : "Relatedness (COI):"}</span>
                  {/* Mirrors exactly what gets recorded on the certificates — an
                      unresolvable pedigree reads as unknown, never as 0%. */}
                  <span style={{ textAlign: "right", color: coiSignal?.available ? (coiRisk?.color || "var(--text-secondary)") : "var(--text-muted)" }}>
                    {coiSignal?.available
                      ? `${coiSignal.coi}% — ${coiRisk?.label || ""}`
                      : (casualModeActive ? PAIRING_COPY.coiUnavailable.casual : PAIRING_COPY.coiUnavailable.pro)}
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>Target Unit:</span>
                  <strong>Tank Serial No. {formatLocalRecordRef(selectedTankId)}</strong>
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
