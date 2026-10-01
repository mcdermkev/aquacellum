/**
 * MentorshipPanel.jsx
 * 
 * Mentor/Mentee pairing interface.
 * - Granted founders/stewards can opt in or out as mentors
 * - Mentee request flow with message
 * - Server-authorized relationship transitions and active pairing display
 */

import React, { useRef, useState } from "react";
import {
  useMentorships,
  useAvailableMentors,
  useRequestMentorship,
  useAcceptMentorship,
  useDeclineMentorship,
  useEndMentorship,
  useToggleAcceptingMentees,
} from "../../hooks/useAudits";
import { GraduationCap } from "@phosphor-icons/react";
import { getCurrentWallet } from "../../services/supabaseClient";
import { sameWallet } from "../../utils/wallet";
import { UnlockPrompt, useUnlockGate } from "./UnlockPrompt";
import "./ProfileDaylight.css";

function PersonButton({ profile, meta, onViewProfile }) {
  const name = profile?.display_name || (profile?.wallet_address ? `${profile.wallet_address.slice(0, 6)}...` : "Unknown");
  return (
    <button type="button" className="pf-person" onClick={() => onViewProfile?.(profile?.wallet_address)}>
      <span
        className="pf-person-avatar"
        aria-hidden="true"
        style={profile?.avatar_url ? { backgroundImage: `url(${profile.avatar_url})` } : undefined}
      />
      <span className="pf-person-text">
        <span className="pf-person-name">{name}</span>
        {meta && <span className="pf-person-meta">{meta}</span>}
      </span>
    </button>
  );
}

export function MentorshipPanel({ walletAddress, acceptingMentees = false, onViewProfile, casualModeActive = false }) {
  const currentWallet = getCurrentWallet();
  const isOwnProfile = sameWallet(currentWallet, walletAddress);

  // Mentoring is granted community authority, never an XP/Depth tier unlock.
  const mentorGate = useUnlockGate("canMentor");

  const [requestingMentor, setRequestingMentor] = useState(null);
  const [requestMessage, setRequestMessage] = useState("");
  const [showMentorList, setShowMentorList] = useState(false);
  // The "Request" button that opened the dialog, so focus goes back to it.
  const requestOpenerRef = useRef(null);
  // Both reads below are Reef trust requests, and every Reef trust request
  // carries a fresh wallet signature (reefTrustApi.js). Firing them on mount
  // meant simply opening your own profile asked the wallet to sign twice,
  // which is the "MetaMask pops up when I click Profile" report. They now run
  // only after the keeper asks for them.
  const [mentorshipsRequested, setMentorshipsRequested] = useState(false);

  const { data: mentorshipsResult, isFetching: mentorshipsLoading } =
    useMentorships(walletAddress, isOwnProfile && mentorshipsRequested);
  const { data: mentorsResult } = useAvailableMentors(isOwnProfile && showMentorList);
  
  const requestMentorshipMutation = useRequestMentorship();
  const acceptMentorshipMutation = useAcceptMentorship();
  const declineMentorshipMutation = useDeclineMentorship();
  const endMentorshipMutation = useEndMentorship();
  const toggleMenteesMutation = useToggleAcceptingMentees();

  const mentorships = mentorshipsResult?.data || { asMentor: [], asMentee: [] };
  const availableMentors = mentorsResult?.data || [];

  const activeMentorPairings = mentorships.asMentor.filter((m) => m.status === "active");
  const pendingMentorRequests = mentorships.asMentor.filter((m) => m.status === "pending");
  const activeMenteePairings = mentorships.asMentee.filter((m) => m.status === "active");
  const pendingMenteeRequests = mentorships.asMentee.filter((m) => m.status === "pending");

  const openRequestDialog = (mentorWallet, opener) => {
    requestOpenerRef.current = opener;
    setRequestingMentor(mentorWallet);
  };

  // Closes the dialog the way Cancel always has, then returns focus to the
  // button that opened it (when it is still on the page).
  const closeRequestDialog = () => {
    setRequestingMentor(null);
    setRequestMessage("");
    const opener = requestOpenerRef.current;
    requestOpenerRef.current = null;
    if (opener?.isConnected) opener.focus();
  };

  // Keeps Tab and Shift+Tab inside the dialog; Escape closes it like Cancel.
  const handleDialogKeyDown = (e) => {
    if (e.key === "Escape") {
      closeRequestDialog();
      return;
    }
    if (e.key !== "Tab") return;
    const focusable = e.currentTarget.querySelectorAll("textarea:not([disabled]), button:not([disabled])");
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    const onItem = active !== e.currentTarget && e.currentTarget.contains(active);
    if (e.shiftKey && (active === first || !onItem)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !onItem)) {
      e.preventDefault();
      first.focus();
    }
  };

  const handleRequestMentorship = async () => {
    if (!requestingMentor) return;
    try {
      await requestMentorshipMutation.mutateAsync({
        mentorWallet: requestingMentor,
        message: requestMessage,
      });
      closeRequestDialog();
    } catch {
      // React Query retains the error; the panel renders it below.
    }
  };

  const panelError = mentorshipsResult?.error || mentorsResult?.error || [
    requestMentorshipMutation,
    acceptMentorshipMutation,
    declineMentorshipMutation,
    endMentorshipMutation,
    toggleMenteesMutation,
  ].find((mutation) => mutation.error)?.error?.message;

  return (
    <div className="mentorship-panel pf-stack" style={{ gap: "1rem" }}>
      {panelError && <p role="alert" className="pf-error">{panelError}</p>}
      {/* XP Unlock Prompt */}
      {mentorGate.showPrompt && (
        <UnlockPrompt
          privilege="canMentor"
          casualModeActive={casualModeActive}
          onClose={() => mentorGate.setShowPrompt(false)}
        />
      )}

      {/* Accepting Mentees Toggle (granted mentors, own profile) */}
      {isOwnProfile && mentorGate.hasAccess && (
        <div className="pf-switch-row">
          <div className="pf-switch-text">
            <strong>Accept mentees</strong>
            <span>Let other keepers ask you to be their mentor.</span>
          </div>
          <button
            type="button"
            className="reef-switch pf-switch"
            onClick={() => toggleMenteesMutation.mutate(!acceptingMentees)}
            disabled={toggleMenteesMutation.isPending}
            role="switch"
            aria-checked={acceptingMentees}
            aria-label={acceptingMentees ? "Stop accepting mentees" : "Start accepting mentees"}
          >
            <span />
          </button>
        </div>
      )}

      {/* Mentor teaser: shown when the keeper has not been granted mentoring */}
      {isOwnProfile && !mentorGate.hasAccess && (
        <div className="pf-callout">
          <GraduationCap size={24} weight="duotone" aria-hidden="true" />
          <div className="pf-callout-body">
            <strong>{casualModeActive ? "Become a mentor" : "Mentor status"}</strong>
            <p>
              {casualModeActive
                ? "Mentors are trusted community volunteers selected by the Aquacellum team."
                : "Mentoring is granted to founders and stewards. XP and Depth do not unlock it."
              }
            </p>
            <button type="button" className="reef-btn" onClick={() => mentorGate.checkAccess()}>
              How mentors are chosen
            </button>
          </div>
        </div>
      )}

      {/* Pending Requests (as Mentor) */}
      {isOwnProfile && pendingMentorRequests.length > 0 && (
        <div>
          <h4 className="pf-sub">Mentee requests</h4>
          <div className="pf-stack">
            {pendingMentorRequests.map((m) => (
              <div key={m.id} className="pf-row">
                <PersonButton
                  profile={m.mentee}
                  meta={m.message ? `"${m.message}"` : null}
                  onViewProfile={onViewProfile}
                />
                <div className="pf-row-actions">
                  <button
                    type="button"
                    onClick={() => acceptMentorshipMutation.mutate(m.id)}
                    className="reef-btn reef-btn--primary"
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    onClick={() => declineMentorshipMutation.mutate(m.id)}
                    className="reef-btn"
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active Pairings (as Mentor) */}
      {activeMentorPairings.length > 0 && (
        <div>
          <h4 className="pf-sub">Your mentees</h4>
          <div className="pf-stack">
            {activeMentorPairings.map((m) => (
              <PairingCard
                key={m.id}
                profile={m.mentee}
                relationship="Mentee"
                onViewProfile={onViewProfile}
                onEnd={() => endMentorshipMutation.mutate(m.id)}
                isOwnProfile={isOwnProfile}
              />
            ))}
          </div>
        </div>
      )}

      {/* Active Pairings (as Mentee) */}
      {activeMenteePairings.length > 0 && (
        <div>
          <h4 className="pf-sub">Your mentor{activeMenteePairings.length > 1 ? "s" : ""}</h4>
          <div className="pf-stack">
            {activeMenteePairings.map((m) => (
              <PairingCard
                key={m.id}
                profile={m.mentor}
                relationship="Mentor"
                onViewProfile={onViewProfile}
                onEnd={() => endMentorshipMutation.mutate(m.id)}
                isOwnProfile={isOwnProfile}
              />
            ))}
          </div>
        </div>
      )}

      {/* Pending (as Mentee) */}
      {pendingMenteeRequests.length > 0 && (
        <div>
          <h4 className="pf-sub">Waiting for a reply</h4>
          {pendingMenteeRequests.map((m) => (
            <p key={m.id} className="pf-muted">
              Waiting for {m.mentor?.display_name || "your mentor"} to reply.
            </p>
          ))}
        </div>
      )}

      {/* Your pairings load on request (see mentorshipsRequested above). */}
      {isOwnProfile && !mentorshipsRequested && (
        <button
          type="button"
          onClick={() => setMentorshipsRequested(true)}
          className="reef-btn reef-btn--block"
        >
          Show my mentorships
        </button>
      )}
      {isOwnProfile && mentorshipsRequested && mentorshipsLoading && !mentorshipsResult && (
        <p role="status" className="pf-muted">
          Loading your mentorships…
        </p>
      )}
      {isOwnProfile && mentorshipsRequested && mentorshipsResult && !mentorshipsResult.error
        && mentorships.asMentor.length === 0 && mentorships.asMentee.length === 0 && (
        <p className="pf-muted">
          No mentorships yet.
        </p>
      )}

      {/* Find a Mentor Button */}
      {isOwnProfile && activeMenteePairings.length === 0 && (
        <div className="pf-stack">
          <button
            type="button"
            onClick={() => {
              setShowMentorList(!showMentorList);
              setMentorshipsRequested(true);
            }}
            className="reef-btn reef-btn--block"
            aria-expanded={showMentorList}
          >
            {showMentorList ? "Hide mentors" : "Find a mentor"}
          </button>

          {showMentorList && (
            <div className="pf-stack">
              {availableMentors.length === 0 ? (
                <p className="pf-muted" style={{ textAlign: "center", padding: "0.75rem" }}>
                  No mentors are taking mentees right now. Check back later.
                </p>
              ) : (
                availableMentors.map((mentor) => (
                  <div key={mentor.wallet_address} className="pf-row">
                    <PersonButton
                      profile={mentor}
                      meta={`${mentor.companion_tier} · ${mentor.xp_total} XP`}
                      onViewProfile={onViewProfile}
                    />
                    <button
                      type="button"
                      onClick={(e) => openRequestDialog(mentor.wallet_address, e.currentTarget)}
                      className="reef-btn reef-btn--primary"
                    >
                      Request
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* Request dialog. Escape closes it the same way Cancel does; Tab stays
          inside it, and a click on the backdrop does not move focus out. */}
      {requestingMentor && (
        <div
          className="pf-modal-backdrop"
          onMouseDown={(e) => { if (e.target === e.currentTarget) e.preventDefault(); }}
        >
          <div
            className="pf-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pf-mentor-request-title"
            tabIndex={-1}
            onKeyDown={handleDialogKeyDown}
          >
            <h3 id="pf-mentor-request-title">Request mentorship</h3>
            <textarea
              className="reef-form-input reef-form-textarea"
              value={requestMessage}
              onChange={(e) => setRequestMessage(e.target.value.slice(0, 300))}
              placeholder="Say who you are and what you'd like help with"
              aria-label="Message to the mentor"
              rows={3}
              maxLength={300}
              autoFocus
            />
            <span className="pf-count">
              {requestMessage.length}/300
            </span>
            <div className="pf-modal-actions">
              <button type="button" onClick={closeRequestDialog} className="reef-btn">
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRequestMentorship}
                disabled={requestMentorshipMutation.isPending}
                className="reef-btn reef-btn--primary"
              >
                {requestMentorshipMutation.isPending ? "Sending…" : "Send request"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PairingCard({ profile, relationship, onViewProfile, onEnd, isOwnProfile }) {
  if (!profile) return null;
  const name = profile.display_name || `${profile.wallet_address.slice(0, 6)}...`;

  return (
    <div className="pf-row">
      <PersonButton profile={profile} meta={relationship} onViewProfile={onViewProfile} />
      {isOwnProfile && (
        <button
          type="button"
          onClick={onEnd}
          className="reef-btn reef-btn--ghost"
          aria-label={`End pairing with ${name}`}
        >
          End
        </button>
      )}
    </div>
  );
}
