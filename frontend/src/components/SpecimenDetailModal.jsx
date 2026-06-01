import React, { useState, useEffect, useRef } from "react";
import { ethers, Contract, ZeroAddress } from "ethers";
import aquadexAbi from "../abi/AquadexManager.json";
import { getProvider } from "../utils/smartAccount";
import { FishSilhouetteSVG, PlantSilhouetteSVG } from "./SilhouetteSVG";
import { Modal } from "./Modal";
import { db } from "../db";
import { generatePedigreeCertificate } from "../utils/pdfExport";

// Helper: detect if a fishbase record or specCode is a plant entry
const isPlantEntry = (specCodeOrItem) => {
  if (typeof specCodeOrItem === "object" && specCodeOrItem !== null) {
    return specCodeOrItem.type === "plant";
  }
  return false;
};

export function SpecimenDetailModal({ 
  specimenId, 
  contractAddress, 
  walletAccount, 
  onClose, 
  onViewLineage, 
  onListOnMarketplace,
  casualModeActive = false
}) {
  const [activeId, setActiveId] = useState(specimenId);
  const [loading, setLoading] = useState(true);
  const [spec, setSpec] = useState(null);
  const [speciesInfo, setSpeciesInfo] = useState(null);
  const [tankInfo, setTankInfo] = useState(null);
  const [metadata, setMetadata] = useState(null);
  const [error, setError] = useState(null);
  const [fishbaseData, setFishbaseData] = useState([]);
  const [lineageTree, setLineageTree] = useState(null);
  const [activeUserTank, setActiveUserTank] = useState(null);

  // (Escape key handling is now provided by the Modal component)

  useEffect(() => {
    const getActiveTank = async () => {
      try {
        const cached = localStorage.getItem("aquadex_display_tank");
        let activeTank = null;

        if (cached) {
          try {
            const parsed = JSON.parse(cached);
            if (parsed && typeof parsed === "object") {
              if (parsed.id) {
                activeTank = await db.tanks.get(parsed.id);
              }
            } else if (parsed) {
              activeTank = await db.tanks.get(Number(parsed));
            }
          } catch (err) {
            if (cached && !isNaN(cached)) {
              activeTank = await db.tanks.get(Number(cached));
            }
          }
        }

        if (!activeTank) {
          const allTanks = await db.tanks.toArray();
          activeTank = allTanks[0] || null;
        }

        setActiveUserTank(activeTank);
      } catch (err) {
        console.error("Error resolving active tank profile in modal:", err);
      }
    };
    getActiveTank();
  }, [walletAccount]);

  const [gbrSpecialGlow, setGbrSpecialGlow] = useState(false);
  const gbrTimeoutRef = useRef(null);

  const isGBR = speciesInfo?.commonName?.toLowerCase()?.includes("german blue ram") ||
                (speciesInfo && fishbaseData.find(f => f.scientificName.toLowerCase() === speciesInfo.scientificName.toLowerCase())?.commonName?.toLowerCase()?.includes("german blue ram"));

  const startGBRTimer = () => {
    if (!isGBR) return;
    if (gbrTimeoutRef.current) clearTimeout(gbrTimeoutRef.current);
    gbrTimeoutRef.current = setTimeout(() => {
      setGbrSpecialGlow(true);
      window.dispatchEvent(new CustomEvent('poseidon:echo-reaction', {
        detail: { mood: "paired_swimming", glowActive: true, glowColor: "#ffd700", swimSpeedMultiplier: 1.0, durationMs: 12000 }
      }));
    }, 12000);
  };

  const clearGBRTimer = () => {
    if (gbrTimeoutRef.current) {
      clearTimeout(gbrTimeoutRef.current);
      gbrTimeoutRef.current = null;
    }
  };

  useEffect(() => {
    setGbrSpecialGlow(false);
    return () => clearGBRTimer();
  }, [isGBR, activeId]);

  const handleGBRStart = () => {
    if (isGBR) {
      startGBRTimer();
    }
  };

  const handleGBRRelease = () => {
    if (!gbrSpecialGlow) {
      clearGBRTimer();
    }
  };

  useEffect(() => {
    fetch("/fishbase_master.json")
      .then((res) => {
        if (!res.ok) throw new Error("Could not load reference library");
        return res.json();
      })
      .then((data) => setFishbaseData(data))
      .catch((err) => console.error("Error loading fishbase reference inside modal:", err));
  }, []);

  useEffect(() => {
    if (activeId) {
      loadDetails();
    }
  }, [activeId, contractAddress]);

  const loadDetails = async () => {
    try {
      setLoading(true);
      setError(null);
      setLineageTree(null);
      const provider = getProvider();
      const contract = new Contract(contractAddress, aquadexAbi, provider);

      // 1. Fetch specimen registry
      const rawSpec = await contract.specimens(activeId);
      if (Number(rawSpec.specimenId) === 0) {
        throw new Error("Specimen certificate does not exist in registry.");
      }

      let owner = ZeroAddress;
      try {
        owner = await contract.ownerOf(activeId);
      } catch (e) {
        console.warn("Could not fetch owner, token might be burned/deprecated:", e);
      }

      const resolvedSpec = {
        specimenId: Number(rawSpec.specimenId),
        speciesId: Number(rawSpec.speciesId),
        birthTimestamp: Number(rawSpec.birthTimestamp),
        breeder: rawSpec.breeder,
        currentTankId: Number(rawSpec.currentTankId),
        sireId: Number(rawSpec.sireId),
        damId: Number(rawSpec.damId),
        ipfsMetadataUri: rawSpec.ipfsMetadataUri,
        status: Number(rawSpec.status),
        owner
      };

      setSpec(resolvedSpec);

      // Helper function to fetch a single lineage node
      const fetchNode = async (id) => {
        if (!id || Number(id) === 0) return null;
        try {
          const nodeSpec = await contract.specimens(id);
          if (Number(nodeSpec.specimenId) === 0) return null;
          let commonName = "Unknown Breed";
          try {
            const nodeSpecies = await contract.speciesCatalog(Number(nodeSpec.speciesId));
            commonName = nodeSpecies.commonName || "Unknown Breed";
          } catch (catalogErr) {
            console.warn("Catalog fetch failed for speciesId:", nodeSpec.speciesId, catalogErr);
          }
          return {
            id: Number(nodeSpec.specimenId),
            speciesId: Number(nodeSpec.speciesId),
            sireId: Number(nodeSpec.sireId),
            damId: Number(nodeSpec.damId),
            commonName,
            status: Number(nodeSpec.status),
          };
        } catch (e) {
          console.warn("Failed to fetch lineage node:", id, e);
          return null;
        }
      };

      // Asynchronously fetch 3 generations of ancestors
      const loadLineageTree = async (sireId, damId) => {
        try {
          // Gen 1
          const sire = await fetchNode(sireId);
          const dam = await fetchNode(damId);

          // Gen 2
          const sireSire = sire ? await fetchNode(sire.sireId) : null;
          const sireDam = sire ? await fetchNode(sire.damId) : null;
          const damSire = dam ? await fetchNode(dam.sireId) : null;
          const damDam = dam ? await fetchNode(dam.damId) : null;

          // Gen 3
          const sireSireSire = sireSire ? await fetchNode(sireSire.sireId) : null;
          const sireSireDam = sireSire ? await fetchNode(sireSire.damId) : null;
          const sireDamSire = sireDam ? await fetchNode(sireDam.sireId) : null;
          const sireDamDam = sireDam ? await fetchNode(sireDam.damId) : null;
          const damSireSire = damSire ? await fetchNode(damSire.sireId) : null;
          const damSireDam = damSire ? await fetchNode(damSire.damId) : null;
          const damDamSire = damDam ? await fetchNode(damDam.sireId) : null;
          const damDamDam = damDam ? await fetchNode(damDam.damId) : null;

          setLineageTree({
            sire,
            dam,
            sireSire,
            sireDam,
            damSire,
            damDam,
            sireSireSire,
            sireSireDam,
            sireDamSire,
            sireDamDam,
            damSireSire,
            damSireDam,
            damDamSire,
            damDamDam,
          });
        } catch (err) {
          console.warn("Failed loading multi-generational tree payload:", err);
        }
      };

      // 2. Fetch species catalog details
      const rawSpecies = await contract.speciesCatalog(resolvedSpec.speciesId);
      setSpeciesInfo({
        commonName: rawSpecies.commonName,
        scientificName: rawSpecies.scientificName,
        careLevel: Number(rawSpecies.careLevel),
        minTemp: Number(rawSpecies.minTempCelsiusX10) / 10,
        maxTemp: Number(rawSpecies.maxTempCelsiusX10) / 10,
        minPh: Number(rawSpecies.minPhX10) / 10,
        maxPh: Number(rawSpecies.maxPhX10) / 10
      });

      // Fetch the multi-generational tree
      await loadLineageTree(resolvedSpec.sireId, resolvedSpec.damId);

      // 3. Fetch tank parameters if assigned
      if (resolvedSpec.currentTankId > 0) {
        try {
          const rawTank = await contract.tanks(resolvedSpec.currentTankId);
          setTankInfo({
            id: resolvedSpec.currentTankId,
            name: rawTank.name,
            facility: rawTank.facility || "Main Room",
            room: rawTank.room || "Garage Rack",
            rack: rawTank.rack || "Outdoor Ponds"
          });
        } catch (e) {
          console.warn("Error reading tank details from contract:", e);
          setTankInfo(null);
        }
      } else {
        setTankInfo(null);
      }

      // 4. Resolve cached spawning metadata
      const cached = localStorage.getItem(`aquadex_specimen_metadata_${activeId}`);
      if (cached) {
        try {
          setMetadata(JSON.parse(cached));
        } catch (e) {
          console.warn("Failed to parse cached local metadata:", e);
        }
      } else {
        setMetadata(null);
      }

    } catch (err) {
      console.error("Error loading registry details for specimen overlay:", err);
      setError(err.reason || err.message || "Failed to load registry details.");
    } finally {
      setLoading(false);
    }
  };

  const calculateAge = (timestamp) => {
    if (!timestamp || timestamp === 0) return "Wild-Caught / Unknown Age";
    const diffSeconds = Math.floor(Date.now() / 1000) - timestamp;
    if (diffSeconds < 0) return "Just Born";
    const days = Math.floor(diffSeconds / 86400);
    if (days < 30) return `${days} Days Old (Fry)`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months} Months Old (Juvenile)`;
    const years = (months / 12).toFixed(1);
    return `${years} Years Old (Adult)`;
  };

  const evaluateCompatibility = (species, tank) => {
    if (!species || !tank) return false;

    let minTemp = species.minTemp;
    let maxTemp = species.maxTemp;
    let minPh = species.minPh;
    let maxPh = species.maxPh;

    if (minTemp === undefined && species.tankMetrics?.tempRangeCelsius) {
      minTemp = species.tankMetrics.tempRangeCelsius[0];
      maxTemp = species.tankMetrics.tempRangeCelsius[1];
    }
    if (minPh === undefined && species.tankMetrics?.phRange) {
      minPh = species.phRange?.[0] || species.tankMetrics.phRange[0];
      maxPh = species.phRange?.[1] || species.tankMetrics.phRange[1];
    }

    if (minTemp === undefined || maxTemp === undefined || minPh === undefined || maxPh === undefined) {
      return false;
    }

    let tankTempX10 = null;
    let tankPhX10 = null;

    if (tank.latestLog) {
      tankTempX10 = tank.latestLog.tempCelsiusX10;
      tankPhX10 = tank.latestLog.phX10;
    }

    if (tankTempX10 === undefined || tankTempX10 === null) {
      tankTempX10 = tank.currentTempX10 ?? tank.tempCelsiusX10;
    }
    if (tankPhX10 === undefined || tankPhX10 === null) {
      tankPhX10 = tank.minPhX10 ?? tank.phX10;
    }

    if (tankTempX10 === undefined || tankTempX10 === null || tankPhX10 === undefined || tankPhX10 === null) {
      return false;
    }

    const tankTemp = Number(tankTempX10) / 10;
    const tankPh = Number(tankPhX10) / 10;

    return tankTemp >= minTemp && tankTemp <= maxTemp && tankPh >= minPh && tankPh <= maxPh;
  };

  if (!activeId) return null;

  const statusBadgeColors = [
    { text: "#22c55e", bg: "rgba(34, 197, 94, 0.1)", border: "rgba(34, 197, 94, 0.2)" }, // Active
    { text: "#ef4444", bg: "rgba(239, 68, 68, 0.1)", border: "rgba(239, 68, 68, 0.2)" }, // Deceased
    { text: "#3b82f6", bg: "rgba(59, 130, 246, 0.1)", border: "rgba(59, 130, 246, 0.2)" }  // Rehomed
  ];

  const customPhoto = localStorage.getItem(`aquadex_specimen_photo_${activeId}`);
  const matchedSpecies = speciesInfo && fishbaseData.find(
    (f) => f.scientificName.toLowerCase() === speciesInfo.scientificName.toLowerCase()
  );
  const masterPhotoUrl = matchedSpecies?.masterPhotoUrl || "";
  const finalImgSrc = customPhoto || masterPhotoUrl;
  const isPlant = isPlantEntry(matchedSpecies || { specCode: spec?.speciesId || 0 });
  const badgeLabel = isPlant ? "🌿 Certified Master Flora" : "🛡️ Breeder-Verified Master Stock";
  const badgeBg = isPlant ? "rgba(16,185,129,0.18)" : "rgba(56,189,248,0.12)";
  const badgeBorder = isPlant ? "rgba(16,185,129,0.45)" : "rgba(56,189,248,0.35)";
  const badgeColor = isPlant ? "#34d399" : "#7dd3fc";

  const renderNodeCard = (node, label) => {
    if (!node) {
      return (
        <div style={{
          padding: "0.3rem 0.4rem",
          borderRadius: "6px",
          background: "rgba(255, 255, 255, 0.01)",
          border: "1px dashed rgba(255, 255, 255, 0.05)",
          textAlign: "center",
          fontSize: "0.6rem",
          color: "var(--text-muted)",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          minHeight: "42px"
        }}>
          <span style={{ fontSize: "0.5rem", opacity: 0.5 }}>{label}</span>
          <span>Unknown Ancestor</span>
        </div>
      );
    }

    return (
      <div 
        onClick={() => setActiveId(node.id)}
        style={{
          padding: "0.3rem 0.4rem",
          borderRadius: "6px",
          background: "rgba(255, 255, 255, 0.03)",
          border: "1px solid var(--glass-border)",
          cursor: "pointer",
          fontSize: "0.6rem",
          transition: "all 0.2s ease",
          minHeight: "42px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(255, 255, 255, 0.08)";
          e.currentTarget.style.borderColor = "var(--accent-blue)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "rgba(255, 255, 255, 0.03)";
          e.currentTarget.style.borderColor = "var(--glass-border)";
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.2rem" }}>
          <span style={{ fontSize: "0.5rem", color: "var(--accent-blue)", fontWeight: "600" }}>{label}</span>
          <span style={{ fontFamily: "monospace", opacity: 0.8 }}>Cert. #{node.id}</span>
        </div>
        <div style={{ color: "#fff", fontWeight: "600", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {node.commonName}
        </div>
      </div>
    );
  };

  const renderPedigreeTree = () => {
    return (
      <div className="pedigree-tree-container">
        {/* Gen 0 */}
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: "0.5rem", flex: 1, minWidth: "110px" }}>
          {renderNodeCard(spec ? { id: spec.specimenId, commonName: speciesInfo.commonName } : null, "Target")}
        </div>

        {/* Conn */}
        <div className="pedigree-connector-col" style={{ display: "flex", flexDirection: "column", justifyContent: "space-around", color: "var(--text-muted)", fontSize: "0.7rem", padding: "0 0.1rem" }}>
          <div>◀</div>
          <div>◀</div>
        </div>

        {/* Gen 1 */}
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-around", gap: "0.5rem", flex: 1, minWidth: "110px" }}>
          {renderNodeCard(lineageTree?.sire, "Sire (Father)")}
          {renderNodeCard(lineageTree?.dam, "Dam (Mother)")}
        </div>

        {/* Conn */}
        <div className="pedigree-connector-col" style={{ display: "flex", flexDirection: "column", justifyContent: "space-around", color: "var(--text-muted)", fontSize: "0.7rem", padding: "0 0.1rem" }}>
          <div style={{ height: "50%", display: "flex", flexDirection: "column", justifyContent: "space-around" }}>
            <div>◀</div>
            <div>◀</div>
          </div>
          <div style={{ height: "50%", display: "flex", flexDirection: "column", justifyContent: "space-around" }}>
            <div>◀</div>
            <div>◀</div>
          </div>
        </div>

        {/* Gen 2 */}
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", gap: "0.35rem", flex: 1, minWidth: "110px" }}>
          {renderNodeCard(lineageTree?.sireSire, "Sire's Sire")}
          {renderNodeCard(lineageTree?.sireDam, "Sire's Dam")}
          {renderNodeCard(lineageTree?.damSire, "Dam's Sire")}
          {renderNodeCard(lineageTree?.damDam, "Dam's Dam")}
        </div>

        {/* Conn */}
        <div className="pedigree-connector-col" style={{ display: "flex", flexDirection: "column", justifyContent: "space-around", color: "var(--text-muted)", fontSize: "0.7rem", padding: "0 0.1rem" }}>
          <div style={{ height: "25%", display: "flex", flexDirection: "column", justifyContent: "space-around" }}>
            <div>◀</div>
            <div>◀</div>
          </div>
          <div style={{ height: "25%", display: "flex", flexDirection: "column", justifyContent: "space-around" }}>
            <div>◀</div>
            <div>◀</div>
          </div>
          <div style={{ height: "25%", display: "flex", flexDirection: "column", justifyContent: "space-around" }}>
            <div>◀</div>
            <div>◀</div>
          </div>
          <div style={{ height: "25%", display: "flex", flexDirection: "column", justifyContent: "space-around" }}>
            <div>◀</div>
            <div>◀</div>
          </div>
        </div>

        {/* Gen 3 */}
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", gap: "0.25rem", flex: 1, minWidth: "110px" }}>
          {renderNodeCard(lineageTree?.sireSireSire, "Sire's G-Sire")}
          {renderNodeCard(lineageTree?.sireSireDam, "Sire's G-Dam")}
          {renderNodeCard(lineageTree?.sireDamSire, "Sire's G-Sire")}
          {renderNodeCard(lineageTree?.sireDamDam, "Sire's G-Dam")}
          {renderNodeCard(lineageTree?.damSireSire, "Dam's G-Sire")}
          {renderNodeCard(lineageTree?.damSireDam, "Dam's G-Dam")}
          {renderNodeCard(lineageTree?.damDamSire, "Dam's G-Sire")}
          {renderNodeCard(lineageTree?.damDamDam, "Dam's G-Dam")}
        </div>
      </div>
    );
  };

  const badge = spec ? (statusBadgeColors[spec.status] || statusBadgeColors[0]) : statusBadgeColors[0];
  const isMine = spec && walletAccount && spec.owner.toLowerCase() === walletAccount.toLowerCase();

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      ariaLabel={`Birth Certificate Serial No. ${activeId.toString().padStart(3, "0")}`}
      className="glass-card specimen-detail-modal-card"
      fullScreenMobile={true}
    >
      <div 
        onMouseDown={handleGBRStart}
        onTouchStart={handleGBRStart}
        onMouseUp={handleGBRRelease}
        onMouseLeave={handleGBRRelease}
        onTouchEnd={handleGBRRelease}
        style={gbrSpecialGlow ? {
          border: "1px solid #ffd700",
          boxShadow: "0 0 15px rgba(255, 215, 0, 0.4), inset 0 0 10px rgba(255, 215, 0, 0.2)",
          transition: "all 0.5s ease",
          display: "flex",
          flexDirection: "column",
          height: "100%"
        } : { display: "flex", flexDirection: "column", height: "100%" }}
      >
        {/* Header bar */}
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "1.25rem 1.5rem",
          borderBottom: "1px solid var(--glass-border)"
        }}>
          <h3 style={{ fontSize: "1.25rem", color: "#fff", display: "flex", alignItems: "center", gap: "0.5rem", margin: 0 }}>
            <span>{isPlant ? "🌿" : "🐟"}</span> Birth Certificate Serial No. {activeId.toString().padStart(3, "0")}
          </h3>
          <button 
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              fontSize: "1.5rem",
              cursor: "pointer",
              padding: "0.25rem",
              lineHeight: 1
            }}
          >
            &times;
          </button>
        </div>

        {/* Modal content body */}
        <div style={{ padding: "1.5rem", overflowY: "auto", display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {loading ? (
            <div className="shimmer-placeholder" style={{ height: "300px", width: "100%", borderRadius: "var(--radius-sm)" }}></div>
          ) : error ? (
            <div style={{ padding: "2rem", color: "var(--accent-red)", background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "var(--radius-sm)", textAlign: "center" }}>
              {error}
            </div>
          ) : (
            <>
              {/* Media card Area */}
              <div className="specimen-detail-media-area">
                {/* Photo frame */}
                <div style={{
                  height: "12rem",
                  width: "100%",
                  borderRadius: "0.75rem",
                  background: "linear-gradient(135deg, rgba(255, 255, 255, 0.03) 0%, rgba(255, 255, 255, 0.01) 100%)",
                  backdropFilter: "blur(12px)",
                  boxShadow: "inset 0 1px 1px rgba(255, 255, 255, 0.05), 0 4px 15px rgba(0, 0, 0, 0.1)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                  position: "relative"
                }}>
                  <img 
                    src={finalImgSrc || ""} 
                    alt={`Specimen ${activeId}`} 
                    style={{ 
                      width: "100%", 
                      height: "100%", 
                      objectFit: "cover", 
                      borderRadius: "0.75rem",
                      display: finalImgSrc ? "block" : "none"
                    }}
                    onError={(e) => {
                      e.target.style.display = "none";
                      const fallback = e.target.nextSibling;
                      if (fallback) fallback.style.display = "block";
                    }}
                  />
                  {isPlant ? (
                    <PlantSilhouetteSVG
                      specCode={spec?.speciesId || 9001}
                      style={{ width: "100px", height: "100px", display: finalImgSrc ? "none" : "block" }}
                    />
                  ) : (
                    <FishSilhouetteSVG 
                      specimenId={activeId} 
                      style={{ 
                        width: "120px", 
                        height: "120px",
                        display: finalImgSrc ? "none" : "block"
                      }} 
                    />
                  )}

                  {/* Glassmorphic Verified Master Badge */}
                  {masterPhotoUrl && (
                    <span style={{
                      position: "absolute",
                      bottom: "0.6rem",
                      left: "50%",
                      transform: "translateX(-50%)",
                      fontSize: "0.6rem",
                      fontWeight: "700",
                      padding: "0.22rem 0.65rem",
                      borderRadius: "20px",
                      whiteSpace: "nowrap",
                      color: badgeColor,
                      background: badgeBg,
                      border: `1px solid ${badgeBorder}`,
                      backdropFilter: "blur(8px)",
                      letterSpacing: "0.03em"
                    }}>
                      {badgeLabel}
                    </span>
                  )}
                  
                  {isMine && (
                    <span className="badge badge-blue" style={{ position: "absolute", top: "0.75rem", left: "0.75rem", fontSize: "0.65rem" }}>
                      👤 Owned By You
                    </span>
                  )}

                  <span style={{ 
                    position: "absolute", 
                    top: "0.75rem", 
                    right: "0.75rem", 
                    fontSize: "0.65rem",
                    fontWeight: "700",
                    padding: "0.25rem 0.5rem",
                    borderRadius: "4px",
                    color: badge.text,
                    background: badge.bg,
                    border: `1px solid ${badge.border}`
                  }}>
                    {spec.status === 0 ? "Active" : spec.status === 1 ? "Deceased" : "Rehomed"}
                  </span>
                </div>

                {/* Identity & Registry stats */}
                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                  <div>
                    <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", display: "block", textTransform: "uppercase" }}>Common Name</span>
                    <strong style={{ fontSize: "1.25rem", color: "#fff" }}>{speciesInfo.commonName}</strong>
                    {evaluateCompatibility(speciesInfo || matchedSpecies, activeUserTank) && (
                      <div className="perfect-fit-badge">✅ Perfect Aquarium Fit</div>
                    )}
                  </div>
                  <div>
                    <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", display: "block", textTransform: "uppercase" }}>Scientific Name</span>
                    <span style={{ fontSize: "0.9rem", color: "var(--text-secondary)", fontStyle: "italic" }}>{speciesInfo.scientificName}</span>
                  </div>
                  <div>
                    <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", display: "block", textTransform: "uppercase" }}>Estimated Age</span>
                    <span style={{ fontSize: "0.9rem", color: "#fff" }}>{calculateAge(spec.birthTimestamp)}</span>
                  </div>
                  <div>
                    <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", display: "block", textTransform: "uppercase" }}>Registry Address</span>
                    <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)", fontFamily: "monospace", wordBreak: "break-all" }}>
                      {spec.owner}
                    </span>
                  </div>
                </div>
              </div>

              {/* Husbandry Containment & Chemistry Snapshots */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
                
                {/* Location Unit details */}
                <div className="glass-card" style={{ padding: "1rem" }}>
                  <h4 style={{ fontSize: "0.85rem", color: "var(--accent-blue)", margin: "0 0 0.75rem 0", display: "flex", alignItems: "center", gap: "0.25rem" }}>
                    <span>🏠</span> Containment Biotope
                  </h4>
                  {tankInfo ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", fontSize: "0.8rem" }}>
                      <div>
                        <span style={{ color: "var(--text-secondary)" }}>Unit Name:</span>{" "}
                        <strong style={{ color: "#fff" }}>{tankInfo.name}</strong>
                      </div>
                      <div>
                        <span style={{ color: "var(--text-secondary)" }}>Registry ID:</span>{" "}
                        <strong style={{ color: "var(--accent-amber)" }}>#{tankInfo.id}</strong>
                      </div>
                      <div>
                        <span style={{ color: "var(--text-secondary)" }}>Location:</span>{" "}
                        <span style={{ color: "var(--text-primary)" }}>{tankInfo.facility} › {tankInfo.room} › {tankInfo.rack}</span>
                      </div>
                    </div>
                  ) : (
                    <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", margin: 0 }}>Unassigned (Not currently placed in a registered tank).</p>
                  )}
                </div>

                {/* Pedigree Parents links */}
                <div className="glass-card" style={{ padding: "1rem" }}>
                  <h4 style={{ fontSize: "0.85rem", color: "var(--accent-blue)", margin: "0 0 0.75rem 0", display: "flex", alignItems: "center", gap: "0.25rem" }}>
                    <span>🧬</span> Parental Lineage
                  </h4>
                  {casualModeActive ? (
                    <div style={{
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "center",
                      alignItems: "center",
                      gap: "0.5rem",
                      padding: "0.5rem 0",
                      textAlign: "center"
                    }}>
                      <div style={{
                        fontSize: "0.8rem",
                        fontWeight: "700",
                        color: "#34d399",
                        background: "rgba(16, 185, 129, 0.12)",
                        border: "1px solid rgba(16, 185, 129, 0.3)",
                        padding: "0.35rem 0.75rem",
                        borderRadius: "20px",
                        letterSpacing: "0.03em"
                      }}>
                        🧬 Verified Purebred Family Lineage
                      </div>
                      <div style={{
                        fontSize: "0.8rem",
                        fontWeight: "700",
                        color: "var(--accent-amber)",
                        background: "rgba(245, 158, 11, 0.12)",
                        border: "1px solid rgba(245, 158, 11, 0.3)",
                        padding: "0.35rem 0.75rem",
                        borderRadius: "20px",
                        letterSpacing: "0.03em"
                      }}>
                        🏆 Premium Local Stock
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.8rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ color: "var(--text-secondary)" }}>Sire (Father):</span>
                        {spec.sireId > 0 ? (
                          <button 
                            onClick={() => setActiveId(spec.sireId)}
                            style={{
                              background: "var(--accent-blue-glow)",
                              border: "1px solid var(--accent-blue)",
                              borderRadius: "4px",
                              padding: "0.15rem 0.5rem",
                              color: "#fff",
                              fontSize: "0.75rem",
                              cursor: "pointer"
                            }}
                          >
                            Serial No. #{spec.sireId.toString().padStart(3, "0")}
                          </button>
                        ) : (
                          <strong style={{ color: "var(--text-muted)" }}>Wild Caught / F0</strong>
                        )}
                      </div>
                      
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ color: "var(--text-secondary)" }}>Dam (Mother):</span>
                        {spec.damId > 0 ? (
                          <button 
                            onClick={() => setActiveId(spec.damId)}
                            style={{
                              background: "var(--accent-blue-glow)",
                              border: "1px solid var(--accent-blue)",
                              borderRadius: "4px",
                              padding: "0.15rem 0.5rem",
                              color: "#fff",
                              fontSize: "0.75rem",
                              cursor: "pointer"
                            }}
                          >
                            Serial No. #{spec.damId.toString().padStart(3, "0")}
                          </button>
                        ) : (
                          <strong style={{ color: "var(--text-muted)" }}>Wild Caught / F0</strong>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Multi-generational lineage pedigree tree chart (Pro Mode only) */}
              {!casualModeActive && (
                <div className="glass-card" style={{ padding: "1.25rem", background: "rgba(0,0,0,0.15)" }}>
                  <h4 style={{ fontSize: "0.85rem", color: "var(--accent-blue)", margin: "0 0 1rem 0", display: "flex", alignItems: "center", gap: "0.25rem" }}>
                    <span>🧬</span> Complete 3-Generation Pedigree Tree
                  </h4>
                  {renderPedigreeTree()}
                </div>
              )}

              {/* Environmental Chemistry / Genetic Attributes */}
              {metadata && (
                <div className="glass-card" style={{ padding: "1.25rem", background: "rgba(0,0,0,0.15)" }}>
                  <h4 style={{ fontSize: "0.85rem", color: "var(--accent-green)", margin: "0 0 0.75rem 0", display: "flex", alignItems: "center", gap: "0.25rem" }}>
                    <span>📊</span> Telemetry & Genetics Log
                  </h4>
                  
                  {/* Attributes Grid */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", fontSize: "0.8rem" }}>
                    <div>
                      <span style={{ color: "var(--text-muted)", display: "block" }}>Description:</span>
                      <span style={{ color: "var(--text-secondary)", fontStyle: "italic" }}>"{metadata.description}"</span>
                    </div>

                    {metadata.attributes && metadata.attributes.length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                        <span style={{ color: "var(--text-muted)", display: "block", marginBottom: "0.2rem" }}>Captured Traits:</span>
                        {metadata.attributes.map((attr, idx) => {
                          if (["Sire ID", "Dam ID", "Containment Tank ID"].includes(attr.trait_type)) return null;
                          return (
                            <div key={idx} style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px dashed rgba(255,255,255,0.03)", paddingBottom: "0.15rem" }}>
                              <span style={{ color: "var(--text-secondary)" }}>{attr.trait_type}:</span>
                              <strong style={{ color: "#fff" }}>{attr.value}</strong>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Footer actions */}
              <div style={{
                display: "flex",
                gap: "0.75rem",
                borderTop: "1px solid var(--glass-border)",
                paddingTop: "1rem",
                marginTop: "0.5rem",
                flexWrap: "wrap"
              }}>
                <button
                  onClick={() => {
                    onClose();
                    onViewLineage(activeId);
                  }}
                  className="btn-primary"
                  style={{ flex: 1, justifyContent: "center", minWidth: "140px" }}
                >
                  Trace Ancestry Tree
                </button>

                <button
                  onClick={async () => {
                    try {
                      await generatePedigreeCertificate({
                        spec,
                        speciesInfo,
                        tankInfo,
                        lineageTree,
                        metadata,
                        photoDataUrl: customPhoto || null,
                        mintTxHash: null
                      });
                    } catch (err) {
                      console.error("PDF generation failed:", err);
                    }
                  }}
                  className="btn-secondary"
                  style={{ flex: 1, justifyContent: "center", minWidth: "140px" }}
                >
                  📄 Export Pedigree PDF
                </button>

                {isMine && onListOnMarketplace && (
                  <button
                    onClick={() => {
                      onClose();
                      onListOnMarketplace(tankInfo || { id: 0, name: "Unassigned" }, spec);
                    }}
                    className="btn-secondary"
                    style={{ flex: 1, justifyContent: "center", minWidth: "140px" }}
                  >
                    🏪 List on Marketplace
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
