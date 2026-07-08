/**
 * useEchoObservation.js
 * 
 * AI-powered per-session observation from Echo via Poseidon (Gemini).
 * 
 * When the user opens a tank detail, this hook generates a short, contextual
 * observation based on their actual tank data (species, recent params, streak).
 * 
 * Rules:
 *   - 1 call per session (cached in sessionStorage)
 *   - Only fires if Poseidon is enabled (localStorage flag)
 *   - Falls back to a canned line if Poseidon is offline
 *   - Never blocks UI — loads async with loading state
 */

import { useState, useEffect, useRef } from "react";

const SESSION_CACHE_KEY = "echo_observation_cache";
const POSEIDON_ENABLED_KEY = "aquadex_poseidon_enabled";

// ─────────────────────────────────────────────────────────────────────────────
// Fallback observations (used when Poseidon is offline)
// ─────────────────────────────────────────────────────────────────────────────

const FALLBACK_OBSERVATIONS = [
  "Your tank has been steady lately. That's the best kind of news.",
  "Echo senses stability here. Keep doing what you're doing.",
  "The rhythm of care shows in how your fish move. Confident and calm.",
  "Another day, another healthy ecosystem. Well done.",
  "Echo notices the small things — and everything here looks right.",
  "Good parameters lead to good behavior. Your fish are proof.",
];

function getRandomFallback() {
  return FALLBACK_OBSERVATIONS[Math.floor(Math.random() * FALLBACK_OBSERVATIONS.length)];
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate an AI observation for the active tank.
 * 
 * @param {object} tankContext
 * @param {string} tankContext.tankName - Name of the active tank
 * @param {string[]} tankContext.species - Species in the tank
 * @param {object} tankContext.lastParams - Most recent water parameters { pH, temp, ammonia }
 * @param {number} tankContext.streakDays - User's care streak
 * @param {string} tankContext.currentTier - User's tier
 * @param {number} tankContext.daysSinceWaterChange - Days since last water change
 * @param {boolean} enabled - Whether to fire the observation (default true)
 * @returns {{ observation: string|null, isLoading: boolean, isAI: boolean }}
 */
export function useEchoObservation(tankContext, enabled = true) {
  const [observation, setObservation] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isAI, setIsAI] = useState(false);
  const calledRef = useRef(false);

  useEffect(() => {
    if (!enabled || calledRef.current) return;
    if (!tankContext || !tankContext.tankName) return;

    // Check if Poseidon is disabled
    const poseidonEnabled = localStorage.getItem(POSEIDON_ENABLED_KEY) !== "false";

    // Check session cache
    const cached = sessionStorage.getItem(SESSION_CACHE_KEY);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (parsed.tankName === tankContext.tankName && parsed.observation) {
          setObservation(parsed.observation);
          setIsAI(parsed.isAI || false);
          return;
        }
      } catch (e) { /* ignore parse errors */ }
    }

    calledRef.current = true;

    if (!poseidonEnabled) {
      const fallback = getRandomFallback();
      setObservation(fallback);
      setIsAI(false);
      cacheObservation(tankContext.tankName, fallback, false);
      return;
    }

    // Call Poseidon
    setIsLoading(true);
    fetchEchoObservation(tankContext)
      .then((result) => {
        setObservation(result.text);
        setIsAI(result.isAI);
        cacheObservation(tankContext.tankName, result.text, result.isAI);
      })
      .catch(() => {
        const fallback = getRandomFallback();
        setObservation(fallback);
        setIsAI(false);
        cacheObservation(tankContext.tankName, fallback, false);
      })
      .finally(() => setIsLoading(false));
  }, [tankContext?.tankName, enabled]);

  return { observation, isLoading, isAI };
}

// ─────────────────────────────────────────────────────────────────────────────
// API Call
// ─────────────────────────────────────────────────────────────────────────────

async function fetchEchoObservation(tankContext) {
  const { tankName, species = [], lastParams, streakDays, currentTier, daysSinceWaterChange } = tankContext;

  // Build a concise prompt for Poseidon
  const speciesList = species.slice(0, 5).join(", ") || "unknown species";
  const paramsStr = lastParams
    ? `pH ${lastParams.pH || "?"}, temp ${lastParams.temp || "?"}°C`
    : "no recent readings";

  const message = `[ECHO OBSERVATION MODE] You are Echo, the user's AI aquarium companion. Generate ONE short observation (max 25 words) about their tank "${tankName}" based on this context:
- Species: ${speciesList}
- Recent params: ${paramsStr}
- Care streak: ${streakDays || 0} days
- Days since water change: ${daysSinceWaterChange || "unknown"}
- Tier: ${currentTier || "Shallow"}

Be warm, poetic, and specific. Reference their actual species or params if possible. Never give medical advice. Just one sentence.`;

  try {
    const response = await fetch("/api/ai?action=poseidon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        mode: "casual",
        sessionData: {
          tankName,
          species,
          waterParams: lastParams,
          streakDays,
        },
      }),
    });

    if (!response.ok) {
      return { text: getRandomFallback(), isAI: false };
    }

    const data = await response.json();

    if (data.offline || !data.message) {
      return { text: getRandomFallback(), isAI: false };
    }

    // Clean the response — just the first sentence, strip any markdown/quotes
    let text = data.message.trim();
    text = text.replace(/^["'`]+|["'`]+$/g, ""); // strip wrapping quotes
    text = text.split("\n")[0]; // first line only
    if (text.length > 120) text = text.slice(0, 117) + "..."; // cap length

    return { text, isAI: true };
  } catch (err) {
    console.warn("useEchoObservation: Poseidon call failed:", err);
    return { text: getRandomFallback(), isAI: false };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cache Helper
// ─────────────────────────────────────────────────────────────────────────────

function cacheObservation(tankName, observation, isAI) {
  try {
    sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify({ tankName, observation, isAI }));
  } catch (e) { /* ignore quota errors */ }
}

export default useEchoObservation;
