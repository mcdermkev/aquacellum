/**
 * Aquadex Species Personality Accessor
 * Pure, dependency-free helper that reads dual-mode (Casual / Pro) personality
 * copy from a species record without ever throwing on missing or partial data.
 *
 * Enforces the "absent = silent" rule in one place so render points can rely on
 * a simple truthiness check: a leaf is either a usable, non-empty string or
 * `undefined` — never placeholder text and never a crash.
 */

/**
 * Normalize a personality leaf to a usable string or `undefined`.
 * Treats null/undefined, non-strings, and empty/whitespace-only strings as absent.
 */
function cleanLeaf(value) {
  if (typeof value !== "string") return undefined;
  return value.trim().length > 0 ? value : undefined;
}

/**
 * Read the requested mode's personality fields from a species record.
 *
 * @param {object} profile - a species record that MAY contain a `personality`
 *   block of shape `{ vibeLine: { casual, pro }, flavorText: { casual, pro } }`.
 * @param {"casual" | "pro"} mode - which voice to read.
 * @returns {{ vibeLine: string | undefined, flavorText: string | undefined }}
 *   the requested mode's fields only; `undefined` for any absent/empty leaf.
 */
export function getPersonality(profile, mode) {
  // Mode isolation: only the requested mode is ever read. Any value other than
  // "casual" or "pro" yields a fully silent result (no defaulting to casual).
  if (mode !== "casual" && mode !== "pro") {
    return { vibeLine: undefined, flavorText: undefined };
  }

  // Optional chaining keeps this safe for null/undefined profile or any
  // combination of missing/null nested keys.
  const personality = profile?.personality;

  return {
    vibeLine: cleanLeaf(personality?.vibeLine?.[mode]),
    flavorText: cleanLeaf(personality?.flavorText?.[mode]),
  };
}
