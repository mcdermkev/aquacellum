import React, { useState, useEffect, useCallback } from "react";
import { ethers, Contract } from "ethers";
import aquadexAbi from "../abi/AquadexManager.json";
import { getProvider } from "../utils/smartAccount";

export function SpecimenLineage({ contractAddress, walletAccount, preselectedTokenId, onSelectBreed }) {
  const [tokenId, setTokenId] = useState("");
  const [tree, setTree] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchSpecimenNode = useCallback(async (contract, id) => {
    if (!id || Number(id) === 0) return null;
    try {
      const data = await contract.specimens(id);
      if (Number(data.specimenId) === 0) return null;

      // Fetch species name
      const speciesId = Number(data.speciesId);
      let speciesInfo = null;
      try {
        speciesInfo = await contract.speciesCatalog(speciesId);
      } catch (err) {
        console.warn("Failed fetching species catalog entry:", err);
      }

      return {
        id: Number(data.specimenId),
        speciesId,
        speciesName: speciesInfo ? `${speciesInfo.commonName}` : `Species ID ${speciesId}`,
        scientificName: speciesInfo ? speciesInfo.scientificName : "",
        birthTimestamp: Number(data.birthTimestamp),
        breeder: data.breeder,
        sireId: Number(data.sireId),
        damId: Number(data.damId),
        ipfsMetadataUri: data.ipfsMetadataUri,
        status: Number(data.status)
      };
    } catch (e) {
      console.warn(`Failed reading specimen node ID ${id}:`, e);
      return null;
    }
  }, []);

  const fetchLineage = useCallback(async (targetId) => {
    if (!targetId || isNaN(targetId)) return;

    setLoading(true);
    setError(null);
    setTree(null);

    try {
      const provider = getProvider();
      const contract = new Contract(contractAddress, aquadexAbi, provider);

      // Target Specimen (Gen 0)
      const targetNode = await fetchSpecimenNode(contract, Number(targetId));
      if (!targetNode) {
        setError(`Birth Certificate Serial No. ${targetId.toString().padStart(3, "0")} was not found in the secure registry.`);
        setLoading(false);
        return;
      }

      // Parents (Gen 1)
      const sireNode = targetNode.sireId ? await fetchSpecimenNode(contract, targetNode.sireId) : null;
      const damNode = targetNode.damId ? await fetchSpecimenNode(contract, targetNode.damId) : null;

      // Grandparents (Gen 2)
      const sireSireNode = sireNode && sireNode.sireId ? await fetchSpecimenNode(contract, sireNode.sireId) : null;
      const sireDamNode = sireNode && sireNode.damId ? await fetchSpecimenNode(contract, sireNode.damId) : null;
      const damSireNode = damNode && damNode.damId ? await fetchSpecimenNode(contract, damNode.sireId) : null;
      const damDamNode = damNode && damNode.damId ? await fetchSpecimenNode(contract, damNode.damId) : null;

      setTree({
        target: targetNode,
        parents: { sire: sireNode, dam: damNode },
        grandparents: {
          sireSire: sireSireNode,
          sireDam: sireDamNode,
          damSire: damSireNode,
          damDam: damDamNode
        }
      });
    } catch (err) {
      console.error("Error reading pedigree tree:", err);
      setError("Failed to query registry. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [contractAddress, fetchSpecimenNode]);

  useEffect(() => {
    if (preselectedTokenId) {
      setTokenId(preselectedTokenId.toString());
      fetchLineage(preselectedTokenId);
    }
  }, [preselectedTokenId, fetchLineage]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    fetchLineage(tokenId);
  };

  const renderCard = (node, relationLabel) => {
    if (!node) {
      return (
        <div 
          className="glass-card" 
          style={{ 
            padding: "1rem", 
            textAlign: "center", 
            border: "1px dashed var(--glass-border)", 
            background: "rgba(0,0,0,0.1)",
            minHeight: "100px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            opacity: 0.5
          }}
        >
          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase" }}>{relationLabel}</span>
          <span style={{ fontSize: "0.85rem", color: "var(--text-muted)", fontWeight: "500" }}>Unknown Ancestry</span>
        </div>
      );
    }

    const formatDate = (ts) => {
      if (ts === 0) return "Wild-Caught / Unknown";
      return new Date(ts * 1000).toLocaleDateString();
    };

    const statusLabels = ["Active", "Deceased", "Rehomed"];
    const statusBadges = ["badge-green", "badge-red", "badge-amber"];

    return (
      <div 
        className="glass-card" 
        style={{ 
          padding: "1rem", 
          display: "flex", 
          flexDirection: "column", 
          gap: "0.5rem",
          background: "rgba(255,255,255,0.02)",
          borderLeft: `4px solid ${relationLabel.includes("Sire") ? "var(--accent-blue)" : "var(--accent-green)"}`,
          cursor: "pointer",
          transition: "transform 0.2s, box-shadow 0.2s"
        }}
        onClick={() => {
          if (onSelectBreed && node.speciesId) {
            onSelectBreed(node.speciesId);
          }
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = "scale(1.02)";
          e.currentTarget.style.boxShadow = "0 4px 15px rgba(255, 255, 255, 0.05)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "scale(1)";
          e.currentTarget.style.boxShadow = "none";
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: "600" }}>
            {relationLabel}
          </span>
          <span className={`badge ${statusBadges[node.status]}`} style={{ fontSize: "0.6rem", padding: "0.1rem 0.4rem" }}>
            {statusLabels[node.status]}
          </span>
        </div>

        <div>
          <h4 style={{ fontSize: "0.95rem", color: "#fff", display: "flex", justifyContent: "space-between" }}>
            <span>{node.speciesName}</span>
            <span style={{ color: "var(--accent-blue)", fontFamily: "monospace" }}>Cert. No. {node.id.toString().padStart(3, "0")}</span>
          </h4>
          {node.scientificName && (
            <span style={{ fontSize: "0.75rem", fontStyle: "italic", color: "var(--text-secondary)", display: "block" }}>
              {node.scientificName}
            </span>
          )}
        </div>

        <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "0.4rem" }}>
          <div>Hatch: {formatDate(node.birthTimestamp)}</div>
          <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            Registrant: {node.breeder.substring(0, 8)}...
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
      <div className="glass-card" style={{ padding: "2rem", marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "1.75rem", marginBottom: "0.25rem", color: "#fff" }}>Ancestry Family Tree Lookup</h2>
        <p style={{ color: "var(--text-muted)", fontSize: "0.875rem", marginBottom: "1.5rem" }}>
          Lookup and trace the ancestry family tree of any registered birth certificate.
        </p>

        <form onSubmit={handleSearchSubmit} style={{ display: "flex", gap: "1rem" }}>
          <input 
            type="number"
            value={tokenId}
            onChange={(e) => setTokenId(e.target.value)}
            placeholder="Enter Certificate Serial No. (e.g. 001)"
            required
            style={{ flex: 1, padding: "0.75rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px" }}
          />
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? "Searching..." : "Generate Family Tree"}
          </button>
        </form>
      </div>

      {error && (
        <div className="glass-card" style={{ padding: "1.5rem", border: "1px solid rgba(248, 113, 113, 0.2)", color: "var(--accent-red)", marginBottom: "2rem" }}>
          {error}
        </div>
      )}

      {loading && (
        <div className="glass-card shimmer-placeholder" style={{ height: "400px", borderRadius: "var(--radius-md)" }} />
      )}

      {tree && (
        <div className="glass-card" style={{ padding: "2.5rem", overflowX: "auto" }}>
          <h3 style={{ fontSize: "1.25rem", marginBottom: "2rem", textAlign: "center", color: "var(--text-secondary)" }}>
            Ancestry Family Tree for Cert. Serial No. {tree.target.id.toString().padStart(3, "0")} ({tree.target.speciesName})
          </h3>

          {/* Tree layout grid */}
          <div style={{ display: "flex", gap: "2rem", minWidth: "800px", position: "relative", justifyContent: "space-between" }}>
            
            {/* Gen 0: Target */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <div style={{ width: "100%" }}>
                {renderCard(tree.target, "Target Certificate")}
              </div>
            </div>

            {/* Tree Branch Line Indicators (Simple visual separation column) */}
            <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-around", color: "var(--text-muted)", fontSize: "1.5rem", userSelect: "none" }}>
              <div>◀</div>
              <div>◀</div>
            </div>

            {/* Gen 1: Parents */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-around", gap: "2rem" }}>
              <div style={{ width: "100%" }}>
                {renderCard(tree.parents.sire, "Sire (Father)")}
              </div>
              <div style={{ width: "100%" }}>
                {renderCard(tree.parents.dam, "Dam (Mother)")}
              </div>
            </div>

            {/* Tree Branch Line Indicators */}
            <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-around", color: "var(--text-muted)", fontSize: "1.5rem", userSelect: "none" }}>
              <div style={{ height: "50%", display: "flex", flexDirection: "column", justifyContent: "space-around" }}>
                <div>◀</div>
                <div>◀</div>
              </div>
              <div style={{ height: "50%", display: "flex", flexDirection: "column", justifyContent: "space-around" }}>
                <div>◀</div>
                <div>◀</div>
              </div>
            </div>

            {/* Gen 2: Grandparents */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", gap: "1rem" }}>
              {renderCard(tree.grandparents.sireSire, "Sire's Sire (Grandfather)")}
              {renderCard(tree.grandparents.sireDam, "Sire's Dam (Grandmother)")}
              {renderCard(tree.grandparents.damSire, "Dam's Sire (Grandfather)")}
              {renderCard(tree.grandparents.damDam, "Dam's Dam (Grandmother)")}
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
