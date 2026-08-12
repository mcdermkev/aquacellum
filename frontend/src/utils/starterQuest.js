/**
 * starterQuest.js — first-run activation checklist for Casual keepers.
 *
 * Five one-time steps, persisted under a single localStorage key. Steps are
 * marked complete by real product signals that already fire across the app —
 * no new XP keys and no new instrumentation at the individual action sites.
 *
 * A single set of window listeners is installed once from App.jsx
 * (installStarterQuestListeners). App.jsx is always mounted while signed in,
 * whereas ProfileHub only mounts on the Profile tab — so recording the signals
 * at the App level is what lets the quest capture a "post to the Reef" or
 * "browse the marketplace" that happens while the hub itself is unmounted.
 *
 * ProfileHub is a pure reader: it calls getStarterQuestState() and re-reads on
 * the QUEST_UPDATED_EVENT.
 */

export const STARTER_QUEST_KEY = "aquadex_starter_quest";
export const QUEST_UPDATED_EVENT = "aquadex:quest_updated";
// Set once the keeper has explicitly dismissed the completed quest card so it
// stops taking up room in the hub. Kept separate from step state so re-opening
// dev tools / clearing a step never resurrects a dismissed card unexpectedly.
const QUEST_DISMISSED_KEY = "aquadex_starter_quest_dismissed";

export const STARTER_QUEST_ITEMS = Object.freeze([
  { id: "add_tank", icon: "🪸", label: "Set up your first aquarium", hint: "Add a tank in My Aquariums", tab: "tanks" },
  { id: "log_test", icon: "🧪", label: "Log a water test", hint: "Record parameters for a tank", tab: "tanks" },
  { id: "add_fish", icon: "🐠", label: "Add your first fish", hint: "Collect a species to your dex", tab: "tanks" },
  { id: "post_reef", icon: "🌊", label: "Post to The Reef", hint: "Share a Current with the community", tab: "reef" },
  { id: "browse_market", icon: "🛒", label: "Browse the marketplace", hint: "See what breeders are offering", tab: "directory" },
]);

const STEP_IDS = STARTER_QUEST_ITEMS.map((s) => s.id);

/** Read the raw {stepId: true} map from localStorage. Never throws. */
function readState() {
  try {
    const raw = localStorage.getItem(STARTER_QUEST_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeState(state) {
  try {
    localStorage.setItem(STARTER_QUEST_KEY, JSON.stringify(state));
  } catch {
    /* storage full / unavailable — quest is best-effort, ignore */
  }
}

/**
 * Public snapshot for the UI.
 * @returns {{ steps: Record<string, boolean>, completedCount: number, total: number, allDone: boolean, dismissed: boolean }}
 */
export function getStarterQuestState() {
  const raw = readState();
  const steps = {};
  let completedCount = 0;
  for (const id of STEP_IDS) {
    const done = raw[id] === true;
    steps[id] = done;
    if (done) completedCount += 1;
  }
  let dismissed = false;
  try {
    dismissed = localStorage.getItem(QUEST_DISMISSED_KEY) === "true";
  } catch {
    /* ignore */
  }
  return {
    steps,
    completedCount,
    total: STEP_IDS.length,
    allDone: completedCount === STEP_IDS.length,
    dismissed,
  };
}

/**
 * Mark a step complete. Idempotent: a no-op (no event) if already complete or
 * if the id isn't a known step. Fires QUEST_UPDATED_EVENT on a real change so a
 * mounted ProfileHub can refresh.
 */
export function markStarterQuestStep(stepId) {
  if (!STEP_IDS.includes(stepId)) return;
  const state = readState();
  if (state[stepId] === true) return;
  state[stepId] = true;
  writeState(state);
  try {
    window.dispatchEvent(new CustomEvent(QUEST_UPDATED_EVENT, { detail: { stepId } }));
  } catch {
    /* SSR / no window — ignore */
  }
}

/** Persist the keeper's dismissal of the finished quest card. */
export function dismissStarterQuest() {
  try {
    localStorage.setItem(QUEST_DISMISSED_KEY, "true");
    window.dispatchEvent(new CustomEvent(QUEST_UPDATED_EVENT, { detail: { dismissed: true } }));
  } catch {
    /* ignore */
  }
}

/**
 * Wire the real product signals to quest steps, once. Returns a teardown fn.
 *
 * Signal → step mapping (all pre-existing events):
 *   aquadex:tank_registered        → add_tank
 *   aquadex_xp_added (LOG_PARAMETERS) → log_test
 *   aquadex:specimen_added         → add_fish
 *   aquadex_first_current_posted   → post_reef
 *   (marketplace visit)            → browse_market  [driven from App via markStarterQuestStep]
 *
 * Idempotency is handled by markStarterQuestStep, so double-fired events are
 * harmless. `_installed` guards against duplicate installs under StrictMode /
 * fast refresh.
 */
let _installed = false;
export function installStarterQuestListeners() {
  if (typeof window === "undefined") return () => {};
  if (_installed) return () => {};
  _installed = true;

  const onTank = () => markStarterQuestStep("add_tank");
  const onFish = () => markStarterQuestStep("add_fish");
  const onReef = () => markStarterQuestStep("post_reef");
  const onXp = (e) => {
    const detail = e && e.detail ? e.detail : {};
    const key = detail.actionKey;
    const label = String(detail.actionLabel || detail.reason || "").toLowerCase();
    if (key === "LOG_PARAMETERS" || label.includes("parameter") || (label.includes("water") && label.includes("test"))) {
      markStarterQuestStep("log_test");
    }
  };

  window.addEventListener("aquadex:tank_registered", onTank);
  window.addEventListener("aquadex:specimen_added", onFish);
  window.addEventListener("aquadex_first_current_posted", onReef);
  window.addEventListener("aquadex_xp_added", onXp);

  // Seed steps that already have persistent truth from a prior session so
  // returning keepers don't see completed work as undone.
  try {
    if (localStorage.getItem("aquadex_posted_first_current") === "true") {
      markStarterQuestStep("post_reef");
    }
  } catch {
    /* ignore */
  }

  return () => {
    window.removeEventListener("aquadex:tank_registered", onTank);
    window.removeEventListener("aquadex:specimen_added", onFish);
    window.removeEventListener("aquadex_first_current_posted", onReef);
    window.removeEventListener("aquadex_xp_added", onXp);
    _installed = false;
  };
}
