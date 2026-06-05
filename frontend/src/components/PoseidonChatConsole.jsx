import React, { useState, useEffect, useRef } from "react";
import { handlePoseidonAction } from "../utils/poseidonBridge";
import { usePoseidon } from "../hooks/usePoseidon";

/**
 * PoseidonChatConsole Panel
 * Renders a glassmorphic panel on the right boundary of the biotope banner.
 * Bridges conversational NLP to local Dexie mutations and Echo animations.
 * 
 * Architecture: Uses the Poseidon Edge Function gateway (Gemini-powered) as primary,
 * with the local Web Worker as offline fallback.
 */
export function PoseidonChatConsole({ tankId, casualModeActive, walletAccount, onClose }) {
  const mode = casualModeActive ? "casual" : "pro";
  const {
    messages,
    isLoading,
    isOnline,
    sendMessage,
    initGreeting,
    requestsRemaining,
  } = usePoseidon({ tankId, mode, walletAddress: walletAccount });

  const [inputText, setInputText] = useState("");
  const messagesEndRef = useRef(null);
  const workerRef = useRef(null);

  // Initialize greeting on mount
  useEffect(() => {
    initGreeting();
  }, [initGreeting]);

  // Initialize Web Worker as offline fallback
  useEffect(() => {
    const worker = new Worker(new URL("../workers/poseidonWorker.js", import.meta.url));
    workerRef.current = worker;
    return () => { worker.terminate(); };
  }, []);

  // Auto-scroll to bottom of conversation
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Route actions and echo reactions whenever messages update
  useEffect(() => {
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.sender !== 'poseidon' || lastMsg.intent === 'init') return;

    // Route action to Dexie bridge
    if (lastMsg.action && lastMsg.action.type !== "NONE") {
      handlePoseidonAction({
        type: lastMsg.action.type,
        payload: lastMsg.action.payload,
        tankId,
        walletAddress: walletAccount
      });
    }

    // Dispatch echo reaction to CompanionFishEntity
    if (lastMsg.echoReaction) {
      window.dispatchEvent(
        new CustomEvent("poseidon:echo-reaction", {
          detail: lastMsg.echoReaction
        })
      );
    }
  }, [messages, tankId, walletAccount]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!inputText.trim() || isLoading) return;

    const text = inputText.trim();
    setInputText("");

    // Send via the Edge Function gateway (falls back to offline mode internally)
    await sendMessage(text);
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
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <img
            src="/poseidon-avatar.jpg"
            alt="Poseidon"
            style={{
              width: "32px",
              height: "32px",
              borderRadius: "50%",
              objectFit: "cover",
              border: `2px solid ${accentColor}`,
              boxShadow: `0 0 8px ${isPro ? 'rgba(168, 85, 247, 0.3)' : 'rgba(56, 189, 248, 0.3)'}`,
            }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            <span
              style={{
                fontSize: "0.75rem",
                fontWeight: "700",
                color: accentColor,
                letterSpacing: "0.05em",
                textTransform: "uppercase"
              }}
            >
              {titleText}
            </span>
            <span style={{ fontSize: "0.6rem", color: "var(--text-muted)", opacity: 0.7 }}>
              {isOnline ? (isPro ? `ONLINE • ${requestsRemaining}/20 queries` : `Connected • ${requestsRemaining} questions left`) : (isPro ? "OFFLINE • LOCAL MODE" : "Offline mode")}
            </span>
          </div>
        </div>
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
                display: "flex",
                flexDirection: isUser ? "row-reverse" : "row",
                gap: "0.4rem",
                alignItems: "flex-start",
              }}
            >
              {/* Poseidon avatar for non-user messages */}
              {!isUser && (
                <img
                  src="/poseidon-avatar.jpg"
                  alt=""
                  style={{
                    width: "22px",
                    height: "22px",
                    borderRadius: "50%",
                    objectFit: "cover",
                    flexShrink: 0,
                    marginTop: "2px",
                    border: `1.5px solid ${borderColor}`,
                    opacity: 0.9,
                  }}
                />
              )}
              <div
                style={{
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
                    {msg.confidence != null && ` • CONF_${(msg.confidence * 100).toFixed(0)}%`}
                  </div>
                )}
                <span style={{ color: msgColor }}>{msg.text}</span>
              </div>
            </div>
          );
        })}
        {isLoading && (
          <div
            style={{
              alignSelf: "flex-start",
              display: "flex",
              gap: "0.4rem",
              alignItems: "flex-start",
              maxWidth: "85%",
            }}
          >
            <img
              src="/poseidon-avatar.jpg"
              alt=""
              style={{
                width: "22px",
                height: "22px",
                borderRadius: "50%",
                objectFit: "cover",
                flexShrink: 0,
                marginTop: "2px",
                border: `1.5px solid ${borderColor}`,
                opacity: 0.6,
                animation: "pulse 1.5s ease-in-out infinite",
              }}
            />
            <div
              style={{
                padding: "0.5rem 0.75rem",
                borderRadius: "8px",
                background: isPro ? "rgba(168, 85, 247, 0.08)" : "rgba(56, 189, 248, 0.08)",
                border: `1px solid ${borderColor}`,
                fontSize: "0.8rem",
                lineHeight: "1.4",
                color: accentColor,
                opacity: 0.7,
              }}
            >
              {isPro ? "▌ PROCESSING..." : "🌊 Thinking..."}
            </div>
          </div>
        )}
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
          disabled={isLoading}
          style={{
            flex: 1,
            background: "rgba(0,0,0,0.3)",
            border: `1px solid ${borderColor}`,
            borderRadius: isPro ? "0" : "6px",
            color: "#fff",
            padding: "0.4rem 0.75rem",
            fontSize: "0.8rem",
            outline: "none",
            fontFamily: "inherit",
            opacity: isLoading ? 0.5 : 1
          }}
        />
        <button
          type="submit"
          disabled={isLoading || !inputText.trim()}
          style={{
            background: isLoading ? "rgba(128,128,128,0.5)" : accentColor,
            border: "none",
            borderRadius: isPro ? "0" : "6px",
            color: isPro ? "#000" : "#fff",
            fontWeight: "700",
            padding: "0.4rem 0.75rem",
            fontSize: "0.8rem",
            cursor: isLoading ? "wait" : "pointer",
            transition: "opacity 0.2s ease",
            opacity: (!inputText.trim() || isLoading) ? 0.5 : 1
          }}
          onMouseEnter={(e) => { if (!isLoading) e.currentTarget.style.opacity = "0.85"; }}
          onMouseLeave={(e) => { if (!isLoading) e.currentTarget.style.opacity = "1"; }}
        >
          {isPro ? "RUN" : "Ask"}
        </button>
      </form>
    </div>
  );
}
