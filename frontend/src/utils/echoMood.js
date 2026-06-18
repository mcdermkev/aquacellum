/**
 * echoMood.js
 * 
 * Echo's mood state machine. Determines Echo's current emotional state
 * based on user activity (care streak, recent actions, time since last visit).
 * 
 * Moods: joyful, pleased, calm, curious, concerned, quiet
 * 
 * Each mood has a set of poetic one-liners that rotate randomly.
 * No AI calls — purely deterministic from local state.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Mood Definitions
// ─────────────────────────────────────────────────────────────────────────────

export const MOODS = {
  joyful: {
    key: "joyful",
    emoji: "✨",
    color: "#fbbf24",
    label: "Joyful",
    description: "Echo is thriving",
  },
  pleased: {
    key: "pleased",
    emoji: "🌊",
    color: "#34d399",
    label: "Pleased",
    description: "Echo is content",
  },
  calm: {
    key: "calm",
    emoji: "🫧",
    color: "#38bdf8",
    label: "Calm",
    description: "Echo is at peace",
  },
  curious: {
    key: "curious",
    emoji: "💭",
    color: "#a78bfa",
    label: "Curious",
    description: "Echo is wondering",
  },
  concerned: {
    key: "concerned",
    emoji: "💫",
    color: "#f97316",
    label: "Concerned",
    description: "Echo noticed something",
  },
  quiet: {
    key: "quiet",
    emoji: "🌙",
    color: "#94a3b8",
    label: "Quiet",
    description: "Echo is resting",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Mood Lines (poetic one-liners per mood)
// ─────────────────────────────────────────────────────────────────────────────

const MOOD_LINES = {
  joyful: [
    "Everything feels right today. The water hums with life.",
    "Your dedication shines. Echo can feel the rhythm of good care.",
    "A beautiful streak. Your tank is a sanctuary.",
    "The kind of day where every fin catches the light just right.",
    "Echo is glowing. She loves when things are steady like this.",
    "You've built something living and beautiful here.",
  ],
  pleased: [
    "Another good day in the tank. Echo approves.",
    "Clean water, fed fish, happy companion. Simple and perfect.",
    "Echo shimmers a little brighter after that log.",
    "Your fish are lucky to have someone who shows up like this.",
    "Consistency is its own kind of magic. Echo sees it.",
    "A quiet satisfaction. Everything's where it should be.",
  ],
  calm: [
    "All is well. The tank breathes easy today.",
    "Echo drifts gently. No urgency, just presence.",
    "A still morning. Your fish are at ease.",
    "Sometimes the best thing is that nothing needs fixing.",
    "Echo floats in comfortable silence beside your tank.",
    "Peace is a parameter too. This tank has it.",
  ],
  curious: [
    "Echo tilts her head. Something new caught her attention.",
    "Have you checked the parameters lately? Just curious.",
    "There's always more to learn about your fish. Echo wonders.",
    "A new species in the collection? Echo wants to know more.",
    "Echo has a thought — but she'll wait until you're ready.",
    "Sometimes curiosity is just another form of caring.",
  ],
  concerned: [
    "Echo noticed you've been away. Your fish miss routine.",
    "It's been a while since the last water check. Just a nudge.",
    "Echo's shimmer dims a little when care gets irregular.",
    "No pressure — but your tank could use a moment of attention.",
    "A gentle reminder from Echo: even small acts of care matter.",
    "Echo senses the drift. A quick log would put her at ease.",
  ],
  quiet: [
    "Echo rests near the substrate. Waiting patiently.",
    "A quiet companion for a quiet moment.",
    "Echo is here. She's always here. No rush.",
    "Even companions need stillness sometimes.",
    "The tank glows softly in the dark. Echo watches.",
    "Whenever you're ready, Echo will be too.",
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Greeting Lines (shown on app open/dashboard load)
// ─────────────────────────────────────────────────────────────────────────────

const GREETINGS = {
  morning: [
    "Good morning. Your tank looks peaceful today.",
    "A new day. Echo woke with the light.",
    "Morning. The fish are already swimming their morning laps.",
  ],
  afternoon: [
    "Afternoon check-in. Everything looks stable.",
    "Good to see you. Echo was just drifting by.",
    "The mid-day light hits the water nicely today.",
  ],
  evening: [
    "Evening. A good time to wind down — for you and the tank.",
    "The tank settles into its night rhythm. Echo does too.",
    "Quiet hours. Echo appreciates you checking in.",
  ],
  returning: [
    "Welcome back. Echo missed the routine.",
    "You're here again. That matters more than you know.",
    "Echo perks up. Consistency looks good on you.",
  ],
  streak: [
    "Day {streak} of the streak. Echo is impressed.",
    "{streak} days strong. Your fish can feel the dedication.",
    "The streak continues. Echo shimmers a little brighter.",
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Action Reactions (shown immediately after specific actions)
// ─────────────────────────────────────────────────────────────────────────────

export const ACTION_REACTIONS = {
  LOG_FEEDING: [
    "Fed and happy. Echo approves.",
    "Full bellies, content fins.",
    "Mealtime is the best time. Echo agrees.",
  ],
  LOG_WATER: [
    "Fresh water makes everything better. Echo feels it.",
    "Clean change logged. The tank breathes easier now.",
    "Water renewed. A simple act that means everything.",
  ],
  LOG_PARAMETERS: [
    "Parameters locked in. Knowledge is power.",
    "Good data leads to good care. Echo relaxes.",
    "Numbers checked. Your fish don't know — but they benefit.",
  ],
  REGISTER_TANK: [
    "A new home registered. Echo is excited to explore it.",
    "Another tank in the family. The journey grows.",
  ],
  MINT_SPECIMEN: [
    "A birth certificate, officially sealed. Legacy captured.",
    "New life, documented. Echo hums with quiet pride.",
  ],
  SPAWN_BREED: [
    "New life! Echo can barely contain herself.",
    "The cycle continues. Echo witnesses something beautiful.",
  ],
  TIER_UP: [
    "Echo evolved! A new form, earned through care.",
    "Tier unlocked. Echo shimmers with a deeper light now.",
    "Growth. Real growth. Echo feels it in her scales.",
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Core Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determine Echo's current mood based on user state.
 * 
 * @param {object} state
 * @param {number} state.streakDays - Current care streak
 * @param {number} state.hoursSinceLastAction - Hours since last logged action
 * @param {number} state.actionsToday - Number of actions logged today
 * @param {boolean} state.justLeveledUp - Whether user just reached a new tier
 * @returns {object} Mood object from MOODS
 */
export function getCurrentMood({ streakDays = 0, hoursSinceLastAction = 0, actionsToday = 0, justLeveledUp = false }) {
  // Joyful: long streak or just leveled up
  if (justLeveledUp || streakDays >= 14) {
    return MOODS.joyful;
  }

  // Pleased: active today with a decent streak
  if (actionsToday >= 2 && streakDays >= 3) {
    return MOODS.pleased;
  }

  // Concerned: inactive for 48+ hours
  if (hoursSinceLastAction >= 48) {
    return MOODS.concerned;
  }

  // Quiet: inactive for 24+ hours but less than 48
  if (hoursSinceLastAction >= 24) {
    return MOODS.quiet;
  }

  // Curious: some activity today, short streak
  if (actionsToday >= 1 && streakDays < 3) {
    return MOODS.curious;
  }

  // Calm: default state
  return MOODS.calm;
}

/**
 * Get a random mood-appropriate one-liner.
 * 
 * @param {string} moodKey - Key from MOODS
 * @returns {string}
 */
export function getMoodLine(moodKey) {
  const lines = MOOD_LINES[moodKey] || MOOD_LINES.calm;
  return lines[Math.floor(Math.random() * lines.length)];
}

/**
 * Get a contextual greeting for the current session.
 * 
 * @param {object} state
 * @param {number} state.streakDays
 * @param {number} state.hoursSinceLastAction
 * @returns {string}
 */
export function getEchoGreeting({ streakDays = 0, hoursSinceLastAction = 0 }) {
  // Streak greeting takes priority
  if (streakDays >= 7) {
    const lines = GREETINGS.streak;
    const line = lines[Math.floor(Math.random() * lines.length)];
    return line.replace("{streak}", streakDays.toString());
  }

  // Returning after absence
  if (hoursSinceLastAction >= 48) {
    const lines = GREETINGS.returning;
    return lines[Math.floor(Math.random() * lines.length)];
  }

  // Time-of-day greeting
  const hour = new Date().getHours();
  if (hour < 12) {
    const lines = GREETINGS.morning;
    return lines[Math.floor(Math.random() * lines.length)];
  } else if (hour < 18) {
    const lines = GREETINGS.afternoon;
    return lines[Math.floor(Math.random() * lines.length)];
  } else {
    const lines = GREETINGS.evening;
    return lines[Math.floor(Math.random() * lines.length)];
  }
}

/**
 * Get a reaction line for a specific action just performed.
 * 
 * @param {string} actionKey - XP_ACTIONS key or special key like "TIER_UP"
 * @returns {string|null} - null if no specific reaction for this action
 */
export function getActionReaction(actionKey) {
  const lines = ACTION_REACTIONS[actionKey];
  if (!lines || lines.length === 0) return null;
  return lines[Math.floor(Math.random() * lines.length)];
}

/**
 * Calculate hours since the last action from a timestamp.
 * 
 * @param {string|number|null} lastActiveDate - ISO string, timestamp, or null
 * @returns {number} Hours since last activity
 */
export function getHoursSinceLastAction(lastActiveDate) {
  if (!lastActiveDate) return 999;
  const last = new Date(lastActiveDate);
  const now = new Date();
  return Math.max(0, (now - last) / (1000 * 60 * 60));
}
