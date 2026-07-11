import React, { useState, useEffect, useCallback } from "react";
import { ethers, Contract } from "ethers";
import aquadexAbi from "../abi/AquadexManager.json";
import { getProvider } from "../utils/smartAccount";
import { db } from "../db";
import { PedigreeTree } from "./PedigreeTree";
import { downloadPedigreeCertificate, printPedigreeCertificate } from "../utils/pedigreeExport";
import { loadOwnedSpecimens, specimenOptionLabel } from "../utils/ownedSpecimens";


export function SpecimenLineage({ contractAddress, walletAccount, preselectedTokenId, onSelectBreed }) {
  const [tokenId, setTokenId] = useState("");
  const [tree, setTree] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [specimenOptions, setSpecimenOptions] = useState([]);

  const fetchSpecimenNode = useCallback(async (contract, id) => {
    if (!id || Number(id) === 0) return null;

    // 1. Try local Dexie FIRST, keyed by local serial number.
    // IMPORTANT: `id` here is always a local serial (typed by the breeder,
    // selected from the picker, or read from a sire/dam reference on another
    // local record) — never a raw ERC-721 token id. The contract assigns
    // token ids from a global `++totalSpecimensMinted` counter that has no
    // relationship to the local serial, so calling `contract.specimens(id)`
    // directly with the serial can silently return a completely different
    // specimen whose token id happens to match. Local Dexie is the
    // source of truth for serial → specimen resolution in this local-first
    // app; the contract is only consulted as a last resort below.
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
          breederStockTag: local.breederStockTag || "",
          // On-chain reconciliation state. Traversal still follows local sire/dam
          // refs (the authoritative on-chain parent refs only exist after the full
          // on-chain cutover), but the node now carries its confirmed token id and
          // sync status so the UI can surface it. Prefer onChainId when displaying.
          onChainId: local.onChainId ?? null,
          chainStatus: local.chainStatus || "local"
        };
      }
    } catch (localErr) {
      console.warn(`Local Dexie lookup failed for specimen ID ${id}:`, localErr);
    }

    // 2. No local record for this serial — it may be a raw on-chain token id
    // for a specimen that isn't mirrored in this browser's local database
    // (e.g. a cross-account lookup). Fall back to querying the contract
    // directly using it as a token id.
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
          breederStockTag: "",
          // A contract-read specimen is on-chain by definition, so its id IS the
          // authoritative token id.
          onChainId: Number(data.specimenId),
          chainStatus: "synced"
        };
      }
    } catch (e) {
      console.warn(`Contract read failed for specimen node ID ${id}:`, e);
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
      const damSireNode = damNode && damNode.sireId ? await fetchSpecimenNode(contract, damNode.sireId) : null;
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

  // Load the user's specimens so they can pick one instead of typing a serial.
  useEffect(() => {
    let active = true;
    (async () => {
      const specs = await loadOwnedSpecimens(walletAccount);
      if (active) setSpecimenOptions(specs);
    })();
    return () => { active = false; };
  }, [walletAccount]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    fetchLineage(tokenId);
  };

  const handlePickSpecimen = (e) => {
    const value = e.target.value;
    setTokenId(value);
    if (value) fetchLineage(value);
  };

  return (
    <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
      <div className="glass-card" style={{ padding: "2rem", marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "1.75rem", marginBottom: "0.25rem", color: "#fff" }}>Ancestry Family Tree Lookup</h2>
        <p style={{ color: "var(--text-muted)", fontSize: "0.875rem", marginBottom: "1.5rem" }}>
          Lookup and trace the ancestry family tree of any registered birth certificate.
        </p>

        {specimenOptions.length > 0 && (
          <div style={{ marginBottom: "1rem" }}>
            <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "0.35rem" }}>
              Pick one of your specimens
            </label>
            <select
              value={specimenOptions.some((s) => s.id.toString() === tokenId.toString()) ? tokenId : ""}
              onChange={handlePickSpecimen}
              style={{ width: "100%", padding: "0.75rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px" }}
            >
              <option value="" style={{ background: "var(--bg-secondary)" }}>Select a specimen…</option>
              {specimenOptions.map((spec) => (
                <option key={spec.id} value={spec.id} style={{ background: "var(--bg-secondary)" }}>
                  {specimenOptionLabel(spec)}
                </option>
              ))}
            </select>
            <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: "0.35rem", display: "block" }}>
              Or enter any registered serial number below.
            </span>
          </div>
        )}

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
