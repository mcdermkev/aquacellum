import React, { useState } from "react";
import { exportLocalDatabase, importLocalDatabase, db } from "../db";
import { useQueryClient } from "@tanstack/react-query";
import { generateFacilitySummary } from "../utils/pdfExport";

export function DataPortabilityWidget({ casualModeActive }) {
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
          : "Facility registry archives exported successfully."
      });
    } catch (err) {
      setImportStatus({
        type: "error",
        message: casualModeActive
          ? "Failed to back up logbook. Please try again."
          : `Export failed: ${err.message}`
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
              : `Restoration complete, but ${result.blobFailures} photos failed to load due to device storage limits.`
          });
        } else {
          setImportStatus({
            type: "success",
            message: casualModeActive
              ? "Logbook successfully restored! Dashboard updated."
              : "Atomic ledger restoration complete. All local registry manifests updated."
          });
        }
      } catch (err) {
        setImportStatus({
          type: "error",
          message: casualModeActive
            ? "Invalid logbook file or restoration failed. Existing data preserved."
            : `Atomic restoration aborted: ${err.message}`
        });
      } finally {
        setIsImporting(false);
        // Clear value to allow re-upload of same file name
        e.target.value = "";
      }
    };

    reader.onerror = () => {
      setImportStatus({
        type: "error",
        message: "Failed to read the selected file."
      });
      setIsImporting(false);
    };

    reader.readAsText(file);
  };

  return (
    <div 
      className="glass-card" 
      style={{
        padding: "2rem",
        borderRadius: "var(--radius-md)",
        border: "1px solid rgba(255, 255, 255, 0.08)",
        background: "rgba(10, 15, 30, 0.7)",
        backdropFilter: "blur(12px)",
        boxShadow: "0 8px 32px 0 rgba(0, 0, 0, 0.37)",
        maxWidth: "600px",
        margin: "0 auto 3rem auto",
        position: "relative",
        overflow: "hidden"
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
        <span style={{ fontSize: "1.5rem" }}>💾</span>
        <h3 style={{ fontSize: "1.25rem", fontWeight: "700", color: "#fff", margin: 0 }}>
          Data Management & Portability
        </h3>
      </div>

      <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", lineHeight: "1.5", marginBottom: "1.5rem" }}>
        {casualModeActive
          ? "Take full ownership of your records. Download a complete copy of your local aquariums, species entries, and logs to your device, or restore them at any time."
          : "Export and import local registry catalogs atomically. Guarantees 100% sovereign record custody and zero platform lock-in. Transactions are processed locally on your client machine."}
      </p>

      {/* Tooltip info banner */}
      <div 
        style={{
          display: "flex",
          gap: "0.5rem",
          alignItems: "flex-start",
          background: "rgba(56, 189, 248, 0.06)",
          border: "1px solid rgba(56, 189, 248, 0.15)",
          borderRadius: "var(--radius-sm)",
          padding: "0.75rem 1rem",
          marginBottom: "1.5rem"
        }}
      >
        <span style={{ color: "var(--accent-blue)", fontSize: "0.9rem" }}>ℹ️</span>
        <span style={{ fontSize: "0.75rem", color: "rgba(255, 255, 255, 0.8)", lineHeight: "1.4" }}>
          All database records are stored locally in your browser's offline storage. Backing up regularly ensures your data remains secure even if you clear your browser cache.
        </span>
      </div>

      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "1.5rem" }}>
        {/* Export Button */}
        <button
          className="btn-primary"
          onClick={handleExport}
          disabled={isExporting || isImporting}
          style={{ 
            padding: "0.75rem 1.5rem", 
            fontSize: "0.875rem", 
            minHeight: "44px",
            minWidth: "150px",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.5rem"
          }}
        >
          {isExporting ? "Processing..." : (casualModeActive ? "Backup My Logbook" : "Export Local Registry Archives")}
        </button>

        {/* Import Button & Hidden File Input */}
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
            backgroundColor: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: "var(--radius-sm)",
            color: "#fff",
            textAlign: "center",
            userSelect: "none"
          }}
        >
          <input
            type="file"
            accept=".json"
            onChange={handleImport}
            disabled={isExporting || isImporting}
            style={{ display: "none" }}
          />
          {isImporting ? "Restoring..." : (casualModeActive ? "Restore Logbook File" : "Import Facility Registry Manifest")}
        </label>

        {/* Facility Summary PDF Export */}
        {!casualModeActive && (
          <button
            className="btn-secondary"
            onClick={async () => {
              try {
                const tanks = await db.tanks.toArray();
                await generateFacilitySummary({
                  tanks,
                  ownerAddress: tanks[0]?.ownerAddress || "Unknown",
                  recentSpawns: []
                });
                setImportStatus({ type: "success", message: "Facility summary PDF generated." });
              } catch (err) {
                console.error("Facility PDF failed:", err);
                setImportStatus({ type: "error", message: `PDF generation failed: ${err.message}` });
              }
            }}
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
              backgroundColor: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: "var(--radius-sm)",
              color: "#fff",
              textAlign: "center",
              userSelect: "none"
            }}
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
            backgroundColor: importStatus.type === "success" 
              ? "rgba(52, 211, 153, 0.08)" 
              : importStatus.type === "warning" 
                ? "rgba(251, 191, 36, 0.08)" 
                : "rgba(248, 113, 113, 0.08)",
            border: importStatus.type === "success" 
              ? "1px solid rgba(52, 211, 153, 0.25)" 
              : importStatus.type === "warning" 
                ? "1px solid rgba(251, 191, 36, 0.25)" 
                : "1px solid rgba(248, 113, 113, 0.25)",
            color: importStatus.type === "success" 
              ? "var(--accent-green)" 
              : importStatus.type === "warning" 
                ? "var(--accent-amber)" 
                : "var(--accent-red)",
            animation: "fadeIn 0.3s ease"
          }}
        >
          {importStatus.message}
        </div>
      )}
    </div>
  );
}
