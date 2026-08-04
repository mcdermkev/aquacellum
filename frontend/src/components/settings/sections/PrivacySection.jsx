import React, { useEffect, useState } from "react";
import { SettingsSection } from "../SettingsSection";
import { DataPrivacySettings } from "../../reef/DataPrivacySettings";
import { getDeletionStatus } from "../../../services/gdprService";

/**
 * PrivacySection — Settings → Your Data / Data & Privacy (docs/SETTINGS_SPEC.md
 * D-S-1). GDPR data export and **account deletion**.
 *
 * ⚠️ THIS IS THE HIGHEST-STAKES CONTROL IN THE PRODUCT and it renders LAST in the
 * panel on purpose (§6: "the switch that changes everything else first; the
 * irreversible things last").
 *
 * Why it moved. `DataPrivacySettings` was reachable only via Reef → `ProfileEdit`,
 * while the destructive-looking button in Settings was "Reset Local Data", which
 * only clears Dexie plus `aquadex_*` keys. A user intending to delete their
 * account found the button that looked right and did something else. Settings is
 * now the ONLY entry point; `ProfileEdit` links here instead of rendering it.
 *
 * ⚠️ `DataPrivacySettings` IS DELIBERATELY NOT REWRITTEN. Its type-to-confirm flow
 * ("DELETE MY ACCOUNT"), its 30-day grace period, and its pending-deletion banner
 * with a cancel action are all correct, and it resolves the user itself through
 * `gdprService` → `getCurrentWallet()` rather than props — so re-parenting is safe
 * and needs no wiring. Restyling a destructive path is how you accidentally break
 * a confirmation gate. It is composed as-is.
 *
 * ⚠️ NOT COLLAPSED BY DEFAULT, and that is a safety decision rather than a styling
 * one. Collapsing was the obvious choice for the one section where a misclick is
 * unrecoverable — but the pending-deletion banner and its Cancel button live
 * INSIDE the body. A user with a deletion scheduled would have had to know to
 * expand a collapsed section to find the countdown or stop it. Hiding the cancel
 * control for an irreversible action is worse than the misclick risk it avoids,
 * especially since the delete button already sits behind a type-to-confirm gate.
 *
 * The header badge below is the always-visible signal: it reports a scheduled
 * deletion and the days remaining even when the user has collapsed the section
 * themselves (collapse state is persisted per section, so that is reachable).
 */
export function PrivacySection({ casualModeActive }) {
  const [deletionStatus, setDeletionStatus] = useState(null);

  // A second read of the same status `DataPrivacySettings` fetches internally.
  // Duplicated deliberately: the alternative is threading state out of that
  // component, which means editing the deletion flow. A cheap extra SELECT is
  // the better trade against touching destructive-path code.
  useEffect(() => {
    let cancelled = false;
    getDeletionStatus()
      .then((status) => {
        if (!cancelled) setDeletionStatus(status);
      })
      .catch(() => {
        // Non-fatal: the badge is an enhancement. The banner inside
        // DataPrivacySettings remains the authoritative report.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const pendingBadge = deletionStatus?.pending ? (
    <span
      style={{
        fontSize: "0.6rem",
        padding: "0.15rem 0.5rem",
        borderRadius: "20px",
        background: "rgba(248, 113, 113, 0.15)",
        color: "var(--accent-red)",
        border: "1px solid rgba(248, 113, 113, 0.35)",
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        whiteSpace: "nowrap",
      }}
    >
      Deletion in {deletionStatus.daysRemaining}d
    </span>
  ) : null;

  return (
    <SettingsSection
      id="privacy"
      icon="🔒"
      title={{ casual: "Your Data", pro: "Data & Privacy" }}
      description={{
        casual:
          "Download everything we hold about you, or delete your account. Deleting is permanent after a 30-day grace period — you can cancel any time before then.",
        pro:
          "GDPR subject-access export and account deletion. Deletion soft-deletes immediately and purges after a 30-day grace period; cancellable during the window.",
      }}
      casualModeActive={casualModeActive}
      tone="danger"
      badge={pendingBadge}
    >
      <DataPrivacySettings casualModeActive={casualModeActive} />
    </SettingsSection>
  );
}

export default PrivacySection;
