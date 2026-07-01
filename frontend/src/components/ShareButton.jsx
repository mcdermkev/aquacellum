import React, { useState } from "react";
import { shareCardImage } from "../utils/shareCard";

/**
 * ShareButton — Reusable share button that generates a card image and shares it.
 *
 * Props:
 *   generateCard: async () => Blob — function that generates the share card
 *   title: string — share title
 *   text: string — share description
 *   label: string — button label (default "Share")
 *   size: "sm" | "md" — button size
 */
export function ShareButton({ generateCard, title, text, label = "Share", size = "sm" }) {
  const [sharing, setSharing] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const handleShare = async (e) => {
    e.stopPropagation();
    if (sharing) return;
    setSharing(true);
    setFeedback(null);

    try {
      const blob = await generateCard();
      const result = await shareCardImage(blob, title, text);

      if (result.method === "clipboard") {
        setFeedback("Copied!");
      } else if (result.method === "download") {
        setFeedback("Saved!");
      } else if (result.method === "native") {
        setFeedback("Shared!");
      }
    } catch (err) {
      console.warn("[Share] Failed:", err);
      setFeedback("Error");
    } finally {
      setSharing(false);
      setTimeout(() => setFeedback(null), 2000);
    }
  };

  const isSmall = size === "sm";

  return (
    <button
      onClick={handleShare}
      disabled={sharing}
      style={{
        display: "inline-flex", alignItems: "center", gap: "4px",
        padding: isSmall ? "3px 8px" : "6px 12px",
        borderRadius: isSmall ? "6px" : "8px",
        fontSize: isSmall ? "0.62rem" : "0.72rem",
        fontWeight: "600",
        background: feedback ? "rgba(52, 211, 153, 0.1)" : "rgba(139, 92, 246, 0.06)",
        border: `1px solid ${feedback ? "rgba(52, 211, 153, 0.3)" : "rgba(139, 92, 246, 0.15)"}`,
        color: feedback ? "#34d399" : "#a78bfa",
        cursor: sharing ? "wait" : "pointer",
        transition: "all 0.2s",
        opacity: sharing ? 0.6 : 1,
      }}
      onMouseEnter={(e) => { if (!sharing && !feedback) e.currentTarget.style.background = "rgba(139, 92, 246, 0.12)"; }}
      onMouseLeave={(e) => { if (!feedback) e.currentTarget.style.background = "rgba(139, 92, 246, 0.06)"; }}
    >
      {sharing ? "..." : feedback || `📤 ${label}`}
    </button>
  );
}

export default ShareButton;
