import React, { useState, useEffect, useRef } from "react";
import { handlePoseidonAction } from "../utils/poseidonBridge";

/**
 * PoseidonChatConsole Panel
 * Renders a glassmorphic panel on the right boundary of the biotope banner.
 * Bridges conversational NLP to local Dexie mutations and Echo animations.
 */
export function PoseidonChatConsole({ tankId, casualModeActive, walletAccount, onClose }) {
  const [messages, setMessages] = useState([
    {
      id: "init",
      sender: "poseidon",
      text: casualModeActive
        ? "👋 Hello! I'm Poseidon. Ask me to log feedings, glass cleaning, water tests, or to set up a new tank."
        : "[POSEIDON CORE ONLINE] Ready for telemetry inputs or system initialization queries.",
      timestamp: Date.now(),
      intent: "init"
    }
  ]);
  const [inputText, setInputText] = useState("");
  const messagesEndRef = useRef(null);
  const workerRef = useRef(null);

  // Initialize Web Worker
  useEffect(() => {
    // Instantiate worker referencing relative path from components/
    const worker = new Worker(new URL("../workers/poseidonWorker.js", import.meta.url));

    worker.onmessage = (e) => {
      const { eventId, timestamp, intent, message, action, echoReaction } = e.data;

      // Append Poseidon's response to conversation log
      setMessages((prev) => [
        ...prev,
        {
          id: eventId || `pos-${Date.now()}`,
          sender: "poseidon",
          text: message,
          timestamp: timestamp || Date.now(),
          intent: intent || "fallback_unknown"
        }
      ]);

      // Route transaction logic to Dexie bridge
      if (action && action.type !== "NONE") {
        handlePoseidonAction({
          type: action.type,
          payload: action.payload,
          tankId,
          walletAddress: walletAccount
        });
      }

      // Dispatch custom window event to notify CompanionFishEntity
      if (echoReaction) {
        window.dispatchEvent(
          new CustomEvent("poseidon:echo-reaction", {
            detail: echoReaction
          })
        );
      }
    };

    workerRef.current = worker;

    return () => {
      worker.terminate();
    };
  }, [tankId, walletAccount]);

  // Auto-scroll to bottom of conversation
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    const text = inputText.trim();
    const userMsg = {
      id: `user-${Date.now()}`,
      sender: "user",
      text,
      timestamp: Date.now()
    };

    // Add user message to display log
    setMessages((prev) => [...prev, userMsg]);
    setInputText("");

    // Intercept message processing for politeness easter egg
    const pleaseCount = messages.filter(m => m.text.toLowerCase().includes("please")).length + (text.toLowerCase().includes("please") ? 1 : 0);
    if (pleaseCount === 3) {
      setMessages((prev) => [
        ...prev,
        {
          id: `pos-${Date.now()}`,
          sender: "poseidon",
          text: "Thank you for being so polite to your local database! 🌊",
          timestamp: Date.now(),
          intent: "polite_intercept"
        }
      ]);

      window.dispatchEvent(
        new CustomEvent("poseidon:echo-reaction", {
          detail: {
            mood: "excited",
            swimSpeedMultiplier: 1.8,
            glowActive: true,
            glowColor: "#ffd700",
            durationMs: 8000
          }
        })
      );
      return;
    }

    // Dispatch message to worker thread
    if (workerRef.current) {
      workerRef.current.postMessage({
        text,
        mode: casualModeActive ? "casual" : "pro",
        personaTone: casualModeActive ? "casual" : "pro"
      });
    }
  };

  // Color tokens and text branding depending on persona mode
  const isPro = !casualModeActive;
  const accentColor = isPro ? "#a855f7" : "#38bdf8"; // Neon purple vs Sky-blue
  const consoleBg = isPro ? "rgba(15, 7, 32, 0.85)" : "rgba(8, 25, 48, 0.85)";
  const borderColor = isPro ? "rgba(168, 85, 247, 0.25)" : "rgba(56, 189, 248, 0.25)";
  const shadowGlow = isPro ? "0 0 15px rgba(168, 85, 247, 0.15)" : "0 0 15px rgba(56, 189, 248, 0.15)";
  const titleText = isPro ? "ECOLOGICAL AUTO-PILOT TERMINAL" : "Poseidon Assistant";

  return (
    <div
      className="poseidon-chat-panel glass-card"
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        width: "320px",
        height: "100%",
        background: consoleBg,
        borderLeft: `1px solid ${borderColor}`,
        boxShadow: shadowGlow,
        zIndex: 5,
        display: "flex",
        flexDirection: "column",
        transition: "all 0.3s ease",
        fontFamily: isPro ? "'Courier New', monospace" : "inherit"
      }}
    >
      {/* Console Header */}
      <div
        style={{
          padding: "0.75rem 1rem",
          borderBottom: `1px solid ${borderColor}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: isPro ? "rgba(168, 85, 247, 0.05)" : "rgba(56, 189, 248, 0.05)"
        }}
      >
        <span
          style={{
            fontSize: "0.75rem",
            fontWeight: "700",
            color: accentColor,
            letterSpacing: "0.05em",
            textTransform: "uppercase"
          }}
        >
          {isPro ? "⚡ " : "🐠 "} {titleText}
        </span>
        {onClose && (
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: "1.4rem",
              lineHeight: "1",
              padding: "8px",
              minWidth: "44px",
              minHeight: "44px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "8px",
              transition: "background 0.2s ease"
            }}
            title="Close Panel"
            aria-label="Close chat panel"
            onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.08)"}
            onMouseLeave={(e) => e.currentTarget.style.background = "none"}
          >
            &times;
          </button>
        )}
      </div>

      {/* Message Output Feed */}
      <div
        style={{
          flex: 1,
          padding: "1rem",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: "0.75rem"
        }}
        className="custom-scrollbar"
      >
        {messages.map((msg) => {
          const isUser = msg.sender === "user";
          const msgColor = isUser ? "#fff" : accentColor;
          const msgBg = isUser
            ? "rgba(255, 255, 255, 0.08)"
            : isPro
            ? "rgba(168, 85, 247, 0.08)"
            : "rgba(56, 189, 248, 0.08)";
          const align = isUser ? "flex-end" : "flex-start";

          return (
            <div
              key={msg.id}
              style={{
                alignSelf: align,
                maxWidth: "85%",
                padding: "0.5rem 0.75rem",
                borderRadius: "8px",
                background: msgBg,
                border: `1px solid ${isUser ? "rgba(255,255,255,0.08)" : borderColor}`,
                fontSize: "0.8rem",
                lineHeight: "1.4"
              }}
            >
              {isPro && !isUser && (
                <div
                  style={{
                    fontSize: "0.6rem",
                    color: "rgba(255, 255, 255, 0.3)",
                    marginBottom: "2px",
                    fontWeight: "700"
                  }}
                >
                  INTENT_{(msg.intent || "UNKNOWN").toUpperCase()}
                </div>
              )}
              <span style={{ color: msgColor }}>{msg.text}</span>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Console Form */}
      <form
        onSubmit={handleSubmit}
        style={{
          padding: "0.75rem",
          borderTop: `1px solid ${borderColor}`,
          display: "flex",
          gap: "0.5rem",
          background: "rgba(0,0,0,0.15)"
        }}
      >
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder={isPro ? "INPUT QUERY_..." : "Ask Poseidon..."}
          style={{
            flex: 1,
            background: "rgba(0,0,0,0.3)",
            border: `1px solid ${borderColor}`,
            borderRadius: isPro ? "0" : "6px",
            color: "#fff",
            padding: "0.4rem 0.75rem",
            fontSize: "0.8rem",
            outline: "none",
            fontFamily: "inherit"
          }}
        />
        <button
          type="submit"
          style={{
            background: accentColor,
            border: "none",
            borderRadius: isPro ? "0" : "6px",
            color: isPro ? "#000" : "#fff",
            fontWeight: "700",
            padding: "0.4rem 0.75rem",
            fontSize: "0.8rem",
            cursor: "pointer",
            transition: "opacity 0.2s ease"
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.85")}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
        >
          {isPro ? "RUN" : "Ask"}
        </button>
      </form>
    </div>
  );
}
