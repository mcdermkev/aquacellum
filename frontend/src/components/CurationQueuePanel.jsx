import React from "react";
import { relayAddSpecies } from "../services/relayer";

/**
 * CurationQueuePanel — Curator review panel for off-chain species proposals.
 * Displays pending species suggestions and allows curator approval (local-first
 * in beta — no MetaMask) or rejection.
 */
export function CurationQueuePanel({ 
  contractInstance, 
  suggestionsQuery, 
  updateSuggestionStatus, 
  refetchContractSpecies, 
  CARE_LEVEL_STRINGS,
  showToast 
}) {
  const { data: suggestions = [], isLoading } = suggestionsQuery;

  const handleApprove = async (item) => {
    try {
      // Beta: register species locally (no MetaMask, no gas)
      const result = await relayAddSpecies({
        scientificName: item.scientificName,
        commonName: item.commonName,
        ipfsUri: item.proofUrl || `ipfs://QmSpeciesCanonicalMetadataReferenceHash_${item.scientificName.replace(" ", "_")}`,
        careLevel: Number(item.careLevel),
        minTemp: Number(item.minTemp),
        maxTemp: Number(item.maxTemp),
        minPh: Number(item.minPh),
        maxPh: Number(item.maxPh),
      });
      if (!result.success) throw new Error(result.error || "Species registration failed");

      await updateSuggestionStatus({ id: item.id, status: "Approved (Local Beta Registry)" });
      await refetchContractSpecies();
      if (showToast) showToast(`✅ Species "${item.commonName}" successfully registered!`);
    } catch (err) {
      console.error("Failed to approve species:", err);
      if (showToast) showToast(`❌ Registration failed: ${err.message || err}`);
    }
  };

  const handleReject = async (id) => {
    try {
      await updateSuggestionStatus({ id, status: "Rejected by Curator" });
    } catch (err) {
      console.error("Failed to reject suggestion:", err);
    }
  };

  if (isLoading) {
    return (
      <div className="glass-card" style={{ padding: "3rem", textAlign: "center" }}>
        <p style={{ color: "var(--text-muted)", fontSize: "1.1rem" }}>Loading curation queue proposals...</p>
      </div>
    );
  }

  return (
    <div className="glass-card" style={{ width: "100%", padding: "2rem", borderRadius: "var(--radius-sm)", color: "#fff" }}>
      <h3 style={{ fontSize: "1.4rem", fontWeight: "700", color: "#38bdf8", margin: "0 0 0.5rem 0" }}>
        Curator Review Panel
      </h3>
      <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: "1.5rem" }}>
        Review off-chain species proposals. Approved items are dispatched directly to the Base L2 smart contract.
      </p>
      {suggestions.length === 0 ? (
        <p style={{ color: "var(--text-muted)", margin: 0 }}>No pending suggestions currently in the queue.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {suggestions.map(item => (
            <div key={item.id} style={{
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: "8px",
              padding: "1.2rem",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "1rem"
            }}>
              <div>
                <h4 style={{ margin: "0 0 0.25rem 0", color: "#fff", fontSize: "1.1rem" }}>
                  {item.commonName} <span style={{ fontStyle: "italic", fontSize: "0.85rem", color: "var(--text-muted)" }}>({item.scientificName})</span>
                </h4>
                <div style={{ display: "flex", gap: "1rem", fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.4rem" }}>
                  <span>Temp: {item.minTemp}°C - {item.maxTemp}°C</span>
                  <span>pH: {item.minPh} - {item.maxPh}</span>
                  <span>Care: {CARE_LEVEL_STRINGS[item.careLevel]}</span>
                </div>
                {item.notes && <p style={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.6)", margin: "0.5rem 0 0 0" }}>Notes: {item.notes}</p>}
                {item.proofUrl && (
                  <div style={{ marginTop: "0.4rem" }}>
                    <a href={item.proofUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.75rem", color: "#38bdf8", textDecoration: "underline" }}>
                      View Reference Source
                    </a>
                  </div>
                )}
              </div>
              
              <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                <span style={{
                  fontSize: "0.75rem",
                  padding: "0.25rem 0.6rem",
                  borderRadius: "4px",
                  fontWeight: "bold",
                  background: item.curatorStatus.includes("Verified") 
                    ? "rgba(52, 211, 153, 0.15)" 
                    : item.curatorStatus.includes("Rejected") 
                    ? "rgba(239, 68, 68, 0.15)"
                    : "rgba(251, 191, 36, 0.15)",
                  color: item.curatorStatus.includes("Verified") 
                    ? "#34d399" 
                    : item.curatorStatus.includes("Rejected") 
                    ? "#f87171"
                    : "#fbbf24"
                }}>
                  {item.curatorStatus}
                </span>
                
                {item.curatorStatus.includes("Verified") && (
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button 
                      onClick={() => handleReject(item.id)}
                      className="btn-secondary"
                      style={{ padding: "0.4rem 1rem", fontSize: "0.8rem", border: "1px solid rgba(239, 68, 68, 0.4)", color: "#f87171", cursor: "pointer", background: "none" }}
                    >
                      Reject
                    </button>
                    <button 
                      onClick={() => handleApprove(item)}
                      className="btn-primary"
                      style={{ padding: "0.4rem 1rem", fontSize: "0.8rem", background: "#34d399", color: "#000", border: "none", borderRadius: "4px", cursor: "pointer", fontWeight: "bold" }}
                    >
                      Approve Base Tx
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
