import { useEffect, useRef } from "react";
import { db } from "../db";
import { deriveTierFromXp } from "../db";
import { TIER_LADDER } from "../utils/xp";
import { isSupabaseConfigured } from "../services/supabaseClient";
import { syncXpProfileToCloud } from "../services/cloudSync";
import { enforceXpCooldown } from "../utils/xpCooldowns";

/**
 * useXPSync — Unified XP Sync Hook (Server-Authoritative)
 * 
 * Reactively syncs XP events to the unified Dexie.js userProfile.totalXp pool.
 * Uses an optimistic-then-reconcile pattern:
 *   1. XP is awarded locally instantly (great UX — no spinner)
 *   2. The claim is sent to /api/validate-xp for server-side validation
 *   3. If rejected (cooldown, daily limit, gaming) → local XP is rolled back
 *   4. If accepted → serverTotal becomes the authoritative leaderboard value
 * 
 * Also maintains breederCompanion tier state (derived from totalXp) and
 * handles the God-Tier zone champion evaluation.
 * 
 * @param {string} walletAddress - Connected wallet address.
 * @param {object} contractInstance - Ethers.js Contract instance of AquadexMarketplace (optional).
 * @param {function} onXpUpdated - Callback invoked after local database updates.
 * @param {function} getAccessToken - Privy getAccessToken() for auth on validation calls.
 */
export function useXPSync(walletAddress, contractInstance, onXpUpdated, getAccessToken) {
  // Track pending validations so we can roll back on rejection
  const pendingValidationsRef = useRef(new Map());

  useEffect(() => {
    if (!walletAddress) return;

    /**
     * Core progression logic: processes a single XP award into the unified pool.
     * Returns the updated totalXp for use by the server sync.
     */
    const processXpProgression = async (user, amount, reasonText, metadata = {}) => {
      const amountNum = Number(amount);
      if (!amountNum || amountNum <= 0) return { totalXp: 0, zoneHash: "" };

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

      return { totalXp, zoneHash };
    };

    /**
     * Roll back a rejected XP claim from the local database.
     * Subtracts the points that the server rejected.
     */
    const rollbackXp = async (user, amount) => {
      const amountNum = Number(amount);
      if (!amountNum || amountNum <= 0) return;

      await db.transaction("rw", [db.userProfile, db.breederCompanion], async () => {
        const profile = await db.userProfile.get(user);
        if (!profile) return;

        profile.totalXp = Math.max(0, (profile.totalXp || 0) - amountNum);
        profile.monthlyXp = Math.max(0, (profile.monthlyXp || 0) - amountNum);
        profile.currentTier = deriveTierFromXp(profile.totalXp);
        await db.userProfile.put(profile);

        // Sync companion tier
        const companion = await db.breederCompanion.get(user);
        if (companion) {
          companion.currentTier = profile.currentTier;
          if (profile.totalXp >= 1500) companion.eggState = 2;
          else if (profile.totalXp >= 500) companion.eggState = 1;
          else companion.eggState = 0;
          await db.breederCompanion.put(companion);
        }
      });

      // Dispatch rollback event so UI can update (toast, companion, etc.)
      window.dispatchEvent(new CustomEvent("aquadex_xp_rollback", {
        detail: { walletAddress: user, amount: amountNum },
      }));

      // Update localStorage for legacy consumers
      try {
        const profile = await db.userProfile.get(user);
        if (profile) {
          localStorage.setItem("aquadex_xp", String(profile.totalXp));
          localStorage.setItem("aquadex_xp_points", String(profile.totalXp));
        }
      } catch { /* ignore */ }

      if (onXpUpdated) onXpUpdated();
    };

    /**
     * Validate XP claim server-side via /api/validate-xp.
     * If rejected, rolls back the optimistically awarded local XP.
     * If accepted, the serverTotal is now the leaderboard authority.
     */
    const validateXpWithServer = async (user, amount, actionKey, metadata = {}) => {
      // Skip if no auth token available (MetaMask users, offline, etc.)
      if (!getAccessToken) return;

      let token = null;
      try {
        token = await getAccessToken();
      } catch {
        // Can't get token — skip server validation (local XP stays)
        return;
      }

      if (!token) return;

      const validationId = `${actionKey}-${Date.now()}-${Math.random()}`;
      pendingValidationsRef.current.set(validationId, { amount, actionKey });

      try {
        const response = await fetch("/api/validate-xp", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
          },
          body: JSON.stringify({
            actionType: actionKey,
            pointsAwarded: amount,
            multiplier: 1.0, // Server calculates real multiplier
            metadata,
            walletAddress: user,
          }),
        });

        if (response.ok) {
          const result = await response.json();
          // Server accepted — if it awarded more (multiplier), add the difference
          if (result.finalPoints > amount) {
            const bonus = result.finalPoints - amount;
            await processXpProgression(user, bonus, `${actionKey} (streak bonus)`);
          }
          // serverTotal is now the authoritative leaderboard value
          // (stored in profiles.xp_total server-side)
        } else if (response.status === 403) {
          // Server REJECTED the XP claim (cooldown, daily limit, gaming)
          const result = await response.json().catch(() => ({}));
          console.info("[XP] Server rejected:", actionKey, result.reason || "");
          // Roll back the optimistically awarded points
          await rollbackXp(user, amount);
        } else if (response.status === 429) {
          // Rate limited — don't roll back (benefit of the doubt), just log
          console.warn("[XP] Rate limited on server validation");
        }
        // 5xx errors: don't roll back — benefit of the doubt for server issues
      } catch (err) {
        // Network error — don't roll back (local-first, offline-friendly)
        console.warn("[XP] Server validation unavailable:", err.message);
      } finally {
        pendingValidationsRef.current.delete(validationId);
      }
    };

    /**
     * Map free-text action reasons to XP_ACTIONS keys.
     */
    const mapReasonToActionKey = (reason) => {
      const r = (reason || "").toLowerCase();
      if (r.includes("feed")) return "LOG_FEEDING";
      if (r.includes("water change")) return "LOG_WATER";
      if ((r.includes("water") && r.includes("test")) || r.includes("parameter")) return "LOG_PARAMETERS";
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
      if (r.includes("arrival") && r.includes("batch")) return "BATCH_ARRIVAL_CONFIRMED";
      if (r.includes("arrival")) return "ARRIVAL_CONFIRMED";
      return "LOG_FEEDING"; // fallback
    };

    // ─── Public trigger for components to award XP ─────────────────────────
    const handleXpUpdate = async (xpAmount, activityType, metadata = {}) => {
      try {
        const { totalXp, zoneHash } = await processXpProgression(walletAddress, xpAmount, activityType, metadata);

        // Server-side validation (non-blocking, runs after optimistic award)
        const actionKey = mapReasonToActionKey(activityType);
        if (isSupabaseConfigured()) {
          validateXpWithServer(walletAddress, xpAmount, actionKey, {
            ...metadata,
            source: "local_action",
            reason: activityType,
          });
        }
      } catch (err) {
        console.error("useXPSync: Dexie synchronization failed:", err);
      }
    };

    window.triggerXpTracking = handleXpUpdate;

    // ─── Bridge: catch addXp() events that only wrote to localStorage ──────
    const handleExternalXpEvent = async (e) => {
      const detail = e.detail || {};
      // Skip events we dispatched ourselves (already in Dexie)
      if (detail._dexieSynced) return;
      // Skip events without usable data
      const amount = Number(detail.points || detail.amount || 0);
      if (amount <= 0) return;
      const reason = detail.actionLabel || detail.label || detail.reason || "Activity";
      try {
        const { totalXp } = await processXpProgression(walletAddress, amount, reason);

        // Validate with server
        const actionKey = mapReasonToActionKey(reason);
        if (isSupabaseConfigured()) {
          validateXpWithServer(walletAddress, amount, actionKey, {
            source: "addXp_bridge",
            reason,
          });
        }
      } catch (err) {
        console.warn("useXPSync: Bridge sync from addXp() failed:", err);
      }
    };

    window.addEventListener("aquadex_xp_added", handleExternalXpEvent);

    // ─── Dexie actionLogs hook — auto-award XP on husbandry logs ───────────
    // IMPORTANT: this is the ONLY place that awards XP for husbandry logs
    // (feeding, water changes, tests, algae scrapes). Individual action
    // handlers (TankList.jsx, QuickLogPanel.jsx, poseidonBridge.js) must NOT
    // also call addXp() for these — that double-counts XP on top of this hook
    // and, worse, bypasses the per-tank cooldown below entirely (which is how
    // spam-clicking "Feed" was able to farm unlimited XP/tier progress).
    const handleActionLogCreating = (primKey, obj, transaction) => {
      const actionType = obj.actionType;
      let xpAmount = 0;
      let actionKey = "";

      if (actionType === "Feed") { xpAmount = 5; actionKey = "LOG_FEEDING"; }
      else if (actionType === "Quick Water Test") { xpAmount = 8; actionKey = "LOG_PARAMETERS"; }
      else if (actionType === "Scraped Algae") { xpAmount = 5; actionKey = "LOG_FEEDING"; }
      else if (actionType === "Water Change") { xpAmount = 10; actionKey = "LOG_WATER"; }

      if (xpAmount > 0) {
        const tankId = obj.tankId != null ? String(obj.tankId) : null;
        transaction.on("complete", async () => {
          // Enforce the per-tank cooldown (e.g. one feeding credit per 24h per
          // tank) before awarding anything. If the cooldown is active, the log
          // entry itself still gets saved (husbandry record stays accurate) —
          // it just doesn't earn XP.
          const cooldown = await enforceXpCooldown(walletAddress, actionKey, tankId);
          if (!cooldown.allowed) return;
          handleXpUpdate(xpAmount, `Logged ${actionType}`, { tankId: obj.tankId });
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
          // On-chain events are already validated by the smart contract
          // No need for server-side validation
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
  }, [walletAddress, contractInstance, onXpUpdated, getAccessToken]);
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
