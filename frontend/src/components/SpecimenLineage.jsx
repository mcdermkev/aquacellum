import React, { useState, useEffect, useCallback } from "react";
import { ethers, Contract } from "ethers";
import aquadexAbi from "../abi/AquadexManager.json";
import { getProvider } from "../utils/smartAccount";
import { PedigreeTree } from "./PedigreeTree";
import { fetchPedigreeTree, PEDIGREE_DEPTH } from "../services/pedigree";
import { formatCertSerial } from "../utils/specimenIdentity";
import { downloadPedigreeCertificate, printPedigreeCertificate } from "../utils/pedigreeExport";
import { loadOwnedSpecimens, specimenOptionLabel } from "../utils/ownedSpecimens";


export function SpecimenLineage({ contractAddress, walletAccount, preselectedTokenId, onSelectBreed }) {
  const [tokenId, setTokenId] = useState("");
  const [tree, setTree] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [specimenOptions, setSpecimenOptions] = useState([]);

  const fetchLineage = useCallback(async (targetId) => {
    if (!targetId || isNaN(targetId)) return;

    setLoading(true);
    setError(null);
    setTree(null);

    try {
      const provider = getProvider();
      const contract = new Contract(contractAddress, aquadexAbi, provider);

      // Ancestor resolution lives in services/pedigree.js — the same resolver
      // COICalculator uses, so a family tree and an inbreeding coefficient can
      // never be computed from different ancestry (they used to be: the COI copy
      // asked the contract before Dexie). See BREEDER_STATE_MODEL §3.
      const resolved = await fetchPedigreeTree(contract, Number(targetId));
      if (!resolved) {
        setError(`Birth Certificate Serial No. ${formatCertSerial(targetId)} was not found in the secure registry.`);
        setLoading(false);
        return;
      }

      setTree(resolved);
    } catch (err) {
      console.error("Error reading pedigree tree:", err);
      setError("Failed to query registry. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [contractAddress]);

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
              Ancestry Family Tree for Cert. Serial No. {formatCertSerial(tree.target.id)} ({tree.target.speciesName})
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
                {PEDIGREE_DEPTH} Generations
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
