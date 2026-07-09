import React, { useState, useEffect } from "react";
import { exportLocalDatabase, importLocalDatabase, db } from "../db";
import { useQueryClient } from "@tanstack/react-query";
import { generateFacilitySummary } from "../utils/pdfExport";
import { useAuth } from "../contexts/AuthContext";
import { ONBOARDING_CACHE_KEY } from "../hooks/useOnboardingGate";
import { setOnboardingComplete } from "../services/reefApi";
import { getSmartWalletAddress, hasUserSigner } from "../services/smartAccountClient";
import { ZoneAssignmentFlow } from "./ZoneAssignmentFlow";
import { SonarPreferences } from "./reef/SonarPreferences";

export function DataPortabilityWidget({ casualModeActive, onToggleMode }) {
  const queryClient = useQueryClient();
  const { account } = useAuth();
  const [importStatus, setImportStatus] = useState({ type: "", message: "" });
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [showModeConfirm, setShowModeConfirm] = useState(false);
  const [showReplayConfirm, setShowReplayConfirm] = useState(false);
  const [smartWalletAddress, setSmartWalletAddress] = useState(null);
  const [smartWalletLoading, setSmartWalletLoading] = useState(false);
  const [zoneAssigned, setZoneAssigned] = useState(false);

  // Check if user already has a zone assigned
  useEffect(() => {
    if (!account) return;
    db.userProfile.get(account).then((profile) => {
      if (profile && profile.zoneHash) {
        setZoneAssigned(true);
      }
    }).catch(() => {});
  }, [account]);

  // Load smart wallet address when account changes (per-user smart wallet)
  useEffect(() => {
    if (!account) {
      setSmartWalletAddress(null);
      return;
    }
    setSmartWalletLoading(true);

    // The signer registration is async, so we retry briefly if it's not ready yet
    let cancelled = false;
    const attempt = (retries = 0) => {
      getSmartWalletAddress()
        .then(addr => { if (!cancelled) setSmartWalletAddress(addr); })
        .catch(err => {
          if (!cancelled && retries < 3 && !hasUserSigner()) {
            setTimeout(() => attempt(retries + 1), 1000);
            return;
          }
          if (!cancelled) console.warn("Smart wallet init failed:", err);
        })
        .finally(() => { if (!cancelled) setSmartWalletLoading(false); });
    };
    // Small delay on first attempt to allow signer registration to complete
    const timer = setTimeout(() => attempt(), 500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [account]);

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

  /**
   * Replay onboarding (Requirement 6.5).
   *
   * Resets ONLY the onboarding flags so `useOnboardingGate(account)` re-resolves to
   * show onboarding again. Deliberately does NOT touch tanks, specimens, or the user's
   * profile (display_name/avatar) — replaying the intro must never clear existing data.
   *
   * Reset surfaces, in order:
   *   1. localStorage fast-path cache (`ONBOARDING_CACHE_KEY`) — removed so the gate
   *      stops short-circuiting to "complete".
   *   2. Dexie `userProfile.onboardingComplete=false` + `onboardingPhase=null` for the
   *      current account (account-gated; only when an account exists).
   *   3. Supabase `onboarding_complete=false` via reefApi (account-gated, no-op when
   *      Supabase is unconfigured) so the server source of truth also replays.
   *
   * The gate reads on account/mount, so after resetting the flags we reload the route.
   * `window.location.reload()` is the minimal robust trigger: it remounts `App`, which
   * calls `useOnboardingGate(account)` fresh and resolves to show onboarding. All data
   * lives in Dexie/Supabase and survives the reload.
   */
  const handleReplayOnboarding = async () => {
    // 1. Clear the local fast-path cache (use the exported constant, not a literal).
    try {
      localStorage.removeItem(ONBOARDING_CACHE_KEY);
    } catch (err) {
      console.warn("[replay] localStorage clear failed:", err);
    }

    // 2 & 3. Reset the per-account flags only when an account exists — never wipe data.
    if (account) {
      try {
        await db.userProfile.update(account, {
          onboardingComplete: false,
          onboardingPhase: null,
        });
      } catch (err) {
        console.warn("[replay] Dexie onboarding reset failed:", err);
      }

      try {
        await setOnboardingComplete(account, false);
      } catch (err) {
        console.warn("[replay] Supabase onboarding reset failed:", err);
      }
    }

    // Re-resolve the gate by remounting the app; Dexie/Supabase data persists.
    window.location.reload();
  };

  return (
    <>
    {/* ─── Smart Wallet Status ─── */}
    <div 
      className="glass-card" 
      style={{
        padding: "1.5rem 2rem",
        borderRadius: "var(--radius-md)",
        border: smartWalletAddress ? "1px solid rgba(52, 211, 153, 0.2)" : "1px solid rgba(255, 255, 255, 0.08)",
        background: "rgba(10, 15, 30, 0.7)",
        backdropFilter: "blur(12px)",
        maxWidth: "600px",
        margin: "0 auto 1.5rem auto",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem" }}>
        <span style={{ fontSize: "1.3rem" }}>⛓️</span>
        <h3 style={{ fontSize: "1.1rem", fontWeight: "700", color: "#fff", margin: 0 }}>
          On-Chain Smart Wallet (EIP-4337)
        </h3>
        <span style={{
          fontSize: "0.6rem",
          padding: "0.15rem 0.5rem",
          borderRadius: "20px",
          background: smartWalletAddress ? "rgba(52, 211, 153, 0.15)" : "rgba(251, 191, 36, 0.15)",
          color: smartWalletAddress ? "#4ade80" : "#fbbf24",
          border: smartWalletAddress ? "1px solid rgba(52, 211, 153, 0.3)" : "1px solid rgba(251, 191, 36, 0.3)",
          fontWeight: "700",
          textTransform: "uppercase",
          letterSpacing: "0.05em"
        }}>
          {smartWalletLoading ? "Initializing..." : smartWalletAddress ? "Active" : "Offline"}
        </span>
      </div>

      {smartWalletAddress ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.6rem 0.85rem", background: "rgba(0,0,0,0.25)", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.05)" }}>
            <div>
              <span style={{ display: "block", fontSize: "0.65rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.2rem" }}>Account ID</span>
              <span style={{ fontSize: "0.8rem", color: "#fff", fontFamily: "monospace" }}>
                {smartWalletAddress.slice(0, 6)}...{smartWalletAddress.slice(-4)}
              </span>
            </div>
            <a
              href={`https://sepolia.basescan.org/address/${smartWalletAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: "0.7rem", color: "var(--accent-blue)", textDecoration: "none", fontWeight: "600" }}
            >
              View on BaseScan ↗
            </a>
          </div>
          <div style={{ display: "flex", gap: "0.75rem" }}>
            <div style={{ flex: 1, padding: "0.5rem 0.75rem", background: "rgba(52,211,153,0.04)", borderRadius: "6px", border: "1px solid rgba(52,211,153,0.15)" }}>
              <span style={{ display: "block", fontSize: "0.6rem", color: "var(--text-muted)", marginBottom: "0.15rem" }}>Network</span>
              <span style={{ fontSize: "0.75rem", color: "#4ade80", fontWeight: "600" }}>Base Sepolia</span>
            </div>
            <div style={{ flex: 1, padding: "0.5rem 0.75rem", background: "rgba(56,189,248,0.04)", borderRadius: "6px", border: "1px solid rgba(56,189,248,0.15)" }}>
              <span style={{ display: "block", fontSize: "0.6rem", color: "var(--text-muted)", marginBottom: "0.15rem" }}>Gas Sponsor</span>
              <span style={{ fontSize: "0.75rem", color: "#38bdf8", fontWeight: "600" }}>CDP Paymaster</span>
            </div>
            <div style={{ flex: 1, padding: "0.5rem 0.75rem", background: "rgba(168,85,247,0.04)", borderRadius: "6px", border: "1px solid rgba(168,85,247,0.15)" }}>
              <span style={{ display: "block", fontSize: "0.6rem", color: "var(--text-muted)", marginBottom: "0.15rem" }}>Batching</span>
              <span style={{ fontSize: "0.75rem", color: "#c084fc", fontWeight: "600" }}>3s Queue</span>
            </div>
          </div>
          <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", lineHeight: "1.5", margin: "0.25rem 0 0" }}>
            All actions (mints, logs, listings) are batched and submitted as gasless UserOperations. Gas is fully sponsored by the CDP Paymaster — you never pay fees.
          </p>
        </div>
      ) : (
        <p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
          {smartWalletLoading ? "Connecting to Coinbase Smart Wallet..." : "Smart wallet could not be initialized. On-chain writes are paused."}
        </p>
      )}
    </div>

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

    {/* ─── Zone & Location ─── */}
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
        <span style={{ fontSize: "1.5rem" }}>📍</span>
        <h3 style={{ fontSize: "1.25rem", fontWeight: "700", color: "#fff", margin: 0 }}>
          {casualModeActive ? "Zone & Location" : "Regional Zone Assignment"}
        </h3>
      </div>

      <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", lineHeight: "1.5", marginBottom: "1.25rem" }}>
        {casualModeActive
          ? "Enable location to join your regional zone leaderboard and compete with nearby keepers. Your exact coordinates are never stored — only your city-level zone."
          : "Assign your operator profile to a geographic zone for regional leaderboard rankings. Location is bucketed to a 15–30 mile zone — precise coordinates are discarded after hashing."}
      </p>

      <ZoneAssignmentFlow
        onComplete={(zone) => {
          setImportStatus({ type: "success", message: `Joined zone: ${zone.displayName}` });
        }}
        onSkip={() => {}}
        isTransfer={zoneAssigned}
        casualModeActive={casualModeActive}
      />
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
              onClick={handleReplayOnboarding}
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

    {/* ─── Notifications (Push + Email) ─── */}
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
      <SonarPreferences />
    </div>

    {/* ─── Install App ─── */}
    <InstallAppSection casualModeActive={casualModeActive} />

    {/* ─── Reset Local Data (Beta Escape Hatch) ─── */}
    <ResetLocalDataSection casualModeActive={casualModeActive} />
  </>
  );
}

/**
 * InstallAppSection — Permanent "Install App" option that shows platform-appropriate
 * install instructions. On iOS (which never fires beforeinstallprompt), this gives users
 * a reliable way to find the Add to Home Screen flow without relying on the dismissable
 * PwaManager banner.
 */
function InstallAppSection({ casualModeActive }) {
  const [installEvent, setInstallEvent] = useState(null);
  const [installed, setInstalled] = useState(false);
  const [showIosSteps, setShowIosSteps] = useState(false);

  const isIos =
    typeof navigator !== "undefined" &&
    /iphone|ipad|ipod/i.test(navigator.userAgent) &&
    !window.MSStream;

  const isStandalone =
    typeof window !== "undefined" &&
    (window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true);

  // Capture Android/desktop install prompt
  useEffect(() => {
    if (isStandalone) {
      setInstalled(true);
      return;
    }
    const onBeforeInstall = (e) => {
      e.preventDefault();
      setInstallEvent(e);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallEvent(null);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (!installEvent) return;
    installEvent.prompt();
    try { await installEvent.userChoice; } catch { /* dismissed */ }
    setInstallEvent(null);
  };

  return (
    <div
      className="glass-card"
      style={{
        padding: "2rem",
        borderRadius: "var(--radius-md)",
        border: "1px solid rgba(56, 189, 248, 0.15)",
        background: "rgba(10, 15, 30, 0.7)",
        backdropFilter: "blur(12px)",
        boxShadow: "0 8px 32px 0 rgba(0, 0, 0, 0.37)",
        maxWidth: "600px",
        margin: "0 auto 3rem auto",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
        <span style={{ fontSize: "1.5rem" }}>📲</span>
        <h3 style={{ fontSize: "1.25rem", fontWeight: "700", color: "#fff", margin: 0 }}>
          {casualModeActive ? "Install App" : "Install Progressive Web App"}
        </h3>
        {installed && (
          <span style={{
            fontSize: "0.6rem",
            padding: "0.15rem 0.5rem",
            borderRadius: "20px",
            background: "rgba(52, 211, 153, 0.15)",
            color: "#4ade80",
            border: "1px solid rgba(52, 211, 153, 0.3)",
            fontWeight: "700",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}>
            Installed
          </span>
        )}
      </div>

      <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", lineHeight: "1.5", marginBottom: "1.25rem" }}>
        {installed
          ? (casualModeActive
              ? "Aquadex is already installed on this device. You're getting the full app experience!"
              : "PWA is installed and running in standalone display mode.")
          : (casualModeActive
              ? "Install Aquadex to your home screen for a full-screen, app-like experience with faster loading and offline access."
              : "Install the PWA for standalone display mode, offline shell caching, and native-like navigation without browser chrome.")}
      </p>

      {!installed && (
        <>
          {/* Android/Desktop: native install prompt available */}
          {installEvent && (
            <button
              className="btn-primary"
              onClick={handleInstall}
              style={{
                padding: "0.75rem 1.5rem",
                fontSize: "0.875rem",
                minHeight: "44px",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "0.5rem",
              }}
            >
              Install Aquadex
            </button>
          )}

          {/* iOS: manual instructions */}
          {isIos && !installEvent && (
            <div>
              <button
                className="btn-primary"
                onClick={() => setShowIosSteps((v) => !v)}
                style={{
                  padding: "0.75rem 1.5rem",
                  fontSize: "0.875rem",
                  minHeight: "44px",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.5rem",
                }}
              >
                {showIosSteps ? "Hide Instructions" : "How to Install"}
              </button>

              {showIosSteps && (
                <div style={{
                  marginTop: "1.25rem",
                  padding: "1.25rem",
                  background: "rgba(56, 189, 248, 0.04)",
                  border: "1px solid rgba(56, 189, 248, 0.15)",
                  borderRadius: "var(--radius-sm)",
                }}>
                  <p style={{ fontSize: "0.8rem", color: "#fff", fontWeight: "600", marginBottom: "1rem" }}>
                    Follow these steps in Safari:
                  </p>
                  <ol style={{
                    fontSize: "0.8rem",
                    color: "var(--text-muted)",
                    lineHeight: "2",
                    paddingLeft: "1.25rem",
                    margin: 0,
                  }}>
                    <li>Tap the <strong style={{ color: "#38bdf8" }}>Share</strong> button <span style={{ fontSize: "1rem" }}>&#x2B06;&#xFE0F;</span> (the square with an arrow at the bottom of Safari)</li>
                    <li>Scroll down and tap <strong style={{ color: "#38bdf8" }}>Add to Home Screen</strong></li>
                    <li>Tap <strong style={{ color: "#38bdf8" }}>Add</strong> in the top-right corner</li>
                  </ol>
                  <div style={{
                    marginTop: "1rem",
                    padding: "0.6rem 0.85rem",
                    background: "rgba(251, 191, 36, 0.06)",
                    border: "1px solid rgba(251, 191, 36, 0.2)",
                    borderRadius: "6px",
                    display: "flex",
                    gap: "0.5rem",
                    alignItems: "flex-start",
                  }}>
                    <span style={{ fontSize: "0.8rem" }}>💡</span>
                    <span style={{ fontSize: "0.72rem", color: "rgba(251, 191, 36, 0.9)", lineHeight: "1.4" }}>
                      This must be done in Safari. Other browsers on iPhone (Chrome, Firefox) don't support installing PWAs.
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Desktop/Android without prompt (hasn't fired yet or unsupported browser) */}
          {!isIos && !installEvent && (
            <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", fontStyle: "italic" }}>
              {casualModeActive
                ? "Your browser will show an install option in the address bar, or try visiting this page in Chrome or Edge."
                : "The install prompt will appear when browser installability criteria are met. Ensure you're using a Chromium-based browser with a valid service worker."}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * ResetLocalDataSection — Dangerous action to wipe all local Dexie + localStorage data.
 * Provides a two-step confirmation to prevent accidental resets.
 * Essential for beta testers who get stuck on a corrupted Dexie schema migration.
 */
function ResetLocalDataSection({ casualModeActive }) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);

  const handleReset = async () => {
    setResetting(true);
    try {
      // 1. Delete the entire Dexie database
      await db.delete();
      // 2. Clear all Aquadex localStorage keys
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith("aquadex_") || key.startsWith("aquacellum"))) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((k) => localStorage.removeItem(k));
      // 3. Reload to reinitialize fresh
      window.location.reload();
    } catch (err) {
      console.error("[Reset] Failed:", err);
      setResetting(false);
      setShowConfirm(false);
    }
  };

  return (
    <div
      className="glass-card"
      style={{
        padding: "2rem",
        borderRadius: "var(--radius-md)",
        border: "1px solid rgba(248, 113, 113, 0.15)",
        background: "rgba(10, 15, 30, 0.7)",
        backdropFilter: "blur(12px)",
        boxShadow: "0 8px 32px 0 rgba(0, 0, 0, 0.37)",
        maxWidth: "600px",
        margin: "0 auto 3rem auto",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
        <span style={{ fontSize: "1.5rem" }}>🗑️</span>
        <h3 style={{ fontSize: "1.25rem", fontWeight: "700", color: "#fff", margin: 0 }}>
          {casualModeActive ? "Reset Local Data" : "Purge Local Database"}
        </h3>
      </div>

      <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", lineHeight: "1.5", marginBottom: "1.25rem" }}>
        {casualModeActive
          ? "If the app is stuck, loading incorrectly, or you want a completely fresh start, you can wipe all locally stored data. This cannot be undone — back up first!"
          : "Nuclear option: deletes IndexedDB (Dexie) and all Aquadex localStorage entries. Use when schema migrations fail or local state is corrupted. Ensure you have exported data first."}
      </p>

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
            cursor: "pointer",
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
            <button
              className="btn-secondary"
              onClick={() => setShowConfirm(false)}
              style={{ padding: "0.6rem 1.25rem", fontSize: "0.8rem" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
