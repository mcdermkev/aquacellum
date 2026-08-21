import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { handlePoseidonAction } from "../utils/poseidonBridge";
import { requiresConfirmation, actionLabel, actionConfirmLabel } from "../utils/poseidonActions";
import { useEchoAttend } from "../hooks/useEchoAttend";
import { usePoseidon } from "../hooks/usePoseidon";
import { FishIdentifier } from "./FishIdentifier";

// The local `formatActionLabel` map that used to live here was the third copy of
// the action list (prompt, bridge, this file) and it drifted: it labelled three
// actions the bridge never implemented. Labels now come from the one registry.

/**
 * PoseidonChatConsole Panel
 * Renders a glassmorphic panel on the right boundary of the biotope banner.
 * Bridges conversational NLP to local Dexie mutations and Echo animations.
 * 
 * Architecture: Uses the Poseidon Edge Function gateway (Gemini-powered) as primary,
 * with the local Web Worker as offline fallback.
 */
export function PoseidonChatConsole({ tankId, casualModeActive, walletAccount, seedPrompt = null, onClose }) {
  // Echo turns toward the console for as long as it is mounted. This one is
  // rendered conditionally by its parents rather than holding an `isOpen`, so its
  // lifetime IS the open state. See docs/ECHO_CHARACTER_SPEC.md §4 rule 1.
  const panelRef = useRef(null);
  useEchoAttend(panelRef, true);
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
  const [pendingAction, setPendingAction] = useState(null); // { type, payload, msgId }
  const messagesEndRef = useRef(null);
  const lastSeedRef = useRef(null);

  // Initialize greeting on mount
  useEffect(() => {
    initGreeting();
  }, [initGreeting]);

  // Contextual "Ask Poseidon" tips seed a grounded question and auto-send it
  // once. Any write Poseidon proposes still queues in the confirmation bar
  // below — seeding only asks the question, it never bypasses confirm-before-write.
  useEffect(() => {
    if (seedPrompt && seedPrompt !== lastSeedRef.current) {
      lastSeedRef.current = seedPrompt;
      sendMessage(seedPrompt);
    }
  }, [seedPrompt, sendMessage]);

  // Auto-scroll to bottom of conversation
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Route actions and echo reactions whenever messages update
  useEffect(() => {
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.sender !== 'poseidon' || lastMsg.intent === 'init') return;

    // Queue action for user confirmation (don't auto-execute).
    // Gated on `requiresConfirmation`, not on `type !== "NONE"`: the informational
    // types (QUERY_COMPATIBILITY, SUGGEST_SPECIES) used to raise a bar whose
    // Confirm button ran nothing at all.
    if (lastMsg.action && requiresConfirmation(lastMsg.action.type)) {
      setPendingAction({
        type: lastMsg.action.type,
        payload: lastMsg.action.payload || {},
        msgId: lastMsg.id,
      });
    }

    // Dispatch echo reaction to EchoAmbient (non-destructive, ok to auto-run)
    if (lastMsg.echoReaction) {
      window.dispatchEvent(
        new CustomEvent("poseidon:echo-reaction", {
          detail: lastMsg.echoReaction
        })
      );
    }
  }, [messages, tankId, walletAccount]);

  // Confirm and execute the pending action
  const confirmAction = () => {
    if (!pendingAction) return;
    handlePoseidonAction({
      type: pendingAction.type,
      payload: pendingAction.payload,
      tankId,
      walletAddress: walletAccount,
    });
    setPendingAction(null);
  };

  // Dismiss the pending action without executing
  const dismissAction = () => {
    setPendingAction(null);
  };

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

  // Docked as a body-level overlay, NOT inside whatever mounted it.
  //
  // This used to be `position: absolute; top:0; right:0; height:100%`, which
  // sized the console to its nearest positioned ancestor. In Casual mode the
  // tank detail is a narrow inline side panel whose hero banner is only a couple
  // of hundred pixels tall, so "Ask Poseidon" opened a ~320px-wide console
  // squeezed into a short strip at the top of the panel — visible but unusable.
  // CasualSpeciesDetail had already hit this and worked around it with a
  // `.csd-poseidon-dock` wrapper; this fixes the cause instead.
  //
  // `position: fixed` alone is NOT sufficient: several ancestors here are
  // `.glass-card`, and a `backdrop-filter` ancestor becomes the containing block
  // AND a stacking context for fixed descendants (the same trap that put the
  // header profile menu under the nav strip). Portalling to `document.body` is
  // what actually escapes it.
  //
  // The ≤768px rule in index.css still promotes this to a full-screen sheet.
  return createPortal(
    <div
      ref={panelRef}
      className="poseidon-chat-panel glass-card"
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: "min(380px, 100vw)",
        background: consoleBg,
        borderLeft: `1px solid ${borderColor}`,
        boxShadow: shadowGlow,
        zIndex: 2000,
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

      {/* Action Confirmation Bar */}
      {pendingAction && (
        <div
          style={{
            padding: "0.6rem 0.75rem",
            background: casualModeActive
              ? "rgba(251, 191, 36, 0.08)"
              : "rgba(168, 85, 247, 0.08)",
            borderTop: `1px solid ${casualModeActive ? "rgba(251, 191, 36, 0.25)" : "rgba(168, 85, 247, 0.25)"}`,
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            flexWrap: "wrap",
          }}
          role="alert"
          aria-label="Action confirmation"
        >
          <span style={{ fontSize: "0.9rem" }}>⚡</span>
          <span style={{ fontSize: "0.72rem", color: casualModeActive ? "#fbbf24" : "#c084fc", flex: 1, minWidth: 0 }}>
            {casualModeActive
              ? `Poseidon wants to: ${actionLabel(pendingAction.type, { casual: true })}`
              : `ACTION: ${pendingAction.type}`}
          </span>
          <button
            type="button"
            onClick={confirmAction}
            style={{
              padding: "0.3rem 0.6rem",
              fontSize: "0.7rem",
              fontWeight: 600,
              borderRadius: "6px",
              border: "none",
              background: "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)",
              color: "#fff",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {actionConfirmLabel(pendingAction.type, { casual: casualModeActive })}
          </button>
          <button
            type="button"
            onClick={dismissAction}
            style={{
              padding: "0.3rem 0.5rem",
              fontSize: "0.7rem",
              borderRadius: "6px",
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.05)",
              color: "var(--text-muted)",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {casualModeActive ? "Skip" : "DENY"}
          </button>
        </div>
      )}

      {/* Visual identification (spec §6). Echo examines while Poseidon looks. */}
      <FishIdentifier
        mode={mode}
        accentColor={accentColor}
        borderColor={borderColor}
        isPro={isPro}
        onAskPoseidon={sendMessage}
      />

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

      {/* Quick Action Suggestion Chips */}
      {messages.length <= 2 && !inputText && (
        <div style={{
          padding: "0.5rem 0.75rem",
          display: "flex",
          flexWrap: "wrap",
          gap: "0.4rem",
          borderTop: `1px solid ${isPro ? "rgba(168, 85, 247, 0.1)" : "rgba(56, 189, 248, 0.1)"}`,
          background: "rgba(0,0,0,0.08)",
        }}>
          <span style={{ fontSize: "0.6rem", color: "var(--text-muted)", width: "100%", marginBottom: "0.15rem" }}>
            {isPro ? "SUGGESTED COMMANDS:" : "Try asking:"}
          </span>
          {(isPro ? [
            { label: "LOG_FEEDING", prompt: "log feeding for this tank" },
            { label: "WATER_TEST", prompt: "log water parameters" },
            { label: "CHECK_COMPAT", prompt: "check species compatibility" },
            { label: "SUGGEST_SPECIES", prompt: "suggest species for my tank" },
          ] : [
            { label: "🍽️ Log Feeding", prompt: "log a feeding for this tank" },
            { label: "🧪 Water Test", prompt: "log my water test results" },
            { label: "🐠 Check Compatibility", prompt: "are my fish compatible?" },
            { label: "💡 Suggest Fish", prompt: "what fish would work well in my tank?" },
          ]).map((chip) => (
            <button
              key={chip.label}
              type="button"
              onClick={() => {
                setInputText(chip.prompt);
              }}
              style={{
                padding: "0.25rem 0.5rem",
                fontSize: "0.68rem",
                borderRadius: isPro ? "0" : "12px",
                border: `1px solid ${isPro ? "rgba(168, 85, 247, 0.25)" : "rgba(56, 189, 248, 0.2)"}`,
                background: isPro ? "rgba(168, 85, 247, 0.06)" : "rgba(56, 189, 248, 0.06)",
                color: accentColor,
                cursor: "pointer",
                fontFamily: isPro ? "'Courier New', monospace" : "inherit",
                transition: "all 0.2s ease",
                whiteSpace: "nowrap",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = isPro ? "rgba(168, 85, 247, 0.15)" : "rgba(56, 189, 248, 0.12)";
                e.currentTarget.style.borderColor = isPro ? "rgba(168, 85, 247, 0.4)" : "rgba(56, 189, 248, 0.4)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = isPro ? "rgba(168, 85, 247, 0.06)" : "rgba(56, 189, 248, 0.06)";
                e.currentTarget.style.borderColor = isPro ? "rgba(168, 85, 247, 0.25)" : "rgba(56, 189, 248, 0.2)";
              }}
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body
  );
}
