/**
 * DataPrivacySettings.jsx
 * 
 * GDPR data export and account deletion UI.
 * Accessible from Profile Settings.
 * 
 * Features:
 * - "Export My Data" — downloads all social content as JSON
 * - "Delete My Account" — records a request; the account is deleted after a
 *   30-day grace period by the daily purge job (api/_lib/accountPurge.js)
 * - Cancel deletion during grace period
 *
 * The removed/kept lists come from gdprService (DELETION_REMOVED /
 * DELETION_KEPT), which accountPurge.test.js pins to the server's purge plan,
 * so the copy cannot drift from what the job actually does.
 */

import { useState, useEffect } from "react";
import { CheckCircle, DownloadSimple, Trash, WarningCircle } from "@phosphor-icons/react";
import {
  exportUserData,
  downloadAsJson,
  requestAccountDeletion,
  cancelAccountDeletion,
  getDeletionStatus,
  DELETION_CONFIRM_PHRASE,
  DELETION_GRACE_DAYS,
  DELETION_REMOVED,
  DELETION_KEPT,
} from "../../services/gdprService";

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

/*
 * Styled by the st-* classes in settings/SettingsDaylight.css (its only render
 * site is Settings, PrivacySection). The section's own heading names the panel,
 * so there is no second heading in here. `casualModeActive` is still accepted
 * from PrivacySection but no longer changes anything: it only switched that
 * duplicate heading's wording.
 */
export function DataPrivacySettings() {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);
  const [exportSuccess, setExportSuccess] = useState(false);

  const [deletionStatus, setDeletionStatus] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleteError, setDeleteError] = useState(null);
  const [cancelError, setCancelError] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    checkDeletionStatus();
  }, []);

  async function checkDeletionStatus() {
    const status = await getDeletionStatus();
    setDeletionStatus(status);
  }

  async function handleExport() {
    setExporting(true);
    setExportError(null);
    setExportSuccess(false);

    const { data, error } = await exportUserData();

    if (error) {
      setExportError(error);
    } else if (data) {
      const timestamp = new Date().toISOString().slice(0, 10);
      downloadAsJson(data, `aquacellum-export-${timestamp}.json`);
      setExportSuccess(true);
      setTimeout(() => setExportSuccess(false), 5000);
    }

    setExporting(false);
  }

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);

    const { error, status } = await requestAccountDeletion(confirmText);

    if (error) {
      setDeleteError(error);
    } else {
      setShowDeleteConfirm(false);
      setConfirmText("");
      if (status) setDeletionStatus(status);
      else await checkDeletionStatus();
    }

    setDeleting(false);
  }

  async function handleCancelDeletion() {
    setCancelling(true);
    setCancelError(null);
    const { error } = await cancelAccountDeletion();
    if (error) setCancelError(error);
    await checkDeletionStatus();
    setCancelling(false);
  }

  const confirmed = confirmText === DELETION_CONFIRM_PHRASE;

  return (
    <section className="st-privacy" aria-label="Data & Privacy Settings">
      {/* Pending deletion banner */}
      {deletionStatus?.pending && (
        <div role="alert" className="st-danger">
          <p className="st-danger-title">Account deletion scheduled</p>
          <p className="st-text">
            Your account will be deleted on or after {formatDate(deletionStatus.deletionDate)}
            {" "}({deletionStatus.daysRemaining} {deletionStatus.daysRemaining === 1 ? "day" : "days"} left).
            Until then everything keeps working as normal, and you can cancel.
          </p>
          <button
            type="button"
            className="st-btn st-btn--primary"
            onClick={handleCancelDeletion}
            disabled={cancelling}
          >
            {cancelling ? "Cancelling…" : "Cancel deletion"}
          </button>
          {cancelError && (
            <p role="status" className="st-status st-status--error">
              <WarningCircle size={18} aria-hidden="true" />
              <span>{cancelError}</span>
            </p>
          )}
        </div>
      )}

      {/* Export section */}
      <div>
        <h4 className="st-sublabel">Export your data</h4>
        <p className="st-hint">
          Download a copy of your profile and Reef social data (posts, comments,
          reactions, connections and notifications) as a JSON file.
        </p>
        <button
          type="button"
          className="st-btn"
          onClick={handleExport}
          disabled={exporting}
        >
          <DownloadSimple size={18} aria-hidden="true" />
          {exporting ? "Preparing export…" : "Download my data"}
        </button>

        {exportSuccess && (
          <p role="status" className="st-status st-status--success">
            <CheckCircle size={18} aria-hidden="true" />
            <span>Export downloaded.</span>
          </p>
        )}
        {exportError && (
          <p role="status" className="st-status st-status--error">
            <WarningCircle size={18} aria-hidden="true" />
            <span>{exportError}</span>
          </p>
        )}
      </div>

      {/* Delete section: kept apart from the export above by a rule */}
      {!deletionStatus?.pending && (
        <div className="st-privacy-delete">
          <h4 className="st-sublabel st-sublabel--danger">
            <Trash size={18} aria-hidden="true" />
            Delete your account
          </h4>
          <p className="st-text">
            Deletion is not immediate. For {DELETION_GRACE_DAYS} days your account keeps
            working and you can cancel here at any time. After that we permanently delete
            the data listed below. If an auction you are in has not finished, we wait for it
            to finish first. This cannot be undone.
          </p>
          {deletionStatus?.error && (
            <p role="status" className="st-status st-status--error">
              <WarningCircle size={18} aria-hidden="true" />
              <span>{deletionStatus.error}</span>
            </p>
          )}

          <div className="st-privacy-lists">
            <div>
              <p className="st-label">What we delete</p>
              <ul className="st-bullets">
                {DELETION_REMOVED.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
            <div>
              <p className="st-label">What we keep</p>
              <ul className="st-bullets">
                {DELETION_KEPT.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          </div>
          <p className="st-hint">
            Anything saved only in this browser stays on this device until you clear it
            (Settings, Clear this device). Records held by Stripe and Privy are kept by
            them under their own policies.
          </p>

          {!showDeleteConfirm ? (
            <button
              type="button"
              className="st-btn st-btn--danger-outline"
              onClick={() => setShowDeleteConfirm(true)}
            >
              <Trash size={18} aria-hidden="true" />
              Delete my account
            </button>
          ) : (
            <div className="st-danger">
              <label htmlFor="delete-account-confirm" className="st-label" style={{ display: "block", marginBottom: "0.5rem" }}>
                Type <strong className="st-danger-phrase">DELETE MY ACCOUNT</strong> to confirm:
              </label>
              <input
                id="delete-account-confirm"
                type="text"
                className="st-input st-input--full st-input--mono"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="Type the phrase here"
                autoComplete="off"
                spellCheck={false}
              />
              <div className="st-actions" style={{ marginTop: "0.75rem" }}>
                <button
                  type="button"
                  className="st-btn st-btn--danger"
                  onClick={handleDelete}
                  disabled={deleting || !confirmed}
                >
                  {deleting ? "Scheduling…" : `Schedule deletion in ${DELETION_GRACE_DAYS} days`}
                </button>
                <button
                  type="button"
                  className="st-btn"
                  onClick={() => { setShowDeleteConfirm(false); setConfirmText(""); setDeleteError(null); }}
                >
                  Cancel
                </button>
              </div>
              {deleteError && (
                <p role="status" className="st-status st-status--error">
                  <WarningCircle size={18} aria-hidden="true" />
                  <span>{deleteError}</span>
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default DataPrivacySettings;