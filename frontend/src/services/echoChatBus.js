/**
 * echoChatBus.js — how the rest of the app talks to Echo's chat.
 *
 * There is one chat (`EchoChat`, mounted once in App.jsx). Anything that wants
 * to open it, optionally with a question already asked or a tank in context,
 * dispatches one of these events instead of mounting its own console. That is
 * what keeps her one character: every "Ask Echo" in the app lands in the same
 * conversation.
 *
 * Seeding only ASKS. Anything Poseidon proposes to write still waits for the
 * keeper in the chat's confirm bar.
 *
 * The event names are written out at each dispatch site on purpose:
 * scripts/seams/analyzeSeams.mjs resolves names from literals, not parameters.
 */

/**
 * Open the chat.
 *
 * @param {object} [opts]
 * @param {string|null} [opts.seedPrompt] a question to ask straight away
 * @param {number|string|null} [opts.tankId] the tank the question is about
 */
export function openEchoChat({ seedPrompt = null, tankId = null } = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("echo:open", { detail: { seedPrompt, tankId } }));
}

/**
 * Open the chat on the tank planner.
 *
 * @param {object} [opts]
 * @param {object[]} [opts.species] catalog records to start the plan with
 * @param {number|string|null} [opts.tankId] start from one of the keeper's tanks
 */
export function openEchoPlanner({ species = [], tankId = null } = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("echo:open-planner", { detail: { species, tankId } }));
}
