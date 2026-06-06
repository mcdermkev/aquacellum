/**
 * SonarPreferences.jsx
 * 
 * Per-category notification preferences panel.
 * - Toggle: Activity / Social / Events / Milestones / Poseidon
 * - Web Push opt-in/out per category
 * - Quiet hours setting (start/end time)
 * - Email digest frequency: off / daily / weekly
 */

import { useState, useEffect } from "react";
import { supabase, getCurrentWallet, isSupabaseConfigured } from "../../services/supabaseClient";

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

export function SonarPreferences({ onClose }) {
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pushSupported, setPushSupported] = useState(false);

  // Check Web Push support
  useEffect(() => {
    setPushSupported("Notification" in window && "serviceWorker" in navigator);
  }, []);

  // Load preferences from Supabase profile
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
    setSaving(true);
    const wallet = getCurrentWallet();

    if (wallet && isSupabaseConfigured()) {
      await supabase
        .from("profiles")
        .update({ notification_preferences: prefs })
        .eq("wallet_address", wallet);
    }

    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  // Request push permission
  const requestPushPermission = async () => {
    if (!pushSupported) return;
    try {
      const permission = await Notification.requestPermission();
      if (permission === "granted") {
        // Push permission granted — service worker registration would go here
        // For now just update UI state
      }
    } catch (err) {
      console.warn("Push permission request failed:", err);
    }
  };

  return (
    <section className="sonar-prefs" aria-label="Notification Preferences">
      <header className="sonar-prefs__header">
        <h2>🔔 Notification Preferences</h2>
        {onClose && (
          <button className="btn btn--ghost" onClick={onClose} aria-label="Close">✕</button>
        )}
      </header>

      {/* Category toggles */}
      <div className="sonar-prefs__categories">
        <h3>Categories</h3>
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
              <label className="toggle-label">
                <input
                  type="checkbox"
                  checked={prefs.categories[cat.key]?.enabled ?? true}
                  onChange={(e) => updateCategory(cat.key, "enabled", e.target.checked)}
                  aria-label={`Enable ${cat.label} notifications`}
                />
                <span>In-app</span>
              </label>
              {pushSupported && (
                <label className="toggle-label">
                  <input
                    type="checkbox"
                    checked={prefs.categories[cat.key]?.push ?? false}
                    onChange={(e) => {
                      if (e.target.checked && Notification.permission !== "granted") {
                        requestPushPermission();
                      }
                      updateCategory(cat.key, "push", e.target.checked);
                    }}
                    disabled={!prefs.categories[cat.key]?.enabled}
                    aria-label={`Enable ${cat.label} push notifications`}
                  />
                  <span>Push</span>
                </label>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Quiet Hours */}
      <div className="sonar-prefs__quiet-hours">
        <h3>Quiet Hours</h3>
        <label className="toggle-label">
          <input
            type="checkbox"
            checked={prefs.quietHours.enabled}
            onChange={(e) => updateQuietHours("enabled", e.target.checked)}
          />
          <span>Enable quiet hours (no push notifications during this time)</span>
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
        <div className="sonar-prefs__email-options">
          {["off", "daily", "weekly"].map((freq) => (
            <label key={freq} className="radio-label">
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
          className="btn btn--primary"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "Saving…" : saved ? "✓ Saved" : "Save Preferences"}
        </button>
      </div>
    </section>
  );
}

export default SonarPreferences;
