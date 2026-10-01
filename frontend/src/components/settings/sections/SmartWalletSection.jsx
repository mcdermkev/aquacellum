import React, { useState, useEffect } from "react";
import { ArrowSquareOut, ShieldCheck } from "@phosphor-icons/react";
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
    /**
     * Retry while the signer is still being registered.
     *
     * ⚠️ THE RETRY MUST BE DRIVEN BY A null RESULT, NOT BY A REJECTION.
     * `getSmartWalletAddress()` RESOLVES with `null` when no signer is registered
     * yet — it does not throw (services/smartAccountClient.js). Putting this ladder
     * in `.catch()` meant the exact race it exists for (Settings mounting before
     * the Privy signer lands) took the SUCCESS path, stored `null`, and never
     * retried; the card then claimed "New entries are not being saved to the
     * permanent record" for a wallet that was moments from being ready.
     *
     * Only keep waiting while `hasUserSigner()` is false, i.e. the address is
     * absent for a reason that can still resolve itself. A null with a signer
     * already present is a real failure and is reported as one.
     */
    const attempt = (retries = 0) => {
      getSmartWalletAddress()
        .then((addr) => {
          if (cancelled) return;
          if (!addr && retries < 3 && !hasUserSigner()) {
            setTimeout(() => attempt(retries + 1), 1000);
            return;
          }
          setSmartWalletAddress(addr);
          setSmartWalletLoading(false);
        })
        .catch((err) => {
          if (cancelled) return;
          console.warn("Smart wallet init failed:", err);
          setSmartWalletLoading(false);
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
      : "Connecting…"
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
      icon={<ShieldCheck size={20} />}
      title={{ casual: "Record Keeping", pro: "Smart Wallet" }}
      description={{
        casual:
          "Your fish, logs and listings are written to a permanent public record, so your history and lineage can be independently verified. Fees are covered for you. You are never asked to pay.",
        pro:
          "ERC-4337 smart account status. Actions are batched and submitted as gasless UserOperations with gas sponsored by the CDP Paymaster.",
      }}
      casualModeActive={casualModeActive}
      badge={
        <span className={`st-badge ${smartWalletAddress ? "st-badge--ok" : "st-badge--warn"}`}>
          {statusLabel}
        </span>
      }
    >
      {!smartWalletAddress ? (
        <p className="st-text" style={{ margin: 0 }}>
          {smartWalletLoading
            ? casualModeActive
              ? "Getting your record keeping set up…"
              : "Connecting to the smart wallet…"
            : casualModeActive
              ? // The honest version of a failure: say what has stopped, in terms of
                // the user's data rather than the subsystem that stalled.
                "New entries are not being saved to the permanent record right now. Everything you add is still stored on this device and will sync once this reconnects."
              : "Smart wallet could not be initialized. On-chain writes are paused."}
        </p>
      ) : casualModeActive ? (
        <>
          <p className="st-text">
            Everything is being recorded normally. You do not need to do anything here.
          </p>

          <div className="st-disclosure">
            <details>
              <summary>Show technical details</summary>
              <TechnicalReadout address={smartWalletAddress} />
            </details>
          </div>
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
    <div className="st-readout">
      <div className="st-readout-row">
        <div>
          <span className="st-readout-label">Account ID</span>
          <span className="st-readout-value st-mono">
            {address.slice(0, 6)}…{address.slice(-4)}
          </span>
        </div>
        <a
          href={`https://sepolia.basescan.org/address/${address}`}
          target="_blank"
          rel="noopener noreferrer"
          className="st-link"
        >
          View on BaseScan
          <ArrowSquareOut size={16} aria-hidden="true" />
          <span className="st-sr-only">(opens in a new tab)</span>
        </a>
      </div>

      <div className="st-readout-tiles">
        <ReadoutTile label="Network" value="Base Sepolia" />
        <ReadoutTile label="Gas Sponsor" value="CDP Paymaster" />
        <ReadoutTile label="Batching" value="3s Queue" />
      </div>

      {showFooter && (
        <p className="st-hint" style={{ margin: "0.25rem 0 0" }}>
          All actions (mints, logs, listings) are batched and submitted as gasless UserOperations. Gas
          is fully sponsored by the CDP Paymaster. You never pay fees.
        </p>
      )}
    </div>
  );
}

function ReadoutTile({ label, value }) {
  return (
    <div className="st-readout-tile">
      <span className="st-readout-label">{label}</span>
      <span className="st-readout-value">{value}</span>
    </div>
  );
}

export default SmartWalletSection;
