import { useEffect, useRef } from "react";
import { db } from "../db";
import { deriveTierFromXp } from "../db";
import { TIER_LADDER, setXpProfilePoints } from "../utils/xp";
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
 * Also maintains breederCompanion tier state (derived purely from totalXp).
 * It does NOT compute geographic zoneHash or regional "champion" ranking —
 * those are server-owned facts (see zoneLeaderboardApi / depthScoreApi) and were
 * previously faked from single-device local data, corrupting the real values.
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
      if (!amountNum || amountNum <= 0) return { totalXp: 0 };

      const cleanReason = reasonText || "";

      // NOTE: this hook does NOT own zoneHash or champion status.
      //   - zoneHash is geographic, written only by the zone-assignment flow
      //     (calculateZoneHash(lat,lng) -> profiles.zone_hash). It must never be
      //     derived from the wallet address here — doing so clobbered the real
      //     GPS-derived value on every single XP award.
      //   - champion / regional-ranking status is a global fact the server owns;
      //     it cannot be computed from this device's local Dexie rows (which only
      //     ever contain this one user, making everyone "champion" on their own
      //     device). Both were self-layer code faking social-layer facts.
      // What this hook legitimately owns: the XP number, the tier DERIVED from
      // that number, egg-state, and the care streak.

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
            zoneHash: null,
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
        profile.currentTier = deriveTierFromXp(profile.totalXp);
        // zoneHash intentionally left untouched — see note above.
        // monthlyXp intentionally NOT maintained here anymore. "XP earned this
        // month" is now derived server-side from the validated xp_events ledger
        // (get_monthly_xp() / rewardsPoolApi.getMonthlyXp). The old local counter
        // never reset and only grew, so it lied about the month. See migration
        // 20260807_monthly_xp_function.sql.

        // Update care streak.
        //
        // A streak reflects continuity of PRESENCE, not continuity of grinding, so
        // a single quiet day must never wipe it. We forgive one skipped day: acting
        // on a consecutive day advances the streak, acting after exactly one quiet
        // day still advances it, and only TWO OR MORE consecutive missed days start
        // a fresh streak. (The old logic reset to 1 on any gap > 1 day, which
        // punished people for a single day off.)
        //
        // The grace window (1 day) stays well inside the server's retention
        // touchpoints (streak-at-risk nudge at "yesterday", win-back at 3/7/14 days
        // in api/retention.js), so the two systems don't contradict each other.
        const STREAK_GRACE_DAYS = 1;
        const today = new Date().toISOString().slice(0, 10);
        if (profile.lastActiveDate !== today) {
          const lastMs = profile.lastActiveDate
            ? Date.parse(`${profile.lastActiveDate}T00:00:00Z`)
            : null;
          const todayMs = Date.parse(`${today}T00:00:00Z`);
          const gapDays = lastMs == null ? Infinity : Math.round((todayMs - lastMs) / 86400000);

          if (gapDays <= 1 + STREAK_GRACE_DAYS) {
            // Consecutive day, or a single quiet day forgiven — keep the streak going.
            profile.streakDays = (profile.streakDays || 0) + 1;
          } else {
            // Absent longer than the grace window — begin a new streak at day 1.
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
            zoneHash: null,
          };
        }

        // Mirror the XP-derived ladder tier only. Never a champion/ranking string
        // (those aren't in TIER_LADDER, so tierAtLeast() would fail closed on them).
        companion.currentTier = profile.currentTier;

        // Egg state progression based on totalXp
        if (totalXp >= 1500) {
          companion.eggState = 2; // Hatched
        } else if (totalXp >= 500) {
          companion.eggState = 1; // Egg Spawned
        } else {
          companion.eggState = 0; // Locked
        }

        // Regional / "God-Tier champion" ranking is deliberately NOT computed here.
        // It is a global comparison across all users in a geographic zone, which
        // this per-device hook cannot see: db.breederCompanion holds only this
        // user's own row, so the old scan always concluded "I am the champion" and
        // stamped a non-ladder "Hadal-Champion" string. When/if champion status is
        // surfaced, it must come from a server view (like species_mastery), not from
        // local Dexie. Removing it fixes both the self/social conflict and the
        // fail-closed entitlement bug.

        await db.breederCompanion.put(companion);
      });

      // Sync XP to cloud for cross-device persistence (fire-and-forget)
      syncXpProfileToCloud(user, {
        totalXp,
        currentTier: deriveTierFromXp(totalXp),
        streakDays: (await db.userProfile.get(user))?.streakDays || 0,
        lastActiveDate: (await db.userProfile.get(user))?.lastActiveDate || null,
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

      return { totalXp };
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
        profile.currentTier = deriveTierFromXp(profile.totalXp);
        // monthlyXp not adjusted — it's no longer a local counter (server-derived).
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

      // Bring localStorage back in line with Dexie.
      //
      // ⚠️ `aquadex_xp_profile` MUST be corrected too, and previously was not. That
      // blob is what `getXp()` reads, so a rejected claim was removed from Dexie and
      // from the two scalar mirrors while the number the app actually displays kept
      // the points — permanently. Every rollback inflated it a little further, and
      // because it also fed entitlement checks at the time, a user could be handed
      // capabilities on the strength of XP the server had explicitly refused.
      try {
        const profile = await db.userProfile.get(user);
        if (profile) {
          setXpProfilePoints(profile.totalXp);
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
            // Batched actions (10 certificates at once) claim points × quantity.
            // Sent as a separate field so the server validates the arithmetic
            // rather than having to accept an unexplained larger number.
            quantity: Number(metadata?.quantity) || 1,
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
     *
     * ⚠️ LAST-RESORT INFERENCE, NOT THE NORMAL PATH. Awards made through
     * `awardXp(actionKey)` carry their key and never come through here. This
     * remains only for (a) the on-chain `XPEarned` event, whose reason really is a
     * contract-supplied string, and (b) any legacy `addXp` call not yet migrated.
     *
     * Its failure mode is why `awardXp` exists: the substring checks run in order
     * and fall back to LOG_FEEDING, so a label that matches nothing — or matches
     * the wrong rule — produces a points mismatch, a 403, and a silent rollback
     * after the user has already been told they earned it. "Specimen Rehomed" hit
     * the fallback; the cash-handshake label matched `includes("handshake")` and
     * resolved to a pickup award worth a fraction of the claim.
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
        await processXpProgression(walletAddress, xpAmount, activityType, metadata);

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

    // ─── Bridge: catch awardXp()/addXp() events that only wrote to localStorage ──
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

        // Prefer the action key the award declared. Inferring from the label is the
        // fallback that used to lose real XP, so a missing key is worth a warning:
        // it means an award site still calls the legacy addXp() and is one bad
        // substring match away from being silently rolled back.
        const actionKey = detail.actionKey || mapReasonToActionKey(reason);
        if (!detail.actionKey) {
          console.warn(
            `[XP] award "${reason}" carried no actionKey; inferred "${actionKey}". ` +
              `Migrate this call site to awardXp(actionKey) — inference can resolve ` +
              `to the wrong action and get the award rejected.`
          );
        }
        if (isSupabaseConfigured()) {
          validateXpWithServer(walletAddress, amount, actionKey, {
            source: detail.actionKey ? "awardXp" : "addXp_bridge",
            reason,
            // Batched awards claim points × quantity; the server needs the
            // multiplier to validate the total instead of rejecting it.
            quantity: detail.quantity || 1,
            ...(detail.tankId != null ? { tankId: detail.tankId } : {}),
            // The server checks this against an active `tides` row before applying
            // any event multiplier; it is a claim, not an instruction.
            ...(detail.eventId != null ? { eventId: detail.eventId } : {}),
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
      // A log arriving from cloudSync is history being restored, not husbandry being
      // performed. Without this, signing in on a second device replayed every synced
      // feeding and water change through the award path and paid out for all of them.
      if (obj.restoredFromCloud) return;

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
