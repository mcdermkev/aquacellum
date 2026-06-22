import React, { useState, useEffect, useRef, useCallback } from "react";
import { usePoseidon } from "../hooks/usePoseidon";
import { handlePoseidonAction } from "../utils/poseidonBridge";
import { parsePoseidonMessage } from "../utils/poseidonDeepLinks";

/**
 * PoseidonGlobalWidget — Always-available floating Poseidon AI chat.
 * 
 * A FAB (floating action button) that opens a slide-up chat drawer,
 * letting users talk to Poseidon from anywhere on the site.
 * Context-aware: adapts greeting and suggestions based on active tab.
 *
 * Props:
 *  - walletAddress (string|null) — connected wallet
 *  - casualModeActive (boolean) — toggles casual vs pro persona
 *  - activeTab (string) — current dashboard tab for context hints
 */
export function PoseidonGlobalWidget({ walletAddress, casualModeActive = true, activeTab = "tanks" }) {
  const [isOpen, setIsOpen] = useState(false);
  const [pillDismissed, setPillDismissed] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const inputRef = useRef(null);
  const messagesEndRef = useRef(null);
  const panelRef = useRef(null);

  const mode = casualModeActive ? "casual" : "pro";
  const {
    messages,
    isLoading,
    isOnline,
    sendMessage,
    initGreeting,
    clearConversation,
    requestsRemaining,
  } = usePoseidon({ mode, walletAddress, persistKey: "aquadex_poseidon_global" });

  // Initialize greeting when first opened (only if no persisted messages)
  useEffect(() => {
    if (isOpen && messages.length === 0) {
      initGreeting();
    }
  }, [isOpen, messages.length, initGreeting]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === "Escape" && isOpen) setIsOpen(false);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen]);

  // Route actions from Poseidon responses
  useEffect(() => {
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.sender !== "poseidon" || lastMsg.intent === "init") return;

    if (lastMsg.action && lastMsg.action.type !== "NONE") {
      setPendingAction({
        type: lastMsg.action.type,
        payload: lastMsg.action.payload || {},
        msgId: lastMsg.id,
      });
    }

    // Dispatch echo reaction
    if (lastMsg.echoReaction) {
      window.dispatchEvent(
        new CustomEvent("poseidon:echo-reaction", { detail: lastMsg.echoReaction })
      );
    }
  }, [messages]);

  const confirmAction = () => {
    if (!pendingAction) return;
    handlePoseidonAction({
      type: pendingAction.type,
      payload: pendingAction.payload,
      walletAddress,
    });
    setPendingAction(null);
  };

  const dismissAction = () => setPendingAction(null);

  const [inputText, setInputText] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!inputText.trim() || isLoading) return;
    const text = inputText.trim();
    setInputText("");
    await sendMessage(text);
  };

  const handleNewConversation = () => {
    clearConversation();
    setPendingAction(null);
    setPillDismissed(false);
    initGreeting();
  };

  // Get the last Poseidon message for pill preview (mobile compact mode)
  const lastPoseidonMsg = [...messages].reverse().find(m => m.sender === "poseidon" && m.intent !== "init");
  const showPill = !isOpen && !pillDismissed && lastPoseidonMsg && messages.length > 1;

  // Context-aware quick suggestions based on current tab
  const getQuickSuggestions = useCallback(() => {
    if (!casualModeActive) return [];
    switch (activeTab) {
      case "tanks":
        return ["Check my water params", "What should I feed today?", "Any compatibility issues?"];
      case "breeder":
        return ["Breeding tips for my species", "Optimal spawning conditions", "Fry survival rate"];
      case "directory":
      case "gallery":
        return ["Compare these species", "Is this a good price?", "Suggest similar fish"];
      case "reef":
        return ["What's trending?", "Best community tank setups", "Rare species spotlight"];
      default:
        return ["Help me set up a tank", "Species compatibility check", "Water chemistry advice"];
    }
  }, [activeTab, casualModeActive]);

  const isPro = !casualModeActive;
  const accentColor = isPro ? "#a855f7" : "#38bdf8";
  const panelBg = isPro ? "rgba(15, 7, 32, 0.96)" : "rgba(8, 18, 38, 0.96)";
  const borderColor = isPro ? "rgba(168, 85, 247, 0.2)" : "rgba(56, 189, 248, 0.2)";

  // Deep-link handler: dispatches navigation events to the app
  const handleDeepLink = useCallback((linkData) => {
    if (linkData.type === "nav") {
      // Navigate to a specific tab
      window.dispatchEvent(
        new CustomEvent("poseidon:navigate", { detail: { tab: linkData.tab } })
      );
      setIsOpen(false);
    } else if (linkData.type === "species") {
      // Navigate to species search with the query pre-filled
      window.dispatchEvent(
        new CustomEvent("poseidon:navigate", {
          detail: { tab: "gallery", search: linkData.query },
        })
      );
      setIsOpen(false);
    }
  }, []);

  return (
    <>
      {/* Mobile Pill — compact preview of last Poseidon response */}
      {showPill && (
        <div className="poseidon-global-pill" onClick={() => setIsOpen(true)}>
          <img src="/poseidon-avatar.jpg" alt="" className="poseidon-global-pill__avatar" />
          <span className="poseidon-global-pill__text">
            {lastPoseidonMsg.text.length > 60
              ? lastPoseidonMsg.text.slice(0, 60) + "…"
              : lastPoseidonMsg.text}
          </span>
          <button
            className="poseidon-global-pill__dismiss"
            onClick={(e) => { e.stopPropagation(); setPillDismissed(true); }}
            aria-label="Dismiss preview"
          >
            ×
          </button>
        </div>
      )}

      {/* Floating Action Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`poseidon-global-fab ${isOpen ? "poseidon-global-fab--active" : ""}`}
        aria-label={isOpen ? "Close Poseidon chat" : "Open Poseidon chat"}
        aria-expanded={isOpen}
        title="Talk to Poseidon"
      >
        {isOpen ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2C6.48 2 2 5.58 2 10c0 2.24 1.12 4.27 2.93 5.72L4 22l4.35-2.18C9.5 20.27 10.72 20.5 12 20.5c5.52 0 10-3.58 10-8.5S17.52 2 12 2z" />
            <circle cx="8" cy="10" r="1" fill="currentColor" />
            <circle cx="12" cy="10" r="1" fill="currentColor" />
            <circle cx="16" cy="10" r="1" fill="currentColor" />
          </svg>
        )}
        {!isOpen && (
          <span className="poseidon-global-fab__label">Poseidon</span>
        )}
      </button>

      {/* Chat Drawer / Panel */}
      {isOpen && (
        <div
          className="poseidon-global-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsOpen(false);
          }}
          aria-hidden="true"
        >
          <div
            ref={panelRef}
            className="poseidon-global-panel"
            role="dialog"
            aria-label="Poseidon AI Assistant"
            style={{
              "--poseidon-panel-bg": panelBg,
              "--poseidon-border-color": borderColor,
              "--poseidon-accent": accentColor,
            }}
          >
            {/* Header */}
            <div className="poseidon-global-panel__header">
              <div className="poseidon-global-panel__header-left">
                <div className="poseidon-global-panel__avatar">
                  <img src="/poseidon-avatar.jpg" alt="Poseidon" />
                  <span className={`poseidon-global-panel__status ${isOnline ? "online" : "offline"}`} />
                </div>
                <div className="poseidon-global-panel__header-info">
                  <span className="poseidon-global-panel__title">
                    {isPro ? "POSEIDON TERMINAL" : "Poseidon"}
                  </span>
                  <span className="poseidon-global-panel__subtitle">
                    {isOnline
                      ? (isPro ? `ONLINE • ${requestsRemaining}/20` : `${requestsRemaining} questions left`)
                      : (isPro ? "OFFLINE" : "Offline mode")}
                  </span>
                </div>
              </div>
              <div className="poseidon-global-panel__header-actions">
                <button
                  onClick={handleNewConversation}
                  className="poseidon-global-panel__header-btn"
                  title="New conversation"
                  aria-label="Start new conversation"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
                </button>
                <button
                  onClick={() => setIsOpen(false)}
                  className="poseidon-global-panel__header-btn"
                  title="Close"
                  aria-label="Close chat"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="poseidon-global-panel__messages">
              {messages.map((msg) => {
                const isUser = msg.sender === "user";
                return (
                  <div
                    key={msg.id}
                    className={`poseidon-global-panel__msg ${isUser ? "poseidon-global-panel__msg--user" : "poseidon-global-panel__msg--ai"}`}
                  >
                    {!isUser && (
                      <img
                        src="/poseidon-avatar.jpg"
                        alt=""
                        className="poseidon-global-panel__msg-avatar"
                      />
                    )}
                    <div className={`poseidon-global-panel__msg-bubble ${isUser ? "poseidon-global-panel__msg-bubble--user" : "poseidon-global-panel__msg-bubble--ai"}`}>
                      {isPro && !isUser && msg.intent && msg.intent !== "init" && (
                        <div className="poseidon-global-panel__msg-meta">
                          INTENT_{msg.intent.toUpperCase()}
                          {msg.confidence != null && ` • CONF_${(msg.confidence * 100).toFixed(0)}%`}
                        </div>
                      )}
                      {isUser ? (
                        <span>{msg.text}</span>
                      ) : (
                        <PoseidonMessageContent text={msg.text} onNavigate={handleDeepLink} />
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Loading indicator */}
              {isLoading && (
                <div className="poseidon-global-panel__msg poseidon-global-panel__msg--ai">
                  <img src="/poseidon-avatar.jpg" alt="" className="poseidon-global-panel__msg-avatar poseidon-global-panel__msg-avatar--loading" />
                  <div className="poseidon-global-panel__msg-bubble poseidon-global-panel__msg-bubble--ai poseidon-global-panel__msg-bubble--loading">
                    {isPro ? "▌ PROCESSING..." : "Thinking..."}
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Action Confirmation */}
            {pendingAction && (
              <div className="poseidon-global-panel__action-bar">
                <span className="poseidon-global-panel__action-icon">⚡</span>
                <span className="poseidon-global-panel__action-text">
                  {casualModeActive
                    ? `Poseidon wants to: ${pendingAction.type.toLowerCase().replace(/_/g, " ")}`
                    : `ACTION: ${pendingAction.type}`}
                </span>
                <button onClick={confirmAction} className="poseidon-global-panel__action-btn poseidon-global-panel__action-btn--confirm">
                  {casualModeActive ? "Do it" : "EXEC"}
                </button>
                <button onClick={dismissAction} className="poseidon-global-panel__action-btn poseidon-global-panel__action-btn--dismiss">
                  {casualModeActive ? "Nah" : "SKIP"}
                </button>
              </div>
            )}

            {/* Quick Suggestions (shown when conversation is fresh) */}
            {messages.length <= 1 && !isLoading && (
              <div className="poseidon-global-panel__suggestions">
                {getQuickSuggestions().map((suggestion, i) => (
                  <button
                    key={i}
                    className="poseidon-global-panel__suggestion-chip"
                    onClick={() => {
                      setInputText("");
                      sendMessage(suggestion);
                    }}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}

            {/* Input */}
            <form onSubmit={handleSubmit} className="poseidon-global-panel__input-area">
              <input
                ref={inputRef}
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={isPro ? "Enter query..." : "Ask Poseidon anything..."}
                className="poseidon-global-panel__input"
                disabled={isLoading}
                aria-label="Message Poseidon"
              />
              <button
                type="submit"
                disabled={!inputText.trim() || isLoading}
                className="poseidon-global-panel__send-btn"
                aria-label="Send message"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * PoseidonMessageContent — Renders Poseidon AI message text with deep-links.
 * Species names become clickable chips that navigate to the gallery/search.
 * Navigation intents become action links that switch tabs.
 */
function PoseidonMessageContent({ text, onNavigate }) {
  const segments = parsePoseidonMessage(text);

  // If no special segments detected, just render text
  if (segments.length === 1 && segments[0].type === "text") {
    return <span>{text}</span>;
  }

  return (
    <span>
      {segments.map((seg, i) => {
        if (seg.type === "text") {
          return <span key={i}>{seg.content}</span>;
        }
        if (seg.type === "species") {
          return (
            <button
              key={i}
              className="poseidon-deep-link poseidon-deep-link--species"
              onClick={() => onNavigate({ type: "species", query: seg.query })}
              title={`Search for ${seg.content}`}
            >
              {seg.content}
            </button>
          );
        }
        if (seg.type === "nav") {
          return (
            <button
              key={i}
              className="poseidon-deep-link poseidon-deep-link--nav"
              onClick={() => onNavigate({ type: "nav", tab: seg.tab })}
              title={seg.label}
            >
              {seg.content}
            </button>
          );
        }
        return <span key={i}>{seg.content}</span>;
      })}
    </span>
  );
}
