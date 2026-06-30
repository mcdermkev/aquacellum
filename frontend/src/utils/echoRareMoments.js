/**
 * echoRareMoments.js
 *
 * Rare moments are time-gated special animations/events that trigger
 * under specific conditions. They reward consistency and create
 * shareable, delightful surprises that can't be forced or purchased.
 *
 * How it works:
 *   - On each app open (or every 30 minutes while active), roll for a rare moment
 *   - Each moment type has trigger conditions + a probability
 *   - If triggered, show a special full-screen animation overlay
 *   - Record the moment in localStorage + Supabase (increments on-chain rareMoments)
 *   - Users can screenshot/share these — they become social proof of dedication
 *
 * Moment Types:
 *   1. Shooting Star     — appears at night (9pm–5am), any streak 3+
 *   2. Rainbow Shimmer   — appears after a water change during "golden hour" (6–8am, 5–7pm)
 *   3. Bioluminescence   — appears at night with 7+ day streak
 *   4. Aurora Drift      — appears during early morning (3–6am) with 14+ day streak
 *   5. Echo's Dream      — appears after 60+ cumulative care days, once per week max
 *   6. Constellation     — appears on evolution milestones (first 24h after stage change)
 *   7. Deep Song         — appears on first app open of the day if needs average > 80
 *   8. Tidal Bloom       — appears in the first week of each month if streak > 30
 *
 * Probability is intentionally LOW (1–5% per eligible check) to make them truly rare.
 * Screenshots of rare moments become flex content in the community.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Moment Definitions
// ─────────────────────────────────────────────────────────────────────────────

export const RARE_MOMENTS = {
  shootingStar: {
    id: "shootingStar",
    name: "Shooting Star",
    description: "A streak of light crosses Echo's world",
    emoji: "🌠",
    probability: 0.04, // 4% per eligible check
    durationMs: 5000,
    animation: "echo-rare-shooting-star",
    message: "A shooting star! Echo made a wish for you. ✨",
    eligibility: (ctx) => {
      const hour = new Date().getHours();
      return (hour >= 21 || hour <= 5) && ctx.streak >= 3;
    },
    cooldownHours: 48,
  },
  rainbowShimmer: {
    id: "rainbowShimmer",
    name: "Rainbow Shimmer",
    description: "Echo's scales catch the light just right",
    emoji: "🌈",
    probability: 0.03, // 3%
    durationMs: 6000,
    animation: "echo-rare-rainbow",
    message: "The light hit just right. Echo shimmers in every color. 🌈",
    eligibility: (ctx) => {
      const hour = new Date().getHours();
      const isGoldenHour = (hour >= 6 && hour <= 8) || (hour >= 17 && hour <= 19);
      return isGoldenHour && ctx.recentWaterChange;
    },
    cooldownHours: 72,
  },
  bioluminescence: {
    id: "bioluminescence",
    name: "Bioluminescence",
    description: "Echo glows from within in the dark",
    emoji: "💫",
    probability: 0.05, // 5%
    durationMs: 7000,
    animation: "echo-rare-biolum",
    message: "In the quiet dark, Echo begins to glow from within. 💫",
    eligibility: (ctx) => {
      const hour = new Date().getHours();
      return (hour >= 22 || hour <= 4) && ctx.streak >= 7;
    },
    cooldownHours: 96,
  },
  auroraDrift: {
    id: "auroraDrift",
    name: "Aurora Drift",
    description: "Northern lights dance through Echo's world",
    emoji: "🌌",
    probability: 0.02, // 2% — very rare
    durationMs: 8000,
    animation: "echo-rare-aurora",
    message: "The aurora drifts through Echo's world. Only the dedicated see this. 🌌",
    eligibility: (ctx) => {
      const hour = new Date().getHours();
      return hour >= 3 && hour <= 6 && ctx.streak >= 14;
    },
    cooldownHours: 168, // Once per week max
  },
  echoDream: {
    id: "echoDream",
    name: "Echo's Dream",
    description: "Echo shares a dream with you",
    emoji: "💭",
    probability: 0.03,
    durationMs: 6000,
    animation: "echo-rare-dream",
    message: "Echo was dreaming... she dreamed of the ocean you built together. 💭",
    eligibility: (ctx) => ctx.totalCareDays >= 60,
    cooldownHours: 168,
  },
  constellation: {
    id: "constellation",
    name: "Constellation Form",
    description: "Echo transforms into stars briefly",
    emoji: "⭐",
    probability: 0.15, // 15% — higher chance but only in narrow window
    durationMs: 5000,
    animation: "echo-rare-constellation",
    message: "Echo transforms into a constellation. A form earned through growth. ⭐",
    eligibility: (ctx) => {
      // Only in the first 24h after an evolution
      if (!ctx.lastEvolutionTimestamp) return false;
      const hoursSinceEvolution = (Date.now() - ctx.lastEvolutionTimestamp) / (1000 * 60 * 60);
      return hoursSinceEvolution <= 24;
    },
    cooldownHours: 24,
  },
  deepSong: {
    id: "deepSong",
    name: "Deep Song",
    description: "Echo sings from the deep",
    emoji: "🎵",
    probability: 0.05,
    durationMs: 5000,
    animation: "echo-rare-deep-song",
    message: "Echo sings. A low, beautiful hum from the deep. Only happy companions sing. 🎵",
    eligibility: (ctx) => ctx.needsAverage >= 80 && ctx.isFirstOpenToday,
    cooldownHours: 48,
  },
  tidalBloom: {
    id: "tidalBloom",
    name: "Tidal Bloom",
    description: "Flowers bloom around Echo",
    emoji: "🌸",
    probability: 0.04,
    durationMs: 6000,
    animation: "echo-rare-tidal-bloom",
    message: "Life blooms around Echo. Thirty days of care made this garden. 🌸",
    eligibility: (ctx) => {
      const dayOfMonth = new Date().getDate();
      return dayOfMonth <= 7 && ctx.streak >= 30;
    },
    cooldownHours: 168,
  },
};

export const RARE_MOMENT_IDS = Object.keys(RARE_MOMENTS);

// ─────────────────────────────────────────────────────────────────────────────
// Core Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a rare moment should trigger.
 * Called on app open and periodically (every 30 min).
 *
 * @param {object} context
 * @param {number} context.streak - Current care streak days
 * @param {number} context.totalCareDays - Cumulative care days
 * @param {number} context.needsAverage - Average of all 5 needs (0–100)
 * @param {boolean} context.recentWaterChange - Whether a water change was logged in past 2h
 * @param {number|null} context.lastEvolutionTimestamp - When Echo last evolved (ms epoch)
 * @param {boolean} context.isFirstOpenToday - Whether this is the first app open today
 * @returns {{ moment: object, roll: number } | null} The triggered moment or null
 */
export function checkForRareMoment(context) {
  const eligible = [];

  for (const id of RARE_MOMENT_IDS) {
    const moment = RARE_MOMENTS[id];

    // Check eligibility
    if (!moment.eligibility(context)) continue;

    // Check cooldown
    if (isOnCooldown(id, moment.cooldownHours)) continue;

    eligible.push(moment);
  }

  if (eligible.length === 0) return null;

  // Roll for each eligible moment (independent probabilities)
  for (const moment of eligible) {
    const roll = Math.random();
    if (roll < moment.probability) {
      return { moment, roll };
    }
  }

  return null;
}

/**
 * Record that a rare moment was triggered.
 * Stores in localStorage for cooldown tracking and returns data for Supabase sync.
 *
 * @param {string} momentId
 * @returns {object} Record for persistence { id, timestamp, type }
 */
export function recordRareMoment(momentId) {
  const record = {
    id: momentId,
    timestamp: Date.now(),
    type: momentId,
  };

  // Store in localStorage for cooldown checks
  const logKey = "echo_rare_moments_log";
  const existing = JSON.parse(localStorage.getItem(logKey) || "[]");
  existing.push(record);

  // Keep only last 50 entries
  const trimmed = existing.slice(-50);
  localStorage.setItem(logKey, JSON.stringify(trimmed));

  // Update total count
  const countKey = "echo_rare_moments_count";
  const count = Number(localStorage.getItem(countKey) || "0") + 1;
  localStorage.setItem(countKey, String(count));

  return record;
}

/**
 * Get the total number of rare moments this user has experienced.
 * @returns {number}
 */
export function getRareMomentsCount() {
  return Number(localStorage.getItem("echo_rare_moments_count") || "0");
}

/**
 * Get the full rare moments history.
 * @returns {Array<{ id: string, timestamp: number, type: string }>}
 */
export function getRareMomentsHistory() {
  return JSON.parse(localStorage.getItem("echo_rare_moments_log") || "[]");
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal Helpers
// ─────────────────────────────────────────────────────────────────────────────

function isOnCooldown(momentId, cooldownHours) {
  const log = JSON.parse(localStorage.getItem("echo_rare_moments_log") || "[]");
  const lastOccurrence = log
    .filter((r) => r.id === momentId)
    .sort((a, b) => b.timestamp - a.timestamp)[0];

  if (!lastOccurrence) return false;

  const hoursSince = (Date.now() - lastOccurrence.timestamp) / (1000 * 60 * 60);
  return hoursSince < cooldownHours;
}
