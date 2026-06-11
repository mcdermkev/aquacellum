import { useMemo, useCallback } from "react";
import { useSponsorContext } from "./SponsorProvider";

/**
 * useSponsorCampaign
 * 
 * Hook for accessing active XP campaigns (sponsor-funded challenges).
 * Tracks user progress toward campaign goals and determines reward eligibility.
 * 
 * Usage:
 *   const { campaign, progress, isComplete, claimReward } = useSponsorCampaign("husbandry_feed");
 */
export function useSponsorCampaign(surface) {
  const { getActiveCampaign, logImpression } = useSponsorContext();

  const campaign = useMemo(() => {
    return getActiveCampaign(surface);
  }, [surface, getActiveCampaign]);

  /**
   * Get the user's current progress toward the campaign goal.
   * Reads from localStorage action history within the campaign window.
   */
  const progress = useMemo(() => {
    if (!campaign) return { current: 0, target: 0, percent: 0 };

    const target = campaign.requirements?.count || 1;
    const windowDays = campaign.requirements?.windowDays || 7;
    const actionType = campaign.requirements?.actionType || "";

    // Count matching actions in XP history within window
    let current = 0;
    try {
      const profileStr = localStorage.getItem("aquadex_xp_profile");
      if (profileStr) {
        const profile = JSON.parse(profileStr);
        const cutoff = Date.now() - (windowDays * 24 * 60 * 60 * 1000);
        const history = profile.history || [];

        current = history.filter(entry => {
          if (entry.timestamp < cutoff) return false;
          // Match action type loosely
          const label = (entry.action || "").toLowerCase();
          return label.includes(actionType.toLowerCase());
        }).length;
      }
    } catch (e) {
      console.warn("Failed to read campaign progress:", e);
    }

    return {
      current: Math.min(current, target),
      target,
      percent: Math.min(100, Math.round((current / target) * 100))
    };
  }, [campaign]);

  const isComplete = progress.current >= progress.target;

  /**
   * Claim the campaign reward. Stores claim state locally.
   */
  const claimReward = useCallback(() => {
    if (!campaign || !isComplete) return null;

    const claimKey = `aquadex_campaign_claimed_${campaign.id}`;
    if (localStorage.getItem(claimKey)) return { alreadyClaimed: true };

    localStorage.setItem(claimKey, JSON.stringify({
      claimedAt: Date.now(),
      reward: campaign.reward
    }));

    if (campaign.sponsorId) {
      logImpression(campaign.sponsorId, surface, "campaign_complete");
    }

    return campaign.reward;
  }, [campaign, isComplete, surface, logImpression]);

  /**
   * Check if this campaign's reward was already claimed
   */
  const isClaimed = useMemo(() => {
    if (!campaign) return false;
    return !!localStorage.getItem(`aquadex_campaign_claimed_${campaign.id}`);
  }, [campaign]);

  return {
    campaign,
    progress,
    isComplete,
    isClaimed,
    claimReward,
    hasCampaign: !!campaign
  };
}
