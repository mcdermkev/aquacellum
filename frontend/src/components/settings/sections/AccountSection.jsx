import React, { useEffect, useState } from "react";
import { SettingsSection } from "../SettingsSection";
import { SettingsSubsectionLabel as SubsectionLabel } from "../SettingsSubsectionLabel";
import { announce } from "../../../utils/a11y";
import { useAuth } from "../../../contexts/AuthContext";
import { useProfile, useUpdateProfile } from "../../../hooks/useReefProfile";

const MAX_DISPLAY_NAME = 30;

/**
 * AccountSection — Settings → Your Account / Account & Identity
 * (docs/SETTINGS_SPEC.md §6 #2).
 *
 * This section was blocked for most of the rework on the belief that
 * `profiles.email` was never written. That was wrong: `AuthContext` has a working
 * email-capture effect that mirrors the Privy-linked address onto the profile
 * (missed originally because it uses shorthand `updateProfile(account, { email })`
 * with no `email:` to grep for). All four real profiles carry an address, so the
 * section is buildable and every field here reads something real.
 *
 * ── WHY EMAIL IS READ-ONLY ────────────────────────────────────────────────────
 * Deliberately not editable. The address is whatever the user authenticated with
 * through Privy, so it IS their verified identity — editing it here would either
 * silently diverge from the login they actually use, or imply we can re-verify a
 * new address, which needs a verification flow that does not exist. Showing it and
 * naming where it comes from is the honest version.
 *
 * ── DISPLAY NAME IS MIRRORED, NOT DUPLICATED ──────────────────────────────────
 * It writes `profiles.display_name` through the same `useUpdateProfile` mutation
 * Reef's `ProfileEdit` uses, so both surfaces edit one value and neither can drift.
 * Reef keeps its own editor because that is where a user thinks about their social
 * identity; Settings has it because that is where they look for account fields.
 *
 * ── TIMEZONE IS DISPLAYED, NOT CHOSEN ─────────────────────────────────────────
 * Captured automatically from the browser when notification preferences save
 * (see SonarPreferences), because quiet hours are enforced server-side and need a
 * zone to resolve wall-clock times. Shown here so the value governing that is
 * visible rather than invisible, but not editable: the browser's answer is better
 * than anything a dropdown would collect, and a second source would just let the
 * two disagree.
 */
export function AccountSection({ casualModeActive }) {
  const { account, disconnect, loginMethod } = useAuth();
  const { data: profile } = useProfile(account, !!account);
  const updateProfile = useUpdateProfile();

  const [nameInput, setNameInput] = useState("");
  const [status, setStatus] = useState(null);

  // Seed the input once the profile arrives, without clobbering in-progress typing.
  useEffect(() => {
    if (profile?.display_name !== undefined && nameInput === "") {
      setNameInput(profile.display_name || "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.display_name]);

  const storedName = profile?.display_name || "";
  const trimmed = nameInput.trim();
  const dirty = trimmed !== storedName;

  const handleSaveName = () => {
    if (!dirty || !account) return;
    setStatus(null);
    updateProfile.mutate(
      { walletAddress: account, updates: { display_name: trimmed || null } },
      {
        onSuccess: () => {
          setStatus({ type: "success", text: "Display name saved." });
          announce("Display name saved");
        },
        onError: (err) => {
          // Report the failure rather than showing a success state that lies —
          // the defect this rework has been removing everywhere else.
          setStatus({ type: "error", text: `Couldn't save: ${err?.message || "unknown error"}` });
        },
      }
    );
  };

  const handleSignOut = async () => {
    announce("Signing out");
    await disconnect();
  };

  if (!account) {
    return (
      <SettingsSection
        id="account"
        icon="👤"
        title={{ casual: "Your Account", pro: "Account & Identity" }}
        casualModeActive={casualModeActive}
      >
        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
          Sign in to see your account details.
        </p>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection
      id="account"
      icon="👤"
      title={{ casual: "Your Account", pro: "Account & Identity" }}
      description={{
        casual: "How you sign in, what other keepers see, and how to sign out.",
        pro: "Identity, sign-in method, and session control.",
      }}
      casualModeActive={casualModeActive}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
        {/* ─── Display name ─── */}
        <div>
          <SubsectionLabel>{casualModeActive ? "Your name" : "Display name"}</SubsectionLabel>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10, lineHeight: 1.4 }}>
            {casualModeActive
              ? "Shown on your posts and your profile. You can change it any time."
              : "Public identifier on social surfaces and storefront attribution."}
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
            <input
              type="text"
              value={nameInput}
              maxLength={MAX_DISPLAY_NAME}
              onChange={(e) => {
                setNameInput(e.target.value.slice(0, MAX_DISPLAY_NAME));
                setStatus(null);
              }}
              aria-label={casualModeActive ? "Your name" : "Display name"}
              style={{
                flex: "1 1 200px",
                minHeight: 40,
                padding: "0.5rem 0.7rem",
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.15)",
                background: "rgba(0,0,0,0.25)",
                color: "var(--text-primary)",
                fontSize: "0.85rem",
              }}
            />
            <button
              type="button"
              className="btn-primary"
              onClick={handleSaveName}
              disabled={!dirty || updateProfile.isPending}
              style={{ padding: "0.5rem 1rem", fontSize: "0.78rem", minHeight: 40 }}
            >
              {updateProfile.isPending ? "Saving…" : "Save"}
            </button>
          </div>
          {status && (
            <p
              style={{
                margin: "0.5rem 0 0",
                fontSize: "0.72rem",
                lineHeight: 1.4,
                color: status.type === "success" ? "var(--accent-green)" : "var(--accent-red)",
              }}
            >
              {status.type === "success" ? "✓ " : "⚠️ "}
              {status.text}
            </p>
          )}
        </div>

        {/* ─── Sign-in identity ─── */}
        <div>
          <SubsectionLabel>{casualModeActive ? "How you sign in" : "Sign-in identity"}</SubsectionLabel>
          <ReadOnlyRow
            label="Email"
            value={profile?.email || "—"}
            note={
              profile?.email
                ? "Verified by your sign-in provider. Change it by signing in with a different address."
                : "No address on file yet. It is recorded automatically when you sign in with email or Google."
            }
          />
          <ReadOnlyRow
            label={casualModeActive ? "Signed in with" : "Auth method"}
            value={loginMethod === "privy" ? "Email or Google" : loginMethod === "metamask" ? "MetaMask" : "—"}
          />
          <ReadOnlyRow
            label="Wallet"
            value={`${account.slice(0, 6)}…${account.slice(-4)}`}
            mono
          />
          <ReadOnlyRow
            label="Time zone"
            value={profile?.notification_preferences?.timezone || "—"}
            note={
              profile?.notification_preferences?.timezone
                ? "Detected from this device. Used for notification quiet hours."
                : "Recorded automatically the first time you save notification preferences."
            }
          />
        </div>

        {/* ─── Sign out ─── */}
        <div>
          <SubsectionLabel>Session</SubsectionLabel>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10, lineHeight: 1.4 }}>
            {casualModeActive
              ? "Signs you out on this device. Your data stays safe and comes back when you sign in again."
              : "Ends the local session. No data is removed."}
          </p>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleSignOut}
            style={{ padding: "0.5rem 1rem", fontSize: "0.78rem", minHeight: 40 }}
          >
            Sign out
          </button>
        </div>
      </div>
    </SettingsSection>
  );
}

/**
 * A labelled read-only value. These are facts about the account, not settings — the
 * panel's job is to show what is true, not only to collect what is wanted, and an
 * input box would imply an edit path that does not exist.
 */
function ReadOnlyRow({ label, value, note, mono = false }) {
  return (
    <div
      style={{
        padding: "0.6rem 0.85rem",
        marginBottom: "0.5rem",
        borderRadius: 8,
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "baseline" }}>
        <span style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          {label}
        </span>
        <span
          style={{
            fontSize: "0.8rem",
            color: "var(--text-primary)",
            fontFamily: mono ? "monospace" : "inherit",
            wordBreak: "break-all",
            textAlign: "right",
          }}
        >
          {value}
        </span>
      </div>
      {note && (
        <p style={{ margin: "0.35rem 0 0", fontSize: 11, color: "var(--text-muted)", lineHeight: 1.4 }}>
          {note}
        </p>
      )}
    </div>
  );
}

export default AccountSection;
