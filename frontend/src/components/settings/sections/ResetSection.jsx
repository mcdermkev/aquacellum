import React, { useState } from "react";
import { Broom, Warning } from "@phosphor-icons/react";
import { SettingsSection } from "../SettingsSection";
import { db } from "../../../db";

/**
 * ResetSection — Settings → Clear this device ("Purge local database" in Pro).
 *
 * ⚠️ RENAMED AND RE-SCOPED IN PHASE 4B (docs/SETTINGS_SPEC.md D-S-1). This section
 * is the reason account deletion had to move into Settings, and the two are only
 * safely distinguishable together.
 *
 * The problem it caused: this was the ONLY destructive-looking control in
 * Settings, it was called "Reset Local Data" / "Reset Everything", and account
 * deletion lived somewhere else entirely (Reef → ProfileEdit). A user who came to
 * Settings intending to delete their account found the button that looked right
 * and got something completely different — a Dexie + `aquadex_*` wipe that leaves
 * the account, the cloud data, and the profile fully intact.
 *
 * So the copy now leads with what this does NOT do. "Clear this device" says the
 * scope in the label, the callout states that the account is untouched, and the
 * footer points at Privacy & Data for the thing a user looking for deletion
 * actually wants. Behaviour is unchanged — only the framing, which was the
 * dangerous part.
 */
export function ResetSection({ casualModeActive }) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);

  const handleReset = async () => {
    setResetting(true);
    try {
      await db.delete();
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith("aquadex_") || key.startsWith("aquacellum"))) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((k) => localStorage.removeItem(k));
      window.location.reload();
    } catch (err) {
      console.error("[Reset] Failed:", err);
      setResetting(false);
      setShowConfirm(false);
    }
  };

  return (
    <SettingsSection
      id="reset"
      icon={<Broom size={20} />}
      title={{ casual: "Clear this device", pro: "Purge local database" }}
      description={{
        casual:
          "Wipes the copy of your data stored in this browser, for when the app is stuck or loading incorrectly. This does NOT delete your account. Anything already synced comes back when you sign in again.",
        pro:
          "Deletes IndexedDB (Dexie) and all Aquadex localStorage entries on this device. Use when schema migrations fail or local state is corrupted. Account, profile and cloud records are unaffected.",
      }}
      casualModeActive={casualModeActive}
      tone="danger"
    >
      <div className="st-callout st-callout--danger" style={{ marginBottom: "1.1rem" }}>
        <Warning size={20} aria-hidden="true" />
        <p>
          This clears tanks, specimens, logs, XP, and preferences stored in <strong>this browser
          only</strong>. Your account stays open and anything already synced to the cloud returns on
          your next sign-in.
        </p>
      </div>

      {!showConfirm ? (
        <button
          type="button"
          className="st-btn st-btn--danger-outline"
          onClick={() => setShowConfirm(true)}
        >
          <Broom size={18} aria-hidden="true" />
          {casualModeActive ? "Clear this device" : "Purge local state"}
        </button>
      ) : (
        <div className="st-danger">
          <p className="st-text">
            {casualModeActive
              ? "Are you sure? Your local data (tanks, fish, logs, XP) will be erased from this browser. Your account is not affected, and synced data returns when you sign in again."
              : "This deletes IndexedDB and every aquadex_* localStorage key on this device, then reloads the page."}
          </p>
          <div className="st-actions">
            <button
              type="button"
              className="st-btn st-btn--danger"
              onClick={handleReset}
              disabled={resetting}
            >
              {resetting ? "Clearing…" : "Yes, clear this device"}
            </button>
            <button type="button" className="st-btn" onClick={() => setShowConfirm(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/*
        The redirect that closes D-S-1. Anyone who arrived here looking to delete
        their account gets told where that actually lives, rather than clearing
        their browser and assuming it worked.
      */}
      <p className="st-hint st-divider" style={{ marginBottom: 0 }}>
        Looking to delete your account instead?{" "}
        <a
          href="#settings/privacy"
          onClick={(e) => {
            e.preventDefault();
            const target = document.getElementById("settings-privacy");
            if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
          className="st-inline-link"
        >
          {casualModeActive ? "Your Data" : "Data & Privacy"}
        </a>{" "}
        handles that, including a 30-day grace period you can cancel within.
      </p>
    </SettingsSection>
  );
}

export default ResetSection;
