/**
 * useEchoRareMoments.js
 *
 * Hook that monitors for rare moment eligibility and triggers them.
 * Checks on app open and every 30 minutes while active.
 * Returns the active moment (if any) for the overlay to render.
 *
 * Usage in App.jsx:
 *   const { activeMoment, dismissMoment } = useEchoRareMoments(echoState);
 *   {activeMoment && <EchoRareMomentOverlay moment={activeMoment} onComplete={dismissMoment} />}
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  checkForRareMoment,
  recordRareMoment,
  getRareMomentsCount,
} from "../utils/echoRareMoments";
import { getMoodFromNeeds, NEED_KEYS } from "../utils/echoNeeds";

const CHECK_INTERVAL_MS = 30 * 60 * 1000; // Every 30 minutes

export function useEchoRareMoments(echoState) {
  const [activeMoment, setActiveMoment] = useState(null);
  const checkInterval = useRef(null);
  const hasCheckedOnMount = useRef(false);

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
    if (!echoState?.hasEcho || hasCheckedOnMount.current) return;
    hasCheckedOnMount.current = true;

    const timer = setTimeout(() => {
      performCheck();
    }, 5000); // 5 second delay after app loads

    return () => clearTimeout(timer);
  }, [echoState?.hasEcho, performCheck]);

  // Periodic checks
  useEffect(() => {
    if (!echoState?.hasEcho) return;

    checkInterval.current = setInterval(performCheck, CHECK_INTERVAL_MS);
    return () => {
      if (checkInterval.current) clearInterval(checkInterval.current);
    };
  }, [echoState?.hasEcho, performCheck]);

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
