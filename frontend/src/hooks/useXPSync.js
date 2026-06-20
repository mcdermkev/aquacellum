import { useEffect } from "react";
import { db } from "../db";
import { deriveTierFromXp } from "../db";
import { TIER_LADDER } from "../utils/xp";
import { isSupabaseConfigured } from "../services/supabaseClient";
import { logXpEvent } from "../services/zoneLeaderboardApi";
import { syncXpProfileToCloud } from "../services/cloudSync";

/**
 * useXPSync — Unified XP Sync Hook
 * 
 * Reactively syncs XP events (on-chain + local husbandry actions) to the
 * unified Dexie.js userProfile.totalXp pool. No more prestigeXp/hobbyistXp split.
 * 
 * Also maintains breederCompanion tier state (derived from totalXp) and
 * handles the God-Tier zone champion evaluation.
 * 
 * @param {string} walletAddress - Connected wallet address.
 * @param {object} contractInstance - Ethers.js Contract instance of AquadexMarketplace (optional).
 * @param {function} onXpUpdated - Callback invoked after local database updates.
 */
export function useXPSync(walletAddress, contractInstance, onXpUpdated) {
  useEffect(() => {
    if (!walletAddress) return;

    /**
     * Core progression logic: processes a single XP award into the unified pool.
     */
    const processXpProgression = async (user, amount, reasonText) => {
      const amountNum = Number(amount);
      if (!amountNum || amountNum <= 0) return;

      const cleanReason = reasonText || "";

      // Generate deterministic zoneHash from walletAddress
      let hash = 0;
      for (let i = 0; i < user.length; i++) {
        hash = user.charCodeAt(i) + ((hash << 5) - hash);
      }
      const zoneHash = "0x" + Math.abs(hash).toString(16).padStart(8, "0");

      let totalXp = 0;
      let finalLevel = 1;
      let oldLevel = 1;

      await db.transaction("rw", [db.userProfile, db.breederCompanion], async () => {
        // ─── 1. Update unified userProfile ───────────────────────────────
        let profile = await db.userProfile.get(user);
        if (!profile) {
          profile = {
            walletAddress: user,
            totalXp: 0,
            currentTier: "Shallow",
            zoneHash,
            monthlyXp: 0,
            rewardCredits: 0,
            streakDays: 0,
            lastActiveDate: null,
            isCouncilMember: false,
            onboardingComplete: false,
          };
        }

        const oldTotalXp = profile.totalXp || 0;
        oldLevel = getTierLevel(oldTotalXp);

        // All XP goes into one pool
        profile.totalXp = oldTotalXp + amountNum;
        profile.monthlyXp = (profile.monthlyXp || 0) + amountNum;
        profile.currentTier = deriveTierFromXp(profile.totalXp);
        profile.zoneHash = zoneHash;

        // Update care streak
        const today = new Date().toISOString().slice(0, 10);
        if (profile.lastActiveDate !== today) {
          const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
          if (profile.lastActiveDate === yesterday) {
            profile.streakDays = (profile.streakDays || 0) + 1;
          } else if (profile.lastActiveDate !== today) {
            profile.streakDays = 1;
          }
          profile.lastActiveDate = today;
        }

        await db.userProfile.put(profile);

        totalXp = profile.totalXp;
        finalLevel = getTierLevel(totalXp);

        // ─── 2. Sync breederCompanion state (derived from totalXp) ───────
        let companion = await db.breederCompanion.get(user);
        if (!companion) {
          companion = {
            walletAddress: user,
            eggState: 0,
            currentTier: "Shallow",
            selectedStats: ["tankCount", "masteredSpecies"],
            zoneHash,
          };
        }

        companion.zoneHash = zoneHash;
        companion.currentTier = profile.currentTier;

        // Egg state progression based on totalXp
        if (totalXp >= 1500) {
          companion.eggState = 2; // Hatched
        } else if (totalXp >= 500) {
          companion.eggState = 1; // Egg Spawned
        } else {
          companion.eggState = 0; // Locked
        }

        // God-Tier zone champion evaluation (only at Hadal tier, 10k+)
        if (totalXp >= 10000) {
          const regionalBreeders = await db.breederCompanion
            .where("zoneHash")
            .equals(zoneHash)
            .toArray();

          let isHighest = true;
          let currentChampion = null;

          for (const breeder of regionalBreeders) {
            if (breeder.walletAddress.toLowerCase() !== user.toLowerCase()) {
              // Check their totalXp from userProfile
              const breederProfile = await db.userProfile.get(breeder.walletAddress);
              const breederXp = breederProfile ? breederProfile.totalXp : 0;
              if (breederXp >= totalXp) {
                isHighest = false;
              }
              if (breeder.currentTier === "Hadal-Champion") {
                currentChampion = breeder;
              }
            }
          }

          if (isHighest) {
            companion.currentTier = "Hadal-Champion";
            // Demote previous champion back to Hadal
            if (currentChampion && currentChampion.walletAddress.toLowerCase() !== user.toLowerCase()) {
              currentChampion.currentTier = "Hadal";
              await db.breederCompanion.put(currentChampion);
            }
          }
        }

        await db.breederCompanion.put(companion);
      });

      // Sync XP to cloud for cross-device persistence (fire-and-forget)
      syncXpProfileToCloud(user, {
        totalXp,
        currentTier: deriveTierFromXp(totalXp),
        streakDays: (await db.userProfile.get(user))?.streakDays || 0,
        lastActiveDate: (await db.userProfile.get(user))?.lastActiveDate || null,
        monthlyXp: (await db.userProfile.get(user))?.monthlyXp || 0,
      }).catch(() => {});

      // Notify consumers
      if (onXpUpdated) {
        onXpUpdated();
      }

      const tierChanged = finalLevel !== oldLevel;

      const xpEvent = new CustomEvent("aquadex_xp_added", {
        detail: {
          _dexieSynced: true, // Flag to prevent bridge listener from re-processing
          walletAddress: user,
          amount: amountNum,
          reason: cleanReason,
          points: amountNum,
          actionLabel: cleanReason,
          totalXp,
          tierChanged,
          newLevel: finalLevel,
          // Legacy compat
          label: cleanReason,
          newXp: totalXp,
          levelChanged: tierChanged,
        },
      });
      window.dispatchEvent(xpEvent);

      // ─── Sync to server (non-blocking, fire-and-forget) ─────────────
      // Logs the XP event to Supabase xp_events for leaderboard + distribution.
      // Server-side validation is handled by the validate-xp-event Edge Function
      // (called via logXpEvent → xp_events insert → trigger).
      if (isSupabaseConfigured()) {
        syncXpToServer(user, amountNum, cleanReason, zoneHash).catch((err) => {
          console.warn("useXPSync: Server sync failed (non-fatal):", err?.message || err);
        });
      }
    };

    /**
     * Sync local XP event to Supabase (fire-and-forget).
     * Maps local action labels to XP_ACTIONS keys for server validation.
     */
    const syncXpToServer = async (wallet, points, reason, zoneHash) => {
      const actionKey = mapReasonToActionKey(reason);
      const multiplier = calculateLocalMultiplier(wallet);

      await logXpEvent({
        actionType: actionKey,
        pointsAwarded: points,
        multiplier,
        metadata: { source: "local_sync", reason },
      });
    };

    /**
     * Map free-text action reasons to XP_ACTIONS keys.
     */
    const mapReasonToActionKey = (reason) => {
      const r = (reason || "").toLowerCase();
      if (r.includes("feed")) return "LOG_FEEDING";
      if (r.includes("water change")) return "LOG_WATER";
      if (r.includes("water") && r.includes("test") || r.includes("parameter")) return "LOG_PARAMETERS";
      if (r.includes("algae") || r.includes("scrape")) return "LOG_FEEDING";
      if (r.includes("photo") || r.includes("observation")) return "PHOTO_OBSERVATION";
      if (r.includes("tank") && r.includes("register")) return "REGISTER_TANK";
      if (r.includes("species") && r.includes("add")) return "ADD_SPECIES";
      if (r.includes("mint") || r.includes("birth certificate")) return "MINT_SPECIMEN";
      if (r.includes("spawn") || r.includes("breed")) return "SPAWN_BREED";
      if (r.includes("list")) return "LIST_DIRECTORY";
      if (r.includes("handshake") || r.includes("pickup")) return "VERIFIED_PICKUP_BUYER";
      if (r.includes("sale") || r.includes("sold")) return "COMPLETED_SALE";
      if (r.includes("purchase") || r.includes("bought") || r.includes("checkout")) return "CLAIM_EXCHANGE";
      if (r.includes("audit") && r.includes("gave")) return "AUDIT_GIVEN";
      if (r.includes("audit")) return "AUDIT_RECEIVED";
      if (r.includes("current") || r.includes("post")) return "POST_CURRENT";
      if (r.includes("insight")) return "PUBLISH_INSIGHT";
      if (r.includes("school") || r.includes("join")) return "JOIN_SCHOOL";
      if (r.includes("mentor")) return "MENTORED_USER";
      return "LOG_FEEDING"; // fallback
    };

    /**
     * Calculate multiplier based on local streak state.
     * In future, expo zone detection can override this to 2.0.
     */
    const calculateLocalMultiplier = (wallet) => {
      // Streak bonus is calculated server-side from profiles.streak_days
      // Client sends 1.0 and lets server validate/apply the correct multiplier
      return 1.0;
    };

    // ─── Public trigger for components to award XP ─────────────────────────
    const handleXpUpdate = async (xpAmount, activityType) => {
      try {
        await processXpProgression(walletAddress, xpAmount, activityType);
      } catch (err) {
        console.error("useXPSync: Dexie synchronization failed:", err);
      }
    };

    window.triggerXpTracking = handleXpUpdate;

    // ─── Bridge: catch addXp() events that only wrote to localStorage ──────
    // addXp() in utils/xp.js fires aquadex_xp_added but only writes localStorage.
    // useXPSync also fires that same event AFTER writing Dexie. We distinguish
    // by checking for a `_dexieSynced` flag that we set on our own dispatches.
    const handleExternalXpEvent = async (e) => {
      const detail = e.detail || {};
      // Skip events we dispatched ourselves (already in Dexie)
      if (detail._dexieSynced) return;
      // Skip events without usable data
      const amount = Number(detail.points || detail.amount || 0);
      if (amount <= 0) return;
      const reason = detail.actionLabel || detail.label || detail.reason || "Activity";
      try {
        await processXpProgression(walletAddress, amount, reason);
      } catch (err) {
        console.warn("useXPSync: Bridge sync from addXp() failed:", err);
      }
    };

    window.addEventListener("aquadex_xp_added", handleExternalXpEvent);

    // ─── Dexie actionLogs hook — auto-award XP on husbandry logs ───────────
    const handleActionLogCreating = (primKey, obj, transaction) => {
      const actionType = obj.actionType;
      let xpAmount = 0;

      if (actionType === "Feed") xpAmount = 5;
      else if (actionType === "Quick Water Test") xpAmount = 8;
      else if (actionType === "Scraped Algae") xpAmount = 5;
      else if (actionType === "Water Change") xpAmount = 10;

      if (xpAmount > 0) {
        transaction.on("complete", () => {
          handleXpUpdate(xpAmount, `Logged ${actionType}`);
        });
      }
    };

    db.actionLogs.hook("creating", handleActionLogCreating);

    // ─── On-chain event listener (if contract provided) ────────────────────
    let handleXpEvent = null;
    if (contractInstance) {
      handleXpEvent = async (user, amount, reason) => {
        if (user.toLowerCase() !== walletAddress.toLowerCase()) return;

        try {
          await processXpProgression(walletAddress, amount, reason);
        } catch (err) {
          console.error("useXPSync: On-chain XP sync failed:", err);
        }
      };

      contractInstance.on("XPEarned", handleXpEvent);
    }

    // ─── Cleanup ───────────────────────────────────────────────────────────
    return () => {
      window.removeEventListener("aquadex_xp_added", handleExternalXpEvent);
      db.actionLogs.hook("creating").unsubscribe(handleActionLogCreating);
      if (contractInstance && handleXpEvent) {
        contractInstance.off("XPEarned", handleXpEvent);
      }
    };
  }, [walletAddress, contractInstance, onXpUpdated]);
}

/**
 * Helper: get tier level number from XP.
 */
function getTierLevel(xp) {
  const points = Number(xp) || 0;
  for (let i = TIER_LADDER.length - 1; i >= 0; i--) {
    if (points >= TIER_LADDER[i].min) return TIER_LADDER[i].level;
  }
  return 1;
}

export default useXPSync;
