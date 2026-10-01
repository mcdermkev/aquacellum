import React, { useState } from "react";
import {
  CheckCircle,
  DownloadSimple,
  FilePdf,
  FloppyDisk,
  Info,
  UploadSimple,
  WarningCircle,
} from "@phosphor-icons/react";
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
          ? "Backup saved to your device."
          : "Database exported.",
      });
    } catch (err) {
      setImportStatus({
        type: "error",
        message: casualModeActive
          ? "Couldn't create the backup. Try again."
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
              : `Import complete, but ${result.blobFailures} photos failed to load due to device storage limits.`,
          });
        } else {
          setImportStatus({
            type: "success",
            message: casualModeActive
              ? "Logbook restored."
              : "Import complete. Local database updated.",
          });
        }
      } catch (err) {
        setImportStatus({
          type: "error",
          message: casualModeActive
            ? "That file couldn't be restored. Your existing data is unchanged."
            : `Import stopped: ${err.message}. Existing data is unchanged.`,
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
      icon={<FloppyDisk size={20} />}
      title={{ casual: "Backup & Restore", pro: "Data Portability" }}
      description={{
        casual:
          "Download a copy of the aquariums, fish and logs stored on this device, or restore one later.",
        pro:
          "Export or import the local database as one JSON file. It all runs in this browser; nothing is uploaded.",
      }}
      casualModeActive={casualModeActive}
    >
      <div className="st-callout st-callout--info" style={{ marginBottom: "1.1rem" }}>
        <Info size={20} aria-hidden="true" />
        <p>
          Your records are kept in this browser's storage. A backup file keeps a copy safe if that storage is cleared.
        </p>
      </div>

      <div className="st-actions" style={{ marginBottom: "1.1rem" }}>
        <button
          type="button"
          className="st-btn st-btn--primary"
          onClick={handleExport}
          disabled={isExporting || isImporting}
        >
          <DownloadSimple size={18} aria-hidden="true" />
          {isExporting ? "Exporting…" : casualModeActive ? "Back up my logbook" : "Export database"}
        </button>

        {/*
          The file input is visually hidden but stays in the tab order (it was
          display:none, which made restore mouse-only). The label is the visible
          button and shows the focus ring via :has(input:focus-visible).
        */}
        <label className={`st-btn${isExporting || isImporting ? " st-btn--disabled" : ""}`}>
          <input
            type="file"
            accept=".json"
            onChange={handleImport}
            disabled={isExporting || isImporting}
            className="st-sr-only"
          />
          <UploadSimple size={18} aria-hidden="true" />
          {isImporting ? "Restoring…" : casualModeActive ? "Restore from a file" : "Import database"}
        </label>

        {!casualModeActive && (
          <button
            type="button"
            className="st-btn"
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
          >
            <FilePdf size={18} aria-hidden="true" />
            Facility summary PDF
          </button>
        )}
      </div>

      {importStatus.message && (
        <p
          className={`st-note ${
            importStatus.type === "success"
              ? "st-note--success"
              : importStatus.type === "warning"
                ? "st-note--warning"
                : "st-note--error"
          }`}
        >
          {importStatus.type === "success" ? (
            <CheckCircle size={18} aria-hidden="true" />
          ) : (
            <WarningCircle size={18} aria-hidden="true" />
          )}
          <span>{importStatus.message}</span>
        </p>
      )}
    </SettingsSection>
  );
}

export default BackupSection;
