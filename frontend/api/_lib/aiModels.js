// aiModels.js — the one place a model name lives.
//
// ── WHY ─────────────────────────────────────────────────────────────────────
//
// Model names used to be string literals at six call sites across api/ai.js and
// api/parse-search.js. That made a Google model retirement — which has now
// happened twice — a code change and a deploy in six places, with a real chance
// of missing one. Worst of all, the health check hardcoded its OWN copy of the
// name, so it could report green for a model nothing actually used.
//
// Here, a retirement is an environment variable. No code change, no deploy, and
// no touching api/ai.js (whose listing-draft prompt sits behind a review gate).
//
// ── TASKS, NOT MODELS ───────────────────────────────────────────────────────
//
// Entries are named for the JOB ("chat", "extract") rather than the model, so
// swapping tier or provider renames nothing downstream.
//
// ── LOCATION IS PART OF THE ADDRESS ─────────────────────────────────────────
//
// Not just a nicety: probed 2026-08-11 against project `aquacellum`, the
// gemini-3.x family is NOT served from us-central1 — it 404s there on both v1 and
// v1beta1 — and is only reachable on the GLOBAL endpoint
// (aiplatform.googleapis.com, locations/global), which is a different host, not
// just a different path segment. So a model and its location have to travel
// together or the next migration fails in a way that looks like a bad model name.
//
// ── MEASURED, NOT ASSUMED (probe, 2026-08-11, identical request shape:
//    responseMimeType json + responseSchema + safetySettings) ───────────────
//
//   model                    location     latency   hidden "thinking" tokens
//   gemini-2.5-flash         us-central1   1869ms   —          (current chat)
//   gemini-2.5-flash-lite    us-central1    656ms   —          (current search/vision)
//   gemini-3.5-flash-lite    global         998ms   0
//   gemini-3.5-flash         global        4280ms   599
//   gemini-3.6-flash         global        6178ms   475
//   gemini-3.7-flash         global        3037ms   375
//
// All six returned schema-valid JSON in `candidates[0].content.parts[0].text`,
// so the existing parse still works — thoughts are billed but not returned as
// parts.
//
// The 3.x *flash* models spend 375–599 hidden tokens and 3–6 SECONDS reasoning
// about a task whose prompt explicitly forbids independent reasoning ("treat
// provided species data as ground truth… never fabricate"). For a chat surface
// that is a latency and cost regression bought with nothing. `gemini-3.5-flash-lite`
// is the standout successor: GA, ~1s, no thinking overhead.
//
// NOTE: this commit deliberately does NOT change which model runs. Defaults are
// the current ones, so the change is purely structural and behaviour-neutral;
// flipping CHAT to gemini-3.5-flash-lite is now a one-variable change that can be
// reverted just as fast. Answer QUALITY across many prompts was not measured, only
// compatibility and latency — so that flip deserves its own look.

/** Where a model is served from. The 3.x line only exists on `global`. */
export const AI_LOCATION = Object.freeze({
  REGIONAL: 'us-central1',
  GLOBAL: 'global',
});

/**
 * Probed, known-good options. Kept in the repo so the next migration starts from
 * measurements instead of guesswork, and so `sunsetOn` lives in version control
 * rather than only in an inbox.
 *
 * `sunsetOn` is an ISO date when Google has announced one. Fill it in from the
 * retirement email — the health check warns as it approaches.
 */
export const KNOWN_MODELS = Object.freeze({
  'gemini-2.5-flash': { location: AI_LOCATION.REGIONAL, sunsetOn: null, note: 'Retirement announced by email; record the date here.' },
  'gemini-2.5-flash-lite': { location: AI_LOCATION.REGIONAL, sunsetOn: null },
  'gemini-3.5-flash-lite': { location: AI_LOCATION.GLOBAL, sunsetOn: null, note: 'Recommended successor for chat/search: ~1s, no thinking overhead.' },
  'gemini-3.5-flash': { location: AI_LOCATION.GLOBAL, sunsetOn: null, note: 'Thinking on by default (~600 hidden tokens, ~4s).' },
  'gemini-3.6-flash': { location: AI_LOCATION.GLOBAL, sunsetOn: null, note: 'Slowest probed (~6s).' },
  'gemini-3.7-flash': { location: AI_LOCATION.GLOBAL, sunsetOn: null, note: 'Pick this if a task ever needs real reasoning.' },
});

/**
 * Task → model. Every entry is overridable by environment variable, which is the
 * whole point: a retirement is answered in the Vercel dashboard.
 *
 *   AI_MODEL_<TASK>     e.g. AI_MODEL_CHAT=gemini-3.5-flash-lite
 *   AI_LOCATION_<TASK>  usually unnecessary — inferred from KNOWN_MODELS
 *
 * `fallback` is used when the primary returns a model-not-found, so a retirement
 * degrades instead of taking the feature down.
 */
const TASK_DEFAULTS = Object.freeze({
  /** Poseidon conversational chat (api/ai.js handlePoseidon). */
  CHAT: { model: 'gemini-2.5-flash', fallback: 'gemini-3.5-flash-lite' },
  /** Grounded listing-description drafting — review-gated prompt. */
  EXTRACT: { model: 'gemini-2.5-flash', fallback: 'gemini-3.5-flash-lite' },
  /** Natural-language catalog search parsing (api/parse-search.js). */
  SEARCH: { model: 'gemini-2.5-flash-lite', fallback: 'gemini-3.5-flash-lite' },
  /** Image alt-text / photo understanding (api/ai.js handleAltText). */
  VISION: { model: 'gemini-2.5-flash-lite', fallback: 'gemini-3.5-flash-lite' },
  /** Grounded species recommendation (api/ai.js handleSuggestSpecies). */
  SUGGEST: { model: 'gemini-2.5-flash', fallback: 'gemini-3.5-flash-lite' },
});
// Deliberately no NARRATION task: spawnNarration.js and useNarration.js post to
// `?action=poseidon`, so they already run on CHAT. A separate entry would be
// config nothing reads — the dead-control shape this codebase keeps clearing out.

export const AI_TASKS = Object.freeze(Object.keys(TASK_DEFAULTS));

function envFor(task, kind) {
  const value = process.env[`AI_${kind}_${task}`];
  return value && String(value).trim() ? String(value).trim() : null;
}

/**
 * Resolve the model configuration for a task.
 *
 * @param {string} task one of AI_TASKS
 * @returns {{ task: string, model: string, location: string, fallback: string|null,
 *             sunsetOn: string|null, source: 'env'|'default' }}
 */
export function modelFor(task) {
  const key = String(task || '').toUpperCase();
  const defaults = TASK_DEFAULTS[key];
  if (!defaults) {
    throw new Error(`[aiModels] Unknown AI task "${task}". Known: ${AI_TASKS.join(', ')}`);
  }

  const envModel = envFor(key, 'MODEL');
  const model = envModel || defaults.model;
  // An override for an unlisted model still needs a location; assume regional
  // unless told otherwise, and let AI_LOCATION_<TASK> settle it explicitly.
  const known = KNOWN_MODELS[model];
  const location = envFor(key, 'LOCATION') || known?.location || AI_LOCATION.REGIONAL;

  return {
    task: key,
    model,
    location,
    fallback: defaults.fallback || null,
    sunsetOn: known?.sunsetOn || null,
    source: envModel ? 'env' : 'default',
  };
}

/** The fallback configuration for a task, or null when there isn't one. */
export function fallbackFor(task) {
  const key = String(task || '').toUpperCase();
  const name = TASK_DEFAULTS[key]?.fallback;
  if (!name) return null;
  const known = KNOWN_MODELS[name];
  return { task: key, model: name, location: known?.location || AI_LOCATION.REGIONAL, fallback: null, sunsetOn: known?.sunsetOn || null, source: 'fallback' };
}

/** Every distinct model:location pair currently configured — for the health check. */
export function configuredModels() {
  const seen = new Map();
  for (const task of AI_TASKS) {
    const cfg = modelFor(task);
    const id = `${cfg.model}@${cfg.location}`;
    if (!seen.has(id)) seen.set(id, { ...cfg, tasks: [task] });
    else seen.get(id).tasks.push(task);
  }
  return [...seen.values()];
}

/**
 * Models whose announced sunset is inside `withinDays`.
 *
 * This exists so a retirement stops being something that lives only in an email.
 * The health check surfaces it, which is the same instinct as the rest of this
 * codebase: prefer a signal that fails loudly over remembering to check.
 */
export function expiringModels(withinDays = 60, now = Date.now()) {
  const out = [];
  for (const cfg of configuredModels()) {
    if (!cfg.sunsetOn) continue;
    const ts = Date.parse(cfg.sunsetOn);
    if (!Number.isFinite(ts)) continue;
    const daysLeft = Math.ceil((ts - now) / 86400000);
    if (daysLeft <= withinDays) out.push({ ...cfg, daysLeft });
  }
  return out;
}
