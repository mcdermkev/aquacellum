/**
 * FloatingReactions.jsx
 * 
 * Periscope/TikTok-style floating emoji reactions overlay.
 * Emojis float up from the bottom-right and fade out.
 */

import React from "react";

export function FloatingReactions({ reactions = [] }) {
  if (reactions.length === 0) return null;

  return (
    <div
      style={{
        position: "absolute",
        bottom: "60px",
        right: "12px",
        width: "50px",
        height: "200px",
        pointerEvents: "none",
        overflow: "hidden",
      }}
      aria-hidden="true"
    >
      {reactions.map((reaction) => (
        <div
          key={reaction.id}
          style={{
            position: "absolute",
            bottom: 0,
            right: Math.random() * 30 + "px",
            fontSize: "1.5rem",
            animation: "floatUp 2.5s ease-out forwards",
            opacity: 0,
          }}
        >
          {reaction.emoji}
        </div>
      ))}

      <style>{`
        @keyframes floatUp {
          0% {
            transform: translateY(0) scale(1);
            opacity: 1;
          }
          50% {
            opacity: 1;
          }
          100% {
            transform: translateY(-180px) scale(0.6);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}

export default FloatingReactions;
