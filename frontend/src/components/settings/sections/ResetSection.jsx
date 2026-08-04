import React, { useState } from "react";
import { SettingsSection } from "../SettingsSection";
import { db } from "../../../db";

/**
 * ResetSection — Settings → Reset Local Data ("Purge Local Database" in Pro).
 *
 * Split out of the old DataPortabilityWidget.jsx unchanged.
 *
 * D-S-1's rename ("Clear this device" / "Purge local database") and the
 * inline link to Privacy & Data are explicitly Phase 4b work
 * (docs/SETTINGS_SPEC.md §9 — gated ⛔ for Opus review because it's
 * account-deletion/ownership-adjacent), because that copy only makes sense
 * once Privacy & Data actually exists as a Settings section to link to.
 * Renaming the button now, with nowhere for the link to point, would create
 * a new dead-end control — precisely what AC-3 exists to prevent. Section
 * order is already correct for D-S-1's other requirement ("Privacy & Data
 * renders below Reset") since Privacy & Data isn't in `SettingsPanel` yet;
 * `SettingsPanel` places this section last for now, and Phase 4b's job is to
 * insert Privacy & Data after it, not reorder anything here.
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
      title={{ casual: "Reset Local Data", pro: "Purge Local Database" }}
      description={{
        casual:
          "If the app is stuck, loading incorrectly, or you want a completely fresh start, you can wipe all locally stored data. This cannot be undone — back up first!",
        pro:
          "Nuclear option: deletes IndexedDB (Dexie) and all Aquadex localStorage entries. Use when schema migrations fail or local state is corrupted. Ensure you have exported data first.",
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
          This will delete all tanks, specimens, logs, XP, and preferences stored on this device.
          Data that has been synced to the cloud will still be available on next login.
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
          {casualModeActive ? "Reset Everything" : "Purge Local State"}
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
              ? "Are you sure? All your local data (tanks, fish, logs, XP) will be permanently deleted from this device."
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
    </SettingsSection>
  );
}

export default ResetSection;
