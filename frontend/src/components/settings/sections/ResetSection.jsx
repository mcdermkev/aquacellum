import React, { useState } from "react";
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
      icon="🗑️"
      title={{ casual: "Clear this device", pro: "Purge local database" }}
      description={{
        casual:
          "Wipes the copy of your data stored in this browser, for when the app is stuck or loading incorrectly. This does NOT delete your account — anything already synced comes back when you sign in again.",
        pro:
          "Deletes IndexedDB (Dexie) and all Aquadex localStorage entries on this device. Use when schema migrations fail or local state is corrupted. Account, profile and cloud records are unaffected.",
      }}
      casualModeActive={casualModeActive}
      tone="danger"
    >
      <div
        style={{
          display: "flex",
          gap: "0.5rem",
          alignItems: "flex-start",
          background: "rgba(248, 113, 113, 0.06)",
          border: "1px solid rgba(248, 113, 113, 0.2)",
          borderRadius: "var(--radius-sm)",
          padding: "0.75rem 1rem",
          marginBottom: "1.25rem",
        }}
      >
        <span style={{ color: "var(--accent-red)", fontSize: "0.9rem" }}>⚠️</span>
        <span style={{ fontSize: "0.75rem", color: "rgba(248, 113, 113, 0.9)", lineHeight: "1.4" }}>
          This clears tanks, specimens, logs, XP, and preferences stored in <strong>this browser
          only</strong>. Your account stays open and anything already synced to the cloud returns on
          your next sign-in.
        </span>
      </div>

      {!showConfirm ? (
        <button
          className="btn-secondary"
          onClick={() => setShowConfirm(true)}
          style={{
            padding: "0.75rem 1.5rem",
            fontSize: "0.875rem",
            minHeight: "44px",
            borderColor: "rgba(248, 113, 113, 0.3)",
            color: "var(--accent-red)",
          }}
        >
          {casualModeActive ? "Clear this device" : "Purge local state"}
        </button>
      ) : (
        <div
          style={{
            padding: "1rem",
            background: "rgba(248, 113, 113, 0.06)",
            border: "1px solid rgba(248, 113, 113, 0.25)",
            borderRadius: "var(--radius-sm)",
          }}
        >
          <p style={{ fontSize: "0.8rem", color: "var(--accent-red)", marginBottom: "0.75rem" }}>
            {casualModeActive
              ? "Are you sure? Your local data (tanks, fish, logs, XP) will be erased from this browser. Your account is not affected, and synced data returns when you sign in again."
              : "Confirm: DELETE IndexedDB + all aquadex_* localStorage keys. Page will reload with a fresh state."}
          </p>
          <div style={{ display: "flex", gap: "0.75rem" }}>
            <button
              className="btn-primary"
              onClick={handleReset}
              disabled={resetting}
              style={{
                padding: "0.6rem 1.25rem",
                fontSize: "0.8rem",
                background: "linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)",
                boxShadow: "0 4px 14px rgba(220, 38, 38, 0.3)",
              }}
            >
              {resetting ? "Resetting..." : "Yes, Delete All Local Data"}
            </button>
            <button className="btn-secondary" onClick={() => setShowConfirm(false)} style={{ padding: "0.6rem 1.25rem", fontSize: "0.8rem" }}>
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
      <p
        style={{
          margin: "1.25rem 0 0",
          paddingTop: "1rem",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          fontSize: "0.75rem",
          color: "var(--text-muted)",
          lineHeight: 1.5,
        }}
      >
        Looking to delete your account instead?{" "}
        <a
          href="#settings/privacy"
          onClick={(e) => {
            e.preventDefault();
            const target = document.getElementById("settings-privacy");
            if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
          style={{ color: "var(--accent-blue)", fontWeight: 600 }}
        >
          {casualModeActive ? "Your Data" : "Data & Privacy"}
        </a>{" "}
        handles that, including a 30-day grace period you can cancel within.
      </p>
    </SettingsSection>
  );
}

export default ResetSection;
