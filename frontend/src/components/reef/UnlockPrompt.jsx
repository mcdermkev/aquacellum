/**
 * UnlockPrompt.jsx
 * 
 * XP-gated feature prompt. Shows when a user attempts an action
 * they haven't unlocked yet. Displays the required tier, current progress,
 * and tips on how to earn XP to unlock the feature.
 */

import React from "react";
import { DEPTH_TIERS } from "../../services/depthScoreApi";
import { useDepthScore } from "../../hooks/useDepthScore";
import { getCurrentWallet } from "../../services/supabaseClient";
import { getXp, XP_ACTIONS } from "../../utils/xp";
import { hasEntitlement, getRequiredTierFor, getUnlockRequirement } from "../../services/entitlements";
import { useActivityFacts } from "../../hooks/useActivityFacts";
import { useUserRoles } from "../../hooks/useUserRoles";

/**
 * Resolve a tier key from a numeric XP/score value using the canonical
 * DEPTH_TIERS thresholds. DEPTH_TIERS is ordered ascending by `min`.
 */
function tierKeyForScore(score) {
  const s = Number(score || 0);
  let key = "Shallow";
  for (const t of DEPTH_TIERS) {
    if (s >= t.min) key = t.key;
  }
  return key;
}

/**
 * Tips, with their point values READ FROM THE CANONICAL TABLE.
 *
 * Every value here was previously hardcoded prose and every one was wrong: tank
 * updates were advertised at +15 (really 12), a new species at +25 (really 15),
 * a breeding log at +50 (really 150), water parameters at +10 (really 8), and two
 * tips ("comment on others' posts", "connect with other keepers") described
 * actions that award nothing at all. Telling someone the wrong price for the
 * thing you are asking them to grind is the worst place in the app to invent a
 * number, so the numbers now come from XP_ACTIONS and cannot drift from it.
 *
 * The chosen actions are also deliberately limited to award paths that actually
 * survive server validation today — recommending an action whose XP gets silently
 * rolled back would be a broken promise dressed as advice.
 */
const XP_TIP_KEYS = [
  { key: "ADD_SPECIES", icon: "🐟", text: "Add a new species to your collection" },
  { key: "LOG_WATER", icon: "💧", text: "Log a water change" },
  { key: "LOG_PARAMETERS", icon: "📊", text: "Test and log your water parameters" },
  { key: "REGISTER_TANK", icon: "🪣", text: "Register another aquarium" },
  { key: "MINT_SPECIMEN", icon: "📜", text: "Register a birth certificate" },
  { key: "SPAWN_BREED", icon: "🧬", text: "Log a successful breeding spawn" },
];

const XP_TIPS = XP_TIP_KEYS.filter(({ key }) => XP_ACTIONS[key]).map(({ key, icon, text }) => ({
  icon,
  text: `${text} for +${XP_ACTIONS[key].points} XP`,
}));

/**
 * Get the tier required for a specific privilege.
 *
 * Sourced from the centralized entitlement map (Task 6) so the Reef
 * privilege keys (canCreateSchools, canGiveAudits, etc.) resolve to the same
 * required tiers as before, without forking a second tier list here.
 *
 * Returns null for anything not tier-gated. The old `|| "Coastal"` fallback would
 * have this prompt tell someone to reach Coastal in order to open an ACTIVITY
 * capability that no amount of XP will ever unlock.
 */
function getRequiredTier(privilege) {
  return getRequiredTierFor(privilege);
}

/**
 * Get user-friendly feature name.
 */
function getFeatureLabel(privilege, casualMode) {
  const labels = {
    canCreateSchools: casualMode ? "Create Groups" : "Create Schools",
    canPostInsights: casualMode ? "Post Expert Tips" : "Post Insights",
    canRequestAudits: casualMode ? "Request Tank Reviews" : "Request Audits",
    canGiveAudits: casualMode ? "Give Tank Reviews" : "Give Expert Audits",
    canMentor: "Become a Mentor",
    canHostVirtualTides: casualMode ? "Host Virtual Events" : "Host Virtual Tides",
    canHostExpoTides: casualMode ? "Host In-Person Events" : "Host Expo Tides",
    canModerate: "Moderate Content",
  };
  return labels[privilege] || "This Feature";
}

export function UnlockPrompt({ privilege, casualModeActive = false, onClose }) {
  const walletAddress = getCurrentWallet();
  const { data: scoreData } = useDepthScore(walletAddress);

  const featureLabel = getFeatureLabel(privilege, casualModeActive);

  // What ACTUALLY opens this capability. An ACTIVITY entitlement is not reachable
  // by earning XP at all, so this prompt must not show an XP meter for one — it
  // would send someone grinding toward a threshold that has no effect.
  const requirement = getUnlockRequirement(privilege);
  const requiredTierKey = getRequiredTier(privilege);
  const isTierGated = requirement.kind === "tier" && !!requiredTierKey;

  const requiredTier = DEPTH_TIERS.find((t) => t.key === requiredTierKey) || DEPTH_TIERS[1];
  const currentScore = Math.max(getXp(), scoreData?.depth_score || 0);
  const currentTierKey = tierKeyForScore(currentScore);
  const currentTier = DEPTH_TIERS.find((t) => t.key === currentTierKey) || DEPTH_TIERS[0];

  const xpNeeded = Math.max(0, requiredTier.min - currentScore);
  const progress = requiredTier.min > 0 ? Math.min((currentScore / requiredTier.min) * 100, 100) : 0;

  // Pick 3 random tips
  const tips = [...XP_TIPS].sort(() => Math.random() - 0.5).slice(0, 3);

  // Tier label adapts to casual mode
  const getTierLabel = (tier) => {
    if (casualModeActive) return tier.hobbyistLabel || tier.label;
    return tier.label;
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.7)",
        backdropFilter: "blur(8px)",
        padding: "1rem",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="unlock-prompt-title"
    >
      <div
        className="glass-card"
        style={{
          width: "100%",
          maxWidth: "420px",
          padding: "2rem",
          borderRadius: "16px",
          border: `1px solid ${requiredTier.color}33`,
          background: "rgba(15, 23, 42, 0.98)",
          textAlign: "center",
        }}
      >
        {/* Lock icon */}
        <div style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>🔒</div>

        {/* Title */}
        <h3
          id="unlock-prompt-title"
          style={{ margin: "0 0 0.5rem", fontSize: "1.1rem", fontWeight: 700, color: "#fff" }}
        >
          {featureLabel}
        </h3>

        <p style={{ margin: "0 0 1.25rem", fontSize: "0.8rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
          {requirement.kind === "activity"
            ? `This opens with ${requirement.hint} — it isn't something you earn with XP.`
            : requirement.kind === "granted"
              ? "This is a community-authority role granted by the founders to trusted keepers — it isn't earned with XP or tier. Keep contributing and reach out if you'd like to help steward the community."
              : requirement.kind === "role"
                ? "This is handled by the curator team."
                : casualModeActive
                  ? `Reach ${getTierLabel(requiredTier)} level to unlock this feature. Keep participating and you'll get there!`
                  : `This feature requires ${requiredTier.label} tier (${requiredTier.min.toLocaleString()} XP). Continue engaging to unlock.`
          }
        </p>

        {/*
          The XP meter and the "earn XP by" tips render ONLY for a tier-gated
          capability. Showing an XP progress bar for an ACTIVITY entitlement would
          invite someone to grind toward a number that has no bearing on it.
        */}
        {isTierGated && (
        <>
        {/* Progress section */}
        <div style={{
          padding: "1rem 1.25rem",
          borderRadius: "12px",
          background: "rgba(255, 255, 255, 0.03)",
          border: "1px solid rgba(255, 255, 255, 0.06)",
          marginBottom: "1.25rem",
        }}>
          {/* Current → Required tier display */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.75rem", marginBottom: "0.75rem" }}>
            <div style={{ textAlign: "center" }}>
              <span style={{ fontSize: "1.2rem" }}>{currentTier.icon}</span>
              <div style={{ fontSize: "0.6rem", color: currentTier.color, marginTop: "0.15rem", fontWeight: 600 }}>
                {getTierLabel(currentTier)}
              </div>
            </div>
            <span style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>→</span>
            <div style={{ textAlign: "center" }}>
              <span style={{ fontSize: "1.2rem" }}>{requiredTier.icon}</span>
              <div style={{ fontSize: "0.6rem", color: requiredTier.color, marginTop: "0.15rem", fontWeight: 600 }}>
                {getTierLabel(requiredTier)}
              </div>
            </div>
          </div>

          {/* Progress bar */}
          <div style={{
            width: "100%",
            height: "8px",
            borderRadius: "4px",
            background: "rgba(255, 255, 255, 0.06)",
            overflow: "hidden",
            marginBottom: "0.5rem",
          }}>
            <div style={{
              width: `${progress}%`,
              height: "100%",
              borderRadius: "4px",
              background: `linear-gradient(90deg, ${currentTier.color}, ${requiredTier.color})`,
              transition: "width 0.5s ease",
            }} />
          </div>

          {/* XP numbers */}
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.65rem" }}>
            <span style={{ color: "var(--text-muted)" }}>
              {currentScore.toLocaleString()} XP
            </span>
            <span style={{ color: requiredTier.color, fontWeight: 600 }}>
              {xpNeeded > 0 ? `${xpNeeded.toLocaleString()} XP to go` : "Unlocked!"}
            </span>
          </div>
        </div>

        {/* How to earn XP */}
        <div style={{ textAlign: "left", marginBottom: "1.5rem" }}>
          <p style={{ margin: "0 0 0.6rem", fontSize: "0.75rem", fontWeight: 600, color: "#fff" }}>
            {casualModeActive ? "How to level up:" : "Earn XP by:"}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            {tips.map((tip, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ fontSize: "0.85rem", flexShrink: 0 }}>{tip.icon}</span>
                <span style={{ fontSize: "0.7rem", color: "var(--text-secondary)" }}>{tip.text}</span>
              </div>
            ))}
          </div>
        </div>
        </>
        )}

        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            width: "100%",
            padding: "0.6rem 1rem",
            borderRadius: "8px",
            border: "none",
            background: `linear-gradient(135deg, ${currentTier.color}40, ${requiredTier.color}40)`,
            color: "#fff",
            fontSize: "0.8rem",
            fontWeight: 600,
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.85"; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
        >
          {casualModeActive ? "Got it, keep going!" : "Understood"}
        </button>
      </div>
    </div>
  );
}

/**
 * Hook: check if user has a specific privilege.
 * Returns { hasAccess, showPrompt, setShowPrompt, checkAccess }
 */
export function useUnlockGate(privilege) {
  const [showPrompt, setShowPrompt] = React.useState(false);
  const walletAddress = getCurrentWallet();
  const { data: scoreData } = useDepthScore(walletAddress);
  // ACTIVITY entitlements open on demonstrated activity rather than XP; this is
  // null until loaded, which hasEntitlement reads as "cannot tell → allow" so a
  // qualified seller is never briefly told they are locked out.
  const activity = useActivityFacts(walletAddress);
  // Social-authority privileges (create schools, give audits, mentor, host
  // Tides, moderate) are GRANTED by role, not earned — hasEntitlement reads
  // these from ctx.roles, sourced from the server-authoritative user_roles
  // table. [] until loaded, which reads as "no authority" (fail closed), the
  // correct default for authority over other keepers.
  const { data: roles = [] } = useUserRoles(walletAddress);

  // Tier still matters for the loyalty perk. The local XP profile (localStorage)
  // drives the header meter, while the Supabase depth_score/depth_tier can lag or
  // be null. hasEntitlement's resolveTier takes the higher of ctx.xp and ctx.tier
  // so a user whose XP has already reached a tier isn't locked out by a stale DB
  // value.
  const hasAccess = hasEntitlement(privilege, {
    xp: getXp(),
    tier: scoreData?.depth_tier,
    activity,
    roles,
  });

  const checkAccess = () => {
    if (hasAccess) return true;
    setShowPrompt(true);
    return false;
  };

  return { hasAccess, showPrompt, setShowPrompt, checkAccess, privilege };
}
