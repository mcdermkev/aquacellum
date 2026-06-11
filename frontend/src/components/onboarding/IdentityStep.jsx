import React, { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "../../contexts/AuthContext";
import { useOnboarding } from "../../contexts/OnboardingContext";
import { generateAlias } from "../../utils/generateAlias";
import { db } from "../../db";
import { IDENTITY_COPY, resolveCopy } from "./identityCopy.js";

// Re-export the pure copy/helper so consumers can import them from the component
// module too. They live in `identityCopy.js` (no React/window deps) so they
// remain unit-testable in the node test environment.
export { IDENTITY_COPY, resolveCopy };

/**
 * IdentityStep.jsx
 *
 * Privy-only identity action area for the revamped onboarding flow
 * (onboarding-revamp spec, task 6.1).
 *
 * This is the ActionArea content for the `identity` phase. It presents a SINGLE
 * auth affordance — the Privy login button — and deliberately renders NO
 * MetaMask button and NO "link external wallet" link (Property 5 / Req 5.1).
 *
 * Flow:
 *   - Tapping the CTA calls `connectPrivy()` (email/Google embedded wallet). The
 *     account address resolves asynchronously via AuthContext effects (Req 5.2).
 *   - WHEN an `account` resolves: generate a friendly alias
 *     (`generateAlias(account)`), upsert the Dexie `userProfile` record, then
 *     `advance()` to the `nameConfirm` phase (Req 5.3).
 *   - WHEN Privy login fails or is cancelled: surface a friendly, persona-aware
 *     Poseidon retry line and re-enable the Privy button — no MetaMask fallback
 *     (Req 5.4).
 *   - OAuth-redirect resume is preserved: if the user returns already
 *     authenticated with a resolved account, the same account-resolve effect
 *     fires on mount and advances to `nameConfirm`.
 *
 * Casual mode keeps blockchain terminology abstracted ("secure logbook"); pro
 * mode may reference the embedded node (Req 5.5).
 *
 * Narration: the PoseidonNarrator is owned by the wizard composition (task 9.1).
 * This component accepts an optional `narrate(text)` callback so it can push
 * Poseidon's pending/success/retry lines into the shared transcript. When no
 * callback is supplied it still works standalone, surfacing the retry copy in an
 * inline `aria-live` region so the message is never lost.
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5
 */

/**
 * persistIdentityProfile — upsert the account's Dexie `userProfile` row with the
 * generated alias and chosen persona. Mirrors the established wizard write
 * (level 1, zeroed XP). Idempotent: updates an existing row in place, otherwise
 * creates a fresh one. No-ops without an account (Property 3 — account-gated
 * persistence).
 *
 * @param {string} account
 * @param {string} alias
 * @param {"casual"|"pro"|null} persona
 * @returns {Promise<void>}
 */
export async function persistIdentityProfile(account, alias, persona) {
  if (!account) return;
  const existing = await db.userProfile.get(account);
  if (existing) {
    await db.userProfile.update(account, { alias, persona });
    return;
  }
  await db.userProfile.add({
    walletAddress: account,
    alias,
    persona,
    level: 1,
    prestigeXp: 0,
    hobbyistXp: 0,
    isCouncilMember: false,
  });
}

export function IdentityStep({ narrate, className = "" }) {
  const { connectPrivy, isConnecting, error, ready } = useAuth();
  const { persona, casualMode, account, advance } = useOnboarding();

  // Treat an unchosen persona as casual so copy stays friendly (persona is set
  // by the time we reach the identity phase in normal flow).
  const isCasual = casualMode !== false;

  // Friendly, persona-aware retry line shown inline (and optionally narrated).
  const [retryLine, setRetryLine] = useState("");

  // Guards so the account-resolve side effects run exactly once per account.
  const handledAccountRef = useRef(null);
  // Tracks whether the user has actually attempted a login, so a pre-existing
  // AuthContext error from another surface doesn't render a spurious retry line.
  const attemptedRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ── Account-resolve handler (covers both fresh login AND OAuth-redirect resume).
  //    When the embedded-wallet address resolves, write identity locally and
  //    advance to name confirmation. Runs once per resolved account.
  useEffect(() => {
    if (!account) return;
    if (handledAccountRef.current === account) return;
    handledAccountRef.current = account;

    const alias = generateAlias(account);

    (async () => {
      try {
        await persistIdentityProfile(account, alias, persona);
      } catch (err) {
        // Persistence is best-effort; never block progression on a Dexie hiccup.
        console.warn("[onboarding] identity profile write failed:", err?.message);
      }
      if (!mountedRef.current) return;
      // Clear any lingering retry copy now that we've succeeded.
      setRetryLine("");
      advance(); // identity → nameConfirm
    })();
  }, [account, persona, advance]);

  // ── Failure / cancellation: surface a friendly retry line and re-enable the
  //    button. We only react to errors that follow a real login attempt so we
  //    don't show a retry message on first render.
  useEffect(() => {
    if (!error || !attemptedRef.current || account) return;
    if (isConnecting) return; // wait until the attempt has actually settled

    const line = resolveCopy(IDENTITY_COPY.retry, isCasual);
    setRetryLine(line);
    if (typeof narrate === "function") {
      Promise.resolve(narrate(line)).catch(() => {});
    }
  }, [error, isConnecting, account, isCasual, narrate]);

  const handleConnect = useCallback(async () => {
    attemptedRef.current = true;
    setRetryLine("");
    try {
      await connectPrivy();
      // Success path: account resolution is handled by the effect above as the
      // AuthContext effects settle the embedded-wallet address.
    } catch (err) {
      // connectPrivy swallows most errors into AuthContext `error`; this catch
      // is a belt-and-braces fallback for unexpected throws.
      const line = resolveCopy(IDENTITY_COPY.retry, isCasual);
      if (mountedRef.current) setRetryLine(line);
      if (typeof narrate === "function") {
        Promise.resolve(narrate(line)).catch(() => {});
      }
    }
  }, [connectPrivy, isCasual, narrate]);

  // Disable while Privy is mid-flight, while the SDK is still booting, or once
  // an account has resolved (we're about to advance).
  const busy = isConnecting || !ready;
  const ctaLabel = busy
    ? resolveCopy(IDENTITY_COPY.ctaBusy, isCasual)
    : resolveCopy(IDENTITY_COPY.cta, isCasual);

  return (
    <div className={`onboarding-action-area${className ? ` ${className}` : ""}`}>
      <button
        type="button"
        className="btn-primary onboarding-privy-btn"
        onClick={handleConnect}
        disabled={busy || !!account}
        aria-busy={busy}
      >
        {ctaLabel}
      </button>

      {/* Friendly Poseidon retry line — announced politely so screen-reader
          users hear the failure without losing focus. Empty until a real
          failure occurs. */}
      <p
        className="onboarding-action-error"
        role="status"
        aria-live="polite"
      >
        {retryLine}
      </p>
    </div>
  );
}

export default IdentityStep;
