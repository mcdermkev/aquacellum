import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useOnboarding } from "../../contexts/OnboardingContext";
import { generateAlias } from "../../utils/generateAlias";
import { db } from "../../db";
import { ensureProfile, updateProfile, checkDisplayNameAvailable } from "../../services/reefApi";
import { isSupabaseConfigured } from "../../services/supabaseClient";
import {
  NAME_CONFIRM_COPY,
  MAX_NAME_LENGTH,
  resolvePersonaCopy,
  nameConfirmButtonLabel,
  normalizeName,
  cleanName,
  isNameValid,
} from "./nameConfirmCopy.js";

// Re-export the pure copy/helpers so consumers (and tests) can import them from
// the component module too. They live in `nameConfirmCopy.js` (no React/Dexie
// deps) so they stay unit-testable in the node test environment.
export {
  NAME_CONFIRM_COPY,
  MAX_NAME_LENGTH,
  resolvePersonaCopy,
  nameConfirmButtonLabel,
  normalizeName,
  cleanName,
  isNameValid,
};

/**
 * NameConfirmStep.jsx
 *
 * Name-confirmation step for the revamped onboarding flow (onboarding-revamp
 * spec, task 6.2). This is the ActionArea content for the `nameConfirm` phase,
 * reached after the Privy identity step resolves an account.
 *
 * Behavior:
 *   - The editable input is PRE-FILLED with a friendly, deterministic alias
 *     derived from the connected account via `generateAlias(account)` (Req 7.1).
 *     If the context already carries a `displayName` (e.g. a resumed session)
 *     that value wins so the user's prior edit isn't clobbered.
 *   - The field is capped at `MAX_NAME_LENGTH` (30) characters and supports
 *     Enter-to-submit; the confirm button is disabled while the trimmed name is
 *     empty (Req 7.6).
 *   - On confirm: persist the chosen name to BOTH the Dexie `userProfile.alias`
 *     mirror AND the Supabase `profiles.display_name` column (the Supabase write
 *     is guarded by `isSupabaseConfigured()` and is a no-op otherwise), then
 *     `advance()` to the `hatch` phase (Req 7.2).
 *
 * Narration: the PoseidonNarrator transcript is owned by the wizard composition
 * (task 9.1). This component accepts an optional `narrate(text)` callback so it
 * can push the prompt/confirmation lines into the shared transcript; standalone
 * it still works and exposes copy through its own labelled controls.
 *
 * Validates: Requirements 7.1, 7.2, 7.6
 */

/**
 * persistDisplayName — persist the confirmed name to the Dexie `userProfile`
 * alias mirror and the Supabase `display_name` column.
 *
 * Pure-ish and dependency-injectable so it can be unit-tested without React
 * (task 6.3). Dependencies default to the real `db` / reefApi / config check
 * but can be overridden in tests.
 *
 *   - No account or empty name → no-op (account-gated persistence, Property 3).
 *   - Supabase write is guarded by `supabaseConfigured()` and is best-effort:
 *     a server hiccup never blocks progression — the offline-first Dexie mirror
 *     is still written.
 *   - The Dexie write is an upsert: `update` (merge, preserving other fields)
 *     with a `put` fallback when no row exists yet.
 *
 * @param {string} account
 * @param {string} name
 * @param {{
 *   database?: typeof db,
 *   ensureProfileFn?: typeof ensureProfile,
 *   updateProfileFn?: typeof updateProfile,
 *   supabaseConfigured?: typeof isSupabaseConfigured,
 * }} [deps]
 * @returns {Promise<{persisted: boolean, name?: string, reason?: string, supabaseWritten?: boolean, aliasWritten?: boolean}>}
 */
export async function persistDisplayName(
  account,
  name,
  {
    database = db,
    ensureProfileFn = ensureProfile,
    updateProfileFn = updateProfile,
    supabaseConfigured = isSupabaseConfigured,
  } = {}
) {
  const trimmed = cleanName(name);
  if (!account || !trimmed) {
    return { persisted: false, reason: !account ? "no-account" : "empty-name" };
  }

  // ── Supabase display_name (server source of truth) — guarded by config.
  let supabaseWritten = false;
  if (supabaseConfigured()) {
    try {
      // ensureProfile creates the row if it doesn't exist yet; updateProfile
      // covers the case where the row already existed from the identity step.
      await ensureProfileFn(account, {
        display_name: trimmed,
        companion_tier: "Bronze",
      });
      await updateProfileFn(account, { display_name: trimmed });
      supabaseWritten = true;
    } catch (err) {
      console.warn("[onboarding] Supabase display_name write failed:", err?.message);
    }
  }

  // ── Dexie alias mirror (offline-first; best-effort upsert).
  let aliasWritten = false;
  try {
    const updated = await database.userProfile.update(account, { alias: trimmed });
    if (!updated) {
      await database.userProfile.put({ walletAddress: account, alias: trimmed });
    }
    aliasWritten = true;
  } catch (err) {
    console.warn("[onboarding] Dexie alias write failed:", err?.message);
  }

  return {
    persisted: aliasWritten || supabaseWritten,
    name: trimmed,
    supabaseWritten,
    aliasWritten,
  };
}

export function NameConfirmStep({ narrate, className = "" }) {
  const { persona, casualMode, account, displayName, setDisplayName, advance } =
    useOnboarding();

  const isCasual = casualMode !== false;

  // Suggested alias derived from the account (Req 7.1). Memoized so it stays
  // stable across re-renders for the same account.
  const suggestedAlias = useMemo(
    () => (account ? generateAlias(account) : ""),
    [account]
  );

  // Local editable value. Seed from any existing context displayName (resumed
  // session) and otherwise from the suggested alias.
  const [value, setValue] = useState(() =>
    normalizeName(displayName || suggestedAlias)
  );
  const [busy, setBusy] = useState(false);
  const [nameTaken, setNameTaken] = useState(false);
  const [checking, setChecking] = useState(false);
  const checkTimerRef = useRef(null);

  // Guard so the one-time prefill effect only seeds the field once per account
  // and never stomps a value the user has started editing.
  const seededRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Prefill once the account (and therefore the suggested alias) resolves, but
  // only if the field hasn't already been seeded with a meaningful value.
  useEffect(() => {
    if (seededRef.current) return;
    const seed = normalizeName(displayName || suggestedAlias);
    if (!seed) return;
    seededRef.current = true;
    setValue(seed);
  }, [displayName, suggestedAlias]);

  // Debounced name-availability check (400ms after the user stops typing).
  useEffect(() => {
    const trimmed = (value || "").trim();
    if (!trimmed || trimmed.length < 2) {
      setNameTaken(false);
      setChecking(false);
      return;
    }
    setChecking(true);
    if (checkTimerRef.current) clearTimeout(checkTimerRef.current);
    checkTimerRef.current = setTimeout(async () => {
      const { available } = await checkDisplayNameAvailable(trimmed, account);
      if (mountedRef.current) {
        setNameTaken(!available);
        setChecking(false);
      }
    }, 400);
    return () => {
      if (checkTimerRef.current) clearTimeout(checkTimerRef.current);
    };
  }, [value, account]);

  // Push Poseidon's name prompt into the shared transcript once on mount.
  const narratedRef = useRef(false);
  useEffect(() => {
    if (narratedRef.current || typeof narrate !== "function") return;
    narratedRef.current = true;
    Promise.resolve(narrate(resolvePersonaCopy(NAME_CONFIRM_COPY.prompt, isCasual))).catch(
      () => {}
    );
  }, [narrate, isCasual]);

  const valid = isNameValid(value) && !nameTaken;

  const handleChange = useCallback((e) => {
    // Clamp to the max length as the user types (Req 7.6).
    setValue(normalizeName(e.target.value));
  }, []);

  const handleConfirm = useCallback(async () => {
    const finalName = cleanName(value);
    if (!finalName || busy) return;

    setBusy(true);
    // Reflect the confirmed name in shared context immediately so downstream
    // phases (and the narrator) can read it.
    setDisplayName(finalName);

    try {
      await persistDisplayName(account, finalName);
    } catch (err) {
      // Persistence is best-effort and already swallows its own errors; this is
      // a final guard so a thrown error never blocks the user from advancing.
      console.warn("[onboarding] name persistence failed:", err?.message);
    }

    if (typeof narrate === "function") {
      const confirmLine = isCasual
        ? `Nice to meet you, ${finalName}. Let's get your logbook set up.`
        : `Operator "${finalName}" acknowledged. Proceeding with initialization.`;
      Promise.resolve(narrate(confirmLine)).catch(() => {});
    }

    if (!mountedRef.current) return;
    setBusy(false);
    advance(); // nameConfirm → hatch
  }, [value, busy, account, persona, isCasual, narrate, setDisplayName, advance]);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === "Enter" && isNameValid(value) && !busy) {
        e.preventDefault();
        handleConfirm();
      }
    },
    [value, busy, handleConfirm]
  );

  const inputId = "onboarding-name-input";

  return (
    <div className={`onboarding-action-area${className ? ` ${className}` : ""}`}>
      <label htmlFor={inputId} className="onboarding-name-label">
        {resolvePersonaCopy(NAME_CONFIRM_COPY.prompt, isCasual)}
      </label>

      <input
        id={inputId}
        type="text"
        className="onboarding-name-input"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={resolvePersonaCopy(NAME_CONFIRM_COPY.placeholder, isCasual)}
        maxLength={MAX_NAME_LENGTH}
        disabled={busy}
        autoFocus
        autoComplete="off"
        aria-label={resolvePersonaCopy(NAME_CONFIRM_COPY.prompt, isCasual)}
        aria-invalid={nameTaken}
      />

      {nameTaken && (
        <p className="onboarding-name-taken" style={{
          fontSize: "0.75rem",
          color: "var(--accent-red, #f87171)",
          margin: "0.25rem 0 0",
        }}>
          That name is already taken. Try something else!
        </p>
      )}
      {checking && !nameTaken && (
        <p style={{ fontSize: "0.7rem", color: "var(--text-muted)", margin: "0.25rem 0 0" }}>
          Checking availability…
        </p>
      )}

      <button
        type="button"
        className="btn-primary onboarding-name-btn"
        onClick={handleConfirm}
        disabled={!valid || busy}
        aria-busy={busy}
      >
        {nameConfirmButtonLabel(isCasual, busy)}
      </button>
    </div>
  );
}

export default NameConfirmStep;
