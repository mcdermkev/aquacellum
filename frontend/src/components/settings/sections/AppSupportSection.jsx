import React, { useState } from "react";
import { SettingsSection } from "../SettingsSection";
import { SettingsSubsectionLabel as SubsectionLabel } from "../SettingsSubsectionLabel";
import { InstallAppPanel } from "../InstallAppPanel";
import { db } from "../../../db";
import { useAuth } from "../../../contexts/AuthContext";
import { ONBOARDING_CACHE_KEY } from "../../../hooks/useOnboardingGate";
import { setOnboardingComplete } from "../../../services/reefApi";
import { CURRENT_VERSION } from "../../WhatsNewModal";

/**
 * AppSupportSection — Settings → App & Support.
 *
 * Split out of the old DataPortabilityWidget.jsx's "Install App" and "Replay
 * Onboarding" cards (unchanged behavior), plus a version/build readout: the
 * registry noted `aquadex_last_seen_version` was written by `WhatsNewModal`
 * but "version is never shown" anywhere in the app (docs/SETTINGS_SPEC.md §6
 * #12). Reuses `WhatsNewModal`'s exported `CURRENT_VERSION` rather than a
 * second copy of the string, so the two can't drift apart.
 *
 * Diagnostics export and legal links (also named in §6 #12's final-state
 * table) are Phase 4/5 net-new backend-touching work, not part of this
 * structural split, and are intentionally not stubbed here — an empty
 * "Diagnostics" button with nothing behind it would be exactly the kind of
 * dead control AC-3 exists to prevent.
 */
export function AppSupportSection({ casualModeActive }) {
  return (
    <SettingsSection id="app" icon="📲" title="App & Support" casualModeActive={casualModeActive}>
      <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
        <InstallAppPanel casualModeActive={casualModeActive} />
        <ReplayOnboardingSubsection casualModeActive={casualModeActive} />
        <VersionSubsection />
      </div>
    </SettingsSection>
  );
}

function VersionSubsection() {
  return (
    <div>
      <SubsectionLabel>Version</SubsectionLabel>
      <p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
        Aquadex <span style={{ color: "var(--text-primary)", fontFamily: "monospace" }}>v{CURRENT_VERSION}</span>
      </p>
    </div>
  );
}

/**
 * ReplayOnboardingSubsection — resets ONLY the onboarding flags so
 * `useOnboardingGate(account)` re-resolves to show onboarding again.
 * Deliberately does NOT touch tanks, specimens, or the user's profile.
 *
 * Reset surfaces, in order:
 *   1. localStorage fast-path cache (`ONBOARDING_CACHE_KEY`) — removed so the
 *      gate stops short-circuiting to "complete".
 *   2. Dexie `userProfile.onboardingComplete=false` + `onboardingPhase=null`
 *      for the current account (account-gated; only when an account exists).
 *   3. Supabase `onboarding_complete=false` via reefApi (account-gated, no-op
 *      when Supabase is unconfigured) so the server source of truth also
 *      replays.
 *
 * The gate reads on account/mount, so after resetting the flags we reload the
 * route. `window.location.reload()` is the minimal robust trigger: it remounts
 * `App`, which calls `useOnboardingGate(account)` fresh and resolves to show
 * onboarding. All data lives in Dexie/Supabase and survives the reload.
 */
function ReplayOnboardingSubsection({ casualModeActive }) {
  const { account } = useAuth();
  const [showReplayConfirm, setShowReplayConfirm] = useState(false);

  const handleReplayOnboarding = async () => {
    try {
      localStorage.removeItem(ONBOARDING_CACHE_KEY);
    } catch (err) {
      console.warn("[replay] localStorage clear failed:", err);
    }

    if (account) {
      try {
        /*
          Dexie primary keys are CASE-SENSITIVE and this table is written by
          several call sites that key on whatever address string they were handed
          (`useXPSync`, `IdentityStep`, `OnboardingContext`) — while Privy hands us
          a checksummed, mixed-case address. So the row may be stored under either
          casing, and `update()` on the wrong one is not an error: it resolves with
          0 rows updated, so the surrounding try/catch never fires and the reset
          silently skips its Dexie half.
          `useReefProfile` carries the same lowercase fallback for the same reason.
        */
        const patch = { onboardingComplete: false, onboardingPhase: null };
        let updated = await db.userProfile.update(account, patch);
        const lower = account.toLowerCase();
        if (!updated && lower !== account) {
          updated = await db.userProfile.update(lower, patch);
        }
        if (!updated) {
          // No local profile row at all — the gate falls back to Supabase and the
          // cleared cache key, so this is expected for a fresh device, not a fault.
          console.info("[replay] no local userProfile row to reset for", account);
        }
      } catch (err) {
        console.warn("[replay] Dexie onboarding reset failed:", err);
      }

      try {
        await setOnboardingComplete(account, false);
      } catch (err) {
        console.warn("[replay] Supabase onboarding reset failed:", err);
      }
    }

    window.location.reload();
  };

  return (
    <div>
      <SubsectionLabel>{casualModeActive ? "Replay Introduction" : "Replay Onboarding Sequence"}</SubsectionLabel>

      <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", lineHeight: "1.5", marginBottom: "1rem" }}>
        {casualModeActive
          ? "Want to see Poseidon and Echo's introduction again? You can replay the welcome walkthrough anytime."
          : "Re-run the initial onboarding sequence. Useful for demonstrating the system to new team members."}
      </p>

      {!showReplayConfirm ? (
        <button
          className="btn-secondary"
          onClick={() => setShowReplayConfirm(true)}
          style={{ padding: "0.75rem 1.5rem", fontSize: "0.875rem", minHeight: "44px" }}
        >
          {casualModeActive ? "Replay Intro" : "Re-run Onboarding"}
        </button>
      ) : (
        <div
          style={{
            padding: "1rem",
            background: "rgba(56, 189, 248, 0.06)",
            border: "1px solid rgba(56, 189, 248, 0.2)",
            borderRadius: "var(--radius-sm)",
          }}
        >
          <p style={{ fontSize: "0.8rem", color: "var(--accent-blue)", marginBottom: "0.75rem" }}>
            This will show the Poseidon & Echo introduction wizard again. Your data and progress won't be affected.
          </p>
          <div style={{ display: "flex", gap: "0.75rem" }}>
            <button className="btn-primary" onClick={handleReplayOnboarding} style={{ padding: "0.6rem 1.25rem", fontSize: "0.8rem" }}>
              Replay Now
            </button>
            <button className="btn-secondary" onClick={() => setShowReplayConfirm(false)} style={{ padding: "0.6rem 1.25rem", fontSize: "0.8rem" }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default AppSupportSection;
