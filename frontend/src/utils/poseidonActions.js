/**
 * poseidonActions.js — the single declaration of what Poseidon can ask the app
 * to do, and which of those things actually run.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * The action list was previously duplicated in three places that drifted:
 *
 *   1. `## AVAILABLE ACTIONS` in POSEIDON_SYSTEM_PROMPT (api/ai.js) — declared 5.
 *   2. `handlePoseidonAction` (poseidonBridge.js) — implemented 2.
 *   3. `formatActionLabel` (PoseidonChatConsole.jsx) — labelled 5.
 *
 * The gap between (1) and (2) was a live bug, not a theoretical one: asking
 * Poseidon to record a water test produced a "Poseidon wants to: record water
 * parameters" bar, and pressing Confirm silently dropped the reading. The keeper
 * got an affirmative UI for a write that never happened — which for a husbandry
 * log is worse than no feature, because they then believe the reading is saved.
 *
 * Everything about an action is declared here once: its class, whether it needs
 * confirming, and its copy. `poseidonActions.test.js` asserts this registry
 * against the prompt's declared list and against the bridge's implementation, so
 * the three-way drift cannot silently return.
 */

/** Canonical action type names. These strings cross the wire from the model. */
export const POSEIDON_ACTION = Object.freeze({
  CREATE_TANK: "CREATE_TANK",
  LOG_HUSBANDRY: "LOG_HUSBANDRY",
  LOG_WATER_PARAMS: "LOG_WATER_PARAMS",
  NAVIGATE: "NAVIGATE",
  QUERY_COMPATIBILITY: "QUERY_COMPATIBILITY",
  SUGGEST_SPECIES: "SUGGEST_SPECIES",
  NONE: "NONE",
});

/**
 * What kind of thing an action is. This is what decides whether a confirm bar
 * appears — not a hardcoded `type !== "NONE"` check.
 */
export const ACTION_CLASS = Object.freeze({
  /** Changes the keeper's records. Must be confirmed, and must actually write. */
  WRITE: "write",
  /** Moves the view. Confirmed too, because yanking the screen mid-read is rude. */
  NAVIGATION: "navigation",
  /** The prose answer IS the whole response. There is nothing to run. */
  INFORMATIONAL: "informational",
  /** No action at all. */
  NONE: "none",
});

const { WRITE, NAVIGATION, INFORMATIONAL, NONE } = ACTION_CLASS;

/**
 * The registry. `label` is what the confirm bar says Poseidon wants to do;
 * `confirmLabel` is the accept button.
 *
 * Copy is checked against PROHIBITED_TERMS by the test, so no Web3 vocabulary
 * can reach a hobbyist through an action bar.
 */
export const POSEIDON_ACTIONS = Object.freeze({
  [POSEIDON_ACTION.CREATE_TANK]: Object.freeze({
    class: WRITE,
    label: Object.freeze({ casual: "set up a new tank", pro: "CREATE_TANK" }),
    confirmLabel: Object.freeze({ casual: "Do it", pro: "EXEC" }),
  }),
  [POSEIDON_ACTION.LOG_HUSBANDRY]: Object.freeze({
    class: WRITE,
    label: Object.freeze({ casual: "log a care event", pro: "LOG_HUSBANDRY" }),
    confirmLabel: Object.freeze({ casual: "Do it", pro: "EXEC" }),
  }),
  [POSEIDON_ACTION.LOG_WATER_PARAMS]: Object.freeze({
    class: WRITE,
    label: Object.freeze({ casual: "save these water readings", pro: "LOG_WATER_PARAMS" }),
    confirmLabel: Object.freeze({ casual: "Save it", pro: "EXEC" }),
  }),
  [POSEIDON_ACTION.NAVIGATE]: Object.freeze({
    class: NAVIGATION,
    label: Object.freeze({ casual: "take you there", pro: "NAVIGATE" }),
    confirmLabel: Object.freeze({ casual: "Take me there", pro: "GO" }),
  }),
  // ── Informational: these were the silent no-ops ──────────────────────────
  // The model answers a compatibility or suggestion question in prose; there is
  // no separate operation to perform afterwards. They stay in the registry (the
  // model still emits them, and the prompt still lists them) but they are
  // classed so no confirm bar is offered for a button that would do nothing.
  [POSEIDON_ACTION.QUERY_COMPATIBILITY]: Object.freeze({
    class: INFORMATIONAL,
    label: Object.freeze({ casual: "check compatibility", pro: "QUERY_COMPATIBILITY" }),
    confirmLabel: null,
  }),
  [POSEIDON_ACTION.SUGGEST_SPECIES]: Object.freeze({
    class: INFORMATIONAL,
    label: Object.freeze({ casual: "suggest some fish", pro: "SUGGEST_SPECIES" }),
    confirmLabel: null,
  }),
  [POSEIDON_ACTION.NONE]: Object.freeze({
    class: NONE,
    label: Object.freeze({ casual: "", pro: "NONE" }),
    confirmLabel: null,
  }),
});

/** Every action type the app recognises. */
export const KNOWN_ACTION_TYPES = Object.freeze(Object.keys(POSEIDON_ACTIONS));

/** Class of an action type. Unknown types are treated as NONE — fail closed. */
export function actionClass(type) {
  return POSEIDON_ACTIONS[type]?.class || NONE;
}

/**
 * Whether to show a confirm bar. True only for things that will actually happen —
 * which is the fix for the three no-op actions that used to offer one.
 */
export function requiresConfirmation(type) {
  const cls = actionClass(type);
  return cls === WRITE || cls === NAVIGATION;
}

/** Whether the bridge has something to execute for this type. */
export function isRunnable(type) {
  return requiresConfirmation(type);
}

/** Mode-aware description of what Poseidon is proposing. */
export function actionLabel(type, { casual = true } = {}) {
  const entry = POSEIDON_ACTIONS[type];
  if (!entry) {
    // An unrecognised type from the model: describe it readably rather than
    // printing a raw enum at the keeper.
    return String(type || "").toLowerCase().replace(/_/g, " ");
  }
  return casual ? entry.label.casual : entry.label.pro;
}

/** Mode-aware accept-button copy. */
export function actionConfirmLabel(type, { casual = true } = {}) {
  const entry = POSEIDON_ACTIONS[type];
  if (!entry?.confirmLabel) return casual ? "Do it" : "EXEC";
  return casual ? entry.confirmLabel.casual : entry.confirmLabel.pro;
}

/** Every user-facing string — for the language invariant test. */
export function allActionCopy() {
  const out = [];
  for (const entry of Object.values(POSEIDON_ACTIONS)) {
    out.push(entry.label.casual, entry.label.pro);
    if (entry.confirmLabel) out.push(entry.confirmLabel.casual, entry.confirmLabel.pro);
  }
  return out.filter(Boolean);
}
