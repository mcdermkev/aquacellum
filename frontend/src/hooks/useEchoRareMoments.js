/**
 * useEchoRareMoments.js
 *
 * Hook that monitors for rare moment eligibility and triggers them.
 * Checks on app open and every 30 minutes while active.
 * Returns the active moment (if any) for the overlay to render.
 *
 * Usage in App.jsx:
 *   const { activeMoment, dismissMoment } = useEchoRareMoments(echoState, echoEnabled);
 *   {activeMoment && <EchoRareMomentOverlay moment={activeMoment} onComplete={dismissMoment} />}
 *
 * ⚠️ `enabled` must be gated at the HOOK, not just at the overlay's render.
 * `performCheck` calls `recordRareMoment(...)` the instant it selects a moment —
 * which permanently consumes it. If the check ran while Echo was switched off
 * (docs/SETTINGS_SPEC.md D-S-4), the moment would be marked as seen and the user
 * would silently lose a rare animation they were never shown. Suppressing Echo's
 * presence must not spend Echo's content.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  checkForRareMoment,
  recordRareMoment,
  getRareMomentsCount,
} from "../utils/echoRareMoments";
import { getMoodFromNeeds, NEED_KEYS } from "../utils/echoNeeds";

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // Every 30 minutes

export function useEchoRareMoments(echoState, enabled = true) {
  const [activeMoment, setActiveMoment] = useState(null);
  const checkInterval = useRef(null);
  const hasCheckedOnMount = useRef(false);

  // Treat "has an Echo" and "Echo is switched on" as the same precondition for
  // every effect below, so there is one flag to reason about.
  const active = !!enabled && !!echoState?.hasEcho;

  // Build context from echoState
  const buildContext = useCallback(() => {
    if (!echoState || !echoState.hasEcho) return null;

    const { needs, streak, totalCareDays, stage } = echoState;

    // Calculate needs average
    const needValues = NEED_KEYS.map((k) => needs?.[k] ?? 50);
    const needsAverage = needValues.reduce((sum, v) => sum + v, 0) / needValues.length;

    // Check if first open today
    const lastOpenKey = "echo_last_app_open_date";
    const today = new Date().toDateString();
    const lastOpen = localStorage.getItem(lastOpenKey);
    const isFirstOpenToday = lastOpen !== today;
    if (isFirstOpenToday) {
      localStorage.setItem(lastOpenKey, today);
    }

    // Check if recent water change (within 2h)
    const lastWaterChangeKey = "echo_last_water_change_ts";
    const lastWaterTs = Number(localStorage.getItem(lastWaterChangeKey) || "0");
    const recentWaterChange = (Date.now() - lastWaterTs) < (2 * 60 * 60 * 1000);

    // Last evolution timestamp
    const lastEvolutionKey = "echo_last_evolution_ts";
    const lastEvolutionTimestamp = Number(localStorage.getItem(lastEvolutionKey) || "0") || null;

    return {
      streak: streak || 0,
      totalCareDays: totalCareDays || 0,
      needsAverage,
      recentWaterChange,
      lastEvolutionTimestamp,
      isFirstOpenToday,
      stage: stage || 0,
    };
  }, [echoState]);

  // Perform a rare moment check
  const performCheck = useCallback(() => {
    if (activeMoment) return; // Don't check while one is active

    const context = buildContext();
    if (!context) return;

    const result = checkForRareMoment(context);
    if (result) {
      // Trigger the rare moment!
      setActiveMoment(result.moment);
      recordRareMoment(result.moment.id);

      // Dispatch event for on-chain recording (picked up by relayer or next sync)
      window.dispatchEvent(new CustomEvent("echo_rare_moment", {
        detail: {
          momentId: result.moment.id,
          timestamp: Date.now(),
          totalCount: getRareMomentsCount(),
        },
      }));
    }
  }, [activeMoment, buildContext]);

  // Dismiss the active moment
  const dismissMoment = useCallback(() => {
    setActiveMoment(null);
  }, []);

  // Check on mount (with small delay to avoid immediate popup)
  useEffect(() => {
    if (!active || hasCheckedOnMount.current) return;
    hasCheckedOnMount.current = true;

    const timer = setTimeout(() => {
      performCheck();
    }, 5000); // 5 second delay after app loads

    return () => clearTimeout(timer);
  }, [active, performCheck]);

  // Periodic checks
  useEffect(() => {
    if (!active) return;

    checkInterval.current = setInterval(performCheck, CHECK_INTERVAL_MS);
    return () => {
      if (checkInterval.current) clearInterval(checkInterval.current);
    };
  }, [active, performCheck]);

  // Turning Echo off mid-session dismisses any moment already on screen, so the
  // overlay can't outlive the companion it belongs to.
  useEffect(() => {
    if (!enabled) setActiveMoment(null);
  }, [enabled]);

  // Listen for actions that might enable rare moments (water change tracking)
  useEffect(() => {
    const handleXpEvent = (e) => {
      const label = (e.detail?.actionLabel || e.detail?.label || "").toLowerCase();
      if (label.includes("water change") || label.includes("waterchange")) {
        localStorage.setItem("echo_last_water_change_ts", String(Date.now()));
      }
    };

    window.addEventListener("aquadex_xp_added", handleXpEvent);
    return () => window.removeEventListener("aquadex_xp_added", handleXpEvent);
  }, []);

  return {
    activeMoment,
    dismissMoment,
    rareMomentsCount: getRareMomentsCount(),
  };
}

export default useEchoRareMoments;
