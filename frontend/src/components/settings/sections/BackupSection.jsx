import React, { useState } from "react";
import { SettingsSection } from "../SettingsSection";
import { exportLocalDatabase, importLocalDatabase, db } from "../../../db";
import { useQueryClient } from "@tanstack/react-query";
import { generateFacilitySummary } from "../../../utils/pdfExport";
import { useAuth } from "../../../contexts/AuthContext";

/**
 * BackupSection — Settings → Backup & Restore ("Data Portability" in Pro).
 *
 * Split out of the old DataPortabilityWidget.jsx (which this section's name
 * was borrowed from, and which is now gone — AC-1). Fixes the one AC-4
 * violation carried over from the old widget: the heading
 * "Data Management & Portability" was unbranched while its body copy was
 * branched, which is exactly the half-branched-section defect AC-4 exists to
 * catch. The heading now branches too (§9 lists the *Smart Wallet* casual
 * face and *this* heading branch together under Phase 5, but AC-4 is a
 * Phase 3 gate, so it can't ship half-done here).
 */
export function BackupSection({ casualModeActive }) {
  const { account } = useAuth();
  const queryClient = useQueryClient();
  const [importStatus, setImportStatus] = useState({ type: "", message: "" });
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);
    setImportStatus({ type: "", message: "" });
    try {
      await exportLocalDatabase();
      setImportStatus({
        type: "success",
        message: casualModeActive
          ? "Logbook successfully backed up to your device!"
          : "Facility registry archives exported successfully.",
      });
    } catch (err) {
      setImportStatus({
        type: "error",
        message: casualModeActive
          ? "Failed to back up logbook. Please try again."
          : `Export failed: ${err.message}`,
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    setImportStatus({ type: "", message: "" });

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const jsonData = JSON.parse(event.target.result);
        const result = await importLocalDatabase(jsonData);

        // Invalidate queries to force frontend hydration pass across all dashboard panels
        queryClient.invalidateQueries();

        if (result && result.blobFailures > 0) {
          setImportStatus({
            type: "warning",
            message: casualModeActive
              ? `Logbook restored, but ${result.blobFailures} photos failed to load due to device storage limits.`
              : `Restoration complete, but ${result.blobFailures} photos failed to load due to device storage limits.`,
          });
        } else {
          setImportStatus({
            type: "success",
            message: casualModeActive
              ? "Logbook successfully restored! Dashboard updated."
              : "Atomic ledger restoration complete. All local registry manifests updated.",
          });
        }
      } catch (err) {
        setImportStatus({
          type: "error",
          message: casualModeActive
            ? "Invalid logbook file or restoration failed. Existing data preserved."
            : `Atomic restoration aborted: ${err.message}`,
        });
      } finally {
        setIsImporting(false);
        // Clear value to allow re-upload of same file name
        e.target.value = "";
      }
    };

    reader.onerror = () => {
      setImportStatus({ type: "error", message: "Failed to read the selected file." });
      setIsImporting(false);
    };

    reader.readAsText(file);
  };

  return (
    <SettingsSection
      id="backup"
      icon="💾"
      title={{ casual: "Backup & Restore", pro: "Data Portability" }}
      description={{
        casual:
          "Take full ownership of your records. Download a complete copy of your local aquariums, species entries, and logs to your device, or restore them at any time.",
        pro:
          "Export and import local registry catalogs atomically. Guarantees 100% sovereign record custody and zero platform lock-in. Transactions are processed locally on your client machine.",
      }}
      casualModeActive={casualModeActive}
    >
      <div
        style={{
          display: "flex",
          gap: "0.5rem",
          alignItems: "flex-start",
          background: "rgba(56, 189, 248, 0.06)",
          border: "1px solid rgba(56, 189, 248, 0.15)",
          borderRadius: "var(--radius-sm)",
          padding: "0.75rem 1rem",
          marginBottom: "1.5rem",
        }}
      >
        <span style={{ color: "var(--accent-blue)", fontSize: "0.9rem" }}>ℹ️</span>
        <span style={{ fontSize: "0.75rem", color: "rgba(255, 255, 255, 0.8)", lineHeight: "1.4" }}>
          All database records are stored locally in your browser's offline storage. Backing up regularly ensures your data remains secure even if you clear your browser cache.
        </span>
      </div>

      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1.5rem" }}>
        <button
          className="btn-primary"
          onClick={handleExport}
          disabled={isExporting || isImporting}
          style={{ padding: "0.75rem 1.5rem", fontSize: "0.875rem", minHeight: "44px", minWidth: "150px" }}
        >
          {isExporting ? "Processing..." : casualModeActive ? "Backup My Logbook" : "Export Local Registry Archives"}
        </button>

        <label
          className="btn-secondary"
          style={{
            padding: "0.75rem 1.5rem",
            fontSize: "0.875rem",
            minHeight: "44px",
            minWidth: "150px",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.5rem",
          }}
        >
          <input
            type="file"
            accept=".json"
            onChange={handleImport}
            disabled={isExporting || isImporting}
            style={{ display: "none" }}
          />
          {isImporting ? "Restoring..." : casualModeActive ? "Restore Logbook File" : "Import Facility Registry Manifest"}
        </label>

        {!casualModeActive && (
          <button
            className="btn-secondary"
            onClick={async () => {
              try {
                /*
                  Scope the report to THIS owner's live tanks.

                  A bare `db.tanks.toArray()` returned every tank row in local
                  IndexedDB — including any other account previously signed in on
                  this browser — and then labelled the whole document with
                  `tanks[0].ownerAddress`, so a shared device produced a facility
                  report attributing someone else's units to you. It also counted
                  soft-deleted tanks: retiring a tank sets `active: false` rather
                  than deleting the row, so Total Units, Total Volume and the rack
                  breakdown all included tanks the keeper had removed.

                  CANONICAL ADDRESS RULE (see useUserTanks/relayer.js): every
                  ownerAddress written to Dexie is lowercased, and Dexie's
                  `.equals()` is case-sensitive, so the lookup MUST lowercase or it
                  matches zero rows against Privy's checksummed address.
                */
                const owner = (account || "").toLowerCase();
                if (!owner) {
                  setImportStatus({
                    type: "error",
                    message: "Sign in to generate a facility summary.",
                  });
                  return;
                }
                const tanks = (await db.tanks.where("ownerAddress").equals(owner).toArray())
                  .filter((t) => t.active !== false);
                if (tanks.length === 0) {
                  setImportStatus({
                    type: "warning",
                    message: "No active tanks to report on.",
                  });
                  return;
                }
                await generateFacilitySummary({
                  tanks,
                  ownerAddress: owner,
                  recentSpawns: [],
                });
                setImportStatus({ type: "success", message: "Facility summary PDF generated." });
              } catch (err) {
                console.error("Facility PDF failed:", err);
                setImportStatus({ type: "error", message: `PDF generation failed: ${err.message}` });
              }
            }}
            style={{ padding: "0.75rem 1.5rem", fontSize: "0.875rem", minHeight: "44px", minWidth: "150px" }}
          >
            📄 Facility Summary PDF
          </button>
        )}
      </div>

      {importStatus.message && (
        <div
          style={{
            padding: "0.75rem 1rem",
            borderRadius: "var(--radius-sm)",
            fontSize: "0.8rem",
            fontWeight: "500",
            backgroundColor:
              importStatus.type === "success"
                ? "rgba(52, 211, 153, 0.08)"
                : importStatus.type === "warning"
                  ? "rgba(251, 191, 36, 0.08)"
                  : "rgba(248, 113, 113, 0.08)",
            border:
              importStatus.type === "success"
                ? "1px solid rgba(52, 211, 153, 0.25)"
                : importStatus.type === "warning"
                  ? "1px solid rgba(251, 191, 36, 0.25)"
                  : "1px solid rgba(248, 113, 113, 0.25)",
            color:
              importStatus.type === "success"
                ? "var(--accent-green)"
                : importStatus.type === "warning"
                  ? "var(--accent-amber)"
                  : "var(--accent-red)",
          }}
        >
          {importStatus.message}
        </div>
      )}
    </SettingsSection>
  );
}

export default BackupSection;
