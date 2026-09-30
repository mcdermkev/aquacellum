/**
 * SchoolInvites.jsx
 * 
 * Panel showing pending school invites for the current user.
 * Displayed in the Following tab of the Reef feed.
 */

import React, { useState, useEffect } from "react";
import { getMySchoolInvites, acceptSchoolInvite, declineSchoolInvite } from "../../services/schoolsApi";
import { getCurrentWallet } from "../../services/supabaseClient";
import { useAuth } from "../../contexts/AuthContext";
import "./ReefDaylight.css";

export function SchoolInvites({ onNavigateSchool }) {
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [responding, setResponding] = useState(null);
  const { account } = useAuth();
  const walletAddress = account || getCurrentWallet();

  useEffect(() => {
    if (!walletAddress) return;
    loadInvites();
  }, [walletAddress]);

  const loadInvites = async () => {
    const { data } = await getMySchoolInvites();
    setInvites(data || []);
    setLoading(false);
  };

  const handleAccept = async (invite) => {
    setResponding(invite.id);
    await acceptSchoolInvite(invite.id, invite.school_id);
    setInvites((prev) => prev.filter((i) => i.id !== invite.id));
    setResponding(null);
  };

  const handleDecline = async (invite) => {
    setResponding(invite.id);
    await declineSchoolInvite(invite.id);
    setInvites((prev) => prev.filter((i) => i.id !== invite.id));
    setResponding(null);
  };

  if (loading || invites.length === 0) return null;

  return (
    <section className="reef-inbox-card" aria-label="Club invites">
      <h3>Club invites ({invites.length})</h3>
      <ul className="reef-inbox-list">
        {invites.map((invite) => (
          <li key={invite.id} className="reef-inbox-row">
            <div className="reef-inbox-row-text">
              <button type="button" className="reef-link" style={{ textAlign: "left", color: "var(--text-primary)" }} onClick={() => onNavigateSchool?.(invite.school?.id)}>
                {invite.school?.name || "A club"}
              </button>
              {invite.inviter && (
                <span className="reef-inbox-row-meta">
                  Invited by {invite.inviter.display_name || invite.invited_by?.slice(0, 8)}
                </span>
              )}
            </div>
            <div className="reef-inbox-row-actions">
              <button type="button" className="reef-btn reef-btn--sm reef-btn--primary" onClick={() => handleAccept(invite)} disabled={responding === invite.id}>
                Join
              </button>
              <button type="button" className="reef-btn reef-btn--sm" onClick={() => handleDecline(invite)} disabled={responding === invite.id}>
                Decline
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default SchoolInvites;
