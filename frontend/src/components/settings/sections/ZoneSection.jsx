import React, { useState, useEffect } from "react";
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
      icon="📍"
      title={{ casual: "Zone & Location", pro: "Regional Zone Assignment" }}
      description={{
        casual:
          "Enable location to join your regional zone leaderboard and compete with nearby keepers. Your exact coordinates are never stored — only your city-level zone.",
        pro:
          "Assign your operator profile to a geographic zone for regional leaderboard rankings. Location is bucketed to a 15–30 mile zone — precise coordinates are discarded after hashing.",
      }}
      casualModeActive={casualModeActive}
    >
      <ZoneAssignmentFlow
        onComplete={(zone) => {
          setJoinedMessage(`Joined zone: ${zone.displayName}`);
          setZoneAssigned(true);
        }}
        onSkip={() => {}}
        isTransfer={zoneAssigned}
        casualModeActive={casualModeActive}
      />

      {joinedMessage && (
        <div
          style={{
            marginTop: "1rem",
            padding: "0.75rem 1rem",
            borderRadius: "var(--radius-sm)",
            fontSize: "0.8rem",
            fontWeight: 500,
            backgroundColor: "rgba(52, 211, 153, 0.08)",
            border: "1px solid rgba(52, 211, 153, 0.25)",
            color: "var(--accent-green)",
          }}
        >
          {joinedMessage}
        </div>
      )}
    </SettingsSection>
  );
}

export default ZoneSection;
