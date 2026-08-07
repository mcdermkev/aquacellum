/**
 * useEchoState.js
 *
 * Central hook combining on-chain Echo DNA/state with off-chain needs.
 * Loads Echo data from Dexie (local cache), calculates real-time needs,
 * and provides actions for interaction and replenishment.
 *
 * Returns:
 *   - dna: EchoDNA traits (or null if not hatched)
 *   - stage: current evolution stage (0–6)
 *   - needs: real-time calculated needs { hunger, clarity, comfort, curiosity, social }
 *   - personality: personality axes object
 *   - mood: derived mood from needs
 *   - streak: current care streak
 *   - totalCareDays: cumulative care days
 *   - tricksUnlocked: array of trick IDs
 *   - hasEcho: whether the user has hatched
 *   - replenishNeed(actionKey): apply a care action
 *   - recordInteraction(type): record tap/pet
 *   - loading: whether initial load is in progress
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { db } from "../db";
import { ethers } from "ethers";
import { getProvider } from "../utils/smartAccount";
import { getXp, TIER_ECHO_FORM } from "../utils/xp";
import { COMPANION_ADDRESS } from "../config/appConfig";
import companionAbi from "../abi/AquadexCompanion.json";
import {
  calculateCurrentNeeds,
  applyAction,
  getMoodFromNeeds,
  getDefaultNeeds,
  serializeNeedsState,
  mapXpActionToNeedAction,
} from "../utils/echoNeeds";

// ─────────────────────────────────────────────────────────────────────────────
// Default/Demo DNA (used when on-chain data unavailable but user has Echo)
// ─────────────────────────────────────────────────────────────────────────────

function generateLocalDna(walletAddress) {
  // Simple deterministic "seed" from wallet for local preview
  // Real DNA comes from on-chain, this is fallback for offline/pre-chain users
  if (!walletAddress) return null;

  const addr = walletAddress.toLowerCase();
  let hash = 0;
  for (let i = 0; i < addr.length; i++) {
    hash = ((hash << 5) - hash) + addr.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit
  }
  const seed = Math.abs(hash);

  return {
    seed,
    bodyShape: seed % 8,
    pattern: (seed >> 4) % 12,
    finStyle: (seed >> 8) % 10,
    eyeType: (seed >> 12) % 6,
    signatureMark: (seed >> 16) % 20,
    baseHue: (seed >> 3) % 360,
    secondaryHue: (seed >> 7) % 360,
  };
}

// Trick unlock conditions (simplified — check against stats)
function deriveTricksUnlocked(stage, totalCareDays, streak, speciesWitnessed) {
  const tricks = [];
  if (stage >= 2) tricks.push("backflip"); // Fry stage
  if (totalCareDays >= 10) tricks.push("bubbleRing"); // 10 param logs equivalent
  if (speciesWitnessed >= 20 || totalCareDays >= 20) tricks.push("speedDash");
  if (streak >= 30 || totalCareDays >= 30) tricks.push("glowPulse");
  if (totalCareDays >= 50) tricks.push("mirrorDance");
  if (stage >= 5) tricks.push("galaxyForm"); // Elder stage
  return tricks;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useEchoState(walletAddress) {
  const [loading, setLoading] = useState(true);
  const [hasEcho, setHasEcho] = useState(false);
  const [dna, setDna] = useState(null);
  const [stage, setStage] = useState(0);
  const [needs, setNeeds] = useState(getDefaultNeeds());
  const [personality, setPersonality] = useState({
    nurturing: 10, analytical: 10, adventurous: 10, social: 10, calm: 10, creative: 10,
  });
  const [streak, setStreak] = useState(0);
  const [totalCareDays, setTotalCareDays] = useState(0);
  const [speciesWitnessed, setSpeciesWitnessed] = useState(0);
  const [tricksUnlocked, setTricksUnlocked] = useState([]);

  const needsRefreshInterval = useRef(null);

  // ─── Load Echo state from Dexie ─────────────────────────────────────
  useEffect(() => {
    if (!walletAddress) {
      setLoading(false);
      setHasEcho(false);
      return;
    }

    const loadEchoData = async () => {
      try {
        const addr = walletAddress;
        const addrLower = walletAddress.toLowerCase();

        // Check if user has profile with enough XP (500+ means hatched)
        let profile = await db.userProfile.get(addr);
        if (!profile && addrLower !== addr) {
          profile = await db.userProfile.get(addrLower);
        }

        // getXp() rather than a raw `aquadex_xp` read: that scalar mirror is gone, and
        // reading it directly is how a second copy of the score comes back.
        const totalXp = profile?.totalXp || getXp();

        if (totalXp < 500) {
          // Not hatched yet
          setHasEcho(false);
          setStage(0);
          setDna(null);
          setLoading(false);
          return;
        }

        setHasEcho(true);

        // ─── Attempt on-chain DNA read ─────────────────────────────────
        let onChainDna = null;
        let onChainState = null;

        try {
          const provider = getProvider();
          const contract = new ethers.Contract(COMPANION_ADDRESS, companionAbi, provider);
          const [tokenId, dnaRaw, stateRaw] = await contract.getFullEcho(addr);

          if (tokenId > 0n) {
            // User has minted on-chain
            onChainDna = {
              seed: Number(dnaRaw.seed),
              bodyShape: Number(dnaRaw.bodyShape),
              pattern: Number(dnaRaw.pattern),
              finStyle: Number(dnaRaw.finStyle),
              eyeType: Number(dnaRaw.eyeType),
              signatureMark: Number(dnaRaw.signatureMark),
              baseHue: Number(dnaRaw.baseHue),
              secondaryHue: Number(dnaRaw.secondaryHue),
            };
            onChainState = {
              currentStage: Number(stateRaw.currentStage),
              totalCareDays: Number(stateRaw.totalCareDays),
              longestStreak: Number(stateRaw.longestStreak),
              speciesWitnessed: Number(stateRaw.speciesWitnessed),
              rareMoments: Number(stateRaw.rareMoments),
              birthTimestamp: Number(stateRaw.birthTimestamp),
              lastEvolution: Number(stateRaw.lastEvolution),
              personalityNurturing: Number(stateRaw.personalityNurturing),
              personalityAnalytical: Number(stateRaw.personalityAnalytical),
              personalityAdventurous: Number(stateRaw.personalityAdventurous),
              personalitySocial: Number(stateRaw.personalitySocial),
              personalityCalm: Number(stateRaw.personalityCalm),
              personalityCreative: Number(stateRaw.personalityCreative),
            };
          }
        } catch (chainErr) {
          // On-chain read failed (no contract interaction, user hasn't minted, etc.)
          // Fall through to local DNA generation
          console.debug("useEchoState: On-chain read unavailable, using local DNA:", chainErr.message);
        }

        // Use on-chain DNA if available, otherwise generate local preview
        if (onChainDna) {
          setDna(onChainDna);
        } else {
          const localDna = generateLocalDna(walletAddress);
          setDna(localDna);
        }

        // Use on-chain state if available
        if (onChainState) {
          setStage(onChainState.currentStage);
          setTotalCareDays(onChainState.totalCareDays);
          setStreak(Math.max(onChainState.longestStreak, profile?.streakDays || 0));
          setSpeciesWitnessed(onChainState.speciesWitnessed);
          setPersonality({
            nurturing: onChainState.personalityNurturing,
            analytical: onChainState.personalityAnalytical,
            adventurous: onChainState.personalityAdventurous,
            social: onChainState.personalitySocial,
            calm: onChainState.personalityCalm,
            creative: onChainState.personalityCreative,
          });
        } else {
          // Derive from local data
          const careDays = profile?.totalCareDays || Math.floor(totalXp / 20);
          setTotalCareDays(careDays);

          const currentStreak = profile?.streakDays || 0;
          setStreak(currentStreak);

          const species = profile?.speciesWitnessed || 0;
          setSpeciesWitnessed(species);

          // Determine stage from local stats
          let currentStage = 1;
          if (careDays >= 365) currentStage = 6;
          else if (careDays >= 180) currentStage = 5;
          else if (careDays >= 90 && species >= 10) currentStage = 4;
          else if (careDays >= 30) currentStage = 3;
          else if (currentStreak >= 7 || careDays >= 7) currentStage = 2;
          else if (careDays >= 3) currentStage = 1;

          // Tier floor (COSMETIC_EXPRESSION_SPEC.md §4): a keeper's XP tier
          // guarantees a minimum companion form. If activity already placed them
          // higher, keep it — the floor only lifts, never caps.
          const tierForm = TIER_ECHO_FORM[profile?.currentTier] || TIER_ECHO_FORM.Shallow;
          currentStage = Math.max(currentStage, tierForm.stageFloor);

          setStage(currentStage);

          // Load personality from localStorage
          const storedPersonality = localStorage.getItem("echo_personality_" + addrLower);
          if (storedPersonality) {
            setPersonality(JSON.parse(storedPersonality));
          }
        }

        // Load needs from local storage (always off-chain)
        let storedNeeds = null;
        try {
          const needsRecord = await db.table("echoNeeds").get(addrLower);
          if (needsRecord) storedNeeds = needsRecord;
        } catch {
          const lsNeeds = localStorage.getItem("echo_needs_" + addrLower);
          if (lsNeeds) storedNeeds = JSON.parse(lsNeeds);
        }

        const currentNeeds = storedNeeds
          ? calculateCurrentNeeds(storedNeeds)
          : getDefaultNeeds();
        setNeeds(currentNeeds);

        // Derive tricks from whatever stage we resolved
        const resolvedStage = onChainState ? onChainState.currentStage : (stage || 1);
        const resolvedCareDays = onChainState ? onChainState.totalCareDays : (profile?.totalCareDays || Math.floor(totalXp / 20));
        const resolvedStreak = onChainState ? onChainState.longestStreak : (profile?.streakDays || 0);
        const resolvedSpecies = onChainState ? onChainState.speciesWitnessed : (profile?.speciesWitnessed || 0);
        const tricks = deriveTricksUnlocked(resolvedStage, resolvedCareDays, resolvedStreak, resolvedSpecies);
        setTricksUnlocked(tricks);

      } catch (err) {
        console.warn("useEchoState: Failed to load:", err);
        setHasEcho(false);
      } finally {
        setLoading(false);
      }
    };

    loadEchoData();
  }, [walletAddress]);

  // ─── Periodic needs recalculation (every 5 min) ─────────────────────
  useEffect(() => {
    if (!hasEcho || !walletAddress) return;

    needsRefreshInterval.current = setInterval(() => {
      const addrLower = walletAddress.toLowerCase();
      const lsNeeds = localStorage.getItem("echo_needs_" + addrLower);
      if (lsNeeds) {
        const stored = JSON.parse(lsNeeds);
        setNeeds(calculateCurrentNeeds(stored));
      }
    }, 5 * 60 * 1000); // Every 5 minutes

    return () => {
      if (needsRefreshInterval.current) clearInterval(needsRefreshInterval.current);
    };
  }, [hasEcho, walletAddress]);

  // ─── Listen for XP events → auto-replenish needs ───────────────────
  useEffect(() => {
    if (!hasEcho || !walletAddress) return;

    const handleXpAction = (e) => {
      const detail = e.detail || {};
      const actionLabel = detail.actionLabel || detail.label || "";
      const mappedAction = mapXpActionToNeedAction(actionLabel);

      if (mappedAction) {
        replenishNeed(mappedAction);
      }
    };

    window.addEventListener("aquadex_xp_added", handleXpAction);
    return () => window.removeEventListener("aquadex_xp_added", handleXpAction);
  }, [hasEcho, walletAddress]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Replenish a need (public action) ───────────────────────────────
  const replenishNeed = useCallback((actionKey) => {
    setNeeds((currentNeeds) => {
      const result = applyAction(currentNeeds, actionKey);
      // Persist updated needs
      if (walletAddress) {
        const serialized = serializeNeedsState(result.needs);
        localStorage.setItem("echo_needs_" + walletAddress.toLowerCase(), JSON.stringify(serialized));
      }
      return result.needs;
    });
  }, [walletAddress]);

  // ─── Record an interaction (tap/pet) ────────────────────────────────
  const recordInteraction = useCallback((type) => {
    // Could emit XP event or track in analytics
    // For now, just dispatch a custom event the existing XP system can pick up
    if (type === "tap" || type === "pet") {
      const points = type === "tap" ? 1 : 2;
      window.dispatchEvent(new CustomEvent("aquadex_xp_added", {
        detail: {
          actionLabel: `Echo ${type}`,
          points,
          totalXp: getXp() + points,
        },
      }));
    }
  }, []);

  // ─── Derived mood ───────────────────────────────────────────────────
  const mood = getMoodFromNeeds(needs);

  return {
    dna,
    stage,
    needs,
    personality,
    mood,
    streak,
    totalCareDays,
    speciesWitnessed,
    tricksUnlocked,
    hasEcho,
    loading,
    replenishNeed,
    recordInteraction,
  };
}

export default useEchoState;
