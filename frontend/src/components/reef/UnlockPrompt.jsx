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

const XP_TIPS = [
  { icon: "📸", text: "Post tank updates to earn +15 XP each" },
  { icon: "💬", text: "Comment on others' posts for +5 XP" },
  { icon: "🐟", text: "Log a new species in your collection for +25 XP" },
  { icon: "🏫", text: "Participate in group challenges for bonus XP" },
  { icon: "🤝", text: "Connect with other keepers for +10 XP" },
  { icon: "📊", text: "Share water parameters for +10 XP" },
  { icon: "🧬", text: "Log a successful breeding for +50 XP" },
];

/**
 * Get the tier required for a specific privilege.
 */
function getRequiredTier(privilege) {
  const tierMap = {
    canCreateSchools: "Coastal",
    canPostInsights: "Coastal",
    canRequestAudits: "Coastal",
    canGiveAudits: "Abyssal",
    canMentor: "Abyssal",
    canHostVirtualTides: "Abyssal",
    canHostExpoTides: "Hadal",
    canModerate: "Hadal",
  };
  return tierMap[privilege] || "Coastal";
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

  const requiredTierKey = getRequiredTier(privilege);
  const requiredTier = DEPTH_TIERS.find((t) => t.key === requiredTierKey) || DEPTH_TIERS[1];
  const currentScore = scoreData?.depth_score || 0;
  const currentTierKey = scoreData?.depth_tier || "Shallow";
  const currentTier = DEPTH_TIERS.find((t) => t.key === currentTierKey) || DEPTH_TIERS[0];

  const xpNeeded = Math.max(0, requiredTier.min - currentScore);
  const progress = requiredTier.min > 0 ? Math.min((currentScore / requiredTier.min) * 100, 100) : 0;
  const featureLabel = getFeatureLabel(privilege, casualModeActive);

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
          {casualModeActive
            ? `Reach ${getTierLabel(requiredTier)} level to unlock this feature. Keep participating and you'll get there!`
            : `This feature requires ${requiredTier.label} tier (${requiredTier.min.toLocaleString()} XP). Continue engaging to unlock.`
          }
        </p>

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

  const currentTier = scoreData?.depth_tier || "Shallow";

  const tierOrder = ["Shallow", "Coastal", "Pelagic", "Abyssal", "Hadal"];
  const requiredTierKey = getRequiredTier(privilege);
  const currentIndex = tierOrder.indexOf(currentTier);
  const requiredIndex = tierOrder.indexOf(requiredTierKey);

  const hasAccess = currentIndex >= requiredIndex;

  const checkAccess = () => {
    if (hasAccess) return true;
    setShowPrompt(true);
    return false;
  };

  return { hasAccess, showPrompt, setShowPrompt, checkAccess, privilege };
}
