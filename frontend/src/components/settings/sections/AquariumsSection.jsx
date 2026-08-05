import React, { useEffect, useState } from "react";
import { SettingsSection } from "../SettingsSection";
import { SettingsToggle } from "../SettingsToggle";
import { SettingsSubsectionLabel as SubsectionLabel } from "../SettingsSubsectionLabel";
import { announce } from "../../../utils/a11y";
import { areRemindersEnabled, setRemindersEnabled } from "../../../utils/growoutReminders";
import { useUserTanks } from "../../../hooks/useUserTanks";
import { tankFitInputs } from "../../../services/compatibleTanks";

/**
 * AquariumsSection — Settings → Aquariums & Logbook
 * (docs/SETTINGS_SPEC.md §6 #7).
 *
 * Three controls, each rescuing something that already worked but had no reachable
 * UI (handoff §3.5 and §3.6):
 *
 *   1. ACTIVE TANK — `aquadex_display_tank`. Already read by `App.jsx` and
 *      `SpecimenDetailModal`, and it feeds the cart drawer's `buyerTank`, so the
 *      choice decides which tank compatibility is checked against when you shop.
 *      It was only settable from the tank list; this makes it visible and
 *      changeable where you'd look for it.
 *
 *      ⚠️ `displayTank` IS NOT A TANK RECORD. It is `{ id, name, volume, temp, ph }`
 *      with volume in GALLONS and temp in °C, so a record (which stores
 *      `volumeLiters` and hides water params in `latestLog`) MUST go through
 *      `tankFitInputs()` first — the same call FishFinder makes. Storing a raw
 *      record makes the fit scorer read NaN and silently return a perfect score for
 *      any tank; see `__tests__/settingsActiveTank.test.js` for the mechanism.
 *
 *      Tanks come from `useUserTanks`, not a direct `db.tanks` read, for the same
 *      reason "Sync now" reuses `runCloudSync`: one definition of "my tanks". It
 *      also scopes by owner — a bare scan returns every account cached on the
 *      device, so a shared browser could bind checks to a stranger's tank.
 *   2. GROW-OUT REMINDERS — `aquadex_growout_reminders_enabled`.
 *      `checkGrowoutReminders()` already honours it (`if (!areRemindersEnabled())
 *      return 0`), but `setRemindersEnabled()` had ZERO callers, so
 *      `initGrowoutReminders()` ran on every boot and could not be turned off.
 *      This is the missing writer, not a new feature.
 *   3. SYNC STATUS + "SYNC NOW" — `aquadex_last_synced` was held in App state with
 *      no UI at all. The button calls `runCloudSync` in `App.jsx`, the same routine
 *      the login sync runs, so there is one definition of what syncing means and
 *      one owner of both the status and the timestamp. It is threaded in rather
 *      than reimplemented here precisely so a second, subtly different sync cannot
 *      exist — and it renders only when a sync can actually happen, since a button
 *      that silently does nothing is the defect this rework removes.
 */
export function AquariumsSection({
  casualModeActive,
  contractAddress,
  walletAccount,
  displayTank,
  setDisplayTank,
  onSyncNow,
  syncStatus,
  lastSyncedAt,
}) {
  // Same source, same query key, same owner scoping as Fish Finder and the tank
  // list — so the list here cannot disagree with the list there, and react-query
  // serves it from cache if any of those has already loaded it.
  const { data: tanks = [], isLoading: tanksLoading } = useUserTanks(contractAddress, walletAccount);
  const [remindersOn, setRemindersOn] = useState(() => areRemindersEnabled());
  const [lastSynced, setLastSynced] = useState(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("aquadex_last_synced");
      setLastSynced(raw ? new Date(raw) : null);
    } catch {
      setLastSynced(null);
    }
  }, []);

  const handleReminders = (next) => {
    setRemindersEnabled(next);
    setRemindersOn(next);
  };

  /**
   * Store the NORMALIZED shape, never the tank record — see the ⚠️ note above.
   * `tankFitInputs` converts volumeLiters → gallons and lifts temp/pH out of
   * `latestLog`, which is exactly what every consumer of `displayTank` expects.
   */
  const handleSelectTank = (tank) => {
    setDisplayTank(tank ? { id: tank.id, name: tank.name, ...tankFitInputs(tank) } : null);
    announce(tank ? `Active tank set to ${tank.name || "unnamed tank"}` : "Active tank cleared");
  };

  const activeTankId = displayTank?.id ?? null;

  return (
    <SettingsSection
      id="aquariums"
      icon="🐠"
      title={{ casual: "Aquariums & Logbook", pro: "Facility & Logbook" }}
      description={{
        casual:
          "Pick which tank the app treats as your main one, control grow-out reminders, and see when your data last synced.",
        pro:
          "Active-tank binding for compatibility checks and cart context, grow-out checkpoint reminder scheduling, and cloud sync status.",
      }}
      casualModeActive={casualModeActive}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
        {/* ─── Active tank ─── */}
        <div>
          <SubsectionLabel>{casualModeActive ? "Main tank" : "Active tank"}</SubsectionLabel>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.4 }}>
            {casualModeActive
              ? "Used to check whether a fish you're looking at would suit your tank, and shown in your cart at checkout."
              : "Binds compatibility evaluation and cart buyer-context to this tank."}
          </p>

          {tanksLoading ? (
            <p style={{ fontSize: 12, color: "var(--text-muted)" }}>Loading tanks…</p>
          ) : !walletAccount ? (
            /*
              `useUserTanks` is owner-scoped and disabled without an account, so an
              empty list here means "not signed in", NOT "no tanks". Saying the
              latter would tell someone their tanks are gone.
            */
            <p style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
              Sign in to choose which tank the app checks against.
            </p>
          ) : tanks.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
              {casualModeActive
                ? "No tanks yet. Once you add one, you can pick it here."
                : "No active tanks registered to this account."}
            </p>
          ) : (
            <div
              role="radiogroup"
              aria-label={casualModeActive ? "Main tank" : "Active tank"}
              style={{ display: "flex", flexDirection: "column", gap: 8 }}
            >
              {tanks.map((tank) => {
                // Null-guarded because `Number(null)` is 0, which would mark a
                // tank with id 0 as selected whenever nothing is selected.
                const selected = activeTankId != null && Number(tank.id) === Number(activeTankId);
                // Same conversion as the stored value, so the label can't disagree
                // with what compatibility is scored against. (`tank.volumeGallons`
                // is not a field — reading it rendered nothing at all.)
                const gallons = tankFitInputs(tank).volume;
                return (
                  <button
                    key={tank.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => handleSelectTank(tank)}
                    style={optionStyle(selected)}
                  >
                    <span>
                      <span style={optionTitleStyle(selected)}>
                        {tank.name || `Tank ${String(tank.id).slice(0, 6)}`}
                        {selected && (
                          <span aria-hidden="true" style={{ marginLeft: 6 }}>
                            ✓
                          </span>
                        )}
                      </span>
                      {gallons > 0 ? (
                        <span style={optionDescStyle}>{gallons} gal</span>
                      ) : null}
                    </span>
                  </button>
                );
              })}

              {activeTankId && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => handleSelectTank(null)}
                  style={{ alignSelf: "flex-start", padding: "0.5rem 1rem", fontSize: "0.75rem", minHeight: 36 }}
                >
                  Clear selection
                </button>
              )}
            </div>
          )}
        </div>

        {/* ─── Grow-out reminders ─── */}
        <div>
          <SubsectionLabel>{casualModeActive ? "Fry reminders" : "Grow-out reminders"}</SubsectionLabel>
          <SettingsToggle
            label={casualModeActive ? "Fry reminders" : "Grow-out checkpoint reminders"}
            hint={
              casualModeActive
                ? "A nudge from Poseidon when a batch of fry hasn't been logged in 5 days. Checked every 6 hours while the app is open."
                : "Local notification when a spawn has no checkpoint activity for 5+ days. Polled every 6 hours; deduplicated to one nudge per spawn per 24h."
            }
            enabled={remindersOn}
            onChange={handleReminders}
            announceOn="Grow-out reminders turned on"
            announceOff="Grow-out reminders turned off"
          />
        </div>

        {/* ─── Sync status + manual sync ─── */}
        <div>
          <SubsectionLabel>{casualModeActive ? "Backup status" : "Cloud sync"}</SubsectionLabel>
          <div
            style={{
              padding: "0.75rem 1rem",
              borderRadius: 10,
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.08)",
              fontSize: 12,
              color: "var(--text-muted)",
              lineHeight: 1.5,
            }}
          >
            {/*
              Prefer the live timestamp from App.jsx over the one read from
              localStorage on mount, so the readout updates the moment a sync
              finishes instead of showing a stale value until the next reload.
            */}
            {(lastSyncedAt || lastSynced) ? (
              <>
                {casualModeActive ? "Last backed up " : "Last synced "}
                <strong style={{ color: "var(--text-primary)" }}>
                  {(lastSyncedAt || lastSynced).toLocaleString()}
                </strong>
              </>
            ) : (
              <span style={{ fontStyle: "italic" }}>
                {casualModeActive
                  ? "Nothing has synced on this device yet."
                  : "No sync timestamp recorded on this device."}
              </span>
            )}
          </div>

          {/*
            "Sync now" calls the SAME routine the login sync runs (App.jsx's
            runCloudSync), so there is one definition of syncing and one owner of
            the status. It only renders when a sync can actually be performed —
            no wallet, or E2E mode, means no button rather than a button that
            silently does nothing.
          */}
          {onSyncNow ? (
            <div style={{ marginTop: "0.75rem", display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  announce("Syncing now");
                  onSyncNow();
                }}
                disabled={syncStatus === "syncing"}
                style={{ padding: "0.5rem 1rem", fontSize: "0.78rem", minHeight: 40 }}
              >
                {syncStatus === "syncing" ? "Syncing…" : casualModeActive ? "Back up now" : "Sync now"}
              </button>
              {syncStatus === "success" && (
                <span style={{ fontSize: "0.72rem", color: "var(--accent-green)" }}>✓ Up to date</span>
              )}
              {syncStatus === "failed" && (
                <span style={{ fontSize: "0.72rem", color: "var(--accent-red)" }}>
                  ⚠️ Sync failed — check your connection and try again.
                </span>
              )}
            </div>
          ) : (
            <p style={{ margin: "0.6rem 0 0", fontSize: 11, color: "var(--text-muted)", lineHeight: 1.4 }}>
              Sign in to back up and restore across devices.
            </p>
          )}
        </div>
      </div>
    </SettingsSection>
  );
}

function optionStyle(selected) {
  return {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    width: "100%",
    minHeight: 44,
    textAlign: "left",
    font: "inherit",
    color: "inherit",
    border: `1px solid ${selected ? "#38bdf8" : "rgba(255,255,255,0.08)"}`,
    borderRadius: 8,
    padding: "10px 12px",
    background: selected ? "rgba(56, 189, 248, 0.08)" : "rgba(255,255,255,0.02)",
    cursor: selected ? "default" : "pointer",
  };
}

function optionTitleStyle(selected) {
  return {
    display: "block",
    fontSize: 13,
    fontWeight: 600,
    color: selected ? "#38bdf8" : "var(--text-primary)",
  };
}

const optionDescStyle = {
  display: "block",
  fontSize: 11,
  color: "var(--text-muted)",
  marginTop: 2,
};

export default AquariumsSection;
