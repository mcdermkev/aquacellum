/**
 * DataPrivacySettings.jsx
 * 
 * GDPR data export and account deletion UI.
 * Accessible from Profile Settings.
 * 
 * Features:
 * - "Export My Data" — downloads all social content as JSON
 * - "Delete My Account" — soft-delete with 30-day grace period
 * - Cancel deletion during grace period
 */

import { useState, useEffect } from "react";
import {
  exportUserData,
  downloadAsJson,
  requestAccountDeletion,
  cancelAccountDeletion,
  getDeletionStatus,
} from "../../services/gdprService";

export function DataPrivacySettings({ casualModeActive = false }) {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);
  const [exportSuccess, setExportSuccess] = useState(false);

  const [deletionStatus, setDeletionStatus] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleteError, setDeleteError] = useState(null);
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

    const { error } = await requestAccountDeletion(confirmText);

    if (error) {
      setDeleteError(error);
    } else {
      setShowDeleteConfirm(false);
      setConfirmText("");
      await checkDeletionStatus();
    }

    setDeleting(false);
  }

  async function handleCancelDeletion() {
    setCancelling(true);
    await cancelAccountDeletion();
    await checkDeletionStatus();
    setCancelling(false);
  }

  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "1.25rem",
        padding: "1.25rem",
        borderRadius: "12px",
        background: "rgba(255, 255, 255, 0.02)",
        border: "1px solid rgba(255, 255, 255, 0.06)",
      }}
      aria-label="Data & Privacy Settings"
    >
      <h3 style={{ margin: 0, fontSize: "0.9rem", fontWeight: 600, color: "#fff" }}>
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
            ⚠️ Account deletion scheduled
          </p>
          <p style={{ margin: "0 0 0.5rem", fontSize: "0.75rem", color: "var(--text-secondary)" }}>
            Your account will be permanently deleted on{" "}
            {new Date(deletionStatus.deletionDate).toLocaleDateString(undefined, {
              year: "numeric", month: "long", day: "numeric",
            })}
            {" "}({deletionStatus.daysRemaining} days remaining).
          </p>
          <button
            onClick={handleCancelDeletion}
            disabled={cancelling}
            style={{
              padding: "0.4rem 0.8rem",
              borderRadius: "6px",
              border: "none",
              background: "linear-gradient(135deg, #0ea5e9, #0369a1)",
              color: "#fff",
              fontSize: "0.75rem",
              fontWeight: 600,
              cursor: cancelling ? "wait" : "pointer",
            }}
          >
            {cancelling ? "Cancelling..." : "Cancel Deletion"}
          </button>
        </div>
      )}

      {/* Export section */}
      <div style={{ paddingBottom: "1rem", borderBottom: "1px solid rgba(255, 255, 255, 0.05)" }}>
        <h4 style={{ margin: "0 0 0.25rem", fontSize: "0.8rem", color: "var(--text-primary)" }}>
          📦 Export Your Data
        </h4>
        <p style={{ margin: "0 0 0.75rem", fontSize: "0.7rem", color: "var(--text-muted)", lineHeight: 1.5 }}>
          Download a copy of all your social data including your profile, posts, comments,
          reactions, connections, and notifications as a JSON file.
        </p>
        <button
          onClick={handleExport}
          disabled={exporting}
          style={{
            padding: "0.45rem 1rem",
            borderRadius: "8px",
            border: "1px solid rgba(56, 189, 248, 0.2)",
            background: exporting ? "rgba(255,255,255,0.03)" : "rgba(56, 189, 248, 0.08)",
            color: exporting ? "var(--text-muted)" : "var(--accent-blue)",
            fontSize: "0.75rem",
            fontWeight: 500,
            cursor: exporting ? "wait" : "pointer",
          }}
        >
          {exporting ? "Preparing export..." : "⬇️ Download My Data"}
        </button>

        {exportSuccess && (
          <p style={{ margin: "0.5rem 0 0", fontSize: "0.7rem", color: "var(--accent-green)" }}>
            ✓ Export downloaded successfully.
          </p>
        )}
        {exportError && (
          <p style={{ margin: "0.5rem 0 0", fontSize: "0.7rem", color: "var(--accent-red)" }}>
            ⚠️ {exportError}
          </p>
        )}
      </div>

      {/* Delete section */}
      {!deletionStatus?.pending && (
        <div>
          <h4 style={{ margin: "0 0 0.25rem", fontSize: "0.8rem", color: "var(--accent-red)" }}>
            🗑️ Delete Account
          </h4>
          <p style={{ margin: "0 0 0.75rem", fontSize: "0.7rem", color: "var(--text-muted)", lineHeight: 1.5 }}>
            Permanently delete your account and all associated data. Your account will be deactivated
            immediately and permanently deleted after a 30-day grace period. You can cancel during this time.
          </p>

          {!showDeleteConfirm ? (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              style={{
                padding: "0.45rem 1rem",
                borderRadius: "8px",
                border: "1px solid rgba(248, 113, 113, 0.2)",
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
              <p style={{ margin: "0 0 0.5rem", fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                Type <strong style={{ color: "var(--accent-red)" }}>DELETE MY ACCOUNT</strong> to confirm:
              </p>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="Type confirmation here..."
                style={{
                  width: "100%",
                  padding: "0.5rem 0.75rem",
                  borderRadius: "6px",
                  border: "1px solid rgba(248, 113, 113, 0.2)",
                  background: "rgba(0,0,0,0.2)",
                  color: "#fff",
                  fontSize: "0.8rem",
                  marginBottom: "0.75rem",
                  outline: "none",
                  fontFamily: "monospace",
                }}
              />
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button
                  onClick={handleDelete}
                  disabled={deleting || confirmText !== "DELETE MY ACCOUNT"}
                  style={{
                    padding: "0.4rem 0.8rem",
                    borderRadius: "6px",
                    border: "none",
                    background: confirmText === "DELETE MY ACCOUNT" ? "#dc2626" : "rgba(255,255,255,0.05)",
                    color: confirmText === "DELETE MY ACCOUNT" ? "#fff" : "var(--text-muted)",
                    fontSize: "0.7rem",
                    fontWeight: 600,
                    cursor: confirmText === "DELETE MY ACCOUNT" ? "pointer" : "not-allowed",
                  }}
                >
                  {deleting ? "Deleting..." : "Confirm Deletion"}
                </button>
                <button
                  onClick={() => { setShowDeleteConfirm(false); setConfirmText(""); setDeleteError(null); }}
                  style={{
                    padding: "0.4rem 0.8rem",
                    borderRadius: "6px",
                    border: "1px solid rgba(255,255,255,0.08)",
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
                <p style={{ margin: "0.5rem 0 0", fontSize: "0.7rem", color: "var(--accent-red)" }}>
                  ⚠️ {deleteError}
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
