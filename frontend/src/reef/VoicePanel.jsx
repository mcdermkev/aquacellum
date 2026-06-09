import React, { useState } from "react";
import { useNarration } from "./hooks/useNarration";

/**
 * VoicePanel — 2D overlay for voice interaction with Poseidon.
 * Shows: mic button, transcript, AI response, text input fallback.
 * Appears below the NarrationLayer when a species is inspected.
 */
export function VoicePanel({ species, mode }) {
  const {
    isListening,
    isSpeaking,
    isThinking,
    transcript,
    aiResponse,
    error,
    sttSupported,
    startListening,
    stopListening,
    stopSpeaking,
    askText,
    reset
  } = useNarration(species, mode);

  const [textInput, setTextInput] = useState("");

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
        bottom: 160,
        left: "50%",
        transform: "translateX(-50%)",
        maxWidth: 520,
        width: "90%",
        background: "rgba(10, 22, 40, 0.88)",
        border: "1px solid rgba(56, 189, 248, 0.2)",
        borderRadius: 12,
        padding: "14px 18px",
        color: "#e2e8f0",
        fontFamily: "system-ui, sans-serif",
        backdropFilter: "blur(8px)",
        zIndex: 101
      }}
    >
      {/* Voice controls row */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {/* Mic button */}
        {sttSupported && (
          <button
            onClick={isListening ? stopListening : startListening}
            disabled={isThinking}
            aria-label={isListening ? "Stop listening" : "Ask a question by voice"}
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              border: `2px solid ${isListening ? "#ef4444" : "#38bdf8"}`,
              background: isListening ? "rgba(239, 68, 68, 0.2)" : "rgba(56, 189, 248, 0.1)",
              color: isListening ? "#ef4444" : "#38bdf8",
              fontSize: 18,
              cursor: isThinking ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "all 0.2s",
              animation: isListening ? "pulse 1.5s infinite" : "none"
            }}
          >
            {isListening ? "⏹" : "🎤"}
          </button>
        )}

        {/* Text input (fallback/alternative to voice) */}
        <form onSubmit={handleTextSubmit} style={{ flex: 1, display: "flex", gap: 8 }}>
          <input
            type="text"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder={`Ask about this ${species?.commonName || "fish"}…`}
            disabled={isThinking}
            style={{
              flex: 1,
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid rgba(56, 189, 248, 0.3)",
              background: "rgba(15, 23, 42, 0.8)",
              color: "#e2e8f0",
              fontSize: 13,
              outline: "none"
            }}
          />
          <button
            type="submit"
            disabled={isThinking || !textInput.trim()}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid #38bdf8",
              background: "rgba(56, 189, 248, 0.15)",
              color: "#38bdf8",
              fontSize: 13,
              cursor: isThinking ? "not-allowed" : "pointer"
            }}
          >
            Ask
          </button>
        </form>

        {/* Stop speaking button */}
        {isSpeaking && (
          <button
            onClick={stopSpeaking}
            aria-label="Stop speaking"
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              border: "1px solid #fbbf24",
              background: "rgba(251, 191, 36, 0.1)",
              color: "#fbbf24",
              fontSize: 14,
              cursor: "pointer"
            }}
          >
            🔇
          </button>
        )}
      </div>

      {/* Status indicators */}
      {isListening && (
        <p style={{ margin: "8px 0 0", fontSize: 12, color: "#ef4444" }}>
          🎙️ Listening… speak your question
        </p>
      )}
      {isThinking && (
        <p style={{ margin: "8px 0 0", fontSize: 12, color: "#38bdf8" }}>
          🧠 Poseidon is thinking…
        </p>
      )}

      {/* Transcript */}
      {transcript && !isThinking && (
        <p style={{ margin: "8px 0 0", fontSize: 12, color: "#94a3b8" }}>
          You asked: "{transcript}"
        </p>
      )}

      {/* AI Response */}
      {aiResponse && (
        <div style={{
          marginTop: 10,
          padding: "10px 12px",
          background: "rgba(56, 189, 248, 0.05)",
          border: "1px solid rgba(56, 189, 248, 0.15)",
          borderRadius: 8,
          fontSize: 13,
          lineHeight: 1.5,
          color: "#cbd5e1",
          maxHeight: 120,
          overflowY: "auto"
        }}>
          {aiResponse}
        </div>
      )}

      {/* Error */}
      {error && (
        <p style={{ margin: "8px 0 0", fontSize: 12, color: "#ef4444" }}>
          ⚠️ {error}
        </p>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); }
          50% { box-shadow: 0 0 0 8px rgba(239, 68, 68, 0); }
        }
      `}</style>
    </div>
  );
}
