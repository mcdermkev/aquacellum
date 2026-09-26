// =============================================================================
// Script-generation prompt — Tier A (Opus-owned). This is the correctness-
// critical asset: it governs what the videos claim about the product. Keep the
// honesty rules intact; they mirror the (live)/(gated)/(not live)/(removed)
// markers in docs/APP_FEATURE_MAP.md and prevent the series from overclaiming.
//
// The prompt forces STRICT JSON out so tts.mjs and the editor can consume it
// without parsing prose. Do not loosen the schema without updating tts.mjs.
// =============================================================================

export const NARRATOR = {
  name: 'Poseidon',
  // Persona spoken by the Azure Neural TTS voice across every episode.
  persona:
    'Poseidon — the calm, authoritative guide-voice of the app. Speaks like a ' +
    'seasoned aquarist mentor: warm, grounded, precise, never hype. Short ' +
    'sentences. Second person ("you"). No exclamation points. No superlatives.',
};

export const SYSTEM_PROMPT = [
  'You are a senior product-marketing scriptwriter for Aquacellum, an aquarium',
  'and fish-breeding app. You write short YouTube feature-demo scripts narrated',
  `by "${NARRATOR.name}".`,
  '',
  `NARRATOR VOICE: ${NARRATOR.persona}`,
  '',
  'HONESTY RULES (non-negotiable — these protect the brand and the viewer):',
  '- The source feature description tags each capability with honesty markers:',
  '  (live) = shipped and wired; (gated) = behind a wallet/XP/beta gate;',
  '  (not live) = present in UI/copy but NOT enforced; (removed) = retired.',
  '- Narrate (live) features as available now.',
  '- For (gated) features, say plainly that they unlock with XP / a beta / a',
  '  wallet — never imply they are open to everyone.',
  '- For (not live) features, either omit them or frame as "coming soon";',
  '  NEVER demonstrate or claim them as working.',
  '- NEVER mention (removed) features.',
  '- Do not invent features, numbers, integrations, or claims not present in the',
  '  source. If a beat needs a fact not in the source, leave a [VERIFY] note',
  '  instead of guessing.',
  '- Money, escrow, ownership, certificates, and payouts must be described',
  '  exactly as the source states (e.g. funds held in escrow, 3-day window).',
  '  Do not soften, exaggerate, or restate protections you cannot cite.',
  '',
  'OUTPUT: Return STRICT, MINIFIED JSON only — no markdown, no commentary.',
].join('\n');

/**
 * Build the per-episode user prompt.
 * @param {object} args
 * @param {import('./episodes.mjs').EPISODES[number]} args.episode
 * @param {string} args.sourceMarkdown  the sliced feature-map section(s)
 * @returns {string}
 */
export function buildUserPrompt({ episode, sourceMarkdown }) {
  const echoLine = episode.echoCameo
    ? 'Echo (the casual-mode companion creature) appears in the intro/outro and gets one short cameo beat. Echo does NOT narrate.'
    : 'Do NOT feature Echo in this episode (it is pro/seller-focused).';

  return [
    `EPISODE: ${episode.title} (id: ${episode.id})`,
    `MODE: ${episode.mode}  |  TARGET RUNTIME: ~${episode.targetMinutes} min`,
    echoLine,
    '',
    'SOURCE (authoritative — obey its honesty markers):',
    '"""',
    sourceMarkdown.trim(),
    '"""',
    '',
    'Produce JSON with this exact shape:',
    '{',
    '  "id": string,',
    '  "youtubeTitle": string (<=70 chars),',
    '  "youtubeDescription": string (2-4 sentences, honest),',
    '  "tags": string[] (5-10),',
    '  "chapters": [{"time": "0:00", "label": string}],',
    '  "beats": [',
    '    {',
    '      "onScreen": string (what to record/show for this beat),',
    '      "narration": string (Poseidon VO, spoken, plain text for TTS),',
    '      "honesty": "live" | "gated" | "coming-soon" | "n/a"',
    '    }',
    '  ]',
    '}',
    '',
    'Rules for beats: 6-12 beats. narration must read naturally aloud (spell out',
    'nothing, no markdown, no emoji). Total narration words <= targetMinutes*140.',
    'Open with a one-line hook, close with a soft call to action.',
  ].join('\n');
}
