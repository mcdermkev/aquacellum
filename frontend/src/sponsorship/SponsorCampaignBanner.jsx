import React from "react";
import { useSponsorCampaign } from "./useSponsorCampaign";
import { useSponsorImpression } from "./useSponsorImpression";

/**
 * SponsorCampaignBanner
 * 
 * Displays an active XP campaign challenge with progress tracking.
 * Shows the sponsor brand, challenge requirements, and a progress bar.
 * 
 * Renders nothing when no campaign is active for the given surface.
 * 
 * Props:
 *   - surface: string — which surface to check for active campaigns
 *   - compact: boolean — use a smaller inline variant (default: false)
 */
export function SponsorCampaignBanner({ surface, compact = false }) {
  const { campaign, progress, isComplete, isClaimed, claimReward, hasCampaign } = useSponsorCampaign(surface);

  if (!hasCampaign) return null;

  useSponsorImpression(campaign.sponsorId, surface);

  const handleClaim = () => {
    const reward = claimReward();
    if (reward && !reward.alreadyClaimed) {
      // Could trigger a toast or XP animation here
      window.dispatchEvent(new CustomEvent("aquadex_campaign_reward", { detail: reward }));
    }
  };

  if (compact) {
    return (
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.4rem 0.75rem",
        background: "rgba(245, 158, 11, 0.05)",
        border: "1px solid rgba(245, 158, 11, 0.15)",
        borderRadius: "8px",
        fontSize: "0.7rem"
      }}>
        <span style={{ color: "#f59e0b" }}>🎯</span>
        <span style={{ color: "rgba(255, 255, 255, 0.7)" }}>
          {campaign.title}: {progress.current}/{progress.target}
        </span>
        <div style={{
          flex: 1,
          height: "4px",
          background: "rgba(255, 255, 255, 0.05)",
          borderRadius: "2px",
          overflow: "hidden",
          minWidth: "40px"
        }}>
          <div style={{
            height: "100%",
            width: `${progress.percent}%`,
            background: isComplete ? "#10b981" : "#f59e0b",
            borderRadius: "2px",
            transition: "width 0.3s ease"
          }} />
        </div>
        {isComplete && !isClaimed && (
          <button
            onClick={handleClaim}
            style={{
              background: "#10b981",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              padding: "0.2rem 0.5rem",
              fontSize: "0.6rem",
              fontWeight: "700",
              cursor: "pointer"
            }}
          >
            Claim
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className="glass-card"
      style={{
        padding: "1.25rem 1.5rem",
        background: "linear-gradient(135deg, rgba(245, 158, 11, 0.06) 0%, rgba(0,0,0,0) 100%)",
        border: "1px solid rgba(245, 158, 11, 0.2)",
        position: "relative"
      }}
    >
      {/* Campaign badge */}
      <span style={{
        position: "absolute",
        top: "0.75rem",
        right: "0.75rem",
        fontSize: "0.6rem",
        fontWeight: "700",
        padding: "0.2rem 0.6rem",
        borderRadius: "12px",
        background: "rgba(245, 158, 11, 0.1)",
        border: "1px solid rgba(245, 158, 11, 0.3)",
        color: "#f59e0b",
        textTransform: "uppercase",
        letterSpacing: "0.05em"
      }}>
        ⚡ Active Challenge
      </span>

      <h4 style={{ margin: "0 0 0.25rem 0", fontSize: "1rem", color: "#fff", fontWeight: "700" }}>
        🎯 {campaign.title}
      </h4>
      <p style={{ margin: "0 0 1rem 0", fontSize: "0.8rem", color: "rgba(255, 255, 255, 0.6)", lineHeight: "1.4" }}>
        {campaign.description}
      </p>

      {/* Progress bar */}
      <div style={{ marginBottom: "0.75rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.7rem", marginBottom: "0.35rem" }}>
          <span style={{ color: "rgba(255, 255, 255, 0.5)" }}>Progress</span>
          <span style={{ color: isComplete ? "#10b981" : "#f59e0b", fontWeight: "600" }}>
            {progress.current} / {progress.target}
          </span>
        </div>
        <div style={{
          height: "8px",
          width: "100%",
          background: "rgba(255, 255, 255, 0.04)",
          borderRadius: "4px",
          overflow: "hidden",
          border: "1px solid rgba(255, 255, 255, 0.06)"
        }}>
          <div style={{
            height: "100%",
            width: `${progress.percent}%`,
            background: isComplete
              ? "linear-gradient(90deg, #10b981, #34d399)"
              : "linear-gradient(90deg, #f59e0b, #fbbf24)",
            borderRadius: "4px",
            transition: "width 0.4s ease"
          }} />
        </div>
      </div>

      {/* Reward section */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "0.6rem 0.75rem",
        background: "rgba(255, 255, 255, 0.02)",
        borderRadius: "6px",
        border: "1px solid rgba(255, 255, 255, 0.04)"
      }}>
        <span style={{ fontSize: "0.75rem", color: "rgba(255, 255, 255, 0.5)" }}>
          🏆 Reward: <strong style={{ color: "#fff" }}>
            {campaign.reward?.type === "badge" && `${campaign.reward.value} Badge`}
            {campaign.reward?.type === "discount_code" && `Discount Code`}
            {campaign.reward?.type === "xp_boost" && `${campaign.reward.value}`}
          </strong>
          {campaign.xpMultiplier > 1 && (
            <span style={{ color: "#f59e0b", marginLeft: "0.5rem" }}>+ {campaign.xpMultiplier}x XP</span>
          )}
        </span>

        {isComplete && !isClaimed && (
          <button
            onClick={handleClaim}
            style={{
              background: "linear-gradient(135deg, #10b981, #059669)",
              color: "#fff",
              border: "none",
              borderRadius: "6px",
              padding: "0.4rem 1rem",
              fontSize: "0.75rem",
              fontWeight: "700",
              cursor: "pointer",
              boxShadow: "0 4px 12px rgba(16, 185, 129, 0.3)"
            }}
          >
            🎉 Claim Reward
          </button>
        )}
        {isClaimed && (
          <span style={{ fontSize: "0.7rem", color: "#10b981", fontWeight: "600" }}>✓ Claimed</span>
        )}
      </div>
    </div>
  );
}
