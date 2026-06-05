import React, { useState, useEffect } from "react";
import { ethers, Contract, formatEther } from "ethers";
import marketplaceAbi from "../abi/AquadexMarketplace.json";
import { HandshakeVerification } from "./HandshakeVerification";
import { getProvider, getSigner } from "../utils/smartAccount";
import { db } from "../db";
import { addXp } from "../utils/xp";
import { generateSpawnNarration } from "../utils/spawnNarration";

// Grow-out checkpoint types
const GROWOUT_TYPES = {
  fry_count: { emoji: "🐟", label: "Fry Count Update" },
  cull: { emoji: "✂️", label: "Culled" },
  sold: { emoji: "💰", label: "Sold" },
  loss: { emoji: "💀", label: "Natural Loss" },
  moved: { emoji: "🔄", label: "Moved to Grow-Out" },
  note: { emoji: "📝", label: "Observation" },
};

// Inline grow-out tracker component for a single spawn
function SpawnGrowoutTracker({ spawnId, eggCount, speciesName, mode }) {
  const [checkpoints, setCheckpoints] = useState([]);
  const [expanded, setExpanded] = useState(false);
  const [narrationLoading, setNarrationLoading] = useState(false);
  const [latestNarration, setLatestNarration] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [formType, setFormType] = useState("fry_count");
  const [formCount, setFormCount] = useState("");
  const [formNote, setFormNote] = useState("");

  const loadCheckpoints = async () => {
    try {
      const rows = await db.spawnGrowout.where("spawnId").equals(spawnId).toArray();
      setCheckpoints(rows.sort((a, b) => b.timestamp - a.timestamp));
    } catch (e) {
      console.warn("Failed to load growout checkpoints:", e);
    }
  };

  useEffect(() => {
    loadCheckpoints();
  }, [spawnId]);

  const handleAddCheckpoint = async () => {
    const count = parseInt(formCount, 10);
    if (isNaN(count) && formType !== "note") return;

    await db.spawnGrowout.add({
      spawnId,
      timestamp: Math.round(Date.now() / 1000),
      type: formType,
      count: formType === "note" ? 0 : count,
      note: formNote.trim() || GROWOUT_TYPES[formType].label
    });

    addXp(5, "Logged Grow-Out Checkpoint");
    setFormCount("");
    setFormNote("");
    setShowAddForm(false);
    await loadCheckpoints();

    // Trigger Poseidon narration in the background (non-blocking)
    setNarrationLoading(true);
    generateSpawnNarration({
      spawnId,
      checkpointType: formType,
      count: formType === "note" ? 0 : count,
      note: formNote.trim(),
      yieldSummary: {
        eggs: eggCount || 0,
        fry: totalFry,
        alive: survivors,
        sold: totalSold,
        lost: totalCulled + totalLoss,
        survivalRate: survivalRate || 0
      },
      speciesName: speciesName || 'Unknown species',
      mode: mode || 'casual'
    }).then(narration => {
      if (narration) {
        setLatestNarration(narration);
        loadCheckpoints(); // Refresh to show the narration entry
      }
    }).finally(() => setNarrationLoading(false));
  };

  // Calculate yield summary
  const totalFry = checkpoints.filter(c => c.type === "fry_count").reduce((max, c) => Math.max(max, c.count || 0), 0);
  const totalCulled = checkpoints.filter(c => c.type === "cull").reduce((sum, c) => sum + (c.count || 0), 0);
  const totalSold = checkpoints.filter(c => c.type === "sold").reduce((sum, c) => sum + (c.count || 0), 0);
  const totalLoss = checkpoints.filter(c => c.type === "loss").reduce((sum, c) => sum + (c.count || 0), 0);
  const survivors = Math.max(0, totalFry - totalCulled - totalSold - totalLoss);
  const survivalRate = totalFry > 0 ? Math.round(((totalFry - totalLoss) / totalFry) * 100) : null;

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        style={{
          background: "none",
          border: "none",
          color: "var(--accent-blue)",
          fontSize: "0.72rem",
          cursor: "pointer",
          padding: "0.25rem 0",
          display: "flex",
          alignItems: "center",
          gap: "0.3rem"
        }}
      >
        📊 {checkpoints.length > 0 ? `Grow-Out (${checkpoints.length} checkpoints)` : "Track Grow-Out"}
        {survivalRate !== null && (
          <span style={{
            fontSize: "0.65rem",
            padding: "0.1rem 0.4rem",
            borderRadius: "10px",
            background: survivalRate >= 80 ? "rgba(52,211,153,0.12)" : survivalRate >= 50 ? "rgba(251,191,36,0.12)" : "rgba(248,113,113,0.12)",
            color: survivalRate >= 80 ? "var(--accent-green)" : survivalRate >= 50 ? "var(--accent-amber)" : "var(--accent-red)",
            border: `1px solid ${survivalRate >= 80 ? "rgba(52,211,153,0.3)" : survivalRate >= 50 ? "rgba(251,191,36,0.3)" : "rgba(248,113,113,0.3)"}`
          }}>
            {survivalRate}% survival
          </span>
        )}
      </button>
    );
  }

  return (
    <div style={{
      marginTop: "0.75rem",
      padding: "0.75rem 1rem",
      borderRadius: "6px",
      background: "rgba(56, 189, 248, 0.03)",
      border: "1px solid rgba(56, 189, 248, 0.15)"
    }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
        <span style={{ fontSize: "0.8rem", fontWeight: "600", color: "#fff" }}>📊 Grow-Out Tracker</span>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "0.85rem" }}
        >
          ▲
        </button>
      </div>

      {/* Yield funnel summary */}
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "1rem", fontWeight: "700", color: "var(--accent-amber)" }}>{eggCount}</div>
          <div style={{ fontSize: "0.6rem", color: "var(--text-muted)" }}>Eggs</div>
        </div>
        <span style={{ color: "var(--text-muted)", alignSelf: "center" }}>→</span>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "1rem", fontWeight: "700", color: "var(--accent-blue)" }}>{totalFry || "—"}</div>
          <div style={{ fontSize: "0.6rem", color: "var(--text-muted)" }}>Fry</div>
        </div>
        <span style={{ color: "var(--text-muted)", alignSelf: "center" }}>→</span>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "1rem", fontWeight: "700", color: "var(--accent-green)" }}>{survivors}</div>
          <div style={{ fontSize: "0.6rem", color: "var(--text-muted)" }}>Alive</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "1rem", fontWeight: "700", color: "var(--accent-amber)" }}>{totalSold}</div>
          <div style={{ fontSize: "0.6rem", color: "var(--text-muted)" }}>Sold</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "1rem", fontWeight: "700", color: "var(--accent-red)" }}>{totalCulled + totalLoss}</div>
          <div style={{ fontSize: "0.6rem", color: "var(--text-muted)" }}>Lost/Culled</div>
        </div>
        {survivalRate !== null && (
          <div style={{ textAlign: "center", marginLeft: "auto" }}>
            <div style={{ fontSize: "1rem", fontWeight: "700", color: survivalRate >= 80 ? "var(--accent-green)" : survivalRate >= 50 ? "var(--accent-amber)" : "var(--accent-red)" }}>
              {survivalRate}%
            </div>
            <div style={{ fontSize: "0.6rem", color: "var(--text-muted)" }}>Survival</div>
          </div>
        )}
      </div>

      {/* Add checkpoint form */}
      {!showAddForm ? (
        <button
          type="button"
          onClick={() => setShowAddForm(true)}
          style={{
            width: "100%",
            padding: "0.4rem",
            fontSize: "0.72rem",
            fontWeight: "600",
            background: "rgba(56, 189, 248, 0.08)",
            border: "1px dashed rgba(56, 189, 248, 0.3)",
            borderRadius: "4px",
            color: "var(--accent-blue)",
            cursor: "pointer"
          }}
        >
          + Add Checkpoint
        </button>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", padding: "0.5rem", background: "rgba(0,0,0,0.2)", borderRadius: "4px" }}>
          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
            {Object.entries(GROWOUT_TYPES).map(([key, { emoji, label }]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFormType(key)}
                style={{
                  padding: "0.25rem 0.5rem",
                  fontSize: "0.68rem",
                  border: "1px solid",
                  borderRadius: "4px",
                  cursor: "pointer",
                  background: formType === key ? "rgba(56,189,248,0.15)" : "transparent",
                  borderColor: formType === key ? "rgba(56,189,248,0.4)" : "var(--glass-border)",
                  color: formType === key ? "var(--accent-blue)" : "var(--text-muted)"
                }}
              >
                {emoji} {label}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: "0.4rem" }}>
            {formType !== "note" && (
              <input
                type="number"
                min="0"
                value={formCount}
                onChange={(e) => setFormCount(e.target.value)}
                placeholder="Count"
                style={{ width: "70px", padding: "0.35rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px", fontSize: "0.75rem" }}
              />
            )}
            <input
              type="text"
              value={formNote}
              onChange={(e) => setFormNote(e.target.value)}
              placeholder="Note (optional)"
              style={{ flex: 1, padding: "0.35rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px", fontSize: "0.75rem" }}
            />
            <button
              type="button"
              onClick={handleAddCheckpoint}
              disabled={formType !== "note" && !formCount}
              className="btn-primary"
              style={{ padding: "0.35rem 0.75rem", fontSize: "0.72rem" }}
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => { setShowAddForm(false); setFormCount(""); setFormNote(""); }}
              style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "0.8rem" }}
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Checkpoint history */}
      {checkpoints.length > 0 && (
        <div style={{ marginTop: "0.75rem", display: "flex", flexDirection: "column", gap: "0.35rem", maxHeight: "160px", overflowY: "auto" }}>
          {checkpoints.map((cp) => (
            cp.type === 'narration' ? (
              // Poseidon narration line — styled distinctly
              <div key={cp.id} style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "0.4rem",
                fontSize: "0.72rem",
                padding: "0.4rem 0.5rem",
                borderRadius: "6px",
                background: "rgba(56, 189, 248, 0.04)",
                border: "1px solid rgba(56, 189, 248, 0.12)",
                color: "rgba(103, 232, 249, 0.9)",
                fontStyle: "italic",
                lineHeight: "1.4"
              }}>
                <img src="/poseidon-avatar.jpg" alt="" style={{ width: "16px", height: "16px", borderRadius: "50%", objectFit: "cover", flexShrink: 0, marginTop: "1px", opacity: 0.8 }} />
                <span>{cp.note}</span>
              </div>
            ) : (
              <div key={cp.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.7rem", padding: "0.2rem 0", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                <span>
                  <span style={{ marginRight: "0.3rem" }}>{GROWOUT_TYPES[cp.type]?.emoji || "📝"}</span>
                  <span style={{ color: "var(--text-secondary)" }}>{GROWOUT_TYPES[cp.type]?.label || cp.type}</span>
                  {cp.count > 0 && <strong style={{ color: "#fff", marginLeft: "0.3rem" }}>×{cp.count}</strong>}
                  {cp.note && <span style={{ color: "var(--text-muted)", marginLeft: "0.4rem" }}>— {cp.note}</span>}
                </span>
                <span style={{ color: "var(--text-muted)", fontSize: "0.65rem", whiteSpace: "nowrap" }}>
                  {new Date(cp.timestamp * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </span>
              </div>
            )
          ))}
          {narrationLoading && (
            <div style={{ fontSize: "0.68rem", color: "rgba(56, 189, 248, 0.6)", fontStyle: "italic", padding: "0.3rem 0", display: "flex", alignItems: "center", gap: "0.3rem" }}>
              <img src="/poseidon-avatar.jpg" alt="" style={{ width: "14px", height: "14px", borderRadius: "50%", objectFit: "cover", opacity: 0.5 }} />
              Poseidon is observing...
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function HatcheryLogs({ specCode, contractInstance, marketplaceAddress, walletAccount, onCheckoutSuccessRedirect }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [buyingMap, setBuyingMap] = useState({});
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [toastMessage, setToastMessage] = useState(null);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  // Handshake states for local pickup
  const [isHandshakeOpen, setIsHandshakeOpen] = useState(false);
  const [handshakeListing, setHandshakeListing] = useState(null);
  const [handshakeQuantity, setHandshakeQuantity] = useState(1);
  const [fulfillmentTypes, setFulfillmentTypes] = useState({});

  useEffect(() => {
    let active = true;
    const fetchLogs = async () => {
      if (!contractInstance) {
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        const fetchedLogs = [];
        let id = 1;
        
        let marketplaceContract = null;
        if (marketplaceAddress) {
          const provider = getProvider();
          marketplaceContract = new Contract(marketplaceAddress, marketplaceAbi, provider);
        }

        // Loop sequentially through mappings until spawnId returns 0n
        while (true) {
          const log = await contractInstance.spawnLogs(id);
          if (!log || log.spawnId === 0n || Number(log.spawnId) === 0) {
            break;
          }
          if (Number(log.speciesId) === Number(specCode)) {
            const spawnId = Number(log.spawnId);
            let listingDetails = null;

            if (marketplaceContract) {
              try {
                const listingId = await marketplaceContract.spawnToListing(spawnId);
                if (listingId > 0n) {
                  const listing = await marketplaceContract.batchListings(listingId);
                  if (listing.isActive) {
                    listingDetails = {
                      listingId: Number(listing.listingId),
                      spawnId: Number(listing.spawnId),
                      quantity: Number(listing.quantity),
                      pricePerFish: listing.pricePerFish.toString(),
                      seller: listing.seller,
                      isActive: listing.isActive
                    };
                  }
                }
              } catch (err) {
                console.error(`Error querying spawnToListing for spawn ${spawnId}:`, err);
              }
            }

            fetchedLogs.push({
              spawnId: spawnId,
              speciesId: Number(log.speciesId),
              breeder: log.breeder,
              eggCount: Number(log.eggCount),
              eventTimestamp: Number(log.eventTimestamp),
              notesIpfsHash: log.notesIpfsHash,
              listing: listingDetails,
            });
          }
          id++;
        }
        
        if (active) {
          // Sort reverse-chronologically (newest spawn logs first)
          fetchedLogs.sort((a, b) => b.eventTimestamp - a.eventTimestamp);
          setLogs(fetchedLogs);
        }
      } catch (err) {
        console.error("Error fetching spawn logs:", err);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    fetchLogs();
    return () => {
      active = false;
    };
  }, [specCode, contractInstance, marketplaceAddress, refreshTrigger]);

  const handleBuy = async (listing, spawnId) => {
    const qtyInput = document.getElementById(`buy-qty-${spawnId}`);
    const quantity = Number(qtyInput?.value || 1);
    if (quantity <= 0 || quantity > listing.quantity) {
      showToast("⚠️ Invalid quantity selected");
      return;
    }

    try {
      setBuyingMap(prev => ({ ...prev, [listing.listingId]: true }));
      const signer = await getSigner();
      const marketplaceContract = new Contract(marketplaceAddress, marketplaceAbi, signer);

      const totalPrice = BigInt(quantity) * BigInt(listing.pricePerFish);

      const tx = await marketplaceContract.purchaseBatch(listing.listingId, quantity, {
        value: totalPrice
      });
      await tx.wait();

      showToast(`✅ Successfully purchased ${quantity} juveniles!`);
      setRefreshTrigger(prev => prev + 1);
    } catch (err) {
      console.error("Purchase failed:", err);
      showToast(`❌ Purchase failed: ${err.reason || err.message}`);
    } finally {
      setBuyingMap(prev => ({ ...prev, [listing.listingId]: false }));
    }
  };

  const handleBuyClick = (listing, spawnId) => {
    const qtyInput = document.getElementById(`buy-qty-${spawnId}`);
    const quantity = Number(qtyInput?.value || 1);
    if (quantity <= 0 || quantity > listing.quantity) {
      showToast("⚠️ Invalid quantity selected");
      return;
    }

    const fulfillmentType = fulfillmentTypes[listing.listingId] ?? 0;
    if (fulfillmentType === 1) {
      setHandshakeListing(listing);
      setHandshakeQuantity(quantity);
      setIsHandshakeOpen(true);
    } else {
      handleBuy(listing, spawnId);
    }
  };

  const truncateAddress = (addr) => {
    if (!addr) return "";
    return `${addr.substring(0, 6)}...${addr.substring(38)}`;
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return "Unknown Date";
    return new Date(timestamp * 1000).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  if (loading) {
    return (
      <div 
        className="glass-card" 
        style={{ 
          padding: "2rem", 
          textAlign: "center",
          borderRadius: "var(--radius-md)",
          background: "rgba(255, 255, 255, 0.01)",
          border: "1px solid rgba(255, 255, 255, 0.03)"
        }}
      >
        <div className="shimmer-placeholder" style={{ height: "40px", width: "60%", margin: "0 auto 1rem", borderRadius: "4px" }} />
        <p style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>Loading hatchery registry records...</p>
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div 
        className="glass-card" 
        style={{ 
          padding: "2.5rem 2rem", 
          textAlign: "center",
          borderRadius: "var(--radius-md)",
          background: "rgba(255, 255, 255, 0.01)",
          border: "1px solid rgba(255, 255, 255, 0.03)"
        }}
      >
        <div style={{
          width: "48px",
          height: "48px",
          borderRadius: "50%",
          background: "rgba(251, 191, 36, 0.05)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "0 auto 1rem",
          border: "1px solid rgba(251, 191, 36, 0.15)"
        }}>
          <span style={{ fontSize: "1.25rem", color: "var(--accent-amber)" }}>🪺</span>
        </div>
        <h4 style={{ color: "#fff", fontSize: "1rem", fontWeight: "600", marginBottom: "0.5rem" }}>
          No Spawning History
        </h4>
        <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", maxWidth: "340px", margin: "0 auto" }}>
          There are no breeder spawn logs recorded on the ledger for this breed code yet.
        </p>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", paddingLeft: "1.5rem" }}>
      {/* Toast notification */}
      {toastMessage && (
        <div className="inline-toast">
          {toastMessage}
        </div>
      )}
      {/* Vertical line indicator */}
      <div 
        style={{
          position: "absolute",
          left: "0.25rem",
          top: "0.5rem",
          bottom: "0.5rem",
          width: "2px",
          background: "linear-gradient(to bottom, var(--accent-amber) 0%, rgba(251, 191, 36, 0.1) 100%)",
          borderRadius: "1px",
          opacity: 0.5
        }}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
        {logs.map((log, index) => (
          <div key={log.spawnId} style={{ position: "relative" }}>
            {/* Timeline Dot */}
            <div 
              style={{
                position: "absolute",
                left: "-1.625rem",
                top: "1.125rem",
                width: "12px",
                height: "12px",
                borderRadius: "50%",
                background: "var(--accent-amber)",
                boxShadow: "0 0 10px var(--accent-amber-glow)",
                border: "2px solid var(--bg-secondary)",
                zIndex: 2
              }}
            />

            {/* Glassmorphic Event Card */}
            <div 
              className="glass-card" 
              style={{ 
                padding: "1.25rem 1.5rem",
                borderRadius: "var(--radius-md)",
                background: "rgba(255, 255, 255, 0.02)",
                border: "1px solid rgba(255, 255, 255, 0.05)",
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem",
                transition: "var(--transition-smooth)"
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "rgba(251, 191, 36, 0.3)";
                e.currentTarget.style.background = "rgba(255, 255, 255, 0.04)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.05)";
                e.currentTarget.style.background = "rgba(255, 255, 255, 0.02)";
              }}
            >
              {/* Card Header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase" }}>Breeder</span>
                  <code style={{ fontSize: "0.8rem", color: "#fff", fontFamily: "monospace", background: "rgba(255,255,255,0.03)", padding: "0.15rem 0.4rem", borderRadius: "4px" }}>
                    {truncateAddress(log.breeder)}
                  </code>
                </div>
                <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                  {formatDate(log.eventTimestamp)}
                </span>
              </div>

              {/* Event Details */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem" }}>
                {/* Neon Amber Glowing Badge */}
                <div 
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.4rem",
                    padding: "0.35rem 0.75rem",
                    borderRadius: "6px",
                    background: "rgba(251, 191, 36, 0.06)",
                    border: "1px solid hsla(35, 100%, 50%, 0.4)",
                    boxShadow: "0 0 12px rgba(251, 191, 36, 0.15)",
                    fontSize: "0.8rem",
                    fontWeight: "600",
                    color: "var(--accent-amber)"
                  }}
                >
                  <span>🥚</span>
                  <span>{log.eggCount} Eggs Logged</span>
                </div>

                {/* Husbandry Notes */}
                {log.notesIpfsHash && log.notesIpfsHash !== "" ? (
                  <a 
                    href={`https://ipfs.io/ipfs/${log.notesIpfsHash}`} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    style={{
                      fontSize: "0.75rem",
                      color: "var(--accent-blue)",
                      textDecoration: "none",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.3rem",
                      transition: "var(--transition-smooth)"
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.color = "#fff"}
                    onMouseLeave={(e) => e.currentTarget.style.color = "var(--accent-blue)"}
                  >
                    <span>📖</span>
                    <span>View Husbandry Notes ({log.notesIpfsHash.substring(0, 6)}...)</span>
                  </a>
                ) : (
                  <span style={{ fontSize: "0.725rem", color: "var(--text-muted)", fontStyle: "italic" }}>
                    No triggers/diet logged
                  </span>
                )}
              </div>

              {/* Grow-Out Lifecycle Tracker */}
              <SpawnGrowoutTracker spawnId={log.spawnId} eggCount={log.eggCount} />

              {/* Active Holding Batch Listing Checkout */}
              {log.listing && (
                <div 
                  style={{
                    marginTop: "0.75rem",
                    padding: "1rem 1.25rem",
                    borderRadius: "6px",
                    background: "rgba(251, 191, 36, 0.03)",
                    border: "1px dashed rgba(251, 191, 36, 0.25)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.75rem",
                    width: "100%"
                  }}
                >
                  {/* Top Row: Batch Info and Toggle Switch */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem", width: "100%" }}>
                    <div>
                      <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", display: "block", textTransform: "uppercase", fontWeight: "600" }}>
                        Batch Available via secure holding
                      </span>
                      <strong style={{ fontSize: "0.9rem", color: "#fff", display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
                        {log.listing.quantity} available @ <span style={{ color: "var(--accent-amber)" }}>${(parseFloat(formatEther(log.listing.pricePerFish)) * 1000).toFixed(2)}</span>
                      </strong>
                    </div>

                    {/* Toggle Switch */}
                    <div style={{
                      display: "flex",
                      background: "rgba(0,0,0,0.3)",
                      borderRadius: "6px",
                      padding: "2px",
                      border: "1px solid rgba(255,255,255,0.04)"
                    }}>
                      <button
                        onClick={() => setFulfillmentTypes(prev => ({ ...prev, [log.listing.listingId]: 0 }))}
                        style={{
                          padding: "0.3rem 0.6rem",
                          fontSize: "0.7rem",
                          fontWeight: "600",
                          border: "none",
                          borderRadius: "4px",
                          cursor: "pointer",
                          background: (fulfillmentTypes[log.listing.listingId] ?? 0) === 0 ? "rgba(251, 191, 36, 0.15)" : "transparent",
                          color: (fulfillmentTypes[log.listing.listingId] ?? 0) === 0 ? "var(--accent-amber)" : "var(--text-muted)",
                          transition: "all 0.2s"
                        }}
                      >
                        📦 Courier Shipping
                      </button>
                      <button
                        onClick={() => setFulfillmentTypes(prev => ({ ...prev, [log.listing.listingId]: 1 }))}
                        style={{
                          padding: "0.3rem 0.6rem",
                          fontSize: "0.7rem",
                          fontWeight: "600",
                          border: "none",
                          borderRadius: "4px",
                          cursor: "pointer",
                          background: (fulfillmentTypes[log.listing.listingId] ?? 0) === 1 ? "rgba(251, 191, 36, 0.15)" : "transparent",
                          color: (fulfillmentTypes[log.listing.listingId] ?? 0) === 1 ? "var(--accent-amber)" : "var(--text-muted)",
                          transition: "all 0.2s"
                        }}
                      >
                        🚗 Local Pickup
                      </button>
                    </div>
                  </div>

                  {/* Bottom Row: Helper Info and Checkout Controls */}
                  <div style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: "0.75rem",
                    width: "100%",
                    borderTop: "1px solid rgba(255,255,255,0.03)",
                    paddingTop: "0.75rem"
                  }}>
                    <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                      {(fulfillmentTypes[log.listing.listingId] ?? 0) === 0 
                        ? "🚚 Insulated live-arrival shipping courier standard." 
                        : "🤝 Local in-person handshake holding settlement."}
                    </span>

                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <label htmlFor={`buy-qty-${log.spawnId}`} style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>Qty:</label>
                      <input 
                        type="number" 
                        min="1" 
                        max={log.listing.quantity} 
                        defaultValue="1" 
                        id={`buy-qty-${log.spawnId}`}
                        style={{
                          width: "55px",
                          background: "rgba(0,0,0,0.3)",
                          border: "1px solid rgba(255,255,255,0.08)",
                          borderRadius: "4px",
                          color: "#fff",
                          fontSize: "0.8rem",
                          padding: "0.25rem",
                          textAlign: "center",
                          outline: "none"
                        }}
                      />
                      <button
                        onClick={() => handleBuyClick(log.listing, log.spawnId)}
                        disabled={buyingMap[log.listing.listingId]}
                        className="btn-primary"
                        style={{
                          background: "var(--accent-amber)",
                          boxShadow: "0 0 10px var(--accent-amber-glow)",
                          color: "#0f172a",
                          fontSize: "0.75rem",
                          fontWeight: "700",
                          padding: "0.4rem 1rem",
                          border: "none",
                          borderRadius: "4px",
                          cursor: "pointer",
                          opacity: buyingMap[log.listing.listingId] ? 0.6 : 1,
                          transition: "all 0.2s ease"
                        }}
                        onMouseEnter={(e) => {
                          if (!buyingMap[log.listing.listingId]) {
                            e.currentTarget.style.boxShadow = "0 0 16px var(--accent-amber-glow)";
                            e.currentTarget.style.transform = "scale(1.02)";
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!buyingMap[log.listing.listingId]) {
                            e.currentTarget.style.boxShadow = "0 0 10px var(--accent-amber-glow)";
                            e.currentTarget.style.transform = "scale(1)";
                          }
                        }}
                      >
                        {buyingMap[log.listing.listingId] ? "Buying..." : "Instant Buy"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Handshake Verification Modal */}
      {isHandshakeOpen && handshakeListing && (
        <HandshakeVerification
          isOpen={isHandshakeOpen}
          onClose={() => setIsHandshakeOpen(false)}
          listing={handshakeListing}
          quantity={handshakeQuantity}
          marketplaceAddress={marketplaceAddress}
          walletAccount={walletAccount}
          onSuccess={(sellerAddress) => {
            setRefreshTrigger(prev => prev + 1);
            if (onCheckoutSuccessRedirect) {
              onCheckoutSuccessRedirect(sellerAddress);
            }
            setIsHandshakeOpen(false);
          }}
        />
      )}
    </div>
  );
}
