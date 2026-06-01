import { useEffect } from "react";
import { db } from "../db";

/**
 * Custom hook to reactively sync on-chain XP events to local Dexie.js user profile cache.
 * @param {string} walletAddress - Connected wallet address.
 * @param {object} contractInstance - Ethers.js Contract instance of AquadexMarketplace.
 * @param {function} onXpUpdated - Callback invoked after local database updates.
 */
export function useXPSync(walletAddress, contractInstance, onXpUpdated) {
  useEffect(() => {
    if (!walletAddress) return;

    // Core progression logic helper to process user XP increase and companion state transitions
    const processXpProgression = async (user, amount, reasonText) => {
      const amountNum = Number(amount);
      const cleanReason = reasonText || "";

      // Generate deterministic fuzzed zoneHash from walletAddress
      let hash = 0;
      for (let i = 0; i < user.length; i++) {
        hash = user.charCodeAt(i) + ((hash << 5) - hash);
      }
      const zoneHash = "0x" + Math.abs(hash).toString(16).padStart(8, "0");

      let totalXp = 0;
      let finalLevel = 1;
      let oldLevel = 1;

      await db.transaction("rw", [db.userProfile, db.breederCompanion], async () => {
        // 1. Update primary profile tables
        let profile = await db.userProfile.get(user);
        if (!profile) {
          profile = {
            walletAddress: user,
            level: 1,
            prestigeXp: 0,
            hobbyistXp: 0,
            isCouncilMember: false
          };
        }

        const oldTotalXp = profile.prestigeXp + profile.hobbyistXp;
        oldLevel = Math.floor(oldTotalXp / 1000) + 1;

        // Classify XP types based on the reason/activityType
        if (
          cleanReason.includes("Breeder") ||
          cleanReason.includes("Handshake") ||
          cleanReason.includes("Expert Audit") ||
          cleanReason.includes("Sale Settled") ||
          cleanReason.includes("Dispute Resolved") ||
          cleanReason.includes("Mentor")
        ) {
          profile.prestigeXp += amountNum;
        } else if (
          cleanReason.includes("Buyer") ||
          cleanReason.includes("Water Snapshot") ||
          cleanReason.includes("Checkout") ||
          cleanReason.includes("Purchase") ||
          cleanReason.includes("Logged") ||
          cleanReason.includes("Registered")
        ) {
          profile.hobbyistXp += amountNum;
        } else {
          profile.prestigeXp += amountNum;
        }

        // Recalculate level (1 level per 1000 XP)
        profile.level = Math.floor((profile.prestigeXp + profile.hobbyistXp) / 1000) + 1;
        await db.userProfile.put(profile);

        totalXp = profile.prestigeXp + profile.hobbyistXp;
        finalLevel = profile.level;

        // 2. Process Breeder Egg Progression State Matrix
        let companion = await db.breederCompanion.get(user);
        if (!companion) {
          companion = {
            walletAddress: user,
            eggState: 0, // 0 = Locked, 1 = Egg Spawned, 2 = Hatched, 3 = Evolved
            companionXp: 0,
            currentTier: "Bronze",
            selectedStats: ["tankCount", "masteredSpecies"],
            zoneHash: zoneHash
          };
        }

        companion.companionXp += amountNum;
        companion.zoneHash = zoneHash; // Ensure zoneHash is set

        // Threshold Check: Spawn the mysterious quiet egg or hatch and tier the companion based on companionXp
        if (companion.companionXp >= 1500) {
          companion.eggState = 2; // Hatched!
          
          if (companion.companionXp >= 10000) {
            companion.currentTier = "Master";
            
            // Regional God-Tier Leaderboard Evaluation
            const regionalBreeders = await db.breederCompanion
              .where("zoneHash")
              .equals(zoneHash)
              .toArray();
            
            let isHighest = true;
            let currentGodTierBreeder = null;

            for (const breeder of regionalBreeders) {
              if (breeder.walletAddress.toLowerCase() !== user.toLowerCase()) {
                if (breeder.companionXp >= companion.companionXp) {
                  isHighest = false;
                }
                if (breeder.currentTier === "God-Tier") {
                  currentGodTierBreeder = breeder;
                }
              }
            }

            if (isHighest) {
              companion.currentTier = "God-Tier";
              // Gracefully demote previous God-Tier in this zone back to Master
              if (currentGodTierBreeder) {
                currentGodTierBreeder.currentTier = "Master";
                await db.breederCompanion.put(currentGodTierBreeder);
              }
            } else {
              companion.currentTier = "Master";
            }
          } else if (companion.companionXp >= 5000) {
            companion.currentTier = "Gold";
          } else if (companion.companionXp >= 2500) {
            companion.currentTier = "Silver";
          } else {
            companion.currentTier = "Bronze";
          }
        } else if (companion.companionXp >= 500) {
          companion.eggState = 1; // Egg Spawned
          companion.currentTier = "Bronze";
        } else {
          companion.eggState = 0; // Locked
          companion.currentTier = "Bronze";
        }

        await db.breederCompanion.put(companion);
      });

      if (onXpUpdated) {
        onXpUpdated();
      }
      
      const levelChanged = finalLevel !== oldLevel;

      const xpEvent = new CustomEvent("aquadex_xp_added", {
        detail: {
          walletAddress: user,
          amount: amountNum,
          reason: cleanReason,
          points: amountNum,
          label: cleanReason,
          newXp: totalXp,
          levelChanged: levelChanged,
          newLevel: finalLevel
        }
      });
      window.dispatchEvent(xpEvent);
    };

    // 1. Setup simulated trigger for contract XPEarned events or local actions
    const handleXpUpdate = async (xpAmount, activityType) => {
      try {
        await processXpProgression(walletAddress, xpAmount, activityType);
      } catch (err) {
        console.error("Dexie offline breederCompanion synchronization failed:", err);
      }
    };

    window.triggerXpTracking = handleXpUpdate;

    // 2. Setup Dexie actionLogs hook to capture local husbandry actions
    const handleActionLogCreating = (primKey, obj, transaction) => {
      const actionType = obj.actionType;
      let xpAmount = 0;
      if (actionType === "Feed") {
        xpAmount = 10;
      } else if (actionType === "Quick Water Test") {
        xpAmount = 15;
      } else if (actionType === "Scraped Algae") {
        xpAmount = 10;
      }

      if (xpAmount > 0) {
        transaction.on("complete", () => {
          handleXpUpdate(xpAmount, `Logged ${actionType}`);
        });
      }
    };

    db.actionLogs.hook("creating", handleActionLogCreating);

    // 3. Setup on-chain event listener if contractInstance is provided
    let handleXpEvent = null;
    if (contractInstance) {
      handleXpEvent = async (user, amount, reason) => {
        if (user.toLowerCase() !== walletAddress.toLowerCase()) {
          return;
        }

        try {
          await processXpProgression(walletAddress, amount, reason);
        } catch (err) {
          console.error("Dexie on-chain userProfile synchronization failed:", err);
        }
      };

      // Bind event listener to on-chain contract
      contractInstance.on("XPEarned", handleXpEvent);
    }

    // Unbind listeners on cleanups to prevent memory leak
    return () => {
      db.actionLogs.hook("creating").unsubscribe(handleActionLogCreating);
      if (contractInstance && handleXpEvent) {
        contractInstance.off("XPEarned", handleXpEvent);
      }
    };
  }, [walletAddress, contractInstance, onXpUpdated]);
}

export default useXPSync;

