/**
 * useNarration — Voice input (STT) + AI response (Poseidon) + voice output (TTS)
 *
 * Flow:
 * 1. User presses/holds mic button or says something via STT
 * 2. Transcribed text + species context → /api/poseidon
 * 3. Response text → TTS spoken aloud + displayed in narration panel
 */
import { useState, useCallback, useRef, useEffect } from "react";

/**
 * @param {object} species - Currently inspected species (full record from fishbase_master)
 * @param {string} mode - "casual" or "pro"
 */
export function useNarration(species, mode) {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [aiResponse, setAiResponse] = useState("");
  const [error, setError] = useState(null);

  const recognitionRef = useRef(null);
  const abortRef = useRef(null);

  // Check browser support
  const sttSupported = typeof window !== "undefined" &&
    (window.SpeechRecognition || window.webkitSpeechRecognition);
  const ttsSupported = typeof window !== "undefined" && window.speechSynthesis;

  // Initialize SpeechRecognition
  useEffect(() => {
    if (!sttSupported) return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      const text = event.results[0]?.[0]?.transcript || "";
      setTranscript(text);
      setIsListening(false);
      if (text.trim()) {
        askPoseidon(text.trim());
      }
    };

    recognition.onerror = (event) => {
      console.warn("[useNarration] STT error:", event.error);
      setIsListening(false);
      if (event.error !== "no-speech") {
        setError(`Voice recognition error: ${event.error}`);
      }
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;

    return () => {
      recognition.abort();
    };
  }, [sttSupported]);

  // Start listening
  const startListening = useCallback(() => {
    if (!recognitionRef.current) return;
    setError(null);
    setTranscript("");
    setIsListening(true);
    try {
      recognitionRef.current.start();
    } catch (e) {
      // Already started
      setIsListening(false);
    }
  }, []);

  // Stop listening
  const stopListening = useCallback(() => {
    if (!recognitionRef.current) return;
    recognitionRef.current.stop();
    setIsListening(false);
  }, []);

  // Speak text via TTS
  const speak = useCallback((text) => {
    if (!ttsSupported || !text) return;
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.9;
    utterance.pitch = 1.0;
    utterance.volume = 0.85;
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    window.speechSynthesis.speak(utterance);
  }, [ttsSupported]);

  // Stop speaking
  const stopSpeaking = useCallback(() => {
    if (ttsSupported) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    }
  }, [ttsSupported]);

  // Ask Poseidon with species context
  const askPoseidon = useCallback(async (question) => {
    if (!species || !question) return;

    setIsThinking(true);
    setError(null);
    setAiResponse("");

    // Abort any prior request
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const contextMessage = `[IMMERSIVE REEF CONTEXT] The user is standing in a virtual underwater reef, looking at a ${species.commonName} (${species.scientificName}). They asked: "${question}"

Species data for context:
- Family: ${species.family || "unknown"}
- Max length: ${species.maxLengthCm || "?"} cm
- Ecology: ${species.ecology?.biotope || species.ecology?.comments || "no data"}
- Diet: ${species.diet?.feedingPlaybook || species.diet?.fooditems || "no data"}
- Social: ${species.ecology?.socialBehavior || "no data"}
- Breeding: ${species.reproduction?.comments || species.reproduction?.spawningTrait || "no data"}
- Difficulty: ${species.tankMetrics?.difficulty || "unknown"}

Answer naturally as if you're a knowledgeable guide narrating their experience in the reef. Keep it conversational and vivid.`;

      const res = await fetch("/api/poseidon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: contextMessage,
          mode: mode,
          sessionData: {},
          conversationHistory: []
        }),
        signal: controller.signal
      });

      if (!res.ok) throw new Error(`API returned ${res.status}`);

      const data = await res.json();
      const responseText = data.message || "I couldn't find an answer to that.";

      setAiResponse(responseText);
      setIsThinking(false);

      // Speak the response
      speak(responseText);

    } catch (err) {
      if (err.name === "AbortError") return;
      console.error("[useNarration] Poseidon error:", err);
      setError("Couldn't reach Poseidon. Try again.");
      setIsThinking(false);
    }
  }, [species, mode, speak]);

  // Ask via text (for typed input as alternative to voice)
  const askText = useCallback((text) => {
    if (text.trim()) {
      setTranscript(text.trim());
      askPoseidon(text.trim());
    }
  }, [askPoseidon]);

  // Clear state
  const reset = useCallback(() => {
    setTranscript("");
    setAiResponse("");
    setError(null);
    stopSpeaking();
  }, [stopSpeaking]);

  return {
    // State
    isListening,
    isSpeaking,
    isThinking,
    transcript,
    aiResponse,
    error,
    // Capabilities
    sttSupported,
    ttsSupported,
    // Actions
    startListening,
    stopListening,
    speak,
    stopSpeaking,
    askText,
    reset
  };
}
