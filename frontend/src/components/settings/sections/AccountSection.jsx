import React, { useEffect, useState } from "react";
import { CheckCircle, SignOut, UserCircle, WarningCircle } from "@phosphor-icons/react";
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
        icon={<UserCircle size={20} />}
        title={{ casual: "Your Account", pro: "Account & Identity" }}
        casualModeActive={casualModeActive}
      >
        <p className="st-empty">Sign in to see your account details.</p>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection
      id="account"
      icon={<UserCircle size={20} />}
      title={{ casual: "Your Account", pro: "Account & Identity" }}
      description={{
        casual: "How you sign in, what other keepers see, and how to sign out.",
        pro: "Your name, how you sign in, and sign out.",
      }}
      casualModeActive={casualModeActive}
    >
      <div className="st-stack">
        {/* ─── Display name ─── */}
        <div>
          {/* The visible subsection heading is the input's label. */}
          <SubsectionLabel>
            <label htmlFor="st-display-name">{casualModeActive ? "Your name" : "Display name"}</label>
          </SubsectionLabel>
          <p className="st-hint" id="st-display-name-hint">
            {casualModeActive
              ? "Shown on your posts and your profile. You can change it any time."
              : "Shown on your posts, profile and storefront."}
          </p>
          <div className="st-input-row">
            <input
              id="st-display-name"
              type="text"
              className="st-input"
              value={nameInput}
              maxLength={MAX_DISPLAY_NAME}
              onChange={(e) => {
                setNameInput(e.target.value.slice(0, MAX_DISPLAY_NAME));
                setStatus(null);
              }}
              aria-describedby="st-display-name-hint"
            />
            <button
              type="button"
              className="st-btn st-btn--primary"
              onClick={handleSaveName}
              disabled={!dirty || updateProfile.isPending}
            >
              {updateProfile.isPending ? "Saving…" : "Save"}
            </button>
          </div>
          {status && (
            <p className={`st-status ${status.type === "success" ? "st-status--success" : "st-status--error"}`}>
              {status.type === "success" ? (
                <CheckCircle size={18} aria-hidden="true" />
              ) : (
                <WarningCircle size={18} aria-hidden="true" />
              )}
              <span>{status.text}</span>
            </p>
          )}
        </div>

        {/* ─── Sign-in identity ─── */}
        <div>
          <SubsectionLabel>{casualModeActive ? "How you sign in" : "Sign-in identity"}</SubsectionLabel>
          <div className="st-rows">
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
        </div>

        {/* ─── Sign out ─── */}
        <div>
          <SubsectionLabel>Session</SubsectionLabel>
          <p className="st-hint">
            {casualModeActive
              ? "Signs you out on this device. Your data stays safe and comes back when you sign in again."
              : "Ends the local session. No data is removed."}
          </p>
          <button type="button" className="st-btn" onClick={handleSignOut}>
            <SignOut size={18} aria-hidden="true" />
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
    <div className="st-row">
      <div className="st-row-main">
        <span className="st-row-label">{label}</span>
        <span className={`st-row-value${mono ? " st-row-value--mono" : ""}`}>{value}</span>
      </div>
      {note && <p className="st-row-note">{note}</p>}
    </div>
  );
}

export default AccountSection;
