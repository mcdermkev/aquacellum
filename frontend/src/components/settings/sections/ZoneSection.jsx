import React, { useState, useEffect } from "react";
import { SettingsSection } from "../SettingsSection";
import { ZoneAssignmentFlow } from "../../ZoneAssignmentFlow";
import { useAuth } from "../../../contexts/AuthContext";
import { db } from "../../../db";

/**
 * ZoneSection — Settings → Zone & Location.
 *
 * Split out of the old DataPortabilityWidget.jsx; restyle-only per
 * docs/SETTINGS_SPEC.md §6 #10 (no behavior change to `ZoneAssignmentFlow`).
 * `zoneAssigned` (whether to render the flow as a transfer vs. a first
 * assignment) is looked up locally from Dexie rather than threaded down from
 * `App.jsx`/`SettingsPanel`, same as the original widget did.
 */
export function ZoneSection({ casualModeActive }) {
  const { account } = useAuth();
  const [zoneAssigned, setZoneAssigned] = useState(false);
  const [joinedMessage, setJoinedMessage] = useState(null);

  useEffect(() => {
    if (!account) return;
    db.userProfile
      .get(account)
      .then((profile) => {
        if (profile && profile.zoneHash) setZoneAssigned(true);
      })
      .catch(() => {});
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
