/**
 * ConnectWallet.jsx
 * 
 * Login component — supports Privy (email/Google) and MetaMask.
 * Privy is the primary login method; MetaMask is the fallback for advanced users.
 */

import React, { useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { generateAlias } from "../utils/generateAlias";

// Shorten address for display: 0xABCD…1234
function shortAddress(addr) {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function ConnectWallet({ onConnected, onDisconnected, casualModeActive, triggerLoginOnEntry, clearTriggerLogin }) {
  const {
    account,
    loginMethod,
    isConnecting,
    error,
    wrongNetwork,
    ready,
    connectPrivy,
    connectMetaMask,
    disconnect,
    handleSwitchNetwork,
  } = useAuth();

  const [showMetaMaskOption, setShowMetaMaskOption] = useState(false);

  // Notify parent when account changes
  React.useEffect(() => {
    if (account && onConnected) onConnected(account);
    if (!account && onDisconnected) onDisconnected();
  }, [account, onConnected, onDisconnected]);

  // Auto-trigger login when landing page CTA sets triggerLoginOnEntry
  React.useEffect(() => {
    if (triggerLoginOnEntry && !account && !isConnecting && ready) {
      connectPrivy();
      if (clearTriggerLogin) clearTriggerLogin();
    } else if (triggerLoginOnEntry) {
      // Already connected or not ready — just clear the flag
      if (clearTriggerLogin) clearTriggerLogin();
    }
  }, [triggerLoginOnEntry, account, isConnecting, ready]);

  // ─────────────────────────────────────────────────────────────────────────
  // Render: Wrong network warning
  // ─────────────────────────────────────────────────────────────────────────
  if (account && wrongNetwork) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.5rem" }}>
        <div
          className="glass-card"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            padding: "0.5rem 1rem",
            borderRadius: "var(--radius-sm)",
            background: "rgba(248, 113, 113, 0.08)",
            border: "1px solid rgba(248, 113, 113, 0.3)",
          }}
        >
          <span style={{ fontSize: "0.875rem", color: "#f87171", fontWeight: 600 }}>
            ⚠️ Wrong Network
          </span>
          <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
            Switch to Base Sepolia
          </span>
          <button
            className="btn-primary"
            onClick={handleSwitchNetwork}
            style={{ padding: "0.25rem 0.75rem", fontSize: "0.75rem", borderRadius: "4px" }}
          >
            Switch Network
          </button>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Render: Connected state
  // ─────────────────────────────────────────────────────────────────────────
  if (account) {
    return (
      <div
        className="glass-card"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          padding: "0.5rem 1rem",
          borderRadius: "var(--radius-sm)",
          background: "rgba(255,255,255,0.05)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              backgroundColor: "var(--accent-green)",
              boxShadow: "0 0 8px var(--accent-green)",
            }}
          />
          <span style={{ fontSize: "0.875rem", color: "var(--text-primary)", fontWeight: 500 }}>
            {casualModeActive ? "Logbook Open & Active 🐠" : "Connected"}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <span
            style={{
              fontSize: "0.8rem",
              color: "var(--text-secondary)",
              fontFamily: "monospace",
              padding: "0 0.5rem",
            }}
          >
            {casualModeActive ? generateAlias(account) : shortAddress(account)}
          </span>
        </div>
        <button
          className="btn-secondary"
          onClick={disconnect}
          style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem", borderRadius: "4px" }}
        >
          {casualModeActive ? "Close Logbook" : "Disconnect"}
        </button>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Render: Disconnected — show connect button
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.5rem" }}>
      <button
        className="btn-primary"
        onClick={connectPrivy}
        disabled={isConnecting}
        style={{ position: "relative", display: "flex", alignItems: "center", gap: "0.5rem" }}
      >
        {isConnecting ? (
          <>
            <div
              style={{
                width: "14px",
                height: "14px",
                border: "2px solid rgba(255,255,255,0.2)",
                borderTopColor: "#fff",
                borderRadius: "50%",
                animation: "shimmer 1s linear infinite",
              }}
            />
            {casualModeActive ? "Connecting… 📖" : "Connecting…"}
          </>
        ) : (
          <>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
              <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
              <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
            </svg>
            {casualModeActive ? "Open Logbook" : "Connect"}
          </>
        )}
      </button>
      {!casualModeActive && (
        <button
          onClick={connectMetaMask}
          disabled={!ready || isConnecting}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            fontSize: "0.7rem",
            cursor: "pointer",
            textDecoration: "underline",
            padding: "0.25rem",
          }}
        >
          Use MetaMask instead
        </button>
      )}
      {error && (
        <span style={{ fontSize: "0.75rem", color: "#f87171", fontWeight: 500 }}>
          {error}
        </span>
      )}
    </div>
  );
}
