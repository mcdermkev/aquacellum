import React, { useState, useEffect } from "react";
import { SettingsSection } from "../SettingsSection";
import { useAuth } from "../../../contexts/AuthContext";
import { getSmartWalletAddress, hasUserSigner } from "../../../services/smartAccountClient";

/**
 * SmartWalletSection — Settings → Smart Wallet.
 *
 * Split out of the old DataPortabilityWidget.jsx unchanged. D-S-6's casual
 * face (a plain-language status line + a "show technical details"
 * disclosure) is explicitly Phase 5 copy work in docs/SETTINGS_SPEC.md §9, so
 * this Phase 3 pass does not add that branch yet — but per §3 ("mode never
 * hides a control") and AC-4 ("no section is conditionally *rendered* on
 * `casualModeActive`"), it also must not be hidden from casual in the
 * meantime the way it briefly was here. So today's copy renders unbranched in
 * both modes — identical to what casual already saw before this split, and
 * the exact inconsistency D-S-6 will resolve, on schedule, in Phase 5.
 */
export function SmartWalletSection({ casualModeActive }) {
  const { account } = useAuth();
  const [smartWalletAddress, setSmartWalletAddress] = useState(null);
  const [smartWalletLoading, setSmartWalletLoading] = useState(false);

  useEffect(() => {
    if (!account) {
      setSmartWalletAddress(null);
      return;
    }
    setSmartWalletLoading(true);

    let cancelled = false;
    const attempt = (retries = 0) => {
      getSmartWalletAddress()
        .then((addr) => {
          if (!cancelled) setSmartWalletAddress(addr);
        })
        .catch((err) => {
          if (!cancelled && retries < 3 && !hasUserSigner()) {
            setTimeout(() => attempt(retries + 1), 1000);
            return;
          }
          if (!cancelled) console.warn("Smart wallet init failed:", err);
        })
        .finally(() => {
          if (!cancelled) setSmartWalletLoading(false);
        });
    };
    const timer = setTimeout(() => attempt(), 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [account]);

  return (
    <SettingsSection id="advanced" icon="⛓️" title="Smart Wallet" casualModeActive={casualModeActive}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem" }}>
        <h4 style={{ fontSize: "0.95rem", fontWeight: "700", color: "var(--text-primary)", margin: 0 }}>
          On-Chain Smart Wallet (EIP-4337)
        </h4>
        <span
          style={{
            fontSize: "0.6rem",
            padding: "0.15rem 0.5rem",
            borderRadius: "20px",
            background: smartWalletAddress ? "rgba(52, 211, 153, 0.15)" : "rgba(251, 191, 36, 0.15)",
            color: smartWalletAddress ? "#4ade80" : "#fbbf24",
            border: smartWalletAddress ? "1px solid rgba(52, 211, 153, 0.3)" : "1px solid rgba(251, 191, 36, 0.3)",
            fontWeight: "700",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {smartWalletLoading ? "Initializing..." : smartWalletAddress ? "Active" : "Offline"}
        </span>
      </div>

      {smartWalletAddress ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "0.6rem 0.85rem",
              background: "rgba(0,0,0,0.25)",
              borderRadius: "8px",
              border: "1px solid rgba(255,255,255,0.05)",
            }}
          >
            <div>
              <span
                style={{
                  display: "block",
                  fontSize: "0.65rem",
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginBottom: "0.2rem",
                }}
              >
                Account ID
              </span>
              <span style={{ fontSize: "0.8rem", color: "var(--text-primary)", fontFamily: "monospace" }}>
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
    </SettingsSection>
  );
}

export default SmartWalletSection;
