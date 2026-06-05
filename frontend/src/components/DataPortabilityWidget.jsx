import React, { useState } from "react";
import { exportLocalDatabase, importLocalDatabase, db } from "../db";
import { useQueryClient } from "@tanstack/react-query";
import { generateFacilitySummary } from "../utils/pdfExport";

export function DataPortabilityWidget({ casualModeActive, onToggleMode }) {
  const queryClient = useQueryClient();
  const [importStatus, setImportStatus] = useState({ type: "", message: "" });
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [showModeConfirm, setShowModeConfirm] = useState(false);
  const [showReplayConfirm, setShowReplayConfirm] = useState(false);

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
    <>
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

    {/* ─── Experience Mode Toggle ─── */}
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
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
        <span style={{ fontSize: "1.5rem" }}>{casualModeActive ? "🐠" : "🧬"}</span>
        <h3 style={{ fontSize: "1.25rem", fontWeight: "700", color: "#fff", margin: 0 }}>
          Experience Mode
        </h3>
      </div>

      <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", lineHeight: "1.5", marginBottom: "1.25rem" }}>
        {casualModeActive
          ? "You're currently in Casual Hobbyist mode. The interface uses friendly language, gamified progress, and hides technical blockchain details."
          : "You're currently in Professional Breeder mode. The interface uses operational language, shows lineage data, and exposes protocol-level details."}
      </p>

      {!showModeConfirm ? (
        <button
          className="btn-secondary"
          onClick={() => setShowModeConfirm(true)}
          style={{
            padding: "0.75rem 1.5rem",
            fontSize: "0.875rem",
            minHeight: "44px",
            cursor: "pointer",
          }}
        >
          {casualModeActive ? "Switch to Pro Breeder Mode" : "Switch to Casual Hobbyist Mode"}
        </button>
      ) : (
        <div style={{
          padding: "1rem",
          background: "rgba(251, 191, 36, 0.06)",
          border: "1px solid rgba(251, 191, 36, 0.2)",
          borderRadius: "var(--radius-sm)",
        }}>
          <p style={{ fontSize: "0.8rem", color: "var(--accent-amber)", marginBottom: "0.75rem" }}>
            {casualModeActive
              ? "Switching to Pro mode will change the interface language to operational/technical terminology and reveal advanced features like lineage trees and spawning workflows."
              : "Switching to Casual mode will simplify the interface, use friendly language, and hide some advanced tools like raw lineage data and spawning workflows."}
          </p>
          <div style={{ display: "flex", gap: "0.75rem" }}>
            <button
              className="btn-primary"
              onClick={() => {
                setShowModeConfirm(false);
                if (onToggleMode) onToggleMode(!casualModeActive);
              }}
              style={{ padding: "0.6rem 1.25rem", fontSize: "0.8rem" }}
            >
              Confirm Switch
            </button>
            <button
              className="btn-secondary"
              onClick={() => setShowModeConfirm(false)}
              style={{ padding: "0.6rem 1.25rem", fontSize: "0.8rem" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>

    {/* ─── Replay Onboarding ─── */}
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
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
        <span style={{ fontSize: "1.5rem" }}>🔄</span>
        <h3 style={{ fontSize: "1.25rem", fontWeight: "700", color: "#fff", margin: 0 }}>
          {casualModeActive ? "Replay Introduction" : "Replay Onboarding Sequence"}
        </h3>
      </div>

      <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", lineHeight: "1.5", marginBottom: "1.25rem" }}>
        {casualModeActive
          ? "Want to see Poseidon and Echo's introduction again? You can replay the welcome walkthrough anytime."
          : "Re-run the initial onboarding sequence. Useful for demonstrating the system to new team members."}
      </p>

      {!showReplayConfirm ? (
        <button
          className="btn-secondary"
          onClick={() => setShowReplayConfirm(true)}
          style={{
            padding: "0.75rem 1.5rem",
            fontSize: "0.875rem",
            minHeight: "44px",
            cursor: "pointer",
          }}
        >
          {casualModeActive ? "Replay Intro" : "Re-run Onboarding"}
        </button>
      ) : (
        <div style={{
          padding: "1rem",
          background: "rgba(56, 189, 248, 0.06)",
          border: "1px solid rgba(56, 189, 248, 0.2)",
          borderRadius: "var(--radius-sm)",
        }}>
          <p style={{ fontSize: "0.8rem", color: "var(--accent-blue)", marginBottom: "0.75rem" }}>
            This will show the Poseidon & Echo introduction wizard again. Your data and progress won't be affected.
          </p>
          <div style={{ display: "flex", gap: "0.75rem" }}>
            <button
              className="btn-primary"
              onClick={() => {
                localStorage.removeItem("aquadex_onboarding_complete");
                window.location.reload();
              }}
              style={{ padding: "0.6rem 1.25rem", fontSize: "0.8rem" }}
            >
              Replay Now
            </button>
            <button
              className="btn-secondary"
              onClick={() => setShowReplayConfirm(false)}
              style={{ padding: "0.6rem 1.25rem", fontSize: "0.8rem" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>

    {/* AI Companion Preferences */}
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
        <img src="/poseidon-avatar.jpg" alt="" style={{ width: "28px", height: "28px", borderRadius: "50%", objectFit: "cover" }} />
        <h3 style={{ fontSize: "1.25rem", fontWeight: "700", color: "#fff", margin: 0 }}>
          {casualModeActive ? "AI Companions" : "Intelligence Layer Preferences"}
        </h3>
      </div>

      <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", lineHeight: "1.5", marginBottom: "1.5rem" }}>
        {casualModeActive
          ? "Control whether Poseidon (your fish expert) and Echo (your companion) are active. You can turn either one off if you prefer a quieter experience."
          : "Toggle Poseidon intelligence layer and Echo companion subsystem independently. Disabling Poseidon stops all API calls to the AI gateway. Disabling Echo hides the companion entity and suppresses gamification reactions."}
      </p>

      {/* Poseidon Toggle */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "1rem",
        borderRadius: "12px",
        background: "rgba(6, 182, 212, 0.04)",
        border: "1px solid rgba(6, 182, 212, 0.12)",
        marginBottom: "0.75rem"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <img src="/poseidon-avatar.jpg" alt="" style={{ width: "36px", height: "36px", borderRadius: "50%", objectFit: "cover", border: "1.5px solid rgba(6, 182, 212, 0.3)" }} />
          <div>
            <div style={{ fontSize: "0.9rem", fontWeight: "600", color: "#fff" }}>Poseidon</div>
            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
              {casualModeActive ? "Freshwater fish expert & data assistant" : "Taxonomic intelligence • Species RAG • Spawn narration"}
            </div>
          </div>
        </div>
        <label style={{ position: "relative", display: "inline-block", width: "44px", height: "24px", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={localStorage.getItem("aquadex_poseidon_enabled") !== "false"}
            onChange={(e) => {
              localStorage.setItem("aquadex_poseidon_enabled", e.target.checked.toString());
              window.dispatchEvent(new CustomEvent("aquadex:ai-prefs-changed"));
            }}
            style={{ opacity: 0, width: 0, height: 0, position: "absolute" }}
          />
          <span style={{
            position: "absolute",
            inset: 0,
            borderRadius: "12px",
            background: localStorage.getItem("aquadex_poseidon_enabled") !== "false" ? "rgba(6, 182, 212, 0.5)" : "rgba(255,255,255,0.1)",
            transition: "background 0.3s ease",
            border: `1px solid ${localStorage.getItem("aquadex_poseidon_enabled") !== "false" ? "rgba(6, 182, 212, 0.6)" : "rgba(255,255,255,0.15)"}`,
          }}></span>
          <span style={{
            position: "absolute",
            top: "3px",
            left: localStorage.getItem("aquadex_poseidon_enabled") !== "false" ? "22px" : "3px",
            width: "18px",
            height: "18px",
            borderRadius: "50%",
            background: "#fff",
            transition: "left 0.3s ease",
            boxShadow: "0 1px 3px rgba(0,0,0,0.3)"
          }}></span>
        </label>
      </div>

      {/* Echo Toggle */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "1rem",
        borderRadius: "12px",
        background: "rgba(139, 92, 246, 0.04)",
        border: "1px solid rgba(139, 92, 246, 0.12)",
        marginBottom: "0.75rem"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <img src="/echo-evolved.jpg" alt="" style={{ width: "36px", height: "36px", borderRadius: "50%", objectFit: "cover", border: "1.5px solid rgba(139, 92, 246, 0.3)" }} />
          <div>
            <div style={{ fontSize: "0.9rem", fontWeight: "600", color: "#fff" }}>Echo</div>
            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
              {casualModeActive ? "Your evolving tank companion" : "Emotional intelligence • Companion entity • Gamification engine"}
            </div>
          </div>
        </div>
        <label style={{ position: "relative", display: "inline-block", width: "44px", height: "24px", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={localStorage.getItem("aquadex_echo_enabled") !== "false"}
            onChange={(e) => {
              localStorage.setItem("aquadex_echo_enabled", e.target.checked.toString());
              window.dispatchEvent(new CustomEvent("aquadex:ai-prefs-changed"));
            }}
            style={{ opacity: 0, width: 0, height: 0, position: "absolute" }}
          />
          <span style={{
            position: "absolute",
            inset: 0,
            borderRadius: "12px",
            background: localStorage.getItem("aquadex_echo_enabled") !== "false" ? "rgba(139, 92, 246, 0.5)" : "rgba(255,255,255,0.1)",
            transition: "background 0.3s ease",
            border: `1px solid ${localStorage.getItem("aquadex_echo_enabled") !== "false" ? "rgba(139, 92, 246, 0.6)" : "rgba(255,255,255,0.15)"}`,
          }}></span>
          <span style={{
            position: "absolute",
            top: "3px",
            left: localStorage.getItem("aquadex_echo_enabled") !== "false" ? "22px" : "3px",
            width: "18px",
            height: "18px",
            borderRadius: "50%",
            background: "#fff",
            transition: "left 0.3s ease",
            boxShadow: "0 1px 3px rgba(0,0,0,0.3)"
          }}></span>
        </label>
      </div>

      <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.5rem", lineHeight: "1.4" }}>
        {casualModeActive
          ? "Both are enabled by default. Changes take effect immediately — no reload needed."
          : "Preferences stored locally. Disabling Poseidon halts all Edge Function calls. Disabling Echo suppresses companion rendering and XP reaction events."}
      </div>
    </div>
  </>
  );
}
