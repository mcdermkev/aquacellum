/**
 * MessageButton.jsx
 * 
 * "💬 Message" button shown on Tankmate profiles.
 * Opens/creates a conversation and navigates to it.
 */

import React, { useState } from "react";
import { getOrCreateConversation } from "../../services/messagesApi";
import { getCurrentWallet } from "../../services/supabaseClient";
import { getRelationshipStatus } from "../../services/reefApi";

export function MessageButton({ targetWallet, onOpenConversation }) {
  const [loading, setLoading] = useState(false);
  const [visible, setVisible] = useState(null); // null = checking
  const currentWallet = getCurrentWallet();

  if (!currentWallet || currentWallet === targetWallet) return null;

  // Check if they're tankmates (only show for mutual connections)
  React.useEffect(() => {
    getRelationshipStatus(targetWallet).then((status) => {
      setVisible(status === "tankmate");
    });
  }, [targetWallet]);

  if (visible === null || !visible) return null;

  const handleClick = async () => {
    setLoading(true);
    const { data } = await getOrCreateConversation(targetWallet);
    if (data && onOpenConversation) {
      onOpenConversation(data.id, targetWallet);
    }
    setLoading(false);
  };

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      style={{
        padding: "0.4rem 0.8rem",
        borderRadius: "50px",
        border: "1px solid rgba(56, 189, 248, 0.25)",
        background: "rgba(56, 189, 248, 0.06)",
        color: "#38bdf8",
        fontSize: "0.7rem",
        fontWeight: 600,
        cursor: loading ? "default" : "pointer",
        transition: "all 0.15s ease",
        opacity: loading ? 0.6 : 1,
      }}
    >
      {loading ? "Opening…" : "💬 Message"}
    </button>
  );
}

export default MessageButton;
