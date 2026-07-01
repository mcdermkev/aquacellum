import React, { useState, useCallback } from "react";
import { Contract } from "ethers";
import aquadexAbi from "../abi/AquadexManager.json";
import { getProvider } from "../utils/smartAccount";
import { db } from "../db";
import {
  buildAncestorMapFromTree,
  calculateCOIFromMaps,
  COI_RISK_CONFIG,
} from "../utils/coiCalculator";

/**
 * COICalculator — Coefficient of Inbreeding analysis tool.
 *
 * Allows breeders to select a proposed sire and dam, fetches their
 * pedigrees (3 generations deep), then calculates and visualizes
 * the inbreeding coefficient with risk badges and recommendations.
 */
export function COICalculator({ contractAddress, walletAccount }) {
  const [sireId, setSireId] = useState("");
  const [damId, setDamId] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const fetchSpecimenNode = useCallback(async (contract, id) => {
    if (!id || Number(id) === 0) return null;
    try {
      const data = await contract.specimens(id);
      if (Number(data.specimenId) !== 0) {
        const speciesId = Number(data.speciesId);
        let speciesInfo = null;
        try { speciesInfo = await contract.speciesCatalog(speciesId); } catch (e) {}
        return {
          id: Number(data.specimenId),
          speciesId,
          speciesName: speciesInfo ? speciesInfo.commonName : `Species #${speciesId}`,
          sireId: Number(data.sireId),
          damId: Number(data.damId),
          status: Number(data.status),
        };
      }
    } catch (e) {}
    // Fallback to local DB
    try {
      let local = await db.specimens.get(Number(id));
      if (!local) local = await db.specimens.filter(s => Number(s.id) === Number(id)).first();
      if (local) {
        return {
          id: Number(local.id || local.specimenId),
          speciesId: local.speciesId,
          speciesName: local.commonName || `Species #${local.speciesId}`,
          sireId: Number(local.sireId || 0),
          damId: Number(local.damId || 0),
          status: local.status ?? 0,
        };
      }
    } catch (e) {}
    return null;
  }, []);

  const fetchPedigreeTree = useCallback(async (contract, rootId) => {
    const target = await fetchSpecimenNode(contract, rootId);
    if (!target) return null;

    const sire = target.sireId ? await fetchSpecimenNode(contract, target.sireId) : null;
    const dam = target.damId ? await fetchSpecimenNode(contract, target.damId) : null;

    const sireSire = sire?.sireId ? await fetchSpecimenNode(contract, sire.sireId) : null;
    const sireDam = sire?.damId ? await fetchSpecimenNode(contract, sire.damId) : null;
    const damSire = dam?.sireId ? await fetchSpecimenNode(contract, dam.sireId) : null;
    const damDam = dam?.damId ? await fetchSpecimenNode(contract, dam.damId) : null;

    return {
      target,
      parents: { sire, dam },
      grandparents: { sireSire, sireDam, damSire, damDam },
    };
  }, [fetchSpecimenNode]);

  const handleCalculate = async () => {
    if (!sireId || !damId) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const provider = getProvider();
      const contract = new Contract(contractAddress, aquadexAbi, provider);

      const sireTree = await fetchPedigreeTree(contract, Number(sireId));
      const damTree = await fetchPedigreeTree(contract, Number(damId));

      if (!sireTree && !damTree) {
        setError("Could not find either specimen. Check the certificate numbers.");
        return;
      }
      if (!sireTree) {
        setError(`Sire (Cert #${sireId}) not found in registry.`);
        return;
      }
      if (!damTree) {
        setError(`Dam (Cert #${damId}) not found in registry.`);
        return;
      }

      const sireMap = buildAncestorMapFromTree(sireTree, "sire");
      const damMap = buildAncestorMapFromTree(damTree, "dam");
      const coiResult = calculateCOIFromMaps(sireMap, damMap);

      setResult({
        ...coiResult,
        sireName: sireTree.target.speciesName,
        damName: damTree.target.speciesName,
        sireAncestorCount: sireMap.size,
        damAncestorCount: damMap.size,
      });
    } catch (err) {
      console.error("COI calculation error:", err);
      setError("Failed to fetch pedigree data. Check connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  const riskConfig = result ? COI_RISK_CONFIG[result.riskLevel] : null;

  return (
    <div style={{ marginTop: "1.5rem" }}>
      <div style={{ marginBottom: "1rem" }}>
        <h3 style={{ fontSize: "1.1rem", fontWeight: "700", color: "#fff", margin: "0 0 0.25rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span>🧮</span> Inbreeding Coefficient (COI) Calculator
        </h3>
        <p style={{ fontSize: "0.8rem", color: "var(--text-muted, #6b7280)", margin: 0, lineHeight: "1.5" }}>
          Evaluate a proposed pairing for genetic diversity. Walks 3 generations of ancestry to detect shared ancestors and calculate Wright's COI.
        </p>
      </div>

      {/* Input */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: "0.75rem", alignItems: "end", marginBottom: "1rem" }}>
        <div>
          <label style={{ fontSize: "0.68rem", fontWeight: "600", color: "#60a5fa", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: "4px" }}>
            ♂ Sire Cert #
          </label>
          <input
            type="number" min="1" value={sireId}
            onChange={(e) => setSireId(e.target.value)}
            placeholder="e.g. 001"
            style={{ width: "100%", padding: "0.6rem 0.75rem", background: "rgba(96,165,250,0.05)", border: "1px solid rgba(96,165,250,0.2)", borderRadius: "8px", color: "#fff", fontSize: "0.85rem" }}
          />
        </div>
        <span style={{ fontSize: "1.2rem", color: "var(--text-muted, #6b7280)", paddingBottom: "0.5rem" }}>×</span>
        <div>
          <label style={{ fontSize: "0.68rem", fontWeight: "600", color: "#f472b6", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: "4px" }}>
            ♀ Dam Cert #
          </label>
          <input
            type="number" min="1" value={damId}
            onChange={(e) => setDamId(e.target.value)}
            placeholder="e.g. 002"
            style={{ width: "100%", padding: "0.6rem 0.75rem", background: "rgba(244,114,182,0.05)", border: "1px solid rgba(244,114,182,0.2)", borderRadius: "8px", color: "#fff", fontSize: "0.85rem" }}
          />
        </div>
      </div>

      <button
        onClick={handleCalculate}
        disabled={!sireId || !damId || loading}
        className="btn-primary"
        style={{ width: "100%", padding: "0.7rem", fontSize: "0.85rem", fontWeight: "600", marginBottom: "1rem" }}
      >
        {loading ? "Analyzing Pedigrees..." : "Calculate Inbreeding Coefficient"}
      </button>

      {error && (
        <div style={{ padding: "0.75rem 1rem", borderRadius: "8px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#f87171", fontSize: "0.8rem", marginBottom: "1rem" }}>
          {error}
        </div>
      )}

      {/* Results */}
      {result && riskConfig && (
        <div style={{ borderRadius: "12px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(139,92,246,0.12)", overflow: "hidden" }}>
          {/* COI Score Header */}
          <div style={{ padding: "1.25rem", background: riskConfig.bg, borderBottom: `1px solid ${riskConfig.color}33` }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: "0.62rem", color: "var(--text-muted, #6b7280)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px" }}>
                  Inbreeding Coefficient
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
                  <span style={{ fontSize: "2rem", fontWeight: "800", color: riskConfig.color, fontFamily: "'JetBrains Mono', monospace" }}>
                    {result.coi}%
                  </span>
                  <span style={{
                    fontSize: "0.72rem", fontWeight: "700", padding: "3px 10px", borderRadius: "12px",
                    background: `${riskConfig.color}15`, border: `1px solid ${riskConfig.color}33`, color: riskConfig.color,
                  }}>
                    {riskConfig.icon} {riskConfig.label}
                  </span>
                </div>
              </div>
              {/* Visual gauge */}
              <div style={{ width: "80px", height: "80px", position: "relative" }}>
                <svg viewBox="0 0 36 36" style={{ width: "100%", height: "100%", transform: "rotate(-90deg)" }}>
                  <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="3" />
                  <circle
                    cx="18" cy="18" r="15" fill="none"
                    stroke={riskConfig.color}
                    strokeWidth="3"
                    strokeDasharray={`${Math.min(result.coi, 50) * 2} 100`}
                    strokeLinecap="round"
                    style={{ transition: "stroke-dasharray 0.8s ease" }}
                  />
                </svg>
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.1rem" }}>
                  {riskConfig.icon}
                </div>
              </div>
            </div>
          </div>

          {/* Details */}
          <div style={{ padding: "1.25rem" }}>
            {/* Pairing summary */}
            <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: "120px", padding: "0.6rem", borderRadius: "8px", background: "rgba(96,165,250,0.05)", border: "1px solid rgba(96,165,250,0.12)" }}>
                <div style={{ fontSize: "0.6rem", color: "#60a5fa", textTransform: "uppercase", fontWeight: "600" }}>Sire</div>
                <div style={{ fontSize: "0.82rem", color: "#fff", fontWeight: "500" }}>{result.sireName}</div>
                <div style={{ fontSize: "0.62rem", color: "var(--text-muted, #6b7280)" }}>{result.sireAncestorCount} ancestors traced</div>
              </div>
              <div style={{ flex: 1, minWidth: "120px", padding: "0.6rem", borderRadius: "8px", background: "rgba(244,114,182,0.05)", border: "1px solid rgba(244,114,182,0.12)" }}>
                <div style={{ fontSize: "0.6rem", color: "#f472b6", textTransform: "uppercase", fontWeight: "600" }}>Dam</div>
                <div style={{ fontSize: "0.82rem", color: "#fff", fontWeight: "500" }}>{result.damName}</div>
                <div style={{ fontSize: "0.62rem", color: "var(--text-muted, #6b7280)" }}>{result.damAncestorCount} ancestors traced</div>
              </div>
            </div>

            {/* Shared Ancestors */}
            {result.sharedAncestors.length > 0 && (
              <div style={{ marginBottom: "1rem" }}>
                <div style={{ fontSize: "0.68rem", fontWeight: "700", color: "var(--text-muted, #6b7280)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "6px" }}>
                  Shared Ancestors Detected ({result.sharedAncestors.length})
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  {result.paths.map((p, i) => (
                    <div key={i} style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "6px 10px", borderRadius: "6px",
                      background: "rgba(251, 191, 36, 0.04)", border: "1px solid rgba(251, 191, 36, 0.1)",
                    }}>
                      <span style={{ fontSize: "0.75rem", color: "#e0e0e0" }}>
                        {p.ancestorName} <span style={{ color: "var(--text-muted, #6b7280)" }}>(#{p.ancestorId})</span>
                      </span>
                      <span style={{ fontSize: "0.65rem", color: "#fbbf24", fontFamily: "'JetBrains Mono', monospace" }}>
                        +{(p.contribution * 100).toFixed(2)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recommendation */}
            <div style={{
              padding: "0.75rem 1rem", borderRadius: "8px",
              background: `${riskConfig.color}08`, border: `1px solid ${riskConfig.color}15`,
            }}>
              <div style={{ fontSize: "0.68rem", fontWeight: "700", color: riskConfig.color, marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Recommendation
              </div>
              <p style={{ fontSize: "0.78rem", color: "var(--text-secondary, #9ca3af)", margin: 0, lineHeight: "1.6" }}>
                {result.recommendation}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default COICalculator;
