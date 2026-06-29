/**
 * ConnectWallet.jsx
 * 
 * Login component — supports Privy (email/Google) and MetaMask.
 * Privy is the primary login method; MetaMask is the fallback for advanced users.
 */

import React, { useState, useEffect } from "react";
import { CaretDown, Wallet } from "@phosphor-icons/react";
import { useAuth } from "../contexts/AuthContext";
import { generateAlias } from "../utils/generateAlias";
import { useProfile } from "../hooks/useReefProfile";

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

  const { data: reefProfile } = useProfile(account, !!account);
  const [showMetaMaskOption, setShowMetaMaskOption] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dexieAlias, setDexieAlias] = useState(null);

  // Resolve display name: Supabase profile name → Dexie alias → generated alias → short address
  const displayNameResolved = reefProfile?.display_name || dexieAlias || (account ? generateAlias(account) : "");

  // Try to read the local Dexie alias as a fallback (in case Supabase profile is missing/stale)
  React.useEffect(() => {
    if (!account) { setDexieAlias(null); return; }
    import("../db").then(({ db }) => {
      db.userProfile.get(account).then((profile) => {
        if (profile?.alias) {
          setDexieAlias(profile.alias);
        }
      }).catch(() => {});
    });
  }, [account]);

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
  // Render: Connected state — Profile chip with dropdown menu
  // ─────────────────────────────────────────────────────────────────────────
  if (account) {
    const avatarUrl = reefProfile?.avatar_url;
    const tierBadge = reefProfile?.companion_tier || "Shallow";

    return (
      <div style={{ position: "relative" }}>
        {/* Profile Chip — clickable */}
        <button
          data-tour-id="profile-widget"
          onClick={() => setMenuOpen(!menuOpen)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.6rem",
            padding: "0.35rem 0.75rem 0.35rem 0.35rem",
            borderRadius: "50px",
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.04)",
            cursor: "pointer",
            transition: "all 0.2s ease",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)"; e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
          aria-label="User menu"
          aria-expanded={menuOpen}
        >
          {/* Avatar with status dot */}
          <div style={{ position: "relative", width: "30px", height: "30px", flexShrink: 0 }}>
            <div style={{
              width: "30px",
              height: "30px",
              borderRadius: "50%",
              background: avatarUrl
                ? `url(${avatarUrl}) center/cover`
                : "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
              border: "1.5px solid rgba(255,255,255,0.12)",
            }} />
            {/* Green status dot */}
            <span style={{
              position: "absolute",
              bottom: "0px",
              right: "0px",
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background: "var(--accent-green)",
              border: "1.5px solid rgba(15, 23, 42, 0.9)",
              boxShadow: "0 0 4px var(--accent-green)",
            }} />
          </div>

          {/* Name + tier */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", minWidth: 0 }}>
            <span style={{
              fontSize: "0.75rem",
              color: "#fff",
              fontWeight: 600,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: "120px",
            }}>
              {displayNameResolved || shortAddress(account)}
            </span>
            <span style={{ fontSize: "0.55rem", color: "var(--text-muted)", lineHeight: "1" }}>
              {tierBadge}
            </span>
          </div>

          {/* Chevron */}
          <CaretDown size={10} weight="bold" style={{ opacity: 0.5, transition: "transform 0.2s", transform: menuOpen ? "rotate(180deg)" : "rotate(0)" }} />
        </button>

        {/* Dropdown Menu — rendered as fixed overlay to avoid any clipping */}
        {menuOpen && (
          <>
            {/* Invisible backdrop to catch outside clicks */}
            <div
              onClick={() => setMenuOpen(false)}
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 9998,
              }}
              aria-hidden="true"
            />
            <div
              role="menu"
              aria-label="User menu"
              style={{
              position: "fixed",
              top: "70px",
              right: "2rem",
              minWidth: "180px",
              padding: "0.4rem",
              borderRadius: "var(--radius-sm)",
              background: "rgba(15, 23, 42, 0.97)",
              border: "1px solid rgba(255,255,255,0.12)",
              backdropFilter: "blur(16px)",
              boxShadow: "0 12px 40px rgba(0,0,0,0.7)",
              zIndex: 9999,
              display: "flex",
              flexDirection: "column",
              gap: "0.15rem",
            }}>
            {/* Profile header in dropdown */}
            <div style={{
              padding: "0.5rem 0.75rem",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
              marginBottom: "0.25rem",
            }}>
              <div style={{ fontSize: "0.75rem", color: "#fff", fontWeight: 600 }}>
                {displayNameResolved || shortAddress(account)}
              </div>
              <div style={{ fontSize: "0.6rem", color: "var(--text-muted)", fontFamily: "monospace" }}>
                {shortAddress(account)}
              </div>
            </div>

            {/* View Profile */}
            <button
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                // Navigate to Reef tab via React Router, then trigger profile view
                window.dispatchEvent(new CustomEvent("poseidon:navigate", { detail: { tab: "reef" } }));
                // Small delay to ensure reef tab is active, then trigger profile view
                setTimeout(() => {
                  window.dispatchEvent(new CustomEvent("reef_view_profile", { detail: { wallet: account } }));
                }, 300);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.5rem 0.75rem",
                borderRadius: "6px",
                border: "none",
                background: "transparent",
                color: "var(--text-secondary)",
                fontSize: "0.75rem",
                cursor: "pointer",
                textAlign: "left",
                width: "100%",
                transition: "all 0.15s ease",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "#fff"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-secondary)"; }}
            >
              👤 View Profile
            </button>

            {/* Disconnect */}
            <button
              role="menuitem"
              onClick={() => { setMenuOpen(false); disconnect(); }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.5rem 0.75rem",
                borderRadius: "6px",
                border: "none",
                background: "transparent",
                color: "var(--text-muted)",
                fontSize: "0.75rem",
                cursor: "pointer",
                textAlign: "left",
                width: "100%",
                transition: "all 0.15s ease",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(248, 113, 113, 0.08)"; e.currentTarget.style.color = "var(--accent-red)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-muted)"; }}
            >
              {casualModeActive ? "📕 Close Logbook" : "⏻ Disconnect"}
            </button>
          </div>
          </>
        )}
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
            <Wallet size={18} weight="duotone" />
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
