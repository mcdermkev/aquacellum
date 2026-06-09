import React, { useEffect, useState } from "react";
import { getPersonality } from "../utils/personality";
import { useNarration } from "./hooks/useNarration";

/**
 * NarrationLayer — Species info panel with integrated voice/text ask.
 * Shows species details at the bottom of the screen with the ask input
 * below the info (no overlap).
 */
export function NarrationLayer({ species, mode, onDismiss }) {
  const [speaking, setSpeaking] = useState(false);
  const personality = getPersonality(species, mode);

  const {
    isListening,
    isSpeaking: aiSpeaking,
    isThinking,
    transcript,
    aiResponse,
    error,
    sttSupported,
    startListening,
    stopListening,
    stopSpeaking,
    askText
  } = useNarration(species, mode);

  const [textInput, setTextInput] = useState("");

  const displayName = species.commonName || species.scientificName;
  const sciName = species.scientificName || "";
  const vibeLine = personality.vibeLine || "";
  const flavorText = personality.flavorText || "";
  const fallbackText = species.ecology?.comments || species.ecology?.biotope || "";
  const mainText = flavorText || fallbackText;
  const tagline = vibeLine || (species.ecology?.socialBehavior || "");

  // TTS: speak the tagline when species changes
  useEffect(() => {
    if (!tagline || typeof window === "undefined") return;
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(tagline);
    utterance.rate = 0.9;
    utterance.pitch = 1.0;
    utterance.volume = 0.8;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);

    const timer = setTimeout(() => {
      window.speechSynthesis.speak(utterance);
    }, 300);

    return () => {
      clearTimeout(timer);
      window.speechSynthesis.cancel();
      setSpeaking(false);
    };
  }, [tagline, species.specCode]);

  const handleTextSubmit = (e) => {
    e.preventDefault();
    if (textInput.trim()) {
      askText(textInput.trim());
      setTextInput("");
    }
  };

  return (
    <div
      style={{
        position: "absolute",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        maxWidth: 540,
        width: "92%",
        background: "rgba(10, 22, 40, 0.92)",
        border: "1px solid rgba(56, 189, 248, 0.3)",
        borderRadius: 16,
        padding: "16px 20px",
        color: "#e2e8f0",
        fontFamily: "system-ui, sans-serif",
        backdropFilter: "blur(12px)",
        zIndex: 100,
        animation: "slideUp 0.3s ease-out"
      }}
      role="dialog"
      aria-label={`Species info: ${displayName}`}
    >
      {/* Close button */}
      <button
        onClick={onDismiss}
        aria-label="Close species info"
        style={{
          position: "absolute",
          top: 10,
          right: 14,
          background: "none",
          border: "none",
          color: "#94a3b8",
          fontSize: 18,
          cursor: "pointer",
          lineHeight: 1
        }}
      >
        ✕
      </button>

      {/* Species name */}
      <h2 style={{ margin: 0, fontSize: 17, color: "#38bdf8", paddingRight: 24 }}>
        {displayName}
        {(speaking || aiSpeaking) && <span style={{ marginLeft: 8, fontSize: 11 }}>🔊</span>}
      </h2>
      <p style={{ margin: "2px 0 8px", fontSize: 12, color: "#64748b", fontStyle: "italic" }}>
        {sciName}
      </p>

      {/* Tagline / vibeLine */}
      {tagline && (
        <p style={{ margin: "0 0 6px", fontSize: 14, color: "#fbbf24", fontWeight: 500 }}>
          "{tagline}"
        </p>
      )}

      {/* Main text */}
      {mainText && (
        <p style={{ margin: "0 0 8px", fontSize: 13, lineHeight: 1.45, color: "#cbd5e1" }}>
          {mainText}
        </p>
      )}

      {/* Quick stats */}
      <div style={{ display: "flex", gap: 12, fontSize: 11, color: "#64748b", marginBottom: 10 }}>
        {species.maxLengthCm && <span>📏 {species.maxLengthCm} cm</span>}
        {species.family && <span>🧬 {species.family}</span>}
        {species.tankMetrics?.difficulty && <span>⚡ {species.tankMetrics.difficulty}</span>}
        <span style={{ textTransform: "uppercase", letterSpacing: "0.04em" }}>{mode} mode</span>
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: "rgba(56, 189, 248, 0.15)", margin: "0 0 10px" }} />

      {/* Ask input row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {sttSupported && (
          <button
            onClick={isListening ? stopListening : startListening}
            disabled={isThinking}
            aria-label={isListening ? "Stop listening" : "Ask by voice"}
            style={{
              width: 34,
              height: 34,
              borderRadius: "50%",
              border: `2px solid ${isListening ? "#ef4444" : "#38bdf8"}`,
              background: isListening ? "rgba(239, 68, 68, 0.15)" : "rgba(56, 189, 248, 0.08)",
              color: isListening ? "#ef4444" : "#38bdf8",
              fontSize: 15,
              cursor: isThinking ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              animation: isListening ? "pulse 1.5s infinite" : "none"
            }}
          >
            {isListening ? "⏹" : "🎤"}
          </button>
        )}

        <form onSubmit={handleTextSubmit} style={{ flex: 1, display: "flex", gap: 6 }}>
          <input
            type="text"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder={`Ask about this ${displayName}…`}
            disabled={isThinking}
            style={{
              flex: 1,
              padding: "7px 11px",
              borderRadius: 8,
              border: "1px solid rgba(56, 189, 248, 0.25)",
              background: "rgba(15, 23, 42, 0.7)",
              color: "#e2e8f0",
              fontSize: 12,
              outline: "none"
            }}
          />
          <button
            type="submit"
            disabled={isThinking || !textInput.trim()}
            style={{
              padding: "7px 12px",
              borderRadius: 8,
              border: "1px solid #38bdf8",
              background: "rgba(56, 189, 248, 0.12)",
              color: "#38bdf8",
              fontSize: 12,
              cursor: isThinking ? "not-allowed" : "pointer",
              flexShrink: 0
            }}
          >
            Ask
          </button>
        </form>

        {aiSpeaking && (
          <button
            onClick={stopSpeaking}
            aria-label="Stop speaking"
            style={{
              width: 30, height: 30, borderRadius: "50%",
              border: "1px solid #fbbf24", background: "rgba(251, 191, 36, 0.1)",
              color: "#fbbf24", fontSize: 12, cursor: "pointer", flexShrink: 0
            }}
          >
            🔇
          </button>
        )}
      </div>

      {/* Status / AI response area */}
      {isListening && (
        <p style={{ margin: "6px 0 0", fontSize: 11, color: "#ef4444" }}>
          🎙️ Listening…
        </p>
      )}
      {isThinking && (
        <p style={{ margin: "6px 0 0", fontSize: 11, color: "#38bdf8" }}>
          🧠 Poseidon is thinking…
        </p>
      )}
      {transcript && !isThinking && !aiResponse && (
        <p style={{ margin: "6px 0 0", fontSize: 11, color: "#94a3b8" }}>
          You: "{transcript}"
        </p>
      )}
      {aiResponse && (
        <div style={{
          marginTop: 8,
          padding: "8px 10px",
          background: "rgba(56, 189, 248, 0.05)",
          border: "1px solid rgba(56, 189, 248, 0.12)",
          borderRadius: 8,
          fontSize: 12,
          lineHeight: 1.45,
          color: "#cbd5e1",
          maxHeight: 90,
          overflowY: "auto"
        }}>
          {aiResponse}
        </div>
      )}
      {error && (
        <p style={{ margin: "6px 0 0", fontSize: 11, color: "#ef4444" }}>⚠️ {error}</p>
      )}

      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateX(-50%) translateY(16px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        @keyframes pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); }
          50% { box-shadow: 0 0 0 6px rgba(239, 68, 68, 0); }
        }
      `}</style>
    </div>
  );
}
