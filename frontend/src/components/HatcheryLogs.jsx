import React, { useState, useEffect } from "react";
import { ethers, Contract, formatEther } from "ethers";
import marketplaceAbi from "../abi/AquadexMarketplace.json";
import { HandshakeVerification } from "./HandshakeVerification";
import { getProvider } from "../utils/smartAccount";
import { relayPurchaseBatch } from "../services/relayer";
import { db } from "../db";
import { SpawnGrowoutTracker } from "./SpawnGrowoutTracker";

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
      try {
        setLoading(true);
        const fetchedLogs = [];

        // 1. Load local spawns from Dexie (beta relayer stores here)
        try {
          const localSpawns = await db.spawns.where("speciesId").equals(Number(specCode)).toArray();
          for (const spawn of localSpawns) {
            fetchedLogs.push({
              spawnId: spawn.spawnId,
              speciesId: Number(spawn.speciesId),
              breeder: spawn.ownerAddress || walletAccount || "",
              eggCount: (spawn.offspringIds || []).length || Number(spawn.offspringCount || 0),
              eventTimestamp: Number(spawn.timestamp || Math.floor(spawn.spawnId / 1000)),
              notesIpfsHash: spawn.metadata?.ipfsHash || "",
              listing: null,
              isLocal: true,
              offspringIds: spawn.offspringIds || [],
              sireId: spawn.sireId,
              damId: spawn.damId,
              tankId: spawn.tankId,
            });
          }
        } catch (localErr) {
          console.warn("Failed to load local spawns from Dexie:", localErr);
        }

        // 2. Load on-chain spawns if contract is available
        if (contractInstance) {
          let marketplaceContract = null;
          if (marketplaceAddress) {
            const provider = getProvider();
            marketplaceContract = new Contract(marketplaceAddress, marketplaceAbi, provider);
          }

          let id = 1;
          while (true) {
            try {
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

                // Only add if not already present from local data
                if (!fetchedLogs.some(l => l.spawnId === spawnId)) {
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
              }
              id++;
            } catch (err) {
              break;
            }
          }
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
  }, [specCode, contractInstance, marketplaceAddress, refreshTrigger, walletAccount]);

  const handleBuy = async (listing, spawnId) => {
    const qtyInput = document.getElementById(`buy-qty-${spawnId}`);
    const quantity = Number(qtyInput?.value || 1);
    if (quantity <= 0 || quantity > listing.quantity) {
      showToast("⚠️ Invalid quantity selected");
      return;
    }

    try {
      setBuyingMap(prev => ({ ...prev, [listing.listingId]: true }));

      // Beta: purchase batch locally (no MetaMask, no gas)
      const result = await relayPurchaseBatch({
        listingId: listing.listingId,
        quantity,
        buyer: walletAccount,
        seller: listing.seller || "",
        pricePerFishEth: listing.price || "0",
        commonName: listing.commonName || "Juvenile Fry Batch",
        // Capture the seller's sealed pedigree while the listing is in hand. This is
        // the only moment the buyer can (§9.25, T3 §2.6) — see relayPurchaseBatch.
        pedigreeDocument: listing.pedigreeDocument || null,
        pedigreeHash: listing.pedigreeHash || null,
        pedigreeChain: listing.pedigreeChain || [],
        lifeStage: listing.lifeStage || null,
        speciesId: listing.speciesId ?? null,
        scientificName: listing.scientificName || "",
      });
      if (!result.success) throw new Error(result.error || "Purchase failed");

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
                  // Check if the value is actually an IPFS CID/URI vs. plain-text relay notes
                  /^(Qm[a-zA-Z0-9]{44}|baf[a-z2-7]{50,}|ipfs:\/\/)/.test(log.notesIpfsHash.trim()) ? (
                    <a 
                      href={log.notesIpfsHash.startsWith("ipfs://") 
                        ? `https://ipfs.io/ipfs/${log.notesIpfsHash.replace("ipfs://", "")}` 
                        : `https://ipfs.io/ipfs/${log.notesIpfsHash}`
                      } 
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
                      <span>View Husbandry Notes ({log.notesIpfsHash.substring(0, 8)}...)</span>
                    </a>
                  ) : (
                    <span 
                      style={{ 
                        fontSize: "0.725rem", 
                        color: "var(--text-secondary)", 
                        display: "inline-flex", 
                        alignItems: "center", 
                        gap: "0.3rem" 
                      }}
                    >
                      <span>📝</span>
                      <span>{log.notesIpfsHash.length > 60 ? log.notesIpfsHash.substring(0, 60) + "…" : log.notesIpfsHash}</span>
                    </span>
                  )
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
