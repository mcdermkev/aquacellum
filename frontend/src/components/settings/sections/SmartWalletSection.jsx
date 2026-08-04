import React, { useState, useEffect } from "react";
import { SettingsSection } from "../SettingsSection";
import { useAuth } from "../../../contexts/AuthContext";
import { getSmartWalletAddress, hasUserSigner } from "../../../services/smartAccountClient";

/**
 * SmartWalletSection — Settings → Record Keeping (casual) / Smart Wallet (pro).
 *
 * ⚠️ D-S-6, resolved in Phase 5. This card was the sharpest casual/pro
 * inconsistency in the tab: it had NO mode branching at all, so casual users read
 * "On-Chain Smart Wallet (EIP-4337)", "Base Sepolia", "CDP Paymaster", "3s Queue"
 * and a BaseScan link — while the Experience Mode card a few sections above
 * promised casual mode "keeps technical blockchain details tucked away".
 *
 * The fix is NOT to hide it from casual. §3 is explicit that mode changes labels,
 * copy register and density — never whether a control exists — and AC-4 forbids
 * rendering a section conditionally on `casualModeActive`. Hiding it would also
 * withhold something a casual user genuinely needs to know: whether their records
 * are actually being saved, and that they are never charged.
 *
 * So casual gets the honest plain-language version — what is happening to their
 * entries and who pays — with the addresses, network, paymaster and BaseScan link
 * moved into a "Show technical details" disclosure. Pro keeps the previous readout
 * verbatim.
 *
 * The disclosure is a native `<details>`/`<summary>` rather than a custom toggle:
 * keyboard operation and expanded-state announcement come for free, which is the
 * right default for a control whose only job is to reveal text (AC-5).
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

  // One status, two registers. Casual hears what it means for their data; pro
  // hears the system state. Both report the SAME fact — the point of the card is
  // to say whether records are actually being written.
  const statusLabel = smartWalletLoading
    ? casualModeActive
      ? "Setting up"
      : "Initializing..."
    : smartWalletAddress
      ? casualModeActive
        ? "Saving"
        : "Active"
      : casualModeActive
        ? "Paused"
        : "Offline";

  return (
    <SettingsSection
      id="advanced"
      icon="⛓️"
      title={{ casual: "Record Keeping", pro: "Smart Wallet" }}
      description={{
        casual:
          "Your fish, logs and listings are written to a permanent public record, so your history and lineage can be independently verified. Fees are covered for you — you are never asked to pay.",
        pro:
          "ERC-4337 smart account status. Actions are batched and submitted as gasless UserOperations with gas sponsored by the CDP Paymaster.",
      }}
      casualModeActive={casualModeActive}
      badge={
        <span
          style={{
            fontSize: "0.6rem",
            padding: "0.15rem 0.5rem",
            borderRadius: "20px",
            background: smartWalletAddress ? "rgba(52, 211, 153, 0.15)" : "rgba(251, 191, 36, 0.15)",
            color: smartWalletAddress ? "#4ade80" : "#fbbf24",
            border: smartWalletAddress
              ? "1px solid rgba(52, 211, 153, 0.3)"
              : "1px solid rgba(251, 191, 36, 0.3)",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            whiteSpace: "nowrap",
          }}
        >
          {statusLabel}
        </span>
      }
    >
      {!smartWalletAddress ? (
        <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", lineHeight: 1.5, margin: 0 }}>
          {smartWalletLoading
            ? casualModeActive
              ? "Getting your record keeping set up…"
              : "Connecting to Coinbase Smart Wallet..."
            : casualModeActive
              ? // The honest version of a failure: say what has stopped, in terms of
                // the user's data rather than the subsystem that stalled.
                "New entries are not being saved to the permanent record right now. Everything you add is still stored on this device and will sync once this reconnects."
              : "Smart wallet could not be initialized. On-chain writes are paused."}
        </p>
      ) : casualModeActive ? (
        <>
          <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", lineHeight: 1.5, margin: "0 0 1rem" }}>
            Everything is being recorded normally. You do not need to do anything here.
          </p>

          <details>
            <summary
              style={{
                cursor: "pointer",
                fontSize: "0.75rem",
                fontWeight: 600,
                color: "var(--accent-blue)",
                minHeight: 32,
                display: "flex",
                alignItems: "center",
              }}
            >
              Show technical details
            </summary>
            <div style={{ marginTop: "0.85rem" }}>
              <TechnicalReadout address={smartWalletAddress} />
            </div>
          </details>
        </>
      ) : (
        <TechnicalReadout address={smartWalletAddress} showFooter />
      )}
    </SettingsSection>
  );
}

/**
 * The addresses/network/paymaster readout. Identical markup in both modes — the
 * only difference is where it sits: inline for pro, behind a disclosure for casual.
 * Keeping it as one component means the two modes cannot drift apart, which is how
 * the half-branched "Data Management & Portability" defect happened (AC-4).
 */
function TechnicalReadout({ address, showFooter = false }) {
  return (
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
            {address.slice(0, 6)}...{address.slice(-4)}
          </span>
        </div>
        <a
          href={`https://sepolia.basescan.org/address/${address}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: "0.7rem", color: "var(--accent-blue)", textDecoration: "none", fontWeight: 600 }}
        >
          View on BaseScan ↗
        </a>
      </div>

      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <ReadoutTile label="Network" value="Base Sepolia" color="#4ade80" tint="52,211,153" />
        <ReadoutTile label="Gas Sponsor" value="CDP Paymaster" color="#38bdf8" tint="56,189,248" />
        <ReadoutTile label="Batching" value="3s Queue" color="#c084fc" tint="168,85,247" />
      </div>

      {showFooter && (
        <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", lineHeight: 1.5, margin: "0.25rem 0 0" }}>
          All actions (mints, logs, listings) are batched and submitted as gasless UserOperations. Gas
          is fully sponsored by the CDP Paymaster — you never pay fees.
        </p>
      )}
    </div>
  );
}

function ReadoutTile({ label, value, color, tint }) {
  return (
    <div
      style={{
        flex: "1 1 120px",
        padding: "0.5rem 0.75rem",
        background: `rgba(${tint},0.04)`,
        borderRadius: "6px",
        border: `1px solid rgba(${tint},0.15)`,
      }}
    >
      <span style={{ display: "block", fontSize: "0.6rem", color: "var(--text-muted)", marginBottom: "0.15rem" }}>
        {label}
      </span>
      <span style={{ fontSize: "0.75rem", color, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

export default SmartWalletSection;
