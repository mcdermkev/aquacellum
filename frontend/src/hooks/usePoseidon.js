import { useState, useCallback, useRef, useEffect } from 'react';
import { db } from '../db';

/**
 * usePoseidon — React hook for interacting with the Poseidon AI gateway.
 * 
 * Handles:
 * - Sending messages to the Edge Function
 * - Maintaining conversation history (persisted to sessionStorage)
 * - Assembling session context (tanks, recent logs, species) from Dexie
 * - Falling back to the local worker when offline or API unavailable
 * - Rate limiting (20 requests/hour as per spec)
 */

const POSEIDON_API_URL = '/api/poseidon';
const MAX_REQUESTS_PER_HOUR = 20;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const SESSION_STORAGE_KEY = 'aquadex_poseidon_conversation';
const SESSION_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes — conversations expire after inactivity

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
  const requestTimestamps = useRef([]);

  // Persist messages whenever they change
  useEffect(() => {
    persistConversation(messages, persistKey);
  }, [messages, persistKey]);

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
              monthlyXp: userProfile.monthlyXp || 0,
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
    requestTimestamps.current = requestTimestamps.current.filter(
      ts => now - ts < RATE_LIMIT_WINDOW_MS
    );
    return requestTimestamps.current.length < MAX_REQUESTS_PER_HOUR;
  }, []);

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

    // Rate limit check
    if (!checkRateLimit()) {
      const rateLimitResponse = {
        id: `pos-${Date.now()}`,
        sender: 'poseidon',
        text: mode === 'pro'
          ? '[RATE LIMIT] Query quota exceeded (20/hr). Retry after cooldown.'
          : '🌊 I need a breather! You\'ve hit the hourly limit (20 questions). Try again in a bit.',
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
      const conversationHistory = messages.slice(-6).map(m => ({
        sender: m.sender,
        text: m.text,
      }));

      const response = await fetch(POSEIDON_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text.trim(),
          mode: mode === 'pro' ? 'pro' : 'casual',
          sessionData,
          conversationHistory,
        }),
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();

      // Track successful request for rate limiting (only if not an error response)
      if (!data.error && !data.offline) {
        requestTimestamps.current.push(Date.now());
      }

      const poseidonMsg = {
        id: `pos-${Date.now()}`,
        sender: 'poseidon',
        text: data.message,
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
          ? '[POSEIDON OFFLINE] Network unreachable. Local command parsing active.'
          : '🌊 I can\'t reach my knowledge base right now. Basic commands still work locally!',
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
  }, [mode, messages, gatherSessionContext, checkRateLimit]);

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
    requestsRemaining: MAX_REQUESTS_PER_HOUR - requestTimestamps.current.filter(
      ts => Date.now() - ts < RATE_LIMIT_WINDOW_MS
    ).length,
  };
}
