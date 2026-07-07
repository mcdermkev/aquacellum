/**
 * MessageButton.jsx
 * 
 * "💬 Message" button shown on any user's profile.
 * Opens/creates a conversation and navigates to it. Messaging is open to all
 * connected users (not just Tankmates) so buyers, sellers, and new members can
 * reach anyone during beta.
 */

import React, { useState } from "react";
import { getOrCreateConversation } from "../../services/messagesApi";
import { getCurrentWallet } from "../../services/supabaseClient";
import { sameWallet } from "../../utils/wallet";
import { useAuth } from "../../contexts/AuthContext";

export function MessageButton({ targetWallet, onOpenConversation }) {
  const [loading, setLoading] = useState(false);
  const { account } = useAuth();
  const currentWallet = account || getCurrentWallet();

  // Show for any other user; only hide for signed-out viewers or self.
  if (!currentWallet || !targetWallet || sameWallet(currentWallet, targetWallet)) return null;

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
