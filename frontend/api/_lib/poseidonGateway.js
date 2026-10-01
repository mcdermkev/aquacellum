/**
 * poseidonGateway.js — the pure parts of the Poseidon chat gateway (api/ai.js
 * handlePoseidon): request size caps, model call settings, and turning whatever
 * the model sent back into one well-formed response body.
 *
 * Kept free of network and env access so it can be unit tested directly
 * (api/ai.js imports `ethers`, which cannot load in the test environment).
 *
 * ── Why the normalizer exists ────────────────────────────────────────────────
 * gemini-2.5-flash "thinks" before it answers, and its thinking tokens count
 * against maxOutputTokens. With the old 1024-token cap a long think left too
 * little room for the JSON answer, the reply stopped mid-string
 * (finishReason MAX_TOKENS), JSON.parse failed, and the gateway passed the raw
 * text through as `message`. Users saw `{"message": "...` with no end.
 *
 * Now: thinking has an explicit budget, the output cap is larger, a MAX_TOKENS
 * reply is retried once with thinking off, and anything that still comes back
 * cut short is reduced to its readable message text with `truncated: true`.
 * Raw model JSON never reaches a client.
 */

// ─── Request limits ──────────────────────────────────────────────────────────

export const POSEIDON_LIMITS = Object.freeze({
  /**
   * Max characters in `message`. The chat UIs cap a typed question at 1000
   * (QUESTION_CHARS), but two in-app callers send a prompt with species data
   * wrapped around the question: reef narration (src/reef/hooks/useNarration.js,
   * up to ~3,300 chars for the most detailed catalog species) and spawn
   * narration (src/utils/spawnNarration.js). 4000 keeps those working while
   * still bounding the cost of one request.
   */
  MESSAGE_CHARS: 4000,
  /** What the chat UIs allow a person to type. Mirrored in usePoseidon.js and poseidon.html. */
  QUESTION_CHARS: 1000,
  /** Clients send the last 6 turns. Far more than that is not a real client. */
  HISTORY_MAX_TURNS: 20,
  /**
   * Hard cap on the total history text a request may carry. Generous on purpose:
   * the chat clients trim each turn to HISTORY_TURN_CHARS before sending, so a
   * real client stays near 6 x 2000, and older clients that send full replies
   * are not refused for a few long answers. Only the trimmed turns reach the model.
   */
  HISTORY_TOTAL_CHARS: 60000,
  /** Turns actually forwarded to the model, and the per-turn trim. */
  HISTORY_TURNS_USED: 6,
  HISTORY_TURN_CHARS: 2000,
  /** Hard cap on the serialized sessionData object. */
  SESSION_DATA_BYTES: 200000,
});

function fail(status, code, error) {
  return { ok: false, status, code, error };
}

/**
 * Validate and trim the conversational request body.
 *
 * Returns `{ ok: true, message, history, sessionData }` with history already
 * reduced to what the model will see, or `{ ok: false, status, code, error }`
 * (400 for a malformed field, 413 for an oversized one).
 */
export function validatePoseidonRequest(body, limits = POSEIDON_LIMITS) {
  const { message, conversationHistory, sessionData } = body || {};

  if (typeof message !== 'string' || !message.trim()) {
    return fail(400, 'message_required', 'Missing required field: message');
  }
  const trimmed = message.trim();
  if (trimmed.length > limits.MESSAGE_CHARS) {
    return fail(413, 'message_too_long', `Message is too long (max ${limits.MESSAGE_CHARS} characters).`);
  }

  let history = [];
  if (conversationHistory != null) {
    if (!Array.isArray(conversationHistory)) {
      return fail(400, 'history_invalid', 'conversationHistory must be an array.');
    }
    if (conversationHistory.length > limits.HISTORY_MAX_TURNS) {
      return fail(413, 'history_too_long', `conversationHistory has too many turns (max ${limits.HISTORY_MAX_TURNS}).`);
    }
    let total = 0;
    for (const turn of conversationHistory) {
      if (turn && typeof turn.text === 'string') total += turn.text.length;
    }
    if (total > limits.HISTORY_TOTAL_CHARS) {
      return fail(413, 'history_too_large', 'conversationHistory is too large.');
    }
    history = conversationHistory
      .filter((t) => t && (t.sender === 'user' || t.sender === 'poseidon') && typeof t.text === 'string' && t.text.trim())
      .slice(-limits.HISTORY_TURNS_USED)
      .map((t) => ({ sender: t.sender, text: t.text.slice(0, limits.HISTORY_TURN_CHARS) }));
  }

  let session = null;
  if (sessionData != null) {
    if (typeof sessionData !== 'object' || Array.isArray(sessionData)) {
      return fail(400, 'session_invalid', 'sessionData must be an object.');
    }
    let size;
    try {
      size = JSON.stringify(sessionData).length;
    } catch {
      return fail(400, 'session_invalid', 'sessionData is not serializable.');
    }
    if (size > limits.SESSION_DATA_BYTES) {
      return fail(413, 'session_too_large', 'sessionData is too large.');
    }
    session = sessionData;
  }

  return { ok: true, message: trimmed, history, sessionData: session, compatCard: sanitizeCompatCard(body?.compatCard) };
}

// ─── The compatibility card shown with the answer ───────────────────────────
//
// The chat (EchoChat, poseidon.html) works out a compatibility card from the
// catalog (src/services/echoMatch.js) before it asks, and sends it along. The
// model is told what the card says so the sentence agrees with it: on
// 2026-10-01 it called rams and cardinals "wonderful tankmates" directly above
// a card that said "Works with care".
//
// It comes from the client, so it is treated like the message: untrusted
// text, cut to size, verdicts limited to the four the engine produces.

const CARD_VERDICTS = Object.freeze({
  good: 'Good match',
  care: 'Works with care',
  bad: 'Not a good match',
  unknown: 'Not enough data',
});
const CARD_STATUS_WORD = Object.freeze({ good: 'OK', care: 'Watch', bad: 'Problem', unknown: 'Not recorded' });

const cardText = (v, max) => (typeof v === 'string' ? v.replace(/[\r\n]+/g, ' ').trim().slice(0, max) : '');

/** A card from the request body in a known shape, or null. */
export function sanitizeCompatCard(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const verdict = typeof raw.verdict === 'string' && CARD_VERDICTS[raw.verdict] ? raw.verdict : null;
  if (!verdict) return null;
  const rows = (Array.isArray(raw.rows) ? raw.rows : [])
    .slice(0, 10)
    .map((r) => ({
      status: CARD_STATUS_WORD[r?.status] ? r.status : 'unknown',
      label: cardText(r?.label, 160),
      detail: cardText(r?.detail, 300),
    }))
    .filter((r) => r.label);
  return { verdict, title: cardText(raw.title, 200), rows };
}

/** The prompt section for a card, or '' when there is none. */
export function compatCardContext(card) {
  if (!card) return '';
  const lines = [
    '## COMPATIBILITY CARD SHOWN WITH YOUR ANSWER',
    `The app shows the user this card under your reply, worked out from the species guide. Verdict: "${CARD_VERDICTS[card.verdict]}"${card.title ? ` for ${card.title}` : ''}.`,
    ...card.rows.map((r) => `- [${CARD_STATUS_WORD[r.status]}] ${r.label}${r.detail ? `: ${r.detail}` : ''}`),
    'Your answer must agree with this verdict. Do not call the match better or worse than the card does. Give the verdict in plain words and the main reason in a sentence or two; the card already lists the numbers, so do not repeat them all.',
  ];
  return lines.join('\n');
}

// ─── House style for replies ────────────────────────────────────────────────

const PICTO = /\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic}\uFE0F?)*/gu;

/**
 * Echo's replies follow the same copy rules as the rest of the app: no
 * exclamation points, no em dashes, and at most one emoji. The prompt asks for
 * this; this is the backstop. En dashes stay: "24–28°C" is a range.
 */
export function plainReplyStyle(text) {
  if (typeof text !== 'string' || !text) return text || '';
  let seenEmoji = false;
  return text
    .replace(PICTO, (m) => {
      if (seenEmoji) return '';
      seenEmoji = true;
      return m;
    })
    .replace(/\s*—\s*/g, ', ')
    .replace(/!+(?=[\s"')\]]|$)/g, '.')
    .replace(/\.{2,}(?!\.)/g, '.')
    .replace(/ {2,}/g, ' ')
    .replace(/ +([.,])/g, '$1')
    .trim();
}

// ─── Model call settings ─────────────────────────────────────────────────────

/**
 * Two attempts. The first leaves a modest thinking budget for compatibility and
 * care reasoning; the retry (only after a MAX_TOKENS finish) turns thinking off
 * and gives the whole budget to the answer.
 *
 * Thinking tokens count against maxOutputTokens on 2.5 models, so the first
 * attempt's answer room is roughly 3072 - 512 = 2560 tokens, which is far more
 * than a "be concise" chat reply needs.
 */
export const POSEIDON_ATTEMPTS = Object.freeze([
  Object.freeze({ maxOutputTokens: 3072, thinkingBudget: 512 }),
  Object.freeze({ maxOutputTokens: 4096, thinkingBudget: 0 }),
]);

/**
 * thinkingConfig for a model, or null when it should be left out.
 *
 * Only the 2.5 Flash line takes a numeric budget with 0 meaning "off":
 * 2.5 Pro rejects 0, and the 3.x line uses thinkingLevel. Sending a budget the
 * model does not accept is a 400, so anything else gets no thinkingConfig and
 * relies on the larger output cap.
 */
export function thinkingConfigFor(model, attempt) {
  const name = String(model || '');
  if (/^gemini-2\.5-flash-lite/.test(name)) {
    // Flash-Lite does not think by default and its non-zero minimum is 512.
    // Keep it off; chat does not need it.
    return { thinkingBudget: 0 };
  }
  if (/^gemini-2\.5-flash/.test(name)) {
    return { thinkingBudget: attempt.thinkingBudget };
  }
  // The 3.x Flash line thinks by default (375-1500 hidden tokens, 5-15 s on
  // chat in the 2026-09-30 probe). `low` keeps the quality that made us pick
  // it and brings answers back to 2-4 s. Flash-Lite does not think, so it gets
  // nothing.
  if (/^gemini-3(\.\d+)?-(flash|pro)(?!-lite)/.test(name)) {
    return { thinkingLevel: 'low' };
  }
  return null;
}

/**
 * Response schema. `propertyOrdering` puts `message` first so a cut-off reply
 * still carries it.
 *
 * No free number fields. The 3.x models occasionally degenerate while writing
 * a float ("1.1000000000000001" followed by thousands of zeros) and run to the
 * output cap: 1 in 4 chat replies on gemini-3.7-flash in the 2026-09-30 probe.
 * Confidence is a word and Echo's reaction is a mood; the gateway turns both
 * into the numbers clients already read (`shapePoseidonReply`, `cleanEcho`).
 */
export const CONFIDENCE_LEVELS = Object.freeze({ low: 0.35, medium: 0.65, high: 0.9 });
export const POSEIDON_RESPONSE_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    message: { type: 'string' },
    intent: { type: 'string' },
    action: {
      type: 'object',
      properties: {
        type: { type: 'string' },
        payload: { type: 'object' },
      },
      required: ['type'],
    },
    confidence: { type: 'string', enum: Object.keys(CONFIDENCE_LEVELS) },
    echoReaction: {
      type: 'object',
      properties: {
        mood: { type: 'string', enum: ['happy', 'excited', 'calm', 'confused', 'alert'] },
      },
    },
    sources: { type: 'array', items: { type: 'string' } },
  },
  required: ['message', 'intent', 'action'],
  propertyOrdering: ['message', 'intent', 'action', 'confidence', 'echoReaction', 'sources'],
});

/** generationConfig for one attempt against one model. */
export function buildPoseidonGenerationConfig(model, attemptIndex = 0) {
  const attempt = POSEIDON_ATTEMPTS[Math.min(attemptIndex, POSEIDON_ATTEMPTS.length - 1)];
  const config = {
    responseMimeType: 'application/json',
    responseSchema: POSEIDON_RESPONSE_SCHEMA,
    temperature: 0.7,
    maxOutputTokens: attempt.maxOutputTokens,
  };
  const thinking = thinkingConfigFor(model, attempt);
  if (thinking) config.thinkingConfig = thinking;
  return config;
}

// ─── Reading the model result ────────────────────────────────────────────────

const BLOCKED_FINISH = new Set(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY']);

/**
 * Pull the answer text and finish reason out of a generateContent result.
 * Joins every non-thought text part (a reply can be split across parts, and
 * thought summaries, if ever enabled, must not be shown as the answer).
 */
export function extractModelText(result) {
  const candidate = result?.candidates?.[0];
  const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
  const text = parts
    .filter((p) => p && typeof p.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('');
  const finishReason = candidate?.finishReason || null;
  const blocked = !!result?.promptFeedback?.blockReason || BLOCKED_FINISH.has(finishReason);
  return { text, finishReason, blocked };
}

/** Decode a JSON string body (no surrounding quotes), tolerating a cut-off escape at the end. */
function decodeJsonStringBody(body) {
  const safe = body.replace(/\\u[0-9a-fA-F]{0,3}$/, '').replace(/(^|[^\\])(\\\\)*\\$/, (m) => m.slice(0, -1));
  try {
    return JSON.parse(`"${safe}"`);
  } catch {
    return safe
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
}

/**
 * Find the `"message"` string in JSON that may be cut off.
 *
 * @returns {{ text: string, complete: boolean } | null} `complete` is false when
 *   the string itself ended before its closing quote.
 */
export function salvageMessageFromJson(raw) {
  if (typeof raw !== 'string') return null;
  const start = /"message"\s*:\s*"/.exec(raw);
  if (!start) return null;
  let i = start.index + start[0].length;
  const bodyStart = i;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === '\\') { i += 2; continue; }
    if (ch === '"') {
      return { text: decodeJsonStringBody(raw.slice(bodyStart, i)), complete: true };
    }
    i += 1;
  }
  return { text: decodeJsonStringBody(raw.slice(bodyStart)), complete: false };
}

/** Cut a partial answer back to the last whole word and mark the cut. */
export function tidyPartial(text) {
  const t = String(text || '').trimEnd();
  if (!t) return '';
  // Stopped right after a sentence: nothing to cut.
  if (/[.!?)]$/.test(t)) return t;
  const lastSpace = t.search(/\s\S*$/);
  const cut = lastSpace > t.length * 0.6 ? t.slice(0, lastSpace).trimEnd() : t;
  return `${cut.replace(/[,;:\-–(]+$/, '')}…`;
}

const DEFAULT_ECHO = Object.freeze({ mood: 'calm', glowActive: false, glowColor: '', swimSpeedMultiplier: 1.0, durationMs: 1500 });
const ECHO_MOODS = new Set(['happy', 'excited', 'calm', 'confused', 'alert']);

// The model now sends only a mood; these give Echo's reaction its size.
const MOOD_MOTION = Object.freeze({
  happy: { swimSpeedMultiplier: 1.25, durationMs: 1800 },
  excited: { swimSpeedMultiplier: 1.5, durationMs: 2200 },
  calm: { swimSpeedMultiplier: 1.0, durationMs: 1500 },
  confused: { swimSpeedMultiplier: 0.8, durationMs: 1800 },
  alert: { swimSpeedMultiplier: 1.3, durationMs: 2000 },
});

function cleanEcho(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_ECHO };
  const mood = ECHO_MOODS.has(raw.mood) ? raw.mood : 'calm';
  const motion = MOOD_MOTION[mood];
  const speed = raw.swimSpeedMultiplier == null ? motion.swimSpeedMultiplier : Number(raw.swimSpeedMultiplier);
  const duration = raw.durationMs == null ? motion.durationMs : Number(raw.durationMs);
  return {
    mood,
    glowActive: raw.glowActive === true,
    glowColor: typeof raw.glowColor === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(raw.glowColor) ? raw.glowColor : '',
    swimSpeedMultiplier: Number.isFinite(speed) ? Math.min(3, Math.max(0.1, speed)) : 1.0,
    durationMs: Number.isFinite(duration) ? Math.min(10000, Math.max(0, Math.round(duration))) : 1500,
  };
}

function cleanAction(raw) {
  if (!raw || typeof raw !== 'object') return { type: 'NONE', payload: {} };
  const type = typeof raw.type === 'string' && /^[A-Z_]{2,40}$/.test(raw.type.trim()) ? raw.type.trim() : 'NONE';
  const payload = raw.payload && typeof raw.payload === 'object' && !Array.isArray(raw.payload) ? raw.payload : {};
  return { type, payload };
}

/**
 * Build the one response shape every client reads:
 * `{ message, intent, action: {type, payload}, echoReaction, confidence, sources, truncated }`.
 */
export function shapePoseidonReply(fields, { truncated = false } = {}) {
  // The schema asks for a word; older replies (and gateway notices) send a number.
  const rawConfidence = fields?.confidence;
  const confidence = typeof rawConfidence === 'string' && CONFIDENCE_LEVELS[rawConfidence] != null
    ? CONFIDENCE_LEVELS[rawConfidence]
    : Number(rawConfidence);
  return {
    message: plainReplyStyle(String(fields?.message || '')),
    intent: typeof fields?.intent === 'string' && fields.intent.length <= 60 ? fields.intent : 'general_knowledge',
    action: truncated ? { type: 'NONE', payload: {} } : cleanAction(fields?.action),
    echoReaction: cleanEcho(fields?.echoReaction),
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.5,
    sources: Array.isArray(fields?.sources)
      ? fields.sources.filter((s) => typeof s === 'string').slice(0, 10).map((s) => s.slice(0, 200))
      : [],
    truncated: !!truncated,
  };
}

function stripFences(text) {
  return text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
}

/**
 * Turn raw model text into a response body, or null when nothing readable is
 * in it (the caller then retries or answers with its error fallback).
 *
 * A reply whose message was cut off comes back with `truncated: true` and
 * `action: NONE`, because an action built from half an answer should not be
 * offered to the user.
 */
export function normalizePoseidonReply(rawText, { finishReason = null } = {}) {
  if (typeof rawText !== 'string' || !rawText.trim()) return null;
  const text = stripFences(rawText).trim();

  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && typeof parsed.message === 'string' && parsed.message.trim()) {
      return shapePoseidonReply({ ...parsed, message: parsed.message.trim() });
    }
    return null;
  } catch {
    // Fall through: not complete JSON.
  }

  const salvaged = salvageMessageFromJson(text);
  if (salvaged) {
    const body = salvaged.text.trim();
    if (!body) return null;
    if (salvaged.complete) {
      // The message closed; only trailing fields were lost.
      return shapePoseidonReply({ message: body });
    }
    return shapePoseidonReply({ message: tidyPartial(body) }, { truncated: true });
  }

  // JSON-shaped but no message in it: nothing safe to show.
  if (text.startsWith('{') || text.startsWith('[')) return null;

  // Plain prose despite the JSON mime type. Readable, so use it.
  if (finishReason === 'MAX_TOKENS') {
    return shapePoseidonReply({ message: tidyPartial(text) }, { truncated: true });
  }
  return shapePoseidonReply({ message: text });
}

/**
 * Read one generateContent result into an outcome:
 *   { kind: 'ok', reply, finishReason }      — a usable reply (may be truncated)
 *   { kind: 'blocked', finishReason }        — safety or policy stop
 *   { kind: 'unusable', finishReason }       — nothing readable
 */
export function interpretPoseidonResult(result) {
  const { text, finishReason, blocked } = extractModelText(result);
  if (blocked && !text.trim()) return { kind: 'blocked', finishReason };
  const reply = normalizePoseidonReply(text, { finishReason });
  if (!reply) return { kind: blocked ? 'blocked' : 'unusable', finishReason };
  return { kind: 'ok', reply, finishReason };
}

/** Whether an outcome warrants the one retry with a larger budget. */
export function shouldRetryPoseidon(outcome) {
  if (!outcome) return false;
  if (outcome.kind === 'ok') return outcome.reply.truncated === true;
  return outcome.kind === 'unusable' && outcome.finishReason === 'MAX_TOKENS';
}

/**
 * Pick between the first outcome and the retry. A complete reply wins; between
 * two partial ones, the longer message wins. Returns null when neither is usable.
 */
export function pickPoseidonOutcome(first, retry) {
  const usable = [first, retry].filter((o) => o && o.kind === 'ok');
  const complete = usable.filter((o) => !o.reply.truncated);
  if (complete.length) return complete[complete.length - 1];
  if (usable.length) {
    return usable.reduce((a, b) => (b.reply.message.length > a.reply.message.length ? b : a));
  }
  const blocked = [first, retry].find((o) => o && o.kind === 'blocked');
  return blocked || null;
}
