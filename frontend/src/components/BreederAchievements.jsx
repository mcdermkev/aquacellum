import React, { useState, useEffect } from "react";
import { loadBreederStats } from "../services/breederStats";
import { getXp, getLevelInfo } from "../utils/xp";
import { ShareButton } from "./ShareButton";
import { generateAchievementCard, generateSpawnMilestoneCard } from "../utils/shareCard";

/**
 * BreederAchievements — Achievement badges and breeder stats widget.
 *
 * Calculates breeder-specific achievements from local data (Dexie):
 * - Spawn milestones (first spawn, 10 spawns, 50 spawns)
 * - Fry survival milestones (100+ fry survived, 500+, 1000+)
 * - Species diversity (bred 3+ species, 5+, 10+)
 * - Grow-out dedication (logged 25+ checkpoints, 100+)
 * - Morph discovery (submitted morphs)
 * - Streak tracking (consecutive days with activity)
 */

const ACHIEVEMENTS = [
  // Spawning milestones
  { id: "first_spawn", icon: "🥚", label: "First Spawn", description: "Logged your first breeding event", check: (d) => d.totalSpawns >= 1, tier: "bronze" },
  { id: "prolific_breeder", icon: "🐟", label: "Prolific Breeder", description: "Completed 10 successful spawns", check: (d) => d.totalSpawns >= 10, tier: "silver" },
  { id: "master_spawner", icon: "👑", label: "Master Spawner", description: "Completed 50 spawns", check: (d) => d.totalSpawns >= 50, tier: "gold" },

  // Fry survival
  { id: "fry_100", icon: "🌊", label: "Century Club", description: "100+ fry survived to grow-out", check: (d) => d.totalFrySurvived >= 100, tier: "bronze" },
  { id: "fry_500", icon: "🏊", label: "Five Hundred Strong", description: "500+ fry survived", check: (d) => d.totalFrySurvived >= 500, tier: "silver" },
  { id: "fry_1000", icon: "🌟", label: "Thousand Keeper", description: "1000+ fry survived across all spawns", check: (d) => d.totalFrySurvived >= 1000, tier: "gold" },

  // Species diversity
  { id: "species_3", icon: "🧬", label: "Diversifier", description: "Bred 3+ different species", check: (d) => d.uniqueSpeciesBred >= 3, tier: "bronze" },
  { id: "species_5", icon: "🔬", label: "Polybreeder", description: "Bred 5+ different species", check: (d) => d.uniqueSpeciesBred >= 5, tier: "silver" },
  { id: "species_10", icon: "🏆", label: "Aquaculture Master", description: "Bred 10+ different species", check: (d) => d.uniqueSpeciesBred >= 10, tier: "gold" },

  // Grow-out dedication
  { id: "checkpoints_25", icon: "📊", label: "Data Collector", description: "Logged 25+ grow-out checkpoints", check: (d) => d.totalCheckpoints >= 25, tier: "bronze" },
  { id: "checkpoints_100", icon: "📈", label: "Meticulous Keeper", description: "Logged 100+ checkpoints", check: (d) => d.totalCheckpoints >= 100, tier: "silver" },
  { id: "checkpoints_500", icon: "🎯", label: "Data Obsessed", description: "500+ checkpoints logged", check: (d) => d.totalCheckpoints >= 500, tier: "gold" },

  // Survival rate excellence
  { id: "survival_90", icon: "💪", label: "Strong Lines", description: "Achieved 90%+ survival on any spawn", check: (d) => d.bestSurvivalRate >= 90, tier: "silver" },
  { id: "survival_95", icon: "⚡", label: "Elite Genetics", description: "Achieved 95%+ survival rate", check: (d) => d.bestSurvivalRate >= 95, tier: "gold" },

  // Sales milestones.
  // These read `verifiedSales` — COMPLETED ORDERS where this account was the
  // seller — not the grow-out `sold` checkpoint count. They used to read the
  // checkpoint count, which is a number the breeder types into a text field, so
  // "Established Seller — Sold 50+ bred fish" was earnable by typing 50. Every
  // badge has a share button, which made that self-assessment one tap from being
  // published as a claim about someone's commercial history.
  // See docs/BREEDER_STATE_MODEL.md §9.11.
  { id: "first_sale", icon: "💰", label: "First Sale", description: "Completed your first sale on the marketplace", check: (d) => d.verifiedSales >= 1, tier: "bronze" },
  { id: "sales_50", icon: "🏪", label: "Established Seller", description: "Completed 50+ marketplace sales", check: (d) => d.verifiedSales >= 50, tier: "silver" },
];

const TIER_STYLES = {
  bronze: { bg: "rgba(180, 130, 70, 0.1)", border: "rgba(180, 130, 70, 0.3)", color: "#cd7f32", glow: "rgba(205, 127, 50, 0.15)" },
  silver: { bg: "rgba(192, 192, 210, 0.08)", border: "rgba(192, 192, 210, 0.25)", color: "#c0c0d2", glow: "rgba(192, 192, 210, 0.12)" },
  gold: { bg: "rgba(255, 215, 0, 0.08)", border: "rgba(255, 215, 0, 0.25)", color: "#ffd700", glow: "rgba(255, 215, 0, 0.15)" },
};

export function BreederAchievements({ walletAccount }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!walletAccount) { setLoading(false); return; }
    refreshStats();
  }, [walletAccount]);

  // Stats come from services/breederStats.js, which keeps the funnel math in the
  // one shared module and — critically — separates VERIFIED figures (completed
  // orders) from SELF-REPORTED ones (grow-out checkpoints the breeder typed).
  const refreshStats = async () => {
    try {
      setLoading(true);
      setStats(await loadBreederStats(walletAccount));
    } catch (err) {
      console.error("[Achievements] Failed to load stats:", err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="glass-card shimmer-placeholder" style={{ height: "200px", borderRadius: "var(--radius-md)" }} />;
  }

  if (!stats) {
    return null;
  }

  const earned = ACHIEVEMENTS.filter(a => a.check(stats));
  const locked = ACHIEVEMENTS.filter(a => !a.check(stats));
  const levelInfo = getLevelInfo(getXp());

  return (
    <div>
      {/* Stats Overview */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: "0.5rem", marginBottom: "1.25rem" }}>
        {[
          { label: "Spawns", value: stats.totalSpawns, icon: "🥚" },
          { label: "Fry Alive", value: stats.totalFrySurvived, icon: "🐟" },
          { label: "Species", value: stats.uniqueSpeciesBred, icon: "🧬" },
          { label: "Checkpoints", value: stats.totalCheckpoints, icon: "📊" },
          { label: "Best Survival", value: `${stats.bestSurvivalRate}%`, icon: "💪" },
          // Two separate tiles on purpose. "Sales" is verified (completed orders);
          // "Rehomed" is the breeder's own tally, which legitimately includes fish
          // given away or sold at a club and never touched an order. Collapsing
          // them into one "Sold" number is what let a typed figure read as
          // commercial history.
          { label: "Sales", value: stats.verifiedSales, icon: "💰", title: "Completed marketplace sales" },
          { label: "Rehomed", value: stats.frySoldSelfReported, icon: "🏠", title: "From your own grow-out logs — includes fish rehomed off the marketplace" },
        ].map(({ label, value, icon, title }) => (
          <div key={label} title={title} style={{
            padding: "0.65rem", borderRadius: "8px", textAlign: "center",
            background: "rgba(139, 92, 246, 0.04)", border: "1px solid rgba(139, 92, 246, 0.1)",
          }}>
            <div style={{ fontSize: "0.9rem", marginBottom: "2px" }}>{icon}</div>
            <div style={{ fontSize: "1rem", fontWeight: "700", color: "#fff" }}>{value}</div>
            <div style={{ fontSize: "0.6rem", color: "var(--text-muted)", marginTop: "1px" }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Earned Achievements */}
      <div style={{ marginBottom: "1.25rem" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.6rem" }}>
          <span style={{ fontSize: "0.75rem", fontWeight: "700", color: "#fff" }}>
            🏆 Earned ({earned.length}/{ACHIEVEMENTS.length})
          </span>
          <span style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>
            {Math.round((earned.length / ACHIEVEMENTS.length) * 100)}% complete
          </span>
        </div>

        {/* Progress bar */}
        <div style={{ height: "4px", background: "rgba(255,255,255,0.05)", borderRadius: "2px", marginBottom: "0.75rem", overflow: "hidden" }}>
          <div style={{
            height: "100%", width: `${(earned.length / ACHIEVEMENTS.length) * 100}%`,
            background: "linear-gradient(90deg, #a78bfa, #34d399)",
            borderRadius: "2px", transition: "width 0.5s ease",
          }} />
        </div>

        {earned.length === 0 ? (
          <div style={{ textAlign: "center", padding: "1.5rem", color: "var(--text-muted)", fontSize: "0.8rem" }}>
            <span style={{ fontSize: "1.5rem", display: "block", marginBottom: "0.5rem" }}>🌱</span>
            Start breeding to unlock achievements!
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "0.5rem" }}>
            {earned.map((a) => {
              const style = TIER_STYLES[a.tier];
              return (
                <div key={a.id} style={{
                  padding: "0.7rem", borderRadius: "10px", textAlign: "center",
                  background: style.bg, border: `1px solid ${style.border}`,
                  boxShadow: `0 0 12px ${style.glow}`,
                  transition: "transform 0.2s",
                  cursor: "default",
                  position: "relative",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; }}
                title={a.description}
                >
                  <div style={{ fontSize: "1.3rem", marginBottom: "4px" }}>{a.icon}</div>
                  <div style={{ fontSize: "0.7rem", fontWeight: "700", color: style.color, marginBottom: "2px" }}>{a.label}</div>
                  <div style={{ fontSize: "0.55rem", color: "var(--text-muted)", lineHeight: "1.3", marginBottom: "6px" }}>{a.description}</div>
                  <ShareButton
                    generateCard={() => generateAchievementCard(a, { earned: earned.length, total: ACHIEVEMENTS.length, totalXp: getXp(), tierName: levelInfo?.key })}
                    title={`Achievement: ${a.label}`}
                    text={`Just unlocked "${a.label}" on Aquacellum! ${a.description}`}
                    size="sm"
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Locked Achievements (dimmed) */}
      {locked.length > 0 && (
        <div>
          <div style={{ fontSize: "0.72rem", fontWeight: "600", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
            🔒 Locked ({locked.length})
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "0.4rem" }}>
            {locked.slice(0, 6).map((a) => (
              <div key={a.id} style={{
                padding: "0.6rem", borderRadius: "8px", textAlign: "center",
                background: "rgba(255,255,255,0.01)", border: "1px dashed rgba(255,255,255,0.06)",
                opacity: 0.5,
              }} title={a.description}>
                <div style={{ fontSize: "1.1rem", marginBottom: "3px", filter: "grayscale(1)" }}>{a.icon}</div>
                <div style={{ fontSize: "0.65rem", fontWeight: "600", color: "var(--text-muted)" }}>{a.label}</div>
                <div style={{ fontSize: "0.52rem", color: "var(--text-muted)", marginTop: "2px" }}>{a.description}</div>
              </div>
            ))}
          </div>
          {locked.length > 6 && (
            <div style={{ textAlign: "center", marginTop: "0.5rem", fontSize: "0.65rem", color: "var(--text-muted)" }}>
              +{locked.length - 6} more to unlock
            </div>
          )}
        </div>
      )}

      {/* Current Tier Display */}
      {levelInfo && (
        <div style={{
          marginTop: "1.25rem", padding: "0.85rem 1rem", borderRadius: "10px",
          background: "rgba(167, 139, 250, 0.05)", border: "1px solid rgba(167, 139, 250, 0.15)",
          display: "flex", alignItems: "center", gap: "0.75rem",
        }}>
          <div style={{ fontSize: "1.5rem" }}>{levelInfo.icon || "🐟"}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "0.82rem", fontWeight: "700", color: "#fff" }}>
              {levelInfo.label || levelInfo.key}
            </div>
            <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginTop: "2px" }}>
              {getXp()} XP — {levelInfo.nextLabel ? `${levelInfo.xpToNext} XP to ${levelInfo.nextLabel}` : "Max tier reached"}
            </div>
          </div>
          <ShareButton
            generateCard={() => generateSpawnMilestoneCard({ spawnCount: stats.totalSpawns, totalOffspring: stats.totalFrySurvived, survivalRate: stats.bestSurvivalRate, speciesCount: stats.uniqueSpeciesBred })}
            title="Breeder Stats"
            text={`My Aquacellum stats: ${stats.totalSpawns} spawns, ${stats.totalFrySurvived} fry survived, ${stats.bestSurvivalRate}% best survival!`}
            label="Share Stats"
            size="sm"
          />
          <div style={{
            fontSize: "0.62rem", fontWeight: "700", padding: "4px 10px", borderRadius: "12px",
            background: "rgba(167, 139, 250, 0.1)", border: "1px solid rgba(167, 139, 250, 0.25)",
            color: "#a78bfa",
          }}>
            Tier {levelInfo.level}
          </div>
        </div>
      )}
    </div>
  );
}

export default BreederAchievements;
