/**
 * nameConfirmCopy.js — pure, dependency-free copy + helpers for NameConfirmStep.
 *
 * Extracted from `NameConfirmStep.jsx` (mirroring the `identityCopy.js` split)
 * so the persona-aware wording and the name validation/normalization logic can
 * be unit-tested in the project's `node` vitest environment without pulling in
 * React contexts or Dexie.
 *
 * Validates: Requirements 7.1 (alias prefill copy), 7.2 (name persistence copy),
 * 7.6 (validation: max length + non-empty).
 */

/** Maximum length for a confirmed display name (Req 7.6). */
export const MAX_NAME_LENGTH = 30;

// ─────────────────────────────────────────────────────────────────────────────
// Persona-aware copy. Casual copy keeps a warm, jargon-free tone; pro copy uses
// the "operator callsign / node" framing established by the existing wizard.
// ─────────────────────────────────────────────────────────────────────────────
export const NAME_CONFIRM_COPY = Object.freeze({
  // Poseidon's prompt asking the user to confirm/edit the suggested name.
  prompt: {
    casual:
      "One last thing — what should I call you? I've suggested a name, but you can change it to whatever you like.",
    pro: "Designate your operator callsign. A default has been generated from your node address.",
  },
  // Input placeholder.
  placeholder: { casual: "Enter your name…", pro: "Enter callsign…" },
  // Primary confirm CTA label.
  button: { casual: "That's Me", pro: "Confirm Callsign" },
  // Disabled label while persistence is in-flight.
  buttonBusy: { casual: "Saving…", pro: "Registering…" },
});

/**
 * resolvePersonaCopy — pick the casual/pro variant of a NAME_CONFIRM_COPY entry.
 *
 * Accepts either a `casualMode` boolean (true ⇒ casual, false ⇒ pro) or the
 * persona strings. Defaults to the casual tone before a persona is chosen.
 *
 * @param {{casual:string, pro:string}} entry
 * @param {boolean|"casual"|"pro"|null} casualMode
 * @returns {string}
 */
export function resolvePersonaCopy(entry, casualMode) {
  if (!entry) return "";
  let mode;
  if (casualMode === true || casualMode === "casual") mode = "casual";
  else if (casualMode === false || casualMode === "pro") mode = "pro";
  else mode = "casual"; // default tone before a persona is chosen
  return entry[mode] ?? entry.casual ?? entry.pro ?? "";
}

/**
 * nameConfirmButtonLabel — the CTA label for the current state.
 *
 * @param {boolean|"casual"|"pro"|null} casualMode
 * @param {boolean} busy
 * @returns {string}
 */
export function nameConfirmButtonLabel(casualMode, busy) {
  return resolvePersonaCopy(
    busy ? NAME_CONFIRM_COPY.buttonBusy : NAME_CONFIRM_COPY.button,
    casualMode
  );
}

/**
 * normalizeName — clamp raw input to the allowed shape for the editable field.
 *
 * Truncates to `MAX_NAME_LENGTH` characters (Req 7.6). Leading/trailing
 * whitespace is preserved while typing (so the user can type spaces between
 * words) and only trimmed at validation/submit time via `isNameValid` /
 * `cleanName`. A null/undefined input normalizes to an empty string.
 *
 * @param {string|null|undefined} raw
 * @returns {string}
 */
export function normalizeName(raw) {
  if (!raw) return "";
  return String(raw).slice(0, MAX_NAME_LENGTH);
}

/**
 * cleanName — the value actually persisted: trimmed and length-clamped.
 *
 * @param {string|null|undefined} raw
 * @returns {string}
 */
export function cleanName(raw) {
  return normalizeName(raw).trim();
}

/**
 * isNameValid — whether a name is acceptable to confirm: non-empty after
 * trimming (Req 7.6 — confirm disabled when empty).
 *
 * @param {string|null|undefined} raw
 * @returns {boolean}
 */
export function isNameValid(raw) {
  return cleanName(raw).length > 0;
}
