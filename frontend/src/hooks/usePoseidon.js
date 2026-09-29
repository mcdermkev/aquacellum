import { useState, useCallback, useRef, useEffect } from 'react';
import { db } from '../db';
import { answerAppQuestion, looksLikeNavigationQuestion } from '../services/appGuide';
import { POSEIDON_ACTION } from '../utils/poseidonActions';

/**
 * usePoseidon — React hook for interacting with the Poseidon AI gateway.
 * 
 * Handles:
 * - Sending messages to the Edge Function
 * - Maintaining conversation history (persisted to sessionStorage)
 * - Assembling session context (tanks, recent logs, species) from Dexie
 * - Showing an honest offline notice when the API is unreachable (there is no
 *   local reasoning fallback in this hook)
 * - Rate limiting (30 requests/hour, kept in sync with the server gate in api/ai.js)
 */

const POSEIDON_API_URL = '/api/ai?action=poseidon';
// Kept in sync with the server-side gate (api/_lib/aiRateLimit.js POSEIDON_RATE,
// max 30 per hour). This is the client-side pre-check and the number shown in
// the "queries remaining" counter — if it disagrees with the server the counter
// lies about the real budget. Change both.
const MAX_REQUESTS_PER_HOUR = 30;
// Longest question a person can type. The server caps `message` at 4000 because
// other callers wrap species data around theirs (api/_lib/poseidonGateway.js).
export const MAX_QUESTION_CHARS = 1000;
export const HISTORY_TURN_CHARS = 2000;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const SESSION_STORAGE_KEY = 'aquadex_poseidon_conversation';
const RATE_LIMIT_STORAGE_KEY = 'aquadex_poseidon_rate_limit';
const SESSION_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes — conversations expire after inactivity

// Optional Privy access-token getter. When registered (AuthContext, like the
// other services' setSessionTokenGetter), the token rides as a bearer header so
// the server counts a signed-in user by account instead of by shared IP.
let _sessionTokenGetter = null;
export function setPoseidonSessionTokenGetter(getter) {
  _sessionTokenGetter = typeof getter === 'function' ? getter : null;
}

async function authHeaders() {
  if (!_sessionTokenGetter) return {};
  try {
    const token = await _sessionTokenGetter();
    return typeof token === 'string' && token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

/**
 * Read the gateway's reply text. The server now always sends clean text, but a
 * cached or older deployment could still pass cut-off model JSON through as
 * `message` ('{"message": "...' with no end). Show the prose inside it instead
 * of raw JSON.
 *
 * @returns {{ text: string, cut: boolean }}
 */
export function readPoseidonText(message) {
  const msg = typeof message === 'string' ? message : '';
  const m = /^\s*\{\s*"message"\s*:\s*"((?:[^"\\]|\\.)*)("?)/.exec(msg);
  if (!m) return { text: msg, cut: false };
  const body = m[1].replace(/\\u[0-9a-fA-F]{0,3}$|\\$/, '');
  let text;
  try {
    text = JSON.parse(`"${body}"`);
  } catch {
    text = body.replace(/\\n/g, '\n').replace(/\\"/g, '"');
  }
  return { text: text.trim() || msg, cut: m[2] !== '"' };
}

/** Text shown for a reply, with a short note when it was cut short. */
export function poseidonReplyText(data, mode) {
  const { text, cut } = readPoseidonText(data?.message);
  if (!data?.truncated && !cut) return text;
  const note = mode === 'pro'
    ? '[TRUNCATED] Response hit the output limit. Narrow the query.'
    : '(That answer got cut short. Asking a narrower question usually helps.)';
  return `${text}\n\n${note}`;
}

/**
 * Load persisted request timestamps from localStorage for rate limiting.
 */
function loadPersistedRequestTimestamps() {
  try {
    const raw = localStorage.getItem(RATE_LIMIT_STORAGE_KEY);
    if (!raw) return [];
    const timestamps = JSON.parse(raw);
    const now = Date.now();
    // Filter out expired timestamps (older than 1 hour)
    const validTimestamps = timestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);
    // Update localStorage with cleaned timestamps
    if (validTimestamps.length !== timestamps.length) {
      localStorage.setItem(RATE_LIMIT_STORAGE_KEY, JSON.stringify(validTimestamps));
    }
    return validTimestamps;
  } catch {
    return [];
  }
}

/**
 * Persist request timestamps to localStorage for rate limiting.
 */
function persistRequestTimestamps(timestamps) {
  try {
    localStorage.setItem(RATE_LIMIT_STORAGE_KEY, JSON.stringify(timestamps));
  } catch {
    // localStorage full or unavailable — degrade gracefully
  }
}

/**
 * Load persisted conversation from sessionStorage.
 * Returns messages array or null if expired/missing.
 */
function loadPersistedConversation(persistKey) {
  try {
    const raw = sessionStorage.getItem(persistKey || SESSION_STORAGE_KEY);
    if (!raw) return null;
    const { messages: stored, lastActivity } = JSON.parse(raw);
    // Expire stale conversations (30 min inactivity)
    if (Date.now() - lastActivity > SESSION_EXPIRY_MS) {
      sessionStorage.removeItem(persistKey || SESSION_STORAGE_KEY);
      return null;
    }
    return Array.isArray(stored) ? stored : null;
  } catch {
    return null;
  }
}

/**
 * Persist conversation to sessionStorage.
 */
function persistConversation(messages, persistKey) {
  try {
    if (!messages || messages.length === 0) {
      sessionStorage.removeItem(persistKey || SESSION_STORAGE_KEY);
      return;
    }
    sessionStorage.setItem(persistKey || SESSION_STORAGE_KEY, JSON.stringify({
      messages,
      lastActivity: Date.now(),
    }));
  } catch {
    // sessionStorage full or unavailable — degrade gracefully
  }
}

export function usePoseidon({ tankId, mode = 'casual', walletAddress, persistKey } = {}) {
  const [messages, setMessages] = useState(() => {
    // Restore persisted conversation on mount
    return loadPersistedConversation(persistKey) || [];
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const requestTimestamps = useRef(loadPersistedRequestTimestamps());
  const [requestsRemaining, setRequestsRemaining] = useState(() => {
    const validTimestamps = loadPersistedRequestTimestamps().filter(
      ts => Date.now() - ts < RATE_LIMIT_WINDOW_MS
    );
    return MAX_REQUESTS_PER_HOUR - validTimestamps.length;
  });

  // Update requestsRemaining whenever timestamps change
  const updateRequestsRemaining = useCallback(() => {
    const now = Date.now();
    const validTimestamps = requestTimestamps.current.filter(
      ts => now - ts < RATE_LIMIT_WINDOW_MS
    );
    setRequestsRemaining(MAX_REQUESTS_PER_HOUR - validTimestamps.length);
  }, []);

  // Persist messages whenever they change
  useEffect(() => {
    persistConversation(messages, persistKey);
  }, [messages, persistKey]);

  // Persist request timestamps whenever they change
  useEffect(() => {
    persistRequestTimestamps(requestTimestamps.current);
    updateRequestsRemaining();
  }, [updateRequestsRemaining]);

  /**
   * Gather session context from Dexie for grounding Poseidon's responses.
   */
  const gatherSessionContext = useCallback(async () => {
    const context = { tanks: [], recentLogs: [], speciesContext: [], tankSpeciesCodes: [], userStats: null };

    try {
      // Get user's XP/loyalty stats for accurate reporting
      if (walletAddress) {
        try {
          let userProfile = await db.userProfile.get(walletAddress);
          if (!userProfile) {
            userProfile = await db.userProfile.get(walletAddress.toLowerCase());
          }
          if (userProfile) {
            context.userStats = {
              totalXp: userProfile.totalXp || 0,
              currentTier: userProfile.currentTier || "Shallow",
              streakDays: userProfile.streakDays || 0,
              // monthlyXp removed: the local counter was unreliable (never reset).
              // "This month" is now server-derived (get_monthly_xp) and dormant
              // until rewards activate, so it's intentionally not narrated yet.
            };
          }
        } catch (err) {
          console.warn('[usePoseidon] Error reading user stats:', err);
        }
      }

      // Get user's tanks (limit 5). `active` is a boolean; IndexedDB can't index
      // booleans, so `.where('active').equals(1)` matched nothing. Filter in JS.
      const tanks = await db.tanks.filter((t) => t.active !== false).limit(5).toArray();
      context.tanks = tanks.map(t => ({
        id: t.id,
        name: t.name,
        volumeLiters: t.volumeLiters,
        tankType: t.tankType,
        logs: t.logs ? t.logs.slice(-1) : [], // Latest reading only
        specimens: t.specimens || []
      }));

      // Get recent action logs (last 5)
      const logs = await db.actionLogs.orderBy('timestamp').reverse().limit(5).toArray();
      context.recentLogs = logs;

      // Get species relevant to the active tank
      if (tankId) {
        const activeTank = tanks.find(t => t.id === tankId);
        if (activeTank && activeTank.specimens) {
          const specCodes = activeTank.specimens
            .map(s => s.speciesId || s.specCode)
            .filter(Boolean);
          context.tankSpeciesCodes = specCodes;
          if (specCodes.length > 0) {
            const species = await db.species
              .where('specCode')
              .anyOf(specCodes)
              .toArray();
            context.speciesContext = species;
          }
        }
      }
    } catch (err) {
      console.warn('[usePoseidon] Error gathering session context:', err);
    }

    return context;
  }, [tankId, walletAddress]);

  /**
   * Check rate limit — returns true if request is allowed.
   */
  const checkRateLimit = useCallback(() => {
    const now = Date.now();
    // Prune old timestamps
    const validTimestamps = requestTimestamps.current.filter(
      ts => now - ts < RATE_LIMIT_WINDOW_MS
    );
    requestTimestamps.current = validTimestamps;
    // Persist updated timestamps
    persistRequestTimestamps(requestTimestamps.current);
    updateRequestsRemaining();
    return requestTimestamps.current.length < MAX_REQUESTS_PER_HOUR;
  }, [updateRequestsRemaining]);

  /**
   * Send a message to Poseidon.
   * Returns the parsed response or null on failure.
   */
  const sendMessage = useCallback(async (text) => {
    if (!text || typeof text !== 'string' || !text.trim()) return null;

    // Check if Poseidon is disabled in settings
    if (localStorage.getItem('aquadex_poseidon_enabled') === 'false') {
      const disabledMsg = {
        id: `pos-${Date.now()}`,
        sender: 'poseidon',
        text: mode === 'pro'
          ? '[POSEIDON DISABLED] Intelligence layer deactivated via settings.'
          : '🌊 I\'m turned off right now. You can re-enable me in Settings.',
        timestamp: Date.now(),
        intent: 'disabled',
        action: { type: 'NONE', payload: {} },
      };
      setMessages(prev => [...prev, { id: `user-${Date.now()}`, sender: 'user', text: text.trim(), timestamp: Date.now() }, disabledMsg]);
      return disabledMsg;
    }

    // ─── Local app-guide answer, before spending anything ────────────────────
    // "Where do I log a water test?" is answerable from the app's own capability
    // manifest (services/appGuide.js). Doing it here means it costs no request
    // against the 30/hr budget, returns instantly, and — unlike the model path —
    // still works with no network, where the only alternative is a canned "I can't
    // reach my knowledge base" sentence.
    //
    // Deliberately narrow: it requires BOTH a navigational cue and a confident
    // manifest match, so husbandry questions still reach the model.
    if (looksLikeNavigationQuestion(text)) {
      const guided = answerAppQuestion(text, { casual: mode !== 'pro' });
      if (guided) {
        const userMsgLocal = {
          id: `user-${Date.now()}`,
          sender: 'user',
          text: text.trim(),
          timestamp: Date.now(),
        };
        const guideMsg = {
          id: `pos-${Date.now()}`,
          sender: 'poseidon',
          text: guided.answer,
          timestamp: Date.now(),
          intent: 'app_guide',
          // A retired destination has no navTarget, so no "take me there" is
          // offered for somewhere that no longer exists.
          action: guided.navTarget
            ? { type: POSEIDON_ACTION.NAVIGATE, payload: { guideId: guided.entry.id } }
            : { type: POSEIDON_ACTION.NONE, payload: {} },
        };
        setMessages((prev) => [...prev, userMsgLocal, guideMsg]);
        return guideMsg;
      }
    }

    // Length check (the server enforces its own cap; this keeps the budget intact
    // and says why instead of failing the request).
    if (text.trim().length > MAX_QUESTION_CHARS) {
      const tooLong = {
        id: `pos-${Date.now()}`,
        sender: 'poseidon',
        text: mode === 'pro'
          ? `[REJECTED] Query exceeds ${MAX_QUESTION_CHARS} characters. Shorten and retry.`
          : `That question is a bit long for me. Please keep it under ${MAX_QUESTION_CHARS} characters.`,
        timestamp: Date.now(),
        intent: 'too_long',
        action: { type: 'NONE', payload: {} },
      };
      setMessages(prev => [...prev, tooLong]);
      return tooLong;
    }

    // Rate limit check
    if (!checkRateLimit()) {
      const rateLimitResponse = {
        id: `pos-${Date.now()}`,
        sender: 'poseidon',
        text: mode === 'pro'
          ? `[RATE LIMIT] Query quota exceeded (${MAX_REQUESTS_PER_HOUR}/hr). Retry after cooldown.`
          : `🌊 I need a breather. You've hit the hourly limit (${MAX_REQUESTS_PER_HOUR} questions). Try again in a bit.`,
        timestamp: Date.now(),
        intent: 'rate_limited',
        action: { type: 'NONE', payload: {} },
      };
      setMessages(prev => [...prev, rateLimitResponse]);
      return rateLimitResponse;
    }

    // Add user message to state
    const userMsg = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: text.trim(),
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);

    try {
      // Gather context from local DB
      const sessionData = await gatherSessionContext();

      // Build conversation history for multi-turn (last 6 messages)
      // Each turn trimmed to what the server forwards anyway (2000 chars,
      // api/_lib/poseidonGateway.js HISTORY_TURN_CHARS).
      const conversationHistory = messages.slice(-6).map(m => ({
        sender: m.sender,
        text: String(m.text || '').slice(0, HISTORY_TURN_CHARS),
      }));

      const response = await fetch(POSEIDON_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({
          message: text.trim(),
          mode: mode === 'pro' ? 'pro' : 'casual',
          sessionData,
          conversationHistory,
        }),
      });

      const data = await response.json().catch(() => null);

      // 429/413/400 carry a readable `message` in the normal reply shape. Show
      // it rather than the generic offline notice, and keep the connection
      // marked online: the gateway answered.
      if (!response.ok) {
        if (!data || typeof data.message !== 'string') {
          throw new Error(`API returned ${response.status}`);
        }
        if (response.status === 429 || data.rateLimited) {
          // The server's shared count is the real budget; show it as spent.
          setRequestsRemaining(0);
        }
        const noticeMsg = {
          id: `pos-${Date.now()}`,
          sender: 'poseidon',
          text: data.message,
          timestamp: Date.now(),
          intent: response.status === 429 ? 'rate_limited' : 'fallback_unknown',
          action: { type: 'NONE', payload: {} },
          echoReaction: data.echoReaction,
        };
        setMessages(prev => [...prev, noticeMsg]);
        return noticeMsg;
      }

      if (!data || typeof data.message !== 'string') {
        throw new Error('Unreadable response');
      }

      // Track successful request for rate limiting (only if not an error response)
      if (!data.error && !data.offline) {
        requestTimestamps.current.push(Date.now());
        persistRequestTimestamps(requestTimestamps.current);
        updateRequestsRemaining();
      }

      const poseidonMsg = {
        id: `pos-${Date.now()}`,
        sender: 'poseidon',
        text: poseidonReplyText(data, mode),
        truncated: !!data.truncated,
        timestamp: Date.now(),
        intent: data.intent,
        action: data.action,
        echoReaction: data.echoReaction,
        confidence: data.confidence,
        sources: data.sources,
      };

      setMessages(prev => [...prev, poseidonMsg]);
      setIsOnline(!data.offline && !data.error);

      return poseidonMsg;

    } catch (err) {
      console.warn('[usePoseidon] API call failed, returning offline fallback:', err);
      setIsOnline(false);

      const fallbackMsg = {
        id: `pos-${Date.now()}`,
        sender: 'poseidon',
        text: mode === 'pro'
          ? '[POSEIDON OFFLINE] Network unreachable. Retry when your connection is back.'
          : '🌊 I can\'t reach my knowledge base right now — check your connection and try again in a moment.',
        timestamp: Date.now(),
        intent: 'fallback_unknown',
        action: { type: 'NONE', payload: {} },
        echoReaction: { mood: 'confused', glowActive: false, glowColor: '', swimSpeedMultiplier: 0.8, durationMs: 2000 },
      };

      setMessages(prev => [...prev, fallbackMsg]);
      return fallbackMsg;
    } finally {
      setIsLoading(false);
    }
  }, [mode, messages, gatherSessionContext, checkRateLimit, updateRequestsRemaining]);

  /**
   * Clear conversation history (also clears persistence).
   */
  const clearConversation = useCallback(() => {
    setMessages([]);
    sessionStorage.removeItem(persistKey || SESSION_STORAGE_KEY);
  }, [persistKey]);

  /**
   * Initialize with a greeting message.
   */
  const initGreeting = useCallback(() => {
    const greeting = {
      id: 'init',
      sender: 'poseidon',
      text: mode === 'pro'
        ? '[POSEIDON CORE ONLINE] Ecological intelligence layer active. Ready for telemetry inputs, compatibility queries, or system initialization.'
        : '👋 Hey there! I\'m Poseidon, your freshwater fish expert. Ask me about species compatibility, water parameters, tank setup, breeding tips, or just log your daily care tasks.',
      timestamp: Date.now(),
      intent: 'init',
    };
    setMessages([greeting]);
  }, [mode]);

  return {
    messages,
    isLoading,
    isOnline,
    sendMessage,
    clearConversation,
    initGreeting,
    requestsRemaining,
  };
}
