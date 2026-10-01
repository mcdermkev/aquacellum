import React, { useState, useEffect } from "react";
import { CheckCircle, MapPin } from "@phosphor-icons/react";
import { SettingsSection } from "../SettingsSection";
import { ZoneAssignmentFlow } from "../../ZoneAssignmentFlow";
import { useAuth } from "../../../contexts/AuthContext";
import { fetchMyZoneAssignment } from "../../../services/zoneLeaderboardApi";

/**
 * ZoneSection — Settings → Zone & Location.
 *
 * Split out of the old DataPortabilityWidget.jsx; restyle-only per
 * docs/SETTINGS_SPEC.md §6 #10 (no behavior change to `ZoneAssignmentFlow`).
 *
 * `zoneAssigned` decides whether the flow presents itself as a first-time JOIN or
 * as a TRANSFER — and a transfer warns "you can only transfer once every 90 days".
 * So getting it wrong does not just mislabel a heading, it invents a restriction.
 *
 * ⚠️ It is read from Supabase `profiles.zone_hash`, NOT from Dexie's
 * `userProfile.zoneHash`. The Dexie field is misleadingly named: `useXPSync.js`
 * sets it to a deterministic hash of the WALLET ADDRESS on every XP award, with no
 * geographic input at all. Checking it (as this section originally did) made
 * `zoneAssigned` true for anyone who had ever earned one XP point, so users who
 * had never joined a zone were shown "Transfer Your Zone" and a 90-day cooldown
 * that did not apply to them. Supabase is where `assignUserToZone` actually
 * writes, so it is the only field that answers the question being asked.
 */
export function ZoneSection({ casualModeActive }) {
  const { account } = useAuth();
  const [zoneAssigned, setZoneAssigned] = useState(false);
  const [joinedMessage, setJoinedMessage] = useState(null);

  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    // Defaults to false on any error: showing the join flow to someone already in
    // a zone is recoverable (assignUserToZone re-checks the cooldown server-side
    // and refuses), whereas claiming a nonexistent 90-day lockout is not.
    fetchMyZoneAssignment()
      .then((res) => {
        if (!cancelled) setZoneAssigned(!!res.assigned);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [account]);

  return (
    <SettingsSection
      id="zone"
      icon={<MapPin size={20} />}
      title={{ casual: "Zone & Location", pro: "Regional Zone Assignment" }}
      description={{
        casual:
          "Share your location once to join your regional leaderboard with nearby keepers. Only your city-level zone is stored, never your exact location.",
        pro:
          "Assign your profile to a regional zone for leaderboard rankings. Location is rounded to a 15–30 mile zone; exact coordinates are discarded.",
      }}
      casualModeActive={casualModeActive}
    >
      {/*
        No `onSkip` here: Settings has nothing to skip to, and the old no-op
        handler rendered "Skip for now" / "Skip" buttons that did nothing.
      */}
      <ZoneAssignmentFlow
        onComplete={(zone) => {
          setJoinedMessage(`Joined zone: ${zone.displayName}`);
          setZoneAssigned(true);
        }}
        isTransfer={zoneAssigned}
        casualModeActive={casualModeActive}
      />

      {joinedMessage && (
        <p className="st-note st-note--success" style={{ marginTop: "1rem" }}>
          <CheckCircle size={18} aria-hidden="true" />
          <span>{joinedMessage}</span>
        </p>
      )}
    </SettingsSection>
  );
}

export default ZoneSection;
