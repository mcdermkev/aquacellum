/**
 * TideChat.jsx
 * 
 * Ephemeral real-time chat for active Tides.
 * - 300-char limit
 * - Rate-limited: 1 msg per 5 seconds per user
 * - Poseidon system messages styled distinctly
 * - Auto-deletes 48h after event ends (handled server-side)
 */

import { useState, useRef, useEffect } from "react";
import { useTideChat } from "../../hooks/useTides";
import { getCurrentWallet } from "../../services/supabaseClient";
import { ProfileCard } from "./ProfileCard";

function ChatMessage({ msg, isOwn }) {
  if (msg.is_system_message) {
    return (
      <div className="tide-chat__msg tide-chat__msg--system" role="status">
        <span className="tide-chat__system-icon">🐙</span>
        <p>{msg.body}</p>
        <time>
          {new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </time>
      </div>
    );
  }

  return (
    <div className={`tide-chat__msg ${isOwn ? "tide-chat__msg--own" : ""}`}>
      {!isOwn && msg.profile && (
        <div className="tide-chat__msg-author">
          <ProfileCard profile={msg.profile} compact />
        </div>
      )}
      <div className="tide-chat__msg-bubble">
        <p>{msg.body}</p>
        <time>
          {new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </time>
      </div>
    </div>
  );
}

export function TideChat({ tideId, enabled = true }) {
  const { messages, sendMessage, isLoading } = useTideChat(tideId, enabled);
  const [input, setInput] = useState("");
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef(null);
  const walletAddress = getCurrentWallet();

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim() || sending) return;

    setError(null);
    setSending(true);

    const { error: sendError } = await sendMessage(input.trim());

    if (sendError) {
      setError(sendError);
    } else {
      setInput("");
    }

    setSending(false);
  };

  if (!enabled) {
    return (
      <div className="tide-chat tide-chat--disabled">
        <p className="text-muted">Chat is only active during live tides.</p>
      </div>
    );
  }

  return (
    <section className="tide-chat" aria-label="Tide Chat">
      {/* Messages area */}
      <div className="tide-chat__messages" role="log" aria-live="polite" aria-label="Chat messages">
        {isLoading ? (
          <div className="tide-chat__loading">
            <p className="text-muted">Loading messages…</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="tide-chat__empty">
            <p>💬 No messages yet. Start the conversation!</p>
          </div>
        ) : (
          messages.map((msg) => (
            <ChatMessage
              key={msg.id}
              msg={msg}
              isOwn={msg.author_wallet === walletAddress}
            />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <form className="tide-chat__input-bar" onSubmit={handleSend}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value.slice(0, 300))}
          placeholder="Say something…"
          maxLength={300}
          disabled={sending}
          aria-label="Chat message input"
          className="tide-chat__input"
        />
        <span className="tide-chat__char-count" aria-hidden="true">
          {input.length}/300
        </span>
        <button
          type="submit"
          disabled={!input.trim() || sending}
          className="btn btn--primary btn--sm"
          aria-label="Send message"
        >
          {sending ? "…" : "Send"}
        </button>
      </form>

      {/* Error display */}
      {error && (
        <p className="tide-chat__error" role="alert">{error}</p>
      )}
    </section>
  );
}

export default TideChat;
