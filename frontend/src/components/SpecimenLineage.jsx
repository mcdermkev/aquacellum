import React, { useState, useEffect, useCallback } from "react";
import { ethers, Contract } from "ethers";
import aquadexAbi from "../abi/AquadexManager.json";
import { getProvider } from "../utils/smartAccount";
import { db } from "../db";
import { PedigreeTree } from "./PedigreeTree";
import { downloadPedigreeCertificate, printPedigreeCertificate } from "../utils/pedigreeExport";


export function SpecimenLineage({ contractAddress, walletAccount, preselectedTokenId, onSelectBreed }) {
  const [tokenId, setTokenId] = useState("");
  const [tree, setTree] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchSpecimenNode = useCallback(async (contract, id) => {
    if (!id || Number(id) === 0) return null;
    
    // 1. Try contract query first
    try {
      const data = await contract.specimens(id);
      if (Number(data.specimenId) !== 0) {
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
          status: Number(data.status),
          breederStockTag: await (async () => {
            try {
              const local = await db.specimens.get(Number(id));
              return local?.breederStockTag || "";
            } catch (_) { return ""; }
          })()
        };
      }
    } catch (e) {
      console.warn(`Contract read failed for specimen node ID ${id}, trying local database...`, e);
    }

    // 2. Fallback to local Dexie database
    try {
      let local = await db.specimens.get(Number(id));
      if (!local) {
        local = await db.specimens.get(id.toString());
      }
      if (!local) {
        local = await db.specimens.filter(s => Number(s.id) === Number(id) || Number(s.specimenId) === Number(id)).first();
      }
      if (local) {
        return {
          id: Number(local.id || local.specimenId),
          speciesId: local.speciesId,
          speciesName: local.commonName || `Species ID ${local.speciesId}`,
          scientificName: local.scientificName || "",
          birthTimestamp: local.birthTimestamp || local.createdAt || 0,
          breeder: local.breeder || "Local Breeder",
          sireId: Number(local.sireId || 0),
          damId: Number(local.damId || 0),
          ipfsMetadataUri: local.ipfsMetadataUri || "",
          status: local.status ?? 0,
          breederStockTag: local.breederStockTag || ""
        };
      }
    } catch (localErr) {
      console.warn(`Local Dexie lookup failed for specimen ID ${id}:`, localErr);
    }

    return null;
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
        <div className="glass-card" style={{ padding: "2rem", overflow: "hidden" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
            <h3 style={{ fontSize: "1.25rem", color: "var(--text-secondary)", margin: 0 }}>
              Ancestry Family Tree for Cert. Serial No. {tree.target.id.toString().padStart(3, "0")} ({tree.target.speciesName})
            </h3>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                onClick={() => downloadPedigreeCertificate(tree, { breederWallet: walletAccount })}
                style={{
                  fontSize: "0.65rem", padding: "4px 10px", borderRadius: "8px",
                  background: "rgba(96, 165, 250, 0.08)", border: "1px solid rgba(96, 165, 250, 0.2)",
                  color: "#60a5fa", fontWeight: "600", cursor: "pointer", transition: "all 0.2s",
                  display: "flex", alignItems: "center", gap: "4px",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(96, 165, 250, 0.15)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(96, 165, 250, 0.08)"; }}
              >
                ⬇ Download PNG
              </button>
              <button
                onClick={() => printPedigreeCertificate(tree, { breederWallet: walletAccount })}
                style={{
                  fontSize: "0.65rem", padding: "4px 10px", borderRadius: "8px",
                  background: "rgba(167, 139, 250, 0.08)", border: "1px solid rgba(167, 139, 250, 0.2)",
                  color: "#a78bfa", fontWeight: "600", cursor: "pointer", transition: "all 0.2s",
                  display: "flex", alignItems: "center", gap: "4px",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(167, 139, 250, 0.15)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(167, 139, 250, 0.08)"; }}
              >
                🖨 Print
              </button>
              <span style={{
                fontSize: "0.65rem",
                padding: "4px 10px",
                borderRadius: "12px",
                background: "rgba(52, 211, 153, 0.08)",
                border: "1px solid rgba(52, 211, 153, 0.2)",
                color: "#34d399",
                fontWeight: "600",
              }}>
                3 Generations
              </span>
            </div>
          </div>

          <PedigreeTree
            tree={tree}
            onNodeClick={(node) => {
              if (onSelectBreed && node?.speciesId) {
                onSelectBreed(node.speciesId);
              }
            }}
          />
        </div>
      )}
    </div>
  );
}
