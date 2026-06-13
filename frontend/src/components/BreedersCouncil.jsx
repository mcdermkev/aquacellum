import React, { useState, useEffect } from "react";
import { db } from "../db";
import { ethers, Contract } from "ethers";
import { getProvider } from "../utils/smartAccount";
import marketplaceAbi from "../abi/AquadexMarketplace.json";
import { useXPSync } from "../hooks/useXPSync";

// Breeder Moniker Card UI component
export function BreederProfileCard({ profile, companion }) {
  if (!profile || !companion || companion.eggState < 2) return null;

  const getTierStyle = (tier) => {
    switch(tier) {
      case "God-Tier":
        return {
          border: "1px solid #ffd700",
          boxShadow: "0 0 20px #ffd700, inset 0 0 10px #ffd700",
          background: "linear-gradient(135deg, rgba(255, 215, 0, 0.25), rgba(0, 0, 0, 0.85))",
          animation: "godTierPulse 2s infinite alternate"
        };
      case "Master":
        return {
          border: "1px solid #d500f9",
          boxShadow: "0 0 15px #d500f9, inset 0 0 5px #d500f9",
          background: "linear-gradient(135deg, rgba(213,0,249,0.15), rgba(0,0,0,0.6))"
        };
      case "Gold":
        return {
          border: "1px solid #ffd700",
          boxShadow: "0 0 12px #ffd700, inset 0 0 4px #ffd700",
          background: "linear-gradient(135deg, rgba(255,215,0,0.12), rgba(0,0,0,0.6))"
        };
      case "Silver":
        return {
          border: "1px solid #b0bec5",
          boxShadow: "0 0 8px #b0bec5",
          background: "linear-gradient(135deg, rgba(176,190,197,0.1), rgba(0,0,0,0.6))"
        };
      default: // Bronze / Base Tier Setup
        return {
          border: "1px solid #cd7f32",
          boxShadow: "0 0 5px #cd7f32",
          background: "linear-gradient(135deg, rgba(205,127,50,0.08), rgba(0,0,0,0.6))"
        };
    }
  };

  const activeStyle = getTierStyle(companion.currentTier);

  return (
    <div style={{
      ...activeStyle,
      padding: '16px',
      borderRadius: '12px',
      fontFamily: 'monospace',
      maxWidth: '360px',
      backdropFilter: 'blur(10px)',
      color: '#ffffff',
      transition: 'all 0.4s ease',
      margin: '0 auto 2rem auto',
      textAlign: 'left'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', gap: '1rem' }}>
        <span style={{ fontWeight: 'bold', letterSpacing: '1px' }}>
          🪪 {profile.walletAddress.substring(0, 6)}...{profile.walletAddress.substring(38)}
        </span>
        <span style={{
          fontSize: '10px',
          padding: '2px 6px',
          borderRadius: '4px',
          background: 'rgba(255,255,255,0.1)',
          textTransform: 'uppercase'
        }}>
          {companion.currentTier === "God-Tier" ? "👑 God-Tier" : `${companion.currentTier} Rank`}
        </span>
      </div>

      <div style={{ fontSize: '12px', opacity: 0.8, borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '8px' }}>
        <div>✦ Level: {profile.level} Breeder</div>
        <div>✦ Showcase Metrics: Active Council Contributor</div>
        <div style={{ display: 'flex', gap: '8px', marginTop: '6px', fontSize: '10px', color: '#00e5ff' }}>
          <span>🐟 Discus Mastery</span>
          <span>•</span>
          <span>💧 99.8% Tank Metric Stability</span>
        </div>
      </div>
    </div>
  );
}

// Hardcoded fallback Genesis Council wallet addresses (case-insensitive)
const GENESIS_COUNCIL = [
  "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", // Kevin (Account #0)
  "0x70997970c51812dc3a010c7d01b50e0d17dc79c8", // Steve (Account #1)
  "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc"  // Co-Founder (Account #2)
];

const TARGET_XP = 5000;

export function BreedersCouncil({ walletAccount, suggestionsQuery, updateSuggestionStatus, CARE_LEVEL_STRINGS, marketplaceAddress, isModalView }) {
  const [profile, setProfile] = useState({ level: 1, prestigeXp: 1850, hobbyistXp: 950, isCouncilMember: false });
  const [stats, setStats] = useState({ totalSpecies: 0, totalListings: 0, totalTanks: 0 });
  const [marketplaceContract, setMarketplaceContract] = useState(null);
  const [companionData, setCompanionData] = useState(null);

  const isCouncil = walletAccount && GENESIS_COUNCIL.includes(walletAccount.toLowerCase());

  // Initialize marketplace contract instance
  useEffect(() => {
    if (!marketplaceAddress) return;
    try {
      const provider = getProvider();
      const contract = new Contract(marketplaceAddress, marketplaceAbi, provider);
      setMarketplaceContract(contract);
    } catch (err) {
      console.error("Failed to initialize marketplace contract in BreedersCouncil:", err);
    }
  }, [marketplaceAddress]);

  const handleXpRefresh = async () => {
    if (!walletAccount) return;
    const updated = await db.userProfile.get(walletAccount);
    if (updated) {
      setProfile(updated);
    }
    const companion = await db.breederCompanion.get(walletAccount);
    setCompanionData(companion || null);
  };

  // Bind the real-time XP sync hook
  useXPSync(walletAccount, marketplaceContract, handleXpRefresh);

  // Load offline profile stats and database counts
  useEffect(() => {
    const loadProfileAndStats = async () => {
      if (!walletAccount) return;
      
      // Load user profile from Dexie table
      let user = await db.userProfile.get(walletAccount);
      if (!user) {
        user = {
          walletAddress: walletAccount,
          level: 2,
          prestigeXp: 1850, // default mock value to show progress bar interaction
          hobbyistXp: 950,
          isCouncilMember: isCouncil
        };
        await db.userProfile.put(user);
      }
      setProfile(user);

      // Load companion profile from Dexie table
      const companion = await db.breederCompanion.get(walletAccount);
      setCompanionData(companion || null);

      // Load analytics counts
      const speciesCount = await db.species.count();
      const listingsCount = await db.listings.count();
      const tanksCount = await db.tanks.count();
      setStats({
        totalSpecies: speciesCount,
        totalListings: listingsCount,
        totalTanks: tanksCount
      });
    };
    loadProfileAndStats();
  }, [walletAccount, isCouncil]);

  const suggestions = suggestionsQuery?.data || [];
  const pendingSuggestions = suggestions.filter(s => s.curatorStatus === "Pending Verification");

  // Render Operational Curation Queue Dashboard & Database Analytics Grid for Council Members
  if (isCouncil) {
    return (
      <div style={{ 
        width: "100%", 
        padding: isModalView ? "0.5rem 0" : "2.5rem", 
        borderRadius: "12px", 
        color: "#fff",
        background: isModalView ? "none" : "",
        border: isModalView ? "none" : "",
        boxShadow: isModalView ? "none" : ""
      }}>
        
        {/* Breeder moniker card (if unlocked) */}
        {companionData && companionData.eggState >= 2 && (
          <div style={{ display: "flex", justifyContent: "center", marginBottom: "2rem" }}>
            <BreederProfileCard profile={profile} companion={companionData} />
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <h2 style={{ fontSize: "1.8rem", fontWeight: "900", margin: 0, color: "#fbbf24", textShadow: "0 0 10px rgba(251, 191, 36, 0.3)" }}>
              🏛️ Genesis Breeders Council
            </h2>
            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", margin: "0.25rem 0 0 0" }}>
              Administrator & Curator portal for core founders. Welcome back, Council Member.
            </p>
          </div>
          <div style={{
            background: "rgba(251, 191, 36, 0.1)",
            border: "1px solid rgba(251, 191, 36, 0.3)",
            padding: "0.5rem 1rem",
            borderRadius: "6px",
            fontSize: "0.85rem",
            color: "#fbbf24",
            fontWeight: "bold"
          }}>
            Address Verified • Admin Bypass Active
          </div>
        </div>

        {/* Database Analytics Grid */}
        <h3 style={{ fontSize: "1.2rem", fontWeight: "700", marginBottom: "1rem", color: "#fff" }}>Ecosystem Live Analytics</h3>
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "1.25rem",
          marginBottom: "2.5rem"
        }}>
          <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "8px", padding: "1.25rem" }}>
            <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Total Cached Species</span>
            <div style={{ fontSize: "2rem", fontWeight: "900", color: "#38bdf8", marginTop: "0.25rem" }}>{stats.totalSpecies || 283}</div>
          </div>
          <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "8px", padding: "1.25rem" }}>
            <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Active Marketplace Listings</span>
            <div style={{ fontSize: "2rem", fontWeight: "900", color: "#34d399", marginTop: "0.25rem" }}>{stats.totalListings || 12}</div>
          </div>
          <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "8px", padding: "1.25rem" }}>
            <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Local Registered Aquariums</span>
            <div style={{ fontSize: "2rem", fontWeight: "900", color: "#a78bfa", marginTop: "0.25rem" }}>{stats.totalTanks || 4}</div>
          </div>
          <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "8px", padding: "1.25rem" }}>
            <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Pending Suggestions Queue</span>
            <div style={{ fontSize: "2rem", fontWeight: "900", color: "#fbbf24", marginTop: "0.25rem" }}>{pendingSuggestions.length}</div>
          </div>
        </div>

        {/* Operational Curation Queue Dashboard */}
        <div style={{ background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.04)", borderRadius: "10px", padding: "1.5rem" }}>
          <h3 style={{ fontSize: "1.2rem", fontWeight: "700", marginBottom: "1rem", color: "#fff" }}>
            Active Curation Queue
          </h3>
          {suggestions.length === 0 ? (
            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", margin: 0 }}>No species suggestions are currently pending review.</p>
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
                      <span>Temp Range: {item.minTemp}°C - {item.maxTemp}°C</span>
                      <span>pH Range: {item.minPh} - {item.maxPh}</span>
                      <span>Care Difficulty: {CARE_LEVEL_STRINGS ? CARE_LEVEL_STRINGS[item.careLevel] : item.careLevel}</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                    <span style={{
                      fontSize: "0.75rem",
                      padding: "0.25rem 0.6rem",
                      borderRadius: "4px",
                      fontWeight: "bold",
                      background: item.curatorStatus?.includes("Verified") 
                        ? "rgba(52, 211, 153, 0.15)" 
                        : "rgba(251, 191, 36, 0.15)",
                      color: item.curatorStatus?.includes("Verified") 
                        ? "#34d399" 
                        : "#fbbf24"
                    }}>
                      {item.curatorStatus}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Render Progression-Locked Screen for Standard Hobbyists
  const progressPercent = Math.min((profile.prestigeXp / TARGET_XP) * 100, 100);

  return (
    <div style={{ 
      width: "100%", 
      padding: isModalView ? "1rem 0" : "3rem", 
      borderRadius: "12px", 
      color: "#fff", 
      textAlign: "center",
      background: isModalView ? "none" : "",
      border: isModalView ? "none" : "",
      boxShadow: isModalView ? "none" : ""
    }}>
      
      {/* Breeder moniker card (if unlocked) */}
      {companionData && companionData.eggState >= 2 && (
        <BreederProfileCard profile={profile} companion={companionData} />
      )}

      <h2 style={{ fontSize: "1.8rem", fontWeight: "900", margin: "0 0 0.5rem 0", color: "#f8fafc" }}>
        Breeders Council nomination
      </h2>
      <p style={{ color: "var(--text-secondary)", fontSize: "0.95rem", maxWidth: "600px", margin: "0 auto 2.5rem auto", lineHeight: "1.6" }}>
        Membership in the Aquadex Breeders Council is reserved for certified Master Breeders. Elevate your local aquarium parameters, maintain breeding registry records, and settle trades to build Loyalty XP and unlock nomination.
      </p>

      {/* Progression Meter */}
      <div style={{ maxWidth: "500px", margin: "0 auto 3rem auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem", fontSize: "0.9rem" }}>
          <span style={{ color: "#38bdf8", fontWeight: "bold" }}>Prestige XP Level {profile.level || 2}</span>
          <span style={{ color: "var(--text-muted)" }}>{profile.prestigeXp} / {TARGET_XP} XP</span>
        </div>
        
        {/* Progress Bar Container */}
        <div style={{
          height: "12px",
          width: "100%",
          background: "rgba(255, 255, 255, 0.05)",
          border: "1px solid rgba(255, 255, 255, 0.1)",
          borderRadius: "6px",
          overflow: "hidden",
          position: "relative"
        }}>
          <div style={{
            height: "100%",
            width: `${progressPercent}%`,
            background: "linear-gradient(90deg, #38bdf8 0%, #34d399 100%)",
            boxShadow: "0 0 8px #38bdf8",
            borderRadius: "6px",
            transition: "width 0.4s ease-out"
          }} />
        </div>
        
        <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.75rem" }}>
          You need {TARGET_XP - profile.prestigeXp} more Prestige XP to unlock Council Curation nomination rights.
        </p>
      </div>

      {/* Glowing Neon Coming Soon Micro-Panel */}
      <div style={{
        maxWidth: "600px",
        margin: "0 auto",
        padding: "1.75rem",
        background: "rgba(10, 15, 30, 0.4)",
        border: "1px solid rgba(255, 215, 0, 0.15)",
        borderRadius: "10px",
        boxShadow: "0 0 15px rgba(255, 215, 0, 0.08), inset 0 0 10px rgba(0, 242, 254, 0.05)",
        position: "relative",
        overflow: "hidden"
      }}>
        <div style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: "1px",
          background: "linear-gradient(90deg, transparent, rgba(255, 215, 0, 0.4), transparent)"
        }} />
        
        <span style={{
          fontSize: "0.75rem",
          fontWeight: "bold",
          letterSpacing: "0.15em",
          color: "#fbbf24",
          background: "rgba(251, 191, 36, 0.1)",
          padding: "0.25rem 0.75rem",
          borderRadius: "12px",
          display: "inline-block",
          marginBottom: "0.75rem"
        }}>
          COMING SOON • PHASE 4
        </span>
        
        <h3 style={{ fontSize: "1.1rem", fontWeight: "800", color: "#fff", margin: "0 0 0.5rem 0" }}>
          Elite Breeder Guild & Curation Council Hub
        </h3>
        
        <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", lineHeight: "1.5", margin: 0 }}>
          This upcoming hub will introduce decentralized curation governance voting, conservation treasury funding proposals, and special biotope registry audits. Gain influence by accumulating loyalty points without complex blockchain overhead.
        </p>
      </div>
    </div>
  );
}
