/**
 * MessageButton.jsx
 * 
 * "Message" button shown on any user's profile.
 * Opens/creates a conversation and navigates to it. Messaging is open to all
 * connected users (not just Tankmates) so buyers, sellers, and new members can
 * reach anyone during beta.
 */

import React, { useState } from "react";
import { ChatCircle } from "@phosphor-icons/react";
import { getOrCreateConversation } from "../../services/messagesApi";
import "./ReefDaylight.css";
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
    <button type="button" className="reef-btn" onClick={handleClick} disabled={loading}>
      <ChatCircle size={18} weight="bold" aria-hidden="true" />
      {loading ? "Opening…" : "Message"}
    </button>
  );
}

export default MessageButton;
