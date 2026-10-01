/**
 * ConnectWallet.jsx
 * 
 * Login component — supports Privy (email/Google) and MetaMask.
 * Privy is the primary login method; MetaMask is the fallback for advanced users.
 */

import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { CaretDown, SignOut, UserCircle, Wallet } from "@phosphor-icons/react";
import { useAuth } from "../contexts/AuthContext";
import { generateAlias } from "../utils/generateAlias";
import { useProfile } from "../hooks/useReefProfile";
import "./AccountMenu.css";

// Shorten address for display: 0xABCD…1234
function shortAddress(addr) {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function ConnectWallet({ onConnected, onDisconnected, casualModeActive, triggerLoginOnEntry, clearTriggerLogin }) {
  const {
    account,
    authenticated,
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
  const [menuPos, setMenuPos] = useState(null);
  const [dexieAlias, setDexieAlias] = useState(null);
  const chipRef = useRef(null);
  const itemRefs = useRef([]);

  // Menu keyboard support (WAI-ARIA menu button): focus the first item on
  // open; arrows, Home and End move between items; Escape and Tab close and
  // return focus to the chip.
  useEffect(() => {
    if (menuOpen) itemRefs.current[0]?.focus();
  }, [menuOpen]);

  const toggleMenu = () => {
    if (!menuOpen && chipRef.current) {
      // Open just under the chip, right edges aligned.
      const r = chipRef.current.getBoundingClientRect();
      setMenuPos({ top: Math.round(r.bottom + 8), right: Math.max(12, Math.round(window.innerWidth - r.right)) });
    }
    setMenuOpen(!menuOpen);
  };

  const closeMenuToChip = () => {
    setMenuOpen(false);
    chipRef.current?.focus();
  };

  const onMenuKeyDown = (e) => {
    const items = itemRefs.current.filter(Boolean);
    const index = items.indexOf(document.activeElement);
    let next = null;
    if (e.key === "ArrowDown") next = (index + 1) % items.length;
    else if (e.key === "ArrowUp") next = (index - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    else if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      closeMenuToChip();
      return;
    }
    if (next === null) return;
    e.preventDefault();
    items[next]?.focus();
  };

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
    if (triggerLoginOnEntry && (!account || !authenticated) && !isConnecting && ready) {
      connectPrivy();
      if (clearTriggerLogin) clearTriggerLogin();
    } else if (triggerLoginOnEntry) {
      // Already connected or not ready — just clear the flag
      if (clearTriggerLogin) clearTriggerLogin();
    }
  }, [triggerLoginOnEntry, account, authenticated, isConnecting, ready, connectPrivy, clearTriggerLogin]);

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
          <span style={{ fontSize: "0.875rem", color: "var(--accent-red)", fontWeight: 600 }}>
            ⚠️ Connection Issue
          </span>
          <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
            Please reconnect
          </span>
          <button
            className="btn-primary"
            onClick={handleSwitchNetwork}
            style={{ padding: "0.25rem 0.75rem", fontSize: "0.75rem", borderRadius: "4px" }}
          >
            Reconnect
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
        {/* Profile chip. Keep the child order (avatar div, name div, caret):
            index.css hides the 2nd div on phones so only the avatar shows. */}
        <button
          ref={chipRef}
          type="button"
          className="acct-chip"
          data-tour-id="profile-widget"
          onClick={toggleMenu}
          aria-label="User menu"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? "acct-menu" : undefined}
        >
          {/* Avatar with status dot */}
          <div className="acct-avatar-wrap">
            <div
              className="acct-avatar"
              style={avatarUrl ? { backgroundImage: `url(${avatarUrl})` } : undefined}
            />
            <span className="acct-dot" />
          </div>

          {/* Name + tier */}
          <div className="acct-text">
            <span className="acct-name">
              {displayNameResolved || shortAddress(account)}
            </span>
            <span className="acct-tier">
              {tierBadge}
            </span>
          </div>

          {/* Chevron */}
          <CaretDown size={12} weight="bold" className="acct-caret" aria-hidden="true" />
        </button>

        {/* Dropdown Menu — PORTALLED TO document.body.
            `position: fixed` alone was not enough and this menu rendered UNDER the
            tab strip on desktop. An ancestor with `backdrop-filter` (the header's
            `.glass-card`) becomes both the containing block AND a stacking context
            for fixed-position descendants, so `zIndex: 9999` below was being
            resolved INSIDE the header rather than against the page — and the nav
            strip, a later sibling that also has `backdrop-filter`, painted over
            it. Portalling to the body is what actually escapes that; raising the
            z-index here could never have worked. */}
        {menuOpen && createPortal(
          <>
            {/* Invisible backdrop to catch outside clicks */}
            <div
              className="acct-backdrop"
              onClick={() => setMenuOpen(false)}
              aria-hidden="true"
            />
            <div
              id="acct-menu"
              className="acct-menu"
              role="menu"
              aria-label="User menu"
              onKeyDown={onMenuKeyDown}
              style={menuPos ? { top: `${menuPos.top}px`, right: `${menuPos.right}px` } : undefined}
            >
            {/* Profile header in dropdown */}
            <div className="acct-head" role="none">
              <div className="acct-head-name">
                {displayNameResolved || shortAddress(account)}
              </div>
              <div className="acct-head-address">
                {shortAddress(account)}
              </div>
            </div>

            {/* View Profile */}
            <button
              ref={(el) => { itemRefs.current[0] = el; }}
              type="button"
              className="acct-item"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                setMenuOpen(false);
                // Navigate to Reef tab via React Router, then trigger profile view
                window.dispatchEvent(new CustomEvent("poseidon:navigate", { detail: { tab: "reef" } }));
                // Small delay to ensure reef tab is active, then trigger profile view
                setTimeout(() => {
                  window.dispatchEvent(new CustomEvent("reef_view_profile", { detail: { wallet: account } }));
                }, 300);
              }}
            >
              <UserCircle size={20} weight="bold" aria-hidden="true" />
              View profile
            </button>

            {/* Disconnect */}
            <button
              ref={(el) => { itemRefs.current[1] = el; }}
              type="button"
              className="acct-item acct-item--danger"
              role="menuitem"
              tabIndex={-1}
              onClick={() => { setMenuOpen(false); disconnect(); }}
            >
              <SignOut size={20} weight="bold" aria-hidden="true" />
              {casualModeActive ? "Close logbook" : "Disconnect"}
            </button>
          </div>
          </>,
          document.body
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
                border: "2px solid rgba(255, 255, 255, 0.3)",
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
        <span style={{ fontSize: "0.75rem", color: "var(--accent-red)", fontWeight: 500 }}>
          {error}
        </span>
      )}
    </div>
  );
}
