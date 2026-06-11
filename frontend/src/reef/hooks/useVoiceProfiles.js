/**
 * useVoiceProfiles — Assigns unique TTS voice configurations to Poseidon and Echo.
 *
 * Poseidon: Deep, authoritative, slower — the all-knowing ocean deity guide.
 * Echo: Bright, youthful, slightly faster — the playful companion fish.
 *
 * Uses Web Speech API's voiceURI system to pick distinct voices per character.
 * Falls back to pitch/rate differentiation when only one voice is available.
 *
 * Users can override voice selections via localStorage:
 *   aquadex_voice_poseidon = { voiceURI, pitch, rate, volume }
 *   aquadex_voice_echo     = { voiceURI, pitch, rate, volume }
 */
import { useState, useEffect, useCallback, useRef } from "react";

// Default voice profiles — tuned for character personality
const DEFAULT_PROFILES = {
  poseidon: {
    voiceURI: null,       // auto-select (prefers deep/male voices)
    pitch: 0.75,          // lower pitch = deep, authoritative
    rate: 0.82,           // measured, deliberate pace
    volume: 0.9,
  },
  echo: {
    voiceURI: null,       // auto-select (prefers bright/lighter voices)
    pitch: 1.3,           // higher pitch = youthful, playful
    rate: 1.05,           // slightly quicker, energetic
    volume: 0.8,
  },
};

// Keywords to prefer when auto-selecting Poseidon's voice
const POSEIDON_VOICE_PREFS = ["daniel", "james", "david", "google uk english male", "microsoft mark", "microsoft david", "male"];
// Keywords to prefer when auto-selecting Echo's voice
const ECHO_VOICE_PREFS = ["samantha", "karen", "zira", "google uk english female", "microsoft zira", "female", "fiona"];

/**
 * Score a voice for a character based on name/keyword matching.
 */
function scoreVoice(voice, prefs) {
  const name = voice.name.toLowerCase();
  let score = 0;
  for (const keyword of prefs) {
    if (name.includes(keyword)) score += 10;
  }
  // Prefer English voices
  if (voice.lang && voice.lang.startsWith("en")) score += 5;
  // Prefer local voices (faster, no network)
  if (voice.localService) score += 2;
  return score;
}

/**
 * Pick the best voice from available list for a character.
 */
function autoSelectVoice(voices, prefs, excludeURI) {
  if (!voices || voices.length === 0) return null;

  // Filter to English voices first
  const english = voices.filter(v => v.lang && v.lang.startsWith("en"));
  const pool = english.length > 0 ? english : voices;

  // Score and sort
  const scored = pool
    .filter(v => v.voiceURI !== excludeURI) // avoid giving both characters the same voice
    .map(v => ({ voice: v, score: scoreVoice(v, prefs) }))
    .sort((a, b) => b.score - a.score);

  return scored.length > 0 ? scored[0].voice : pool[0];
}

/**
 * Load saved profile from localStorage, merging with defaults.
 */
function loadSavedProfile(key) {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(`aquadex_voice_${key}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Save profile to localStorage.
 */
function saveProfile(key, profile) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(`aquadex_voice_${key}`, JSON.stringify(profile));
  } catch {
    // Storage full or unavailable — silently fail
  }
}

export function useVoiceProfiles() {
  const [voices, setVoices] = useState([]);
  const [poseidonProfile, setPoseidonProfile] = useState(DEFAULT_PROFILES.poseidon);
  const [echoProfile, setEchoProfile] = useState(DEFAULT_PROFILES.echo);
  const [ready, setReady] = useState(false);
  const initializedRef = useRef(false);

  // Load available voices (async — browsers load them lazily)
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;

    const loadVoices = () => {
      const available = window.speechSynthesis.getVoices();
      if (available.length > 0) {
        setVoices(available);
      }
    };

    loadVoices();
    window.speechSynthesis.addEventListener("voiceschanged", loadVoices);

    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
    };
  }, []);

  // Once voices are loaded, auto-select or restore saved profiles
  useEffect(() => {
    if (voices.length === 0 || initializedRef.current) return;
    initializedRef.current = true;

    const savedPoseidon = loadSavedProfile("poseidon");
    const savedEcho = loadSavedProfile("echo");

    // Resolve Poseidon voice
    let pVoiceURI = savedPoseidon?.voiceURI || null;
    if (pVoiceURI) {
      // Validate it still exists
      const exists = voices.find(v => v.voiceURI === pVoiceURI);
      if (!exists) pVoiceURI = null;
    }
    if (!pVoiceURI) {
      const auto = autoSelectVoice(voices, POSEIDON_VOICE_PREFS, null);
      pVoiceURI = auto ? auto.voiceURI : null;
    }

    // Resolve Echo voice (exclude Poseidon's choice)
    let eVoiceURI = savedEcho?.voiceURI || null;
    if (eVoiceURI) {
      const exists = voices.find(v => v.voiceURI === eVoiceURI);
      if (!exists) eVoiceURI = null;
    }
    if (!eVoiceURI) {
      const auto = autoSelectVoice(voices, ECHO_VOICE_PREFS, pVoiceURI);
      eVoiceURI = auto ? auto.voiceURI : null;
    }

    const finalPoseidon = {
      voiceURI: pVoiceURI,
      pitch: savedPoseidon?.pitch ?? DEFAULT_PROFILES.poseidon.pitch,
      rate: savedPoseidon?.rate ?? DEFAULT_PROFILES.poseidon.rate,
      volume: savedPoseidon?.volume ?? DEFAULT_PROFILES.poseidon.volume,
    };

    const finalEcho = {
      voiceURI: eVoiceURI,
      pitch: savedEcho?.pitch ?? DEFAULT_PROFILES.echo.pitch,
      rate: savedEcho?.rate ?? DEFAULT_PROFILES.echo.rate,
      volume: savedEcho?.volume ?? DEFAULT_PROFILES.echo.volume,
    };

    setPoseidonProfile(finalPoseidon);
    setEchoProfile(finalEcho);
    setReady(true);
  }, [voices]);

  /**
   * Create a configured SpeechSynthesisUtterance for a character.
   * @param {"poseidon"|"echo"} character
   * @param {string} text
   * @returns {SpeechSynthesisUtterance|null}
   */
  const createUtterance = useCallback((character, text) => {
    if (typeof window === "undefined" || !window.speechSynthesis || !text) return null;

    const profile = character === "echo" ? echoProfile : poseidonProfile;
    const utterance = new SpeechSynthesisUtterance(text);

    // Apply voice if found
    if (profile.voiceURI) {
      const voice = voices.find(v => v.voiceURI === profile.voiceURI);
      if (voice) utterance.voice = voice;
    }

    utterance.pitch = profile.pitch;
    utterance.rate = profile.rate;
    utterance.volume = profile.volume;

    return utterance;
  }, [poseidonProfile, echoProfile, voices]);

  /**
   * Speak text as a specific character.
   * @param {"poseidon"|"echo"} character
   * @param {string} text
   * @param {object} [callbacks] - { onStart, onEnd, onError }
   */
  const speakAs = useCallback((character, text, callbacks = {}) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();

    const utterance = createUtterance(character, text);
    if (!utterance) return;

    if (callbacks.onStart) utterance.onstart = callbacks.onStart;
    if (callbacks.onEnd) utterance.onend = callbacks.onEnd;
    if (callbacks.onError) utterance.onerror = callbacks.onError;

    window.speechSynthesis.speak(utterance);
  }, [createUtterance]);

  /**
   * Update a character's voice profile and persist.
   */
  const updateProfile = useCallback((character, updates) => {
    if (character === "poseidon") {
      setPoseidonProfile(prev => {
        const next = { ...prev, ...updates };
        saveProfile("poseidon", next);
        return next;
      });
    } else {
      setEchoProfile(prev => {
        const next = { ...prev, ...updates };
        saveProfile("echo", next);
        return next;
      });
    }
  }, []);

  /**
   * Reset profiles to defaults (re-triggers auto-select).
   */
  const resetProfiles = useCallback(() => {
    localStorage.removeItem("aquadex_voice_poseidon");
    localStorage.removeItem("aquadex_voice_echo");
    initializedRef.current = false;

    // Re-run auto-select
    const auto1 = autoSelectVoice(voices, POSEIDON_VOICE_PREFS, null);
    const pURI = auto1 ? auto1.voiceURI : null;
    const auto2 = autoSelectVoice(voices, ECHO_VOICE_PREFS, pURI);
    const eURI = auto2 ? auto2.voiceURI : null;

    setPoseidonProfile({ ...DEFAULT_PROFILES.poseidon, voiceURI: pURI });
    setEchoProfile({ ...DEFAULT_PROFILES.echo, voiceURI: eURI });
  }, [voices]);

  return {
    // State
    ready,
    voices,
    poseidonProfile,
    echoProfile,
    // Actions
    speakAs,
    createUtterance,
    updateProfile,
    resetProfiles,
  };
}
