/**
 * Aquadex Breeding XP & Husbandry Telemetry Helper
 * Tracks user actions locally to reward breeder engagement.
 * Cross-compatible with future mobile AI app generator platforms.
 */

// XP Constants for different husbandry activities
export const XP_ACTIONS = {
  LOG_WATER: { points: 15, label: "Logged Water Parameters" },
  LOG_PARAMETERS: { points: 20, label: "Logged Water Parameters" },
  REGISTER_TANK: { points: 25, label: "Registered Aquarium Tank" },
  MINT_SPECIMEN: { points: 50, label: "Registered Birth Certificate" },
  SPAWN_BREED: { points: 150, label: "Successful Breeding Spawn" },
  LIST_DIRECTORY: { points: 30, label: "Listed Certificate in Directory" },
  CLAIM_EXCHANGE: { points: 40, label: "Secured Certificate from Directory" },
};

/**
 * Get the full user XP Profile from local storage, with fallback initialization
 */
export function getXpProfile() {
  try {
    const val = localStorage.getItem("aquadex_xp_profile");
    if (val && val !== "undefined" && val !== "null") {
      const parsed = JSON.parse(val);
      if (parsed && typeof parsed === "object" && typeof parsed.points === "number") {
        return parsed;
      }
    }
  } catch (e) {
    console.warn("Failed to parse aquadex_xp_profile local storage value:", e);
  }

  // Fallback default user XP profile structure
  const fallback = {
    points: 0,
    level: 1,
    badge: "Novice Aquarist",
    history: []
  };
  try {
    localStorage.setItem("aquadex_xp_profile", JSON.stringify(fallback));
    localStorage.setItem("aquadex_xp", "0");
    localStorage.setItem("aquadex_xp_points", "0");
  } catch (e) {
    console.error("Local storage is not writable:", e);
  }
  return fallback;
}

/**
 * Get current user XP points from local storage
 */
export function getXp() {
  const profile = getXpProfile();
  return profile.points;
}

/**
 * Add XP points and fire event notifications
 */
export function addXp(pointsToAdd, actionLabel = "Husbandry Activity") {
  // Wrap in safety checks to handle undefined or malformed numbers
  const points = Number(pointsToAdd || 0);

  const profile = getXpProfile();
  const currentXp = profile.points;
  const newXp = currentXp + points;

  const oldInfo = getLevelInfo(currentXp);
  const newInfo = getLevelInfo(newXp);
  const levelChanged = oldInfo.level !== newInfo.level;

  // Update profile structure
  profile.points = newXp;
  profile.level = newInfo.level;
  profile.badge = newInfo.badge;
  if (!profile.history) profile.history = [];
  profile.history.push({
    timestamp: Date.now(),
    action: actionLabel,
    points
  });

  try {
    localStorage.setItem("aquadex_xp_profile", JSON.stringify(profile));
    localStorage.setItem("aquadex_xp", newXp.toString());
    localStorage.setItem("aquadex_xp_points", newXp.toString());
  } catch (e) {
    console.error("Failed saving XP state to local storage:", e);
  }

  // Dispatch a global event so UI components can update dynamically and display toasts
  const event = new CustomEvent("aquadex_xp_added", {
    detail: {
      points,
      actionLabel,
      totalXp: newXp,
      levelInfo: newInfo,
      levelChanged,
      newLevel: newInfo.level,
    },
  });
  window.dispatchEvent(event);

  return { newXp, levelInfo: newInfo, levelChanged };
}

/**
 * Get details about level and progress based on XP
 */
export function getLevelInfo(xp) {
  const currentPoints = Number(xp || 0);
  if (currentPoints < 100) {
    return {
      level: 1,
      badge: "Novice Aquarist",
      color: "var(--accent-blue)",
      colorHex: "#38bdf8",
      nextLevelXp: 100,
      baseXp: 0,
      progressPct: Math.min(100, Math.max(0, (currentPoints / 100) * 100)),
    };
  } else if (currentPoints < 300) {
    return {
      level: 2,
      badge: "Husbandry Technician",
      color: "var(--accent-green)",
      colorHex: "#34d399",
      nextLevelXp: 300,
      baseXp: 100,
      progressPct: Math.min(100, Math.max(0, ((currentPoints - 100) / 200) * 100)),
    };
  } else if (currentPoints < 600) {
    return {
      level: 3,
      badge: "Experienced Breeder",
      color: "var(--accent-amber)",
      colorHex: "#fbbf24",
      nextLevelXp: 600,
      baseXp: 300,
      progressPct: Math.min(100, Math.max(0, ((currentPoints - 300) / 300) * 100)),
    };
  } else {
    return {
      level: 4,
      badge: "Master Husbandry Director",
      color: "#f43f5e", // Rose
      colorHex: "#f43f5e",
      nextLevelXp: null,
      baseXp: 600,
      progressPct: 100,
    };
  }
}
