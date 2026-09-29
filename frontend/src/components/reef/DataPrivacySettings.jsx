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

const listStyle = {
  margin: "0.25rem 0 0.75rem",
  paddingLeft: "1.1rem",
  fontSize: "0.72rem",
  color: "var(--text-secondary)",
  lineHeight: 1.55,
};

const subheadStyle = {
  margin: "0.5rem 0 0",
  fontSize: "0.75rem",
  fontWeight: 600,
  color: "var(--text-primary)",
};

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

export function DataPrivacySettings({ casualModeActive = false }) {
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
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "1.25rem",
        padding: "1.25rem",
        borderRadius: "12px",
        background: "rgba(var(--ink-rgb), 0.03)",
        border: "1px solid rgba(var(--ink-rgb), 0.11)",
      }}
      aria-label="Data & Privacy Settings"
    >
      <h3 style={{ margin: 0, fontSize: "0.9rem", fontWeight: 600, color: "var(--text-primary)" }}>
        {casualModeActive ? "🔒 Your Data" : "Data & Privacy"}
      </h3>

      {/* Pending deletion banner */}
      {deletionStatus?.pending && (
        <div
          role="alert"
          style={{
            padding: "1rem",
            borderRadius: "10px",
            background: "rgba(248, 113, 113, 0.08)",
            border: "1px solid rgba(248, 113, 113, 0.2)",
          }}
        >
          <p style={{ margin: "0 0 0.25rem", fontSize: "0.85rem", color: "var(--accent-red)", fontWeight: 600 }}>
            Account deletion scheduled
          </p>
          <p style={{ margin: "0 0 0.5rem", fontSize: "0.75rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
            Your account will be deleted on or after {formatDate(deletionStatus.deletionDate)}
            {" "}({deletionStatus.daysRemaining} {deletionStatus.daysRemaining === 1 ? "day" : "days"} left).
            Until then everything keeps working as normal, and you can cancel.
          </p>
          <button
            type="button"
            onClick={handleCancelDeletion}
            disabled={cancelling}
            style={{
              padding: "0.4rem 0.8rem",
              borderRadius: "6px",
              border: "none",
              background: "linear-gradient(135deg, #0284c7, #0369a1)",
              color: "#fff",
              fontSize: "0.75rem",
              fontWeight: 600,
              cursor: cancelling ? "wait" : "pointer",
            }}
          >
            {cancelling ? "Cancelling..." : "Cancel Deletion"}
          </button>
          {cancelError && (
            <p role="status" style={{ margin: "0.5rem 0 0", fontSize: "0.7rem", color: "var(--accent-red)" }}>
              {cancelError}
            </p>
          )}
        </div>
      )}

      {/* Export section */}
      <div style={{ paddingBottom: "1rem", borderBottom: "1px solid rgba(var(--ink-rgb), 0.1)" }}>
        <h4 style={{ margin: "0 0 0.25rem", fontSize: "0.8rem", color: "var(--text-primary)" }}>
          📦 Export Your Data
        </h4>
        <p style={{ margin: "0 0 0.75rem", fontSize: "0.7rem", color: "var(--text-muted)", lineHeight: 1.5 }}>
          Download a copy of your profile and Reef social data (posts, comments,
          reactions, connections and notifications) as a JSON file.
        </p>
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting}
          style={{
            padding: "0.45rem 1rem",
            borderRadius: "8px",
            border: "1px solid rgba(56, 189, 248, 0.2)",
            background: exporting ? "rgba(var(--ink-rgb), 0.03)" : "rgba(56, 189, 248, 0.08)",
            color: exporting ? "var(--text-muted)" : "var(--accent-blue)",
            fontSize: "0.75rem",
            fontWeight: 500,
            cursor: exporting ? "wait" : "pointer",
          }}
        >
          {exporting ? "Preparing export..." : "⬇️ Download My Data"}
        </button>

        {exportSuccess && (
          <p role="status" style={{ margin: "0.5rem 0 0", fontSize: "0.7rem", color: "var(--accent-green)" }}>
            ✓ Export downloaded.
          </p>
        )}
        {exportError && (
          <p role="status" style={{ margin: "0.5rem 0 0", fontSize: "0.7rem", color: "var(--accent-red)" }}>
            {exportError}
          </p>
        )}
      </div>

      {/* Delete section */}
      {!deletionStatus?.pending && (
        <div>
          <h4 style={{ margin: "0 0 0.25rem", fontSize: "0.8rem", color: "var(--accent-red)" }}>
            🗑️ Delete Account
          </h4>
          <p style={{ margin: "0 0 0.25rem", fontSize: "0.72rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
            Deletion is not immediate. There is a 30-day grace period: your account keeps
            working and you can cancel here at any time. After {DELETION_GRACE_DAYS} days
            we permanently delete your account data. This cannot be undone.
          </p>
          {deletionStatus?.error && (
            <p role="status" style={{ margin: "0.25rem 0", fontSize: "0.7rem", color: "var(--accent-red)" }}>
              {deletionStatus.error}
            </p>
          )}

          <p style={subheadStyle}>What we delete</p>
          <ul style={listStyle}>
            {DELETION_REMOVED.map((item) => <li key={item}>{item}</li>)}
          </ul>
          <p style={subheadStyle}>What we keep</p>
          <ul style={listStyle}>
            {DELETION_KEPT.map((item) => <li key={item}>{item}</li>)}
          </ul>
          <p style={{ margin: "0 0 0.75rem", fontSize: "0.7rem", color: "var(--text-muted)", lineHeight: 1.5 }}>
            Anything saved only in this browser stays on this device until you clear it
            (Settings, Clear this device). Records held by Stripe and Privy are kept by
            them under their own policies.
          </p>

          {!showDeleteConfirm ? (
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              style={{
                padding: "0.45rem 1rem",
                borderRadius: "8px",
                border: "1px solid rgba(220, 38, 38, 0.35)",
                background: "rgba(248, 113, 113, 0.06)",
                color: "var(--accent-red)",
                fontSize: "0.75rem",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Delete My Account
            </button>
          ) : (
            <div style={{
              padding: "1rem",
              borderRadius: "10px",
              background: "rgba(248, 113, 113, 0.05)",
              border: "1px solid rgba(248, 113, 113, 0.15)",
            }}>
              <label
                htmlFor="delete-account-confirm"
                style={{ display: "block", margin: "0 0 0.5rem", fontSize: "0.75rem", color: "var(--text-secondary)" }}
              >
                Type <strong style={{ color: "var(--accent-red)" }}>DELETE MY ACCOUNT</strong> to confirm:
              </label>
              <input
                id="delete-account-confirm"
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="Type confirmation here..."
                autoComplete="off"
                spellCheck={false}
                style={{
                  width: "100%",
                  padding: "0.5rem 0.75rem",
                  borderRadius: "6px",
                  border: "1px solid rgba(220, 38, 38, 0.35)",
                  background: "var(--bg-secondary)",
                  color: "var(--text-primary)",
                  fontSize: "0.8rem",
                  marginBottom: "0.75rem",
                  fontFamily: "monospace",
                }}
              />
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting || !confirmed}
                  style={{
                    padding: "0.4rem 0.8rem",
                    borderRadius: "6px",
                    border: "none",
                    background: confirmed ? "#dc2626" : "rgba(var(--ink-rgb), 0.05)",
                    color: confirmed ? "#fff" : "var(--text-muted)",
                    fontSize: "0.7rem",
                    fontWeight: 600,
                    cursor: confirmed ? "pointer" : "not-allowed",
                  }}
                >
                  {deleting ? "Scheduling..." : `Schedule deletion in ${DELETION_GRACE_DAYS} days`}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowDeleteConfirm(false); setConfirmText(""); setDeleteError(null); }}
                  style={{
                    padding: "0.4rem 0.8rem",
                    borderRadius: "6px",
                    border: "1px solid rgba(var(--ink-rgb), 0.13)",
                    background: "transparent",
                    color: "var(--text-muted)",
                    fontSize: "0.7rem",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
              </div>
              {deleteError && (
                <p role="status" style={{ margin: "0.5rem 0 0", fontSize: "0.7rem", color: "var(--accent-red)" }}>
                  {deleteError}
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
