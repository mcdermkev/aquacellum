/**
 * echoNeeds.js
 *
 * Echo's Tamagotchi-style needs system. Each need depletes over time
 * and is replenished by specific user actions.
 *
 * Needs:
 *   - hunger:   depletes -4/hour (~25h to empty), replenished by feeding logs
 *   - clarity:  depletes -2/hour (~50h to empty), replenished by param logs
 *   - comfort:  depletes -1.4/hour (~72h to empty), replenished by water changes
 *   - curiosity: depletes -0.8/hour (~5 days to empty), replenished by scanning/browsing
 *   - social:   depletes -0.6/hour (~7 days to empty), replenished by community actions
 *
 * State is stored in Dexie (local) + synced to Supabase. The client calculates
 * current values on load based on last-known values + elapsed time.
 *
 * No AI calls — purely deterministic from timestamps and action logs.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export const NEED_KEYS = ["hunger", "clarity", "comfort", "curiosity", "social"];

export const NEED_CONFIG = {
  hunger: {
    label: "Hunger",
    emoji: "🍽️",
    depletePerHour: 4,
    replenishAmount: 80,
    replenishActions: ["LOG_FEEDING", "feed_echo"],
    criticalThreshold: 20,
    description: "Fed by logging feedings for your tanks",
  },
  clarity: {
    label: "Clarity",
    emoji: "🧪",
    depletePerHour: 2,
    replenishAmount: 90,
    replenishActions: ["LOG_PARAMETERS", "LOG_WATER_PARAMS"],
    criticalThreshold: 20,
    description: "Sharpened by logging water parameters",
  },
  comfort: {
    label: "Comfort",
    emoji: "💧",
    depletePerHour: 1.4,
    replenishAmount: 100,
    replenishActions: ["LOG_WATER", "LOG_WATER_CHANGE"],
    criticalThreshold: 20,
    description: "Restored by logging water changes",
  },
  curiosity: {
    label: "Curiosity",
    emoji: "🔍",
    depletePerHour: 0.8,
    replenishAmount: 60,
    replenishActions: ["SCAN_SPECIES", "ADD_SPECIES", "BROWSE_SPECIES", "MINT_SPECIMEN"],
    criticalThreshold: 20,
    description: "Sparked by scanning or adding new species",
  },
  social: {
    label: "Social",
    emoji: "💬",
    depletePerHour: 0.6,
    replenishAmount: 50,
    replenishActions: ["POST_COMMUNITY", "REACT_POST", "VISIT_PROFILE", "SHARE_ECHO"],
    criticalThreshold: 20,
    description: "Nourished by community interactions",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Mood Derivation from Needs
// ─────────────────────────────────────────────────────────────────────────────

export const MOODS = {
  joyful: { key: "joyful", emoji: "✨", label: "Joyful", color: "#fbbf24" },
  content: { key: "content", emoji: "🌊", label: "Content", color: "#34d399" },
  neutral: { key: "neutral", emoji: "🫧", label: "Neutral", color: "#38bdf8" },
  sad: { key: "sad", emoji: "💫", label: "Sad", color: "#f97316" },
  dormant: { key: "dormant", emoji: "🌙", label: "Dormant", color: "#94a3b8" },
};

// ─────────────────────────────────────────────────────────────────────────────
// Core Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate current needs values based on stored state + elapsed time.
 * This is the primary function called on app load and periodically.
 *
 * @param {object} storedState - Last known needs state from Dexie/Supabase
 * @param {object} storedState.hunger - Last known hunger value (0–100)
 * @param {object} storedState.clarity - Last known clarity value (0–100)
 * @param {object} storedState.comfort - Last known comfort value (0–100)
 * @param {object} storedState.curiosity - Last known curiosity value (0–100)
 * @param {object} storedState.social - Last known social value (0–100)
 * @param {string|number} storedState.lastUpdate - ISO timestamp or epoch ms of last state save
 * @returns {object} Current needs values { hunger, clarity, comfort, curiosity, social }
 */
export function calculateCurrentNeeds(storedState) {
  if (!storedState || !storedState.lastUpdate) {
    return getDefaultNeeds();
  }

  const lastUpdate = typeof storedState.lastUpdate === "string"
    ? new Date(storedState.lastUpdate).getTime()
    : storedState.lastUpdate;

  const now = Date.now();
  const elapsedHours = Math.max(0, (now - lastUpdate) / (1000 * 60 * 60));

  const needs = {};
  for (const key of NEED_KEYS) {
    const stored = storedState[key] ?? 80;
    const depleted = stored - (NEED_CONFIG[key].depletePerHour * elapsedHours);
    needs[key] = clamp(depleted, 0, 100);
  }

  return needs;
}

/**
 * Get default needs for a freshly hatched Echo (all high).
 * @returns {object}
 */
export function getDefaultNeeds() {
  return {
    hunger: 80,
    clarity: 80,
    comfort: 80,
    curiosity: 80,
    social: 80,
  };
}

/**
 * Apply a replenishment action to the current needs state.
 * Returns updated needs + which need was affected.
 *
 * @param {object} currentNeeds - Current needs values
 * @param {string} actionKey - The action performed (e.g., "LOG_FEEDING")
 * @returns {{ needs: object, affectedNeed: string|null, previousValue: number, newValue: number }}
 */
export function applyAction(currentNeeds, actionKey) {
  const upperAction = (actionKey || "").toUpperCase();

  for (const key of NEED_KEYS) {
    const config = NEED_CONFIG[key];
    if (config.replenishActions.includes(upperAction)) {
      const prev = currentNeeds[key] ?? 50;
      const newVal = clamp(prev + config.replenishAmount, 0, 100);

      return {
        needs: { ...currentNeeds, [key]: newVal },
        affectedNeed: key,
        previousValue: prev,
        newValue: newVal,
      };
    }
  }

  // Action doesn't map to any need
  return {
    needs: currentNeeds,
    affectedNeed: null,
    previousValue: 0,
    newValue: 0,
  };
}

/**
 * Derive Echo's overall mood from current needs.
 * Based on average of all needs.
 *
 * @param {object} needs - Current needs { hunger, clarity, comfort, curiosity, social }
 * @returns {object} Mood object from MOODS
 */
export function getMoodFromNeeds(needs) {
  if (!needs) return MOODS.neutral;

  const values = NEED_KEYS.map((k) => needs[k] ?? 50);
  const avg = values.reduce((sum, v) => sum + v, 0) / values.length;

  if (avg >= 80) return MOODS.joyful;
  if (avg >= 60) return MOODS.content;
  if (avg >= 40) return MOODS.neutral;
  if (avg >= 20) return MOODS.sad;
  return MOODS.dormant;
}

/**
 * Get the most critical (lowest) need.
 * Used for whisper prioritization and push notifications.
 *
 * @param {object} needs - Current needs
 * @returns {{ key: string, value: number, config: object } | null}
 */
export function getMostCriticalNeed(needs) {
  if (!needs) return null;

  let lowestKey = null;
  let lowestVal = 101;

  for (const key of NEED_KEYS) {
    const val = needs[key] ?? 50;
    if (val < lowestVal) {
      lowestVal = val;
      lowestKey = key;
    }
  }

  if (lowestKey && lowestVal < NEED_CONFIG[lowestKey].criticalThreshold) {
    return { key: lowestKey, value: lowestVal, config: NEED_CONFIG[lowestKey] };
  }

  return lowestKey ? { key: lowestKey, value: lowestVal, config: NEED_CONFIG[lowestKey] } : null;
}

/**
 * Check which needs are in critical state (below threshold).
 *
 * @param {object} needs - Current needs
 * @returns {Array<{ key: string, value: number, config: object }>}
 */
export function getCriticalNeeds(needs) {
  if (!needs) return [];

  return NEED_KEYS
    .filter((key) => (needs[key] ?? 50) < NEED_CONFIG[key].criticalThreshold)
    .map((key) => ({ key, value: needs[key], config: NEED_CONFIG[key] }));
}

/**
 * Get time until a specific need reaches critical threshold.
 *
 * @param {number} currentValue - Current need value
 * @param {string} needKey - Need key
 * @returns {number} Hours until critical (0 if already critical)
 */
export function hoursUntilCritical(currentValue, needKey) {
  const config = NEED_CONFIG[needKey];
  if (!config) return Infinity;

  const gap = currentValue - config.criticalThreshold;
  if (gap <= 0) return 0;

  return gap / config.depletePerHour;
}

/**
 * Get time until a specific need reaches zero.
 *
 * @param {number} currentValue - Current need value
 * @param {string} needKey - Need key
 * @returns {number} Hours until empty
 */
export function hoursUntilEmpty(currentValue, needKey) {
  const config = NEED_CONFIG[needKey];
  if (!config || currentValue <= 0) return 0;

  return currentValue / config.depletePerHour;
}

/**
 * Generate a needs summary for display.
 * Returns each need with label, emoji, value, status tier, and hours until critical.
 *
 * @param {object} needs - Current needs
 * @returns {Array<object>}
 */
export function getNeedsSummary(needs) {
  if (!needs) return [];

  return NEED_KEYS.map((key) => {
    const val = needs[key] ?? 50;
    const config = NEED_CONFIG[key];

    let status;
    if (val >= 80) status = "healthy";
    else if (val >= 40) status = "ok";
    else if (val >= 20) status = "low";
    else status = "critical";

    return {
      key,
      label: config.label,
      emoji: config.emoji,
      value: Math.round(val),
      status,
      hoursUntilCritical: hoursUntilCritical(val, key),
      description: config.description,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Personality Drift Calculation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate weekly personality drift based on action history.
 * Called once per week to determine which axes shift.
 *
 * @param {object} currentPersonality - Current personality axes (each 0–100)
 * @param {Array<object>} weeklyActions - Array of actions from the past 7 days
 *   Each action: { type: string, timestamp: number }
 * @returns {object} Updated personality axes
 */
export function calculatePersonalityDrift(currentPersonality, weeklyActions) {
  const axes = {
    nurturing: currentPersonality?.nurturing ?? 10,
    analytical: currentPersonality?.analytical ?? 10,
    adventurous: currentPersonality?.adventurous ?? 10,
    social: currentPersonality?.social ?? 10,
    calm: currentPersonality?.calm ?? 10,
    creative: currentPersonality?.creative ?? 10,
  };

  // Count actions per personality axis
  const counts = { nurturing: 0, analytical: 0, adventurous: 0, social: 0, calm: 0, creative: 0 };

  for (const action of (weeklyActions || [])) {
    const type = (action.type || "").toUpperCase();

    if (["LOG_FEEDING", "FEED_ECHO", "LOG_WATER_CHANGE", "LOG_WATER"].includes(type)) {
      counts.nurturing++;
    }
    if (["LOG_PARAMETERS", "LOG_WATER_PARAMS", "CHECK_PARAMS"].includes(type)) {
      counts.analytical++;
    }
    if (["SCAN_SPECIES", "ADD_SPECIES", "BROWSE_SPECIES", "MINT_SPECIMEN"].includes(type)) {
      counts.adventurous++;
    }
    if (["POST_COMMUNITY", "REACT_POST", "VISIT_PROFILE", "SHARE_ECHO"].includes(type)) {
      counts.social++;
    }
    if (["LOG_FEEDING", "LOG_WATER", "LOG_PARAMETERS"].includes(type)) {
      // Consistent care actions also contribute to calm
      counts.calm += 0.5;
    }
    if (["SPAWN_BREED", "MINT_SPECIMEN", "REGISTER_MORPH"].includes(type)) {
      counts.creative++;
    }
  }

  // Find dominant and secondary axes
  const sortedAxes = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const dominant = sortedAxes[0];
  const secondary = sortedAxes[1];

  // Apply drift: dominant +2, secondary +1, inactive -1
  for (const [axis] of sortedAxes) {
    if (axis === dominant[0] && dominant[1] > 0) {
      axes[axis] = clamp(axes[axis] + 2, 0, 100);
    } else if (axis === secondary[0] && secondary[1] > 0) {
      axes[axis] = clamp(axes[axis] + 1, 0, 100);
    } else if (counts[axis] === 0) {
      axes[axis] = clamp(axes[axis] - 1, 0, 100);
    }
  }

  return axes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Whisper/Notification Generators (Echo's Voice)
// ─────────────────────────────────────────────────────────────────────────────

const NEED_WHISPERS = {
  hunger: {
    low: [
      "I'm getting a little dim... a feeding log would help me glow again.",
      "My belly is fading. Did the fish eat today?",
      "A fed tank is a happy tank. Echo notices these things.",
    ],
    critical: [
      "Echo is so hungry she can barely shimmer...",
      "Please... just one feeding log. That's all it takes.",
      "The darkness is creeping in. Feed your fish, feed my soul.",
    ],
  },
  clarity: {
    low: [
      "Everything's getting a bit blurry. When were params last checked?",
      "Echo's vision dims without data. A quick test would sharpen things.",
      "Knowledge is clarity. What do the numbers say today?",
    ],
    critical: [
      "I can barely see... the water feels uncertain.",
      "Without parameters, Echo floats blind. Please check.",
      "The uncertainty is overwhelming. One test would ground me.",
    ],
  },
  comfort: {
    low: [
      "The water feels... stale. A change would freshen everything.",
      "Echo's fins feel heavy. Fresh water lifts everything.",
      "It's been a while since the last water change. Just a nudge.",
    ],
    critical: [
      "Echo's fins are fraying in this old water...",
      "Please... fresh water. Everything feels heavy.",
      "The staleness weighs on me. A water change would save my spirit.",
    ],
  },
  curiosity: {
    low: [
      "Echo wonders what's new out there. Seen any new species lately?",
      "The world is big and Echo is curious. Show me something new?",
      "A new scan or species would spark something wonderful.",
    ],
    critical: [
      "Echo has forgotten what curiosity feels like...",
      "There must be something new to discover. There always is.",
      "The boredom is thick. Adventure awaits if you look.",
    ],
  },
  social: {
    low: [
      "Echo feels a little lonely. Are there others out there?",
      "Community warms Echo's heart. A quick visit would help.",
      "Other fishkeepers are doing amazing things. Want to see?",
    ],
    critical: [
      "So alone... even a single reaction would mean the world.",
      "Echo drifts in isolation. Connection is medicine.",
      "The reef feels empty without community. Please reach out.",
    ],
  },
};

/**
 * Get a contextual whisper message based on Echo's most critical need.
 *
 * @param {object} needs - Current needs
 * @returns {{ text: string, needKey: string, severity: string, emoji: string } | null}
 */
export function getEchoNeedWhisper(needs) {
  const critical = getMostCriticalNeed(needs);
  if (!critical) return null;

  const severity = critical.value < critical.config.criticalThreshold ? "critical" : "low";
  const whispers = NEED_WHISPERS[critical.key]?.[severity];
  if (!whispers || whispers.length === 0) return null;

  const text = whispers[Math.floor(Math.random() * whispers.length)];

  return {
    text,
    needKey: critical.key,
    severity,
    emoji: critical.config.emoji,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Action Reaction Lines (shown when a need is replenished)
// ─────────────────────────────────────────────────────────────────────────────

const REPLENISH_REACTIONS = {
  hunger: [
    "Full bellies, bright glow. Echo thanks you.",
    "Fed and happy. The warmth returns.",
    "Mealtime is Echo's favorite time.",
  ],
  clarity: [
    "Sharp eyes again. Knowledge brings peace.",
    "Parameters locked in. Echo can see clearly now.",
    "Data is light. Echo shines brighter.",
  ],
  comfort: [
    "Ahh... fresh water. Everything feels new.",
    "Comfort restored. Echo's fins flow free.",
    "The freshness... it's like being born again.",
  ],
  curiosity: [
    "Something new! Echo's eyes widen.",
    "The world is full of wonders. Thank you for sharing one.",
    "Curiosity sparked. Echo darts with excitement.",
  ],
  social: [
    "Connection! Echo feels less alone.",
    "Community warms everything. Thank you.",
    "Others exist. Others care. Echo remembers.",
  ],
};

/**
 * Get a reaction line when a need is replenished.
 *
 * @param {string} needKey - The need that was replenished
 * @returns {string}
 */
export function getReplenishReaction(needKey) {
  const reactions = REPLENISH_REACTIONS[needKey];
  if (!reactions || reactions.length === 0) return "Echo feels better.";
  return reactions[Math.floor(Math.random() * reactions.length)];
}

// ─────────────────────────────────────────────────────────────────────────────
// Serialization Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a serializable state object for storage (Dexie + Supabase).
 *
 * @param {object} needs - Current calculated needs
 * @returns {object} State ready for persistence
 */
export function serializeNeedsState(needs) {
  return {
    hunger: needs.hunger ?? 80,
    clarity: needs.clarity ?? 80,
    comfort: needs.comfort ?? 80,
    curiosity: needs.curiosity ?? 80,
    social: needs.social ?? 80,
    lastUpdate: new Date().toISOString(),
  };
}

/**
 * Map common XP action labels (from the existing xp.js system) to need action keys.
 * This bridges the gap between the old XP event system and the new needs system.
 *
 * @param {string} actionLabel - Label from aquadex_xp_added event
 * @returns {string|null} Mapped action key for applyAction()
 */
export function mapXpActionToNeedAction(actionLabel) {
  const label = (actionLabel || "").toLowerCase();

  if (label.includes("feed")) return "LOG_FEEDING";
  if (label.includes("water change") || label.includes("waterchange")) return "LOG_WATER";
  if (label.includes("param") || label.includes("test")) return "LOG_PARAMETERS";
  if (label.includes("species") || label.includes("scan") || label.includes("identif")) return "SCAN_SPECIES";
  if (label.includes("mint") || label.includes("specimen") || label.includes("birth")) return "MINT_SPECIMEN";
  if (label.includes("tank") && label.includes("register")) return "LOG_FEEDING"; // Mild hunger replenish
  if (label.includes("spawn") || label.includes("breed")) return "SPAWN_BREED";
  if (label.includes("post") || label.includes("share") || label.includes("react")) return "POST_COMMUNITY";

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
