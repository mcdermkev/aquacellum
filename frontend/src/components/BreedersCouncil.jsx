import React, { useState, useEffect } from "react";
import { db } from "../db";
import { Contract } from "ethers";
import { getProvider } from "../utils/smartAccount";
import marketplaceAbi from "../abi/AquadexMarketplace.json";
import { useXPSync } from "../hooks/useXPSync";
import { useUserRoles } from "../hooks/useUserRoles";

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
          🪪 Member ID: {profile.walletAddress.substring(0, 6)}...{profile.walletAddress.substring(38)}
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

// ─────────────────────────────────────────────────────────────────────────────
// Council membership
//
// Read from the server-authoritative `user_roles` table via useUserRoles.
//
// This REPLACES a hardcoded `GENESIS_COUNCIL` array that held the stock
// Hardhat/Anvil dev accounts (0xf39fd6…, 0x70997970…, 0x3c44cddd…). No production
// wallet was in it, so BOTH founders fell through to the nomination screen and
// nobody could approve anything — the bug that started this work.
//
// It also deliberately does NOT use isFounderWallet() from config/appConfig.js.
// That allowlist is stale: it names 0x41e562…c9eb as the second founder, but the
// real second founder's wallet is 0xef09…98f7, so gating on it would lock a
// founder out exactly like the Hardhat list did. `user_roles` is granted
// server-side from the founder_emails allowlist and survives wallet changes.
//
// Authority here is conferred, not earned — the same rule services/entitlements.js
// applies to every other social-authority privilege.
// ─────────────────────────────────────────────────────────────────────────────

const CURATION_ROLES = ["founder", "curator"];

/** Statuses that accept no further votes. */
const TERMINAL = ["promoted", "rejected"];

function statusColors(status) {
  switch (status) {
    case "promoted": return { bg: "rgba(52, 211, 153, 0.15)", fg: "#34d399" };
    case "approved": return { bg: "rgba(56, 189, 248, 0.15)", fg: "#38bdf8" };
    case "rejected": return { bg: "rgba(239, 68, 68, 0.15)", fg: "#f87171" };
    default:         return { bg: "rgba(251, 191, 36, 0.15)", fg: "#fbbf24" };
  }
}

/**
 * The one place that explains what a suggestion still needs. Reads the tallies
 * from the `species_suggestion_queue` view rather than recomputing them, so this
 * copy can never disagree with the database about what is required.
 */
function requirementLabel(item) {
  if (item.status === "promoted") {
    return `Live in the catalog as species #${item.onchain_species_id}`;
  }
  if (item.status === "rejected") return "Rejected by a founder";

  if (item.status === "approved") {
    // needs_care_profile, not fishbase_match: the latter is a submit-time
    // snapshot that never clears, so gating on it left a species permanently
    // un-publishable even after its profile was authored.
    return item.needs_care_profile
      ? "Approved — needs a care profile authored before it can be published"
      : "Approved — ready to publish to the live catalog";
  }

  const need = item.approvals_remaining ?? 0;
  const parts = [];
  if (need > 0) {
    parts.push(`${need} more approval${need === 1 ? "" : "s"}`);
  }
  if (!item.founder_approved) parts.push("a founder's approval");
  if (parts.length === 0) return "Awaiting review";
  return `Needs ${parts.join(" and ")}`;
}

export function BreedersCouncil({
  walletAccount,
  suggestionsQuery,
  castVote,
  isVoting,
  promoteSpecies,
  isPromoting,
  CARE_LEVEL_STRINGS,
  marketplaceAddress,
  isModalView,
}) {
  const [profile, setProfile] = useState({ totalXp: 0, currentTier: "Shallow", isCouncilMember: false });
  const [stats, setStats] = useState({ totalSpecies: 0, totalListings: 0, totalTanks: 0 });
  const [marketplaceContract, setMarketplaceContract] = useState(null);
  const [companionData, setCompanionData] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [actionNotice, setActionNotice] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const { data: roles = [], isLoading: rolesLoading } = useUserRoles(walletAccount);
  const isFounder = roles.includes("founder");
  const isCouncil = roles.some((r) => CURATION_ROLES.includes(r));

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
    if (updated) setProfile(updated);
    const companion = await db.breederCompanion.get(walletAccount);
    setCompanionData(companion || null);
  };

  useXPSync(walletAccount, marketplaceContract, handleXpRefresh, null);

  useEffect(() => {
    const loadProfileAndStats = async () => {
      if (!walletAccount) return;

      // Read the profile; do NOT invent one. The previous version seeded a fresh
      // wallet with `totalXp: 2800` and then rendered a progress bar against it,
      // so the "you need 2121 more XP" figure was fabricated.
      const user = await db.userProfile.get(walletAccount);
      if (user) setProfile(user);

      const companion = await db.breederCompanion.get(walletAccount);
      setCompanionData(companion || null);

      const [speciesCount, listingsCount, tanksCount] = await Promise.all([
        db.species.count(),
        db.listings.count(),
        db.tanks.count(),
      ]);
      setStats({ totalSpecies: speciesCount, totalListings: listingsCount, totalTanks: tanksCount });
    };
    loadProfileAndStats();
  }, [walletAccount]);

  const suggestions = suggestionsQuery?.data || [];
  const pending = suggestions.filter((s) => s.status === "pending");
  const approved = suggestions.filter((s) => s.status === "approved");

  const runAction = async (id, fn, successMessage) => {
    setActionError(null);
    setActionNotice(null);
    setBusyId(id);
    try {
      const result = await fn();
      setActionNotice(typeof successMessage === "function" ? successMessage(result) : successMessage);
    } catch (err) {
      setActionError(err?.message || "Action failed.");
    } finally {
      setBusyId(null);
    }
  };

  // ── Non-council view ──────────────────────────────────────────────────────
  if (!isCouncil) {
    return (
      <div style={{
        width: "100%",
        padding: isModalView ? "1rem 0" : "3rem",
        borderRadius: "12px",
        color: "#fff",
        textAlign: "center",
      }}>
        {companionData && companionData.eggState >= 2 && (
          <BreederProfileCard profile={profile} companion={companionData} />
        )}

        <h2 style={{ fontSize: "1.8rem", fontWeight: "900", margin: "0 0 0.5rem 0", color: "#f8fafc" }}>
          Breeders Council
        </h2>

        {/* Honest about how membership works.
            This replaced a progress bar counting toward 5000 XP, which was a lie
            twice over: the XP figure was hardcoded to 2800 for every wallet, and
            5000 is the Abyssal threshold while the label said Pelagic (2500).
            Nothing about reaching a tier has ever granted council rights. */}
        <p style={{
          color: "var(--text-secondary)", fontSize: "0.95rem", maxWidth: "600px",
          margin: "0 auto 1.5rem auto", lineHeight: "1.6",
        }}>
          Curation seats are granted by the founders, not earned with XP. Deciding what
          enters the shared species catalog is a trust role, so it is handed to keepers
          with a track record rather than unlocked by activity.
        </p>
        <p style={{
          color: "var(--text-muted)", fontSize: "0.85rem", maxWidth: "600px",
          margin: "0 auto 2.5rem auto", lineHeight: "1.6",
        }}>
          Anyone can propose a species from the <strong>Propose Catalog Entry</strong> tab,
          and every proposal below is public — including who approved it.
          {rolesLoading ? " Checking your roles…" : ""}
        </p>

        {suggestions.length > 0 && (
          <div style={{ maxWidth: "760px", margin: "0 auto 2.5rem auto", textAlign: "left" }}>
            <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "#fff", marginBottom: "0.75rem" }}>
              Open proposals
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {suggestions.slice(0, 12).map((item) => {
                const c = statusColors(item.status);
                return (
                  <div key={item.id} style={{
                    background: "rgba(255,255,255,0.02)",
                    border: "1px solid rgba(255,255,255,0.06)",
                    borderRadius: "8px",
                    padding: "0.85rem 1rem",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "1rem",
                    flexWrap: "wrap",
                  }}>
                    <div>
                      <strong style={{ fontSize: "0.9rem" }}>{item.common_name}</strong>
                      <span style={{ fontStyle: "italic", fontSize: "0.8rem", color: "var(--text-muted)", marginLeft: "0.4rem" }}>
                        ({item.scientific_name})
                      </span>
                      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>
                        {requirementLabel(item)}
                      </div>
                    </div>
                    <span style={{
                      fontSize: "0.7rem", padding: "0.2rem 0.55rem", borderRadius: "4px",
                      fontWeight: "bold", background: c.bg, color: c.fg, textTransform: "uppercase",
                    }}>
                      {item.status}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Glowing Neon Coming Soon Micro-Panel */}
        <div style={{
          maxWidth: "600px", margin: "0 auto", padding: "1.75rem",
          background: "rgba(10, 15, 30, 0.4)",
          border: "1px solid rgba(255, 215, 0, 0.15)",
          borderRadius: "10px",
          boxShadow: "0 0 15px rgba(255, 215, 0, 0.08), inset 0 0 10px rgba(0, 242, 254, 0.05)",
          position: "relative", overflow: "hidden",
        }}>
          <div style={{
            position: "absolute", top: 0, left: 0, right: 0, height: "1px",
            background: "linear-gradient(90deg, transparent, rgba(255, 215, 0, 0.4), transparent)",
          }} />
          <span style={{
            fontSize: "0.75rem", fontWeight: "bold", letterSpacing: "0.15em", color: "#fbbf24",
            background: "rgba(251, 191, 36, 0.1)", padding: "0.25rem 0.75rem",
            borderRadius: "12px", display: "inline-block", marginBottom: "0.75rem",
          }}>
            COMING SOON • PHASE 4
          </span>
          <h3 style={{ fontSize: "1.1rem", fontWeight: "800", color: "#fff", margin: "0 0 0.5rem 0" }}>
            Elite Breeder Guild & Curation Council Hub
          </h3>
          <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", lineHeight: "1.5", margin: 0 }}>
            This upcoming hub will introduce conservation treasury funding proposals and
            special biotope registry audits.
          </p>
        </div>
      </div>
    );
  }

  // ── Council view ──────────────────────────────────────────────────────────
  const requiredApprovals = suggestions[0]?.required_approvals ?? 1;

  return (
    <div style={{
      width: "100%",
      padding: isModalView ? "0.5rem 0" : "2.5rem",
      borderRadius: "12px",
      color: "#fff",
    }}>
      {companionData && companionData.eggState >= 2 && (
        <div style={{ display: "flex", justifyContent: "center", marginBottom: "2rem" }}>
          <BreederProfileCard profile={profile} companion={companionData} />
        </div>
      )}

      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginBottom: "2rem", flexWrap: "wrap", gap: "1rem",
      }}>
        <div>
          <h2 style={{
            fontSize: "1.8rem", fontWeight: "900", margin: 0, color: "#fbbf24",
            textShadow: "0 0 10px rgba(251, 191, 36, 0.3)",
          }}>
            🏛️ Breeders Council
          </h2>
          <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", margin: "0.25rem 0 0 0" }}>
            {requiredApprovals === 1
              ? "One founder approval publishes a species."
              : `${requiredApprovals} approvals publish a species, and one must be a founder's.`}
          </p>
        </div>
        {/* States the role actually held, rather than the old "Admin Bypass
            Active" badge, which described a bypass that did not exist. */}
        <div style={{
          background: "rgba(251, 191, 36, 0.1)",
          border: "1px solid rgba(251, 191, 36, 0.3)",
          padding: "0.5rem 1rem", borderRadius: "6px", fontSize: "0.85rem",
          color: "#fbbf24", fontWeight: "bold", textTransform: "capitalize",
        }}>
          {roles.filter((r) => CURATION_ROLES.includes(r)).join(" • ")}
        </div>
      </div>

      {actionError && (
        <div style={{
          background: "rgba(239, 68, 68, 0.12)", border: "1px solid rgba(239, 68, 68, 0.35)",
          color: "#fca5a5", borderRadius: "8px", padding: "0.75rem 1rem",
          fontSize: "0.85rem", marginBottom: "1rem",
        }}>
          {actionError}
        </div>
      )}
      {actionNotice && (
        <div style={{
          background: "rgba(52, 211, 153, 0.12)", border: "1px solid rgba(52, 211, 153, 0.35)",
          color: "#6ee7b7", borderRadius: "8px", padding: "0.75rem 1rem",
          fontSize: "0.85rem", marginBottom: "1rem",
        }}>
          {actionNotice}
        </div>
      )}

      <h3 style={{ fontSize: "1.2rem", fontWeight: "700", marginBottom: "1rem", color: "#fff" }}>
        Ecosystem Live Analytics
      </h3>
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: "1.25rem", marginBottom: "2.5rem",
      }}>
        {[
          { label: "Cached Species", value: stats.totalSpecies, color: "#38bdf8" },
          { label: "Marketplace Listings", value: stats.totalListings, color: "#34d399" },
          { label: "Registered Aquariums", value: stats.totalTanks, color: "#a78bfa" },
          { label: "Awaiting Your Vote", value: pending.length, color: "#fbbf24" },
          { label: "Approved, Not Published", value: approved.length, color: "#f472b6" },
        ].map((card) => (
          <div key={card.label} style={{
            background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: "8px", padding: "1.25rem",
          }}>
            <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{card.label}</span>
            {/* Real counts only. These used to fall back to `|| 283` / `|| 12` /
                `|| 4`, so an empty database displayed invented figures. */}
            <div style={{ fontSize: "2rem", fontWeight: "900", color: card.color, marginTop: "0.25rem" }}>
              {card.value}
            </div>
          </div>
        ))}
      </div>

      <div style={{
        background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.04)",
        borderRadius: "10px", padding: "1.5rem",
      }}>
        <h3 style={{ fontSize: "1.2rem", fontWeight: "700", marginBottom: "1rem", color: "#fff" }}>
          Curation Queue
        </h3>

        {suggestionsQuery?.isLoading ? (
          <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", margin: 0 }}>Loading the shared queue…</p>
        ) : suggestionsQuery?.error ? (
          <p style={{ color: "#f87171", fontSize: "0.9rem", margin: 0 }}>
            Could not load the queue: {suggestionsQuery.error.message}
          </p>
        ) : suggestions.length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", margin: 0 }}>
            No species suggestions yet.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {suggestions.map((item) => {
              const c = statusColors(item.status);
              const isTerminal = TERMINAL.includes(item.status);
              const busy = busyId === item.id && (isVoting || isPromoting);
              // Computed live by the view, so authoring a profile re-enables the
              // Publish button on the next refetch with no status transition.
              const needsProfile = item.needs_care_profile === true;

              return (
                <div key={item.id} style={{
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: "8px", padding: "1.2rem",
                  display: "flex", justifyContent: "space-between",
                  alignItems: "flex-start", flexWrap: "wrap", gap: "1rem",
                }}>
                  <div style={{ flex: "1 1 320px" }}>
                    <h4 style={{ margin: "0 0 0.25rem 0", color: "#fff", fontSize: "1.1rem" }}>
                      {item.common_name}{" "}
                      <span style={{ fontStyle: "italic", fontSize: "0.85rem", color: "var(--text-muted)" }}>
                        ({item.scientific_name})
                      </span>
                    </h4>
                    <div style={{
                      display: "flex", gap: "1rem", fontSize: "0.8rem",
                      color: "var(--text-muted)", marginTop: "0.4rem", flexWrap: "wrap",
                    }}>
                      <span>Temp: {item.min_temp_c}°C – {item.max_temp_c}°C</span>
                      <span>pH: {item.min_ph} – {item.max_ph}</span>
                      <span>
                        Care: {CARE_LEVEL_STRINGS ? CARE_LEVEL_STRINGS[item.care_level] : item.care_level}
                      </span>
                    </div>

                    <div style={{ fontSize: "0.8rem", color: "#cbd5e1", marginTop: "0.5rem" }}>
                      {requirementLabel(item)}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
                      {item.approve_votes ?? 0} approve · {item.reject_votes ?? 0} reject
                      {item.founder_approved ? " · founder approved" : ""}
                    </div>

                    {needsProfile && item.status !== "promoted" && (
                      <div style={{
                        marginTop: "0.6rem", fontSize: "0.75rem", color: "#fbbf24",
                        background: "rgba(251,191,36,0.08)",
                        border: "1px solid rgba(251,191,36,0.25)",
                        borderRadius: "6px", padding: "0.5rem 0.65rem", lineHeight: 1.5,
                      }}>
                        Not in our reference data, so publishing it now would create a card
                        with no photo, ecology, diet, or personality. Author its care profile
                        first:
                        <code style={{ display: "block", marginTop: "0.35rem", fontSize: "0.7rem" }}>
                          node ops/author-species-profile.mjs --suggestion {item.id} --template
                        </code>
                      </div>
                    )}

                    {item.notes && (
                      <p style={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.6)", margin: "0.5rem 0 0 0" }}>
                        Notes: {item.notes}
                      </p>
                    )}
                    {item.proof_url && (
                      <div style={{ marginTop: "0.4rem" }}>
                        <a href={item.proof_url} target="_blank" rel="noopener noreferrer"
                          style={{ fontSize: "0.75rem", color: "#38bdf8", textDecoration: "underline" }}>
                          View reference source
                        </a>
                      </div>
                    )}
                    {item.promotion_tx_hash && (
                      <div style={{ marginTop: "0.4rem" }}>
                        <a
                          href={`https://sepolia.basescan.org/tx/${item.promotion_tx_hash}`}
                          target="_blank" rel="noopener noreferrer"
                          style={{ fontSize: "0.75rem", color: "#34d399", textDecoration: "underline" }}
                        >
                          View publication transaction
                        </a>
                      </div>
                    )}
                  </div>

                  <div style={{
                    display: "flex", flexDirection: "column", alignItems: "flex-end",
                    gap: "0.6rem", flex: "0 0 auto",
                  }}>
                    <span style={{
                      fontSize: "0.75rem", padding: "0.25rem 0.6rem", borderRadius: "4px",
                      fontWeight: "bold", background: c.bg, color: c.fg, textTransform: "uppercase",
                    }}>
                      {item.status}
                    </span>

                    {!isTerminal && (
                      <div style={{ display: "flex", gap: "0.5rem" }}>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => runAction(
                            item.id,
                            () => castVote({ suggestionId: item.id, vote: "reject" }),
                            "Reject vote recorded."
                          )}
                          style={{
                            padding: "0.4rem 1rem", fontSize: "0.8rem",
                            border: "1px solid rgba(239, 68, 68, 0.4)", color: "#f87171",
                            cursor: busy ? "wait" : "pointer", background: "none",
                            borderRadius: "4px", opacity: busy ? 0.6 : 1,
                          }}
                        >
                          Reject
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => runAction(
                            item.id,
                            () => castVote({ suggestionId: item.id, vote: "approve" }),
                            "Approve vote recorded."
                          )}
                          style={{
                            padding: "0.4rem 1rem", fontSize: "0.8rem", background: "#34d399",
                            color: "#000", border: "none", borderRadius: "4px",
                            cursor: busy ? "wait" : "pointer", fontWeight: "bold",
                            opacity: busy ? 0.6 : 1,
                          }}
                        >
                          Approve
                        </button>
                      </div>
                    )}

                    {/* Publishing is founder-only and needs reference data or an
                        authored profile. The server enforces both; this only
                        avoids offering a button that would fail. */}
                    {item.status === "approved" && isFounder && (
                      <button
                        type="button"
                        disabled={busy || needsProfile}
                        title={needsProfile ? "Author a care profile for this species first" : undefined}
                        onClick={() => runAction(
                          item.id,
                          () => promoteSpecies(item.id),
                          (r) => r?.alreadyPromoted
                            ? `Already live as species #${r.onchainSpeciesId}.`
                            : `Published as species #${r.onchainSpeciesId}. It can now be added to a tank.`
                        )}
                        style={{
                          padding: "0.45rem 1rem", fontSize: "0.8rem",
                          background: needsProfile ? "rgba(255,255,255,0.06)" : "#38bdf8",
                          color: needsProfile ? "var(--text-muted)" : "#04121f",
                          border: "none", borderRadius: "4px", fontWeight: "bold",
                          cursor: busy ? "wait" : needsProfile ? "not-allowed" : "pointer",
                          opacity: busy ? 0.6 : 1,
                        }}
                      >
                        {busy && isPromoting ? "Publishing…" : "Publish to catalog"}
                      </button>
                    )}

                    {item.status === "approved" && !isFounder && (
                      <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", maxWidth: "180px", textAlign: "right" }}>
                        A founder publishes the final entry.
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
