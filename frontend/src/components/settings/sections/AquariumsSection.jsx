import React, { useEffect, useRef, useState } from "react";
import { ArrowsClockwise, Check, CheckCircle, Fish, WarningCircle } from "@phosphor-icons/react";
import { SettingsSection } from "../SettingsSection";
import { SettingsToggle } from "../SettingsToggle";
import { SettingsSubsectionLabel as SubsectionLabel } from "../SettingsSubsectionLabel";
import { nextRadioIndex } from "../radioKeys";
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
  const tankRefs = useRef([]);

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

  // Roving tabindex over the tank list (one Tab stop, arrows move and select),
  // the same radio-group keyboard pattern as SettingsRadioGroup. Selection still
  // goes through handleSelectTank, so what is stored is unchanged.
  const selectedTankIndex = tanks.findIndex(
    (tank) => activeTankId != null && Number(tank.id) === Number(activeTankId)
  );
  const tankTabStop = selectedTankIndex >= 0 ? selectedTankIndex : 0;
  const handleTankKeyDown = (event, index) => {
    const next = nextRadioIndex(event.key, index, tanks.length);
    if (next === null) return;
    event.preventDefault();
    tankRefs.current[next]?.focus();
    handleSelectTank(tanks[next]);
  };

  return (
    <SettingsSection
      id="aquariums"
      icon={<Fish size={20} />}
      title={{ casual: "Aquariums & Logbook", pro: "Facility & Logbook" }}
      description={{
        casual:
          "Pick which tank the app treats as your main one, control grow-out reminders, and see when your data last synced.",
        pro:
          "Which tank compatibility checks and your cart use, grow-out reminders, and cloud sync status.",
      }}
      casualModeActive={casualModeActive}
    >
      <div className="st-stack">
        {/* ─── Active tank ─── */}
        <div>
          <SubsectionLabel>{casualModeActive ? "Main tank" : "Active tank"}</SubsectionLabel>
          <p className="st-hint">
            {casualModeActive
              ? "Used to check whether a fish you're looking at would suit your tank, and shown in your cart at checkout."
              : "Compatibility checks and your cart use this tank."}
          </p>

          {tanksLoading ? (
            <p className="st-empty">Loading tanks…</p>
          ) : !walletAccount ? (
            /*
              `useUserTanks` is owner-scoped and disabled without an account, so an
              empty list here means "not signed in", NOT "no tanks". Saying the
              latter would tell someone their tanks are gone.
            */
            <p className="st-empty">
              Sign in to choose which tank the app checks against.
            </p>
          ) : tanks.length === 0 ? (
            <p className="st-empty">
              {casualModeActive
                ? "No tanks yet. Once you add one, you can pick it here."
                : "No active tanks registered to this account."}
            </p>
          ) : (
            <>
              <div
                role="radiogroup"
                aria-label={casualModeActive ? "Main tank" : "Active tank"}
                className="st-choices"
              >
                {tanks.map((tank, index) => {
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
                      ref={(el) => {
                        tankRefs.current[index] = el;
                      }}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      tabIndex={index === tankTabStop ? 0 : -1}
                      onClick={() => handleSelectTank(tank)}
                      onKeyDown={(event) => handleTankKeyDown(event, index)}
                      className="st-choice"
                    >
                      <span className="st-choice-main">
                        <span className="st-choice-mark" aria-hidden="true">
                          {selected && <Check size={13} weight="bold" />}
                        </span>
                        <span className="st-choice-text">
                          <span className="st-choice-label">
                            {tank.name || `Tank ${String(tank.id).slice(0, 6)}`}
                          </span>
                          {gallons > 0 ? (
                            <span className="st-choice-desc">{gallons} gal</span>
                          ) : null}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>

              {activeTankId && (
                <div className="st-actions" style={{ marginTop: "0.6rem" }}>
                  <button
                    type="button"
                    className="st-btn"
                    onClick={() => handleSelectTank(null)}
                  >
                    Clear selection
                  </button>
                </div>
              )}
            </>
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
                : "A device notification when a spawn has no checkpoint for 5 days or more. Checked every 6 hours, at most one per spawn per day."
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
          <div className="st-well">
            {/*
              Prefer the live timestamp from App.jsx over the one read from
              localStorage on mount, so the readout updates the moment a sync
              finishes instead of showing a stale value until the next reload.
            */}
            {(lastSyncedAt || lastSynced) ? (
              <>
                {casualModeActive ? "Last backed up " : "Last synced "}
                <strong>
                  {(lastSyncedAt || lastSynced).toLocaleString()}
                </strong>
              </>
            ) : (
              <span>
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
            <div className="st-actions" style={{ marginTop: "0.75rem" }}>
              <button
                type="button"
                className="st-btn"
                onClick={() => {
                  announce("Syncing now");
                  onSyncNow();
                }}
                disabled={syncStatus === "syncing"}
              >
                <ArrowsClockwise size={18} aria-hidden="true" />
                {syncStatus === "syncing" ? "Syncing…" : casualModeActive ? "Back up now" : "Sync now"}
              </button>
              {syncStatus === "success" && (
                <span className="st-status st-status--success" style={{ margin: 0 }}>
                  <CheckCircle size={18} aria-hidden="true" />
                  <span>Up to date</span>
                </span>
              )}
              {syncStatus === "failed" && (
                <span className="st-status st-status--error" style={{ margin: 0 }}>
                  <WarningCircle size={18} aria-hidden="true" />
                  <span>Sync failed. Check your connection and try again.</span>
                </span>
              )}
            </div>
          ) : (
            <p className="st-hint" style={{ margin: "0.6rem 0 0" }}>
              Sign in to back up and restore across devices.
            </p>
          )}
        </div>
      </div>
    </SettingsSection>
  );
}

export default AquariumsSection;
