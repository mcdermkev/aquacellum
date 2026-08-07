/**
 * TideLivePulse.jsx
 *
 * The "this is happening right now" bar shown while a Tide is live — for EVERY
 * tide type, independent of video. Reuses the Tank Cam realtime presence +
 * reaction system (Supabase presence/broadcast) so attendees see a live viewer
 * count and each other's floating reactions. This is what makes a chat-based
 * live event actually feel alive.
 */

import { useTankCamPresence } from "../../hooks/useTankCam";
import { FloatingReactions } from "../tank-cam/FloatingReactions";

const REACTION_EMOJIS = ["🐠", "🔥", "💧", "🌿", "😍", "👏"];

export function TideLivePulse({ tideId }) {
  // Same channel key the (deferred) stream viewer uses, so presence stays unified
  // if/when video is switched back on.
  const { viewerCount, reactions, sendReaction } = useTankCamPresence(`tide-${tideId}`, !!tideId);

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "0.75rem",
        flexWrap: "wrap",
        padding: "0.6rem 0.9rem",
        borderRadius: "12px",
        background: "linear-gradient(135deg, rgba(239,68,68,0.10), rgba(56,189,248,0.06))",
        border: "1px solid rgba(239,68,68,0.25)",
        overflow: "hidden",
      }}
      aria-label="Live now"
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.35rem",
            padding: "3px 9px",
            borderRadius: "50px",
            background: "rgba(239,68,68,0.9)",
            color: "#fff",
            fontSize: "0.65rem",
            fontWeight: 800,
            letterSpacing: "0.05em",
          }}
        >
          <span className="pulse-dot" aria-hidden="true" style={{
            width: 7, height: 7, borderRadius: "50%", background: "#fff", display: "inline-block",
          }} />
          LIVE
        </span>
        <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)", fontWeight: 600 }}>
          👁️ {viewerCount} {viewerCount === 1 ? "keeper" : "keepers"} here
        </span>
      </div>

      {/* Reaction bar */}
      <div style={{ display: "flex", gap: "0.3rem" }}>
        {REACTION_EMOJIS.map((emoji) => (
          <button
            key={emoji}
            onClick={() => sendReaction(emoji)}
            style={{
              width: "30px",
              height: "30px",
              borderRadius: "50%",
              border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(255,255,255,0.06)",
              fontSize: "0.95rem",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              lineHeight: 1,
            }}
            aria-label={`React with ${emoji}`}
          >
            {emoji}
          </button>
        ))}
      </div>

      {/* Floating reactions rise over the bar */}
      <FloatingReactions reactions={reactions} />
    </div>
  );
}

export default TideLivePulse;
