/**
 * SonarPreferences.jsx
 *
 * Per-category notification preferences panel, plus the device-level push
 * enrolment for this browser.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS WAS REWRITTEN (2026-07-31)
 *
 * This panel let people configure notifications that could not possibly arrive,
 * and gave no way to find that out. Push had never delivered once — the
 * production build shipped without a VAPID key, so `subscribeToPush()` bailed
 * before it ever asked for permission — and this component reported success
 * anyway, because it flipped the category's `push` flag regardless of the
 * result and only `console.warn`ed the failure.
 *
 * The correcting idea: a preferences screen must show what is TRUE, not just
 * collect what is WANTED. So:
 *
 *   - A device block reports real state from `getPushStatus()` — permission,
 *     whether this browser is subscribed, and whether the SERVER has a row for
 *     it. Those last two are shown separately because they can disagree, and
 *     that disagreement was previously unnameable.
 *   - "Send test notification" exercises the whole real path. It is the check
 *     that would have caught this outage on day one.
 *   - Per-category Push switches are disabled until push actually works, rather
 *     than pretending to arm a channel with no sender.
 *   - Failures say what happened and what to do, from `pushReasonMessage()`.
 *
 * Also fixed here: `handleSave` used to show "✓ Saved" unconditionally, so with
 * Supabase unconfigured or no wallet connected it confirmed a write it had
 * skipped.
 *
 * NOTE ON CATEGORIES. Only some of these can currently reach a phone at all —
 * push is emitted by `echo-nudge`, `order-notifications` and the retention cron,
 * and nothing bridges `sonar_notifications` inserts to `send-push`. So Social,
 * Events and Milestones write in-app rows and stop there. That gap is real and
 * is deliberately NOT papered over in the copy here; it is the next task in the
 * notification work, and hiding it would recreate exactly the problem this
 * rewrite exists to fix.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useEffect, useCallback } from "react";
import { supabase, getCurrentWallet, isSupabaseConfigured } from "../../services/supabaseClient";
import {
  getPushStatus,
  subscribeToPush,
  unsubscribeFromPush,
  sendTestPush,
  pushReasonMessage,
} from "../../services/pushService";
import { trackEvent } from "../../services/analytics";

const CATEGORIES = [
  {
    key: "activity",
    label: "Activity",
    icon: "🐟",
    desc: "Tankmate posts, watched tank updates, species insights",
  },
  {
    key: "social",
    label: "Social",
    icon: "🤝",
    desc: "Tankmate requests, mentor requests, audit received, replies",
  },
  {
    key: "event",
    label: "Events",
    icon: "🌊",
    desc: "Tide starting, RSVP reminders, challenge updates, auction outbid",
  },
  {
    key: "milestone",
    label: "Milestones",
    icon: "🏆",
    desc: "Badge unlocked, tier promoted, companion evolved",
  },
  {
    key: "poseidon",
    label: "Poseidon",
    icon: "🐙",
    desc: "Weekly Reef Digest, suggested tankmates, content recommendations",
  },
];

const DEFAULT_PREFS = {
  categories: {
    activity: { enabled: true, push: false },
    social: { enabled: true, push: true },
    event: { enabled: true, push: true },
    milestone: { enabled: true, push: false },
    poseidon: { enabled: true, push: false },
  },
  quietHours: { enabled: false, start: "22:00", end: "08:00" },
  emailDigest: "off", // off | daily | weekly
};

export function SonarPreferences({ onClose, casualModeActive = false }) {
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // Device-level push state. `null` while the first read is in flight so the UI
  // can say "checking" instead of briefly claiming push is off.
  const [pushStatus, setPushStatus] = useState(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMessage, setPushMessage] = useState(null); // { type, text }

  const refreshPushStatus = useCallback(async () => {
    try {
      setPushStatus(await getPushStatus());
    } catch (err) {
      console.warn("[Sonar] Could not read push status:", err?.message);
      setPushStatus((prev) => prev ?? { supported: false });
    }
  }, []);

  useEffect(() => {
    refreshPushStatus();
  }, [refreshPushStatus]);

  // Load preferences from the Supabase profile
  useEffect(() => {
    async function loadPrefs() {
      if (!isSupabaseConfigured()) return;
      const wallet = getCurrentWallet();
      if (!wallet) return;

      const { data } = await supabase
        .from("profiles")
        .select("notification_preferences")
        .eq("wallet_address", wallet)
        .single();

      if (data?.notification_preferences) {
        setPrefs({ ...DEFAULT_PREFS, ...data.notification_preferences });
      }
    }
    loadPrefs();
  }, []);

  const updateCategory = (category, field, value) => {
    setPrefs((prev) => ({
      ...prev,
      categories: {
        ...prev.categories,
        [category]: {
          ...prev.categories[category],
          [field]: value,
        },
      },
    }));
    setSaved(false);
  };

  const updateQuietHours = (field, value) => {
    setPrefs((prev) => ({
      ...prev,
      quietHours: { ...prev.quietHours, [field]: value },
    }));
    setSaved(false);
  };

  const handleSave = async () => {
    const wallet = getCurrentWallet();

    // Previously this method showed "✓ Saved" even here, which is how a
    // preferences screen ends up lying about the one thing it exists to do.
    if (!wallet || !isSupabaseConfigured()) {
      setSaveError(
        !isSupabaseConfigured()
          ? "Can't save — the cloud connection isn't configured on this build."
          : "Sign in to save your notification preferences."
      );
      return;
    }

    setSaving(true);
    setSaveError(null);

    const { error } = await supabase
      .from("profiles")
      .update({ notification_preferences: prefs })
      .eq("wallet_address", wallet);

    setSaving(false);

    if (error) {
      console.error("[Sonar] Failed to save preferences:", error);
      setSaveError(`Couldn't save: ${error.message}`);
      return;
    }

    if (prefs.emailDigest !== "off") {
      trackEvent("notification_opt_in", { channel: "email", frequency: prefs.emailDigest });
    }

    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  // ── Device push enrolment ──────────────────────────────────────────────────

  const handleEnablePush = async () => {
    setPushBusy(true);
    setPushMessage(null);

    const result = await subscribeToPush();

    if (result.success) {
      trackEvent("notification_opt_in", { channel: "push" });
      setPushMessage({ type: "success", text: "This device is registered for notifications." });
    } else {
      // The whole point of the rewrite: a failure is reported, with the reason,
      // and no toggle moves.
      setPushMessage({ type: "error", text: pushReasonMessage(result.reason) });
    }

    await refreshPushStatus();
    setPushBusy(false);
  };

  const handleDisablePush = async () => {
    setPushBusy(true);
    setPushMessage(null);

    const result = await unsubscribeFromPush();
    setPushMessage(
      result.success
        ? { type: "info", text: "This device will no longer receive notifications." }
        : { type: "error", text: pushReasonMessage(result.reason) }
    );

    await refreshPushStatus();
    setPushBusy(false);
  };

  const handleTestPush = async () => {
    setPushBusy(true);
    setPushMessage(null);

    const result = await sendTestPush();

    if (!result.success) {
      setPushMessage({ type: "error", text: result.message || "Test send failed." });
    } else if (result.delivered) {
      setPushMessage({
        type: "success",
        text: `${result.message} If it doesn't appear within a few seconds, check your system notification settings for this browser.`,
      });
    } else {
      // send-push reported sent: 0 — accepted, but no devices to send to.
      setPushMessage({ type: "warning", text: result.message });
    }

    setPushBusy(false);
  };

  const pushActive = pushStatus?.active === true;
  const pushDiverged = !!pushStatus?.subscribedHere && !pushStatus?.registeredOnServer;

  return (
    <section className="sonar-prefs" aria-label="Notification Preferences">
      <header className="sonar-prefs__header">
        <div>
          <h2>🔔 Notification Preferences</h2>
          <p className="sonar-prefs__subtitle">
            {casualModeActive
              ? "Choose what Aquacellum tells you about, and how."
              : "Configure notification categories, delivery channels, and quiet hours."}
          </p>
        </div>
        {onClose && (
          <button className="btn btn--ghost" onClick={onClose} aria-label="Close">✕</button>
        )}
      </header>

      {/* ── Push on this device ──────────────────────────────────────────────
          Deliberately the FIRST thing in the panel. The category matrix below
          is meaningless if this says push isn't working, and the old ordering
          (categories first, no device state at all) is what let a total outage
          look like a configured feature. */}
      <div className="sonar-prefs__device">
        <h3>Push notifications on this device</h3>
        <PushStatusBanner
          status={pushStatus}
          diverged={pushDiverged}
          casualModeActive={casualModeActive}
        />

        {pushStatus && pushStatus.supported && !pushStatus.blocked && (
          <div className="sonar-prefs__device-actions" style={deviceActionsStyle}>
            {pushActive ? (
              <button className="btn btn--ghost" onClick={handleDisablePush} disabled={pushBusy}>
                {pushBusy ? "Working…" : "Turn off on this device"}
              </button>
            ) : (
              <button
                className="btn"
                onClick={handleEnablePush}
                disabled={pushBusy || pushStatus.iosNeedsInstall}
                style={primaryBtnStyle}
              >
                {pushBusy ? "Working…" : pushDiverged ? "Re-register this device" : "Turn on notifications"}
              </button>
            )}

            {/* Available whenever the account has any registered device, not
                only when THIS one is active — "I get nothing on my phone" is
                usually asked from a laptop. */}
            {(pushActive || (pushStatus.deviceCount || 0) > 0) && (
              <button className="btn btn--ghost" onClick={handleTestPush} disabled={pushBusy}>
                {pushBusy ? "Sending…" : "Send test notification"}
              </button>
            )}
          </div>
        )}

        {pushMessage && (
          <p role="status" style={messageStyle(pushMessage.type)}>
            {pushMessage.text}
          </p>
        )}
      </div>

      {/* Category toggles */}
      <div className="sonar-prefs__categories">
        <h3>Categories</h3>
        {!pushActive && (
          <p className="text-muted text-sm" style={{ marginTop: 0 }}>
            Push switches unlock once notifications are on for this device. In-app
            notifications work regardless.
          </p>
        )}
        {CATEGORIES.map((cat) => (
          <div key={cat.key} className="sonar-prefs__category">
            <div className="sonar-prefs__category-info">
              <span className="sonar-prefs__category-icon">{cat.icon}</span>
              <div>
                <strong>{cat.label}</strong>
                <p className="text-muted text-sm">{cat.desc}</p>
              </div>
            </div>
            <div className="sonar-prefs__category-controls">
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={prefs.categories[cat.key]?.enabled ?? true}
                  onChange={(e) => updateCategory(cat.key, "enabled", e.target.checked)}
                  aria-label={`Enable ${cat.label} notifications`}
                />
                <span className="toggle-switch__track"><span className="toggle-switch__thumb" /></span>
                <span className="toggle-switch__label">In-app</span>
              </label>
              {pushStatus?.supported && (
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={prefs.categories[cat.key]?.push ?? false}
                    onChange={(e) => updateCategory(cat.key, "push", e.target.checked)}
                    // Was: enabled whenever push was "supported", and its
                    // onChange kicked off a permission request whose failure was
                    // swallowed. Enrolment is now one explicit action above, and
                    // this switch only records a preference.
                    disabled={!pushActive || !prefs.categories[cat.key]?.enabled}
                    aria-label={`Enable ${cat.label} push notifications`}
                  />
                  <span className="toggle-switch__track"><span className="toggle-switch__thumb" /></span>
                  <span className="toggle-switch__label">Push</span>
                </label>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Quiet Hours */}
      <div className="sonar-prefs__quiet-hours">
        <h3>Quiet Hours</h3>
        <label className="toggle-switch toggle-switch--wide">
          <input
            type="checkbox"
            checked={prefs.quietHours.enabled}
            onChange={(e) => updateQuietHours("enabled", e.target.checked)}
          />
          <span className="toggle-switch__track"><span className="toggle-switch__thumb" /></span>
          <span className="toggle-switch__label">Enable quiet hours (no push notifications during this time)</span>
        </label>
        {prefs.quietHours.enabled && (
          <div className="sonar-prefs__quiet-times">
            <label className="form-field">
              <span>From</span>
              <input
                type="time"
                value={prefs.quietHours.start}
                onChange={(e) => updateQuietHours("start", e.target.value)}
              />
            </label>
            <label className="form-field">
              <span>Until</span>
              <input
                type="time"
                value={prefs.quietHours.end}
                onChange={(e) => updateQuietHours("end", e.target.value)}
              />
            </label>
          </div>
        )}
      </div>

      {/* Email Digest */}
      <div className="sonar-prefs__email">
        <h3>Email Digest</h3>
        <p className="text-muted text-sm">Poseidon curates a summary of what you missed.</p>
        <div className="sonar-prefs__email-options" role="radiogroup" aria-label="Email digest frequency">
          {["off", "daily", "weekly"].map((freq) => (
            <label
              key={freq}
              className={`sonar-pill${prefs.emailDigest === freq ? " sonar-pill--active" : ""}`}
            >
              <input
                type="radio"
                name="emailDigest"
                value={freq}
                checked={prefs.emailDigest === freq}
                onChange={() => {
                  setPrefs((p) => ({ ...p, emailDigest: freq }));
                  setSaved(false);
                }}
              />
              <span>{freq === "off" ? "Off" : freq.charAt(0).toUpperCase() + freq.slice(1)}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Save button */}
      <div className="sonar-prefs__actions">
        <button
          className={`sonar-prefs__save${saved ? " sonar-prefs__save--saved" : ""}`}
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "Saving…" : saved ? "✓ Saved" : "Save Preferences"}
        </button>
        {saveError && (
          <p role="alert" style={messageStyle("error")}>{saveError}</p>
        )}
      </div>
    </section>
  );
}

/**
 * The honest state of push for this device.
 *
 * Every branch here is a state the previous UI rendered identically (as a push
 * checkbox you could tick), and each one needs a different action from the user
 * — which is the argument for showing them at all.
 */
function PushStatusBanner({ status, diverged, casualModeActive }) {
  if (!status) {
    return <p className="text-muted text-sm">Checking notification status…</p>;
  }

  if (!status.supported) {
    return (
      <p style={messageStyle("info")}>
        This browser doesn't support push notifications. In-app notifications still work.
      </p>
    );
  }

  if (status.iosNeedsInstall) {
    return (
      <p style={messageStyle("warning")}>
        On iPhone and iPad, notifications only work after you install the app to your
        Home Screen. Use <strong>Install App</strong> in Settings first, then come back
        here and turn them on.
      </p>
    );
  }

  if (!status.configured) {
    // A deployment fault, not a user one — and precisely the production state
    // that caused this whole investigation. Say so plainly rather than showing a
    // toggle that cannot work.
    return (
      <p style={messageStyle("error")}>
        Push notifications aren't configured on this deployment, so they can't be
        switched on yet.
      </p>
    );
  }

  if (status.blocked) {
    return (
      <p style={messageStyle("error")}>
        Notifications are <strong>blocked</strong> for this site. The app can't ask again
        once blocked — you'll need to allow notifications in your browser's site settings
        (the icon next to the address bar), then reload.
      </p>
    );
  }

  if (!status.bridgeActive) {
    return (
      <p style={messageStyle("warning")}>
        Sign in to enable notifications — we need a verified session to register this
        device to your account.
      </p>
    );
  }

  if (diverged) {
    return (
      <p style={messageStyle("warning")}>
        This browser has a notification subscription that isn't registered to your
        account, so nothing will reach you. Re-register to fix it.
      </p>
    );
  }

  if (status.active) {
    const others = Math.max(0, (status.deviceCount || 1) - 1);
    return (
      <p style={messageStyle("success")}>
        <strong>Active on this device.</strong>{" "}
        {others > 0
          ? `Also registered on ${others} other device${others === 1 ? "" : "s"}.`
          : "This is your only registered device."}{" "}
        {casualModeActive
          ? "Send a test to make sure it comes through."
          : "Use the test send to verify end-to-end delivery."}
      </p>
    );
  }

  if ((status.deviceCount || 0) > 0) {
    return (
      <p style={messageStyle("info")}>
        Notifications are on for {status.deviceCount} other device
        {status.deviceCount === 1 ? "" : "s"}, but not this one.
      </p>
    );
  }

  return (
    <p style={messageStyle("info")}>
      Notifications are off. Turn them on to get alerts on this device
      {casualModeActive ? "" : " (browser permission required)"}.
    </p>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
// Inline because sonar-prefs.css has no equivalents for these new states and
// adding a stylesheet pass here would widen a bug fix into a styling change.

const deviceActionsStyle = {
  display: "flex",
  gap: "0.75rem",
  flexWrap: "wrap",
  marginTop: "0.75rem",
};

const primaryBtnStyle = {
  background: "linear-gradient(135deg, #38bdf8 0%, #0ea5e9 100%)",
  color: "#04121f",
  fontWeight: 700,
  border: "none",
};

const MESSAGE_COLORS = {
  success: { fg: "#4ade80", bg: "rgba(52, 211, 153, 0.08)", border: "rgba(52, 211, 153, 0.25)" },
  error: { fg: "#f87171", bg: "rgba(248, 113, 113, 0.08)", border: "rgba(248, 113, 113, 0.25)" },
  warning: { fg: "#fbbf24", bg: "rgba(251, 191, 36, 0.08)", border: "rgba(251, 191, 36, 0.25)" },
  info: { fg: "#93c5fd", bg: "rgba(56, 189, 248, 0.06)", border: "rgba(56, 189, 248, 0.2)" },
};

function messageStyle(type) {
  const c = MESSAGE_COLORS[type] || MESSAGE_COLORS.info;
  return {
    marginTop: "0.75rem",
    marginBottom: 0,
    padding: "0.65rem 0.9rem",
    borderRadius: "8px",
    background: c.bg,
    border: `1px solid ${c.border}`,
    color: c.fg,
    fontSize: "0.8rem",
    lineHeight: 1.5,
  };
}

export default SonarPreferences;
