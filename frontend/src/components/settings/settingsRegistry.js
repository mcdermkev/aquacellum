/**
 * settingsRegistry.js — the declarative source of truth for AC-3
 * (docs/SETTINGS_SPEC.md), "the honesty test."
 *
 * Every preference Settings writes is declared here with its storage key and
 * the module(s) outside `components/settings/` that actually read it.
 * `frontend/src/__tests__/settingsRegistry.test.js` asserts, for every entry,
 * that at least one declared `readBy` path really does reference the key —
 * so a control that writes and is never read (the Echo-toggle defect this
 * whole rework started from) fails the suite instead of shipping quietly.
 *
 * `readBy` paths are relative to `frontend/src/`. A `readerPattern` overrides
 * the default check (does the file contain the literal `storageKey` string)
 * for keys that are read through a wrapping function/hook rather than a raw
 * `localStorage.getItem("the_key")` call — regex source, matched with `m`.
 *
 * ⚠️ A passing AC-3 entry is necessary, not sufficient. "Has a reader" does not
 * mean "the user can observe the effect" — the reader also has to sit on a
 * surface that is actually reachable. See the voice-profile note below for the
 * case that proved the distinction.
 *
 * KEEP THIS UPDATED: a preference added to a Settings section without an
 * entry here has no test coverage at all, and one added with a wrong/no
 * `readBy` will correctly fail AC-3.
 */

export const SETTINGS_REGISTRY = [
  {
    key: "aquadex_casual_mode",
    control: "Experience Mode (Settings + header ModeSegmentedControl)",
    readBy: ["App.jsx"],
  },
  {
    key: "aquadex_poseidon_enabled",
    control: "AI Companions → Poseidon",
    readBy: [
      "hooks/usePoseidon.js",
      "hooks/useNaturalSearch.js",
      "utils/altTextGenerator.js",
      "utils/spawnNarration.js",
      "hooks/useEchoObservation.js",
      "components/reef/SonarPreferences.jsx",
    ],
  },
  {
    key: "aquadex_echo_enabled",
    control: "AI Companions → Echo",
    // Consumed through the useAiPrefs() hook in App.jsx, not a raw
    // localStorage.getItem call at the App.jsx call site itself.
    readBy: ["hooks/useAiPrefs.js", "App.jsx"],
    readerPattern: "aquadex_echo_enabled|echoEnabled",
  },
  {
    key: "aquadex_font_settings",
    control: "Accessibility → Font size",
    readBy: ["hooks/useFontSettings.js"],
  },
  {
    key: "aquadex_high_contrast",
    control: "Accessibility → High contrast",
    readBy: ["hooks/useHighContrast.js"],
  },
  {
    key: "aquadex_haptics",
    control: "Accessibility → Haptic feedback",
    readBy: ["utils/haptics.js"],
  },
  {
    key: "aquadex_reduced_motion_override",
    control: "Accessibility → Motion",
    readBy: ["utils/a11y.js"],
  },
  {
    key: "aquadex_temp_unit",
    control: "Units & Formatting → Temperature",
    // Surfaces: the logbook activity feed and the TankList telemetry tile, both
    // of which previously hardcoded showing BOTH °C and °F.
    readBy: ["utils/units.js", "components/ActivityLog.jsx", "components/TankList.jsx"],
    readerPattern: "aquadex_temp_unit|tempUnit",
  },
  {
    key: "aquadex_distance_unit",
    control: "Units & Formatting → Distance",
    // The orphaned pref from handoff §3.5: its only previous consumer,
    // LocalBreederMap, is retired and never imported. ZoneAssignmentFlow's radius
    // line is now a real, reachable reader.
    readBy: ["utils/units.js", "components/ZoneAssignmentFlow.jsx"],
    readerPattern: "aquadex_distance_unit|distanceUnit",
  },
  {
    key: "aquadex_growout_reminders_enabled",
    control: "Aquariums & Logbook → Grow-out reminders",
    // `checkGrowoutReminders()` already honoured this; the setter had zero callers.
    readBy: ["utils/growoutReminders.js"],
  },
  {
    key: "aquadex_display_tank",
    control: "Aquariums & Logbook → Active tank",
    // Read by App.jsx (hydrates `displayTank`, which feeds the cart's buyerTank)
    // and by SpecimenDetailModal for compatibility checks.
    readBy: ["App.jsx", "components/SpecimenDetailModal.jsx"],
  },
  {
    key: "aquadex_watchlist",
    control: "Fish Finder → Watchlist (entitlement: species_watchlist)",
    readBy: ["components/MarketplaceBoard.jsx"],
  },
  {
    key: "aquadex_saved_searches",
    control: "Fish Finder → Saved searches (entitlement: saved_search)",
    // Was WRITE-ONLY for months: MarketplaceBoard appended to it and nothing ever
    // read a record back, so a user could save a search and never use it. The
    // store now lives in services/savedSearches.js and MarketplaceBoard consumes a
    // saved set via `pendingSavedSearch`, which is the reader that makes saving
    // mean anything.
    readBy: ["services/savedSearches.js", "components/MarketplaceBoard.jsx"],
    readerPattern: "aquadex_saved_searches|pendingSavedSearch",
  },
  // ⚠️ `aquadex_voice_poseidon` / `aquadex_voice_echo` are deliberately NOT
  // here, and the Settings tab deliberately does not expose them
  // (docs/SETTINGS_SPEC.md D-S-7). They have a genuine reader
  // (reef/hooks/useVoiceProfiles.js), so an AC-3 entry would have PASSED — but
  // that reader is only ever mounted by ImmersiveReef on /reef-xr.html, which
  // is intentionally unlinked. Do not add them back without first linking the
  // Immersive Reef; a Settings control for an unreachable feature is still a
  // control that does nothing the user can observe.
  {
    key: "aquadex_mode_hint_seen",
    control: "Experience Mode (first-run hint, ModeSegmentedControl)",
    readBy: ["components/ModeSegmentedControl.jsx"],
  },
  {
    // Server-side preference, not a localStorage key — it lives in
    // `profiles.notification_preferences`. Registered anyway because AC-3's question
    // ("does anything read this?") is the same question, and the answer used to be
    // no: `send-push` ignored the column entirely, so all five per-category Push
    // switches and the whole Quiet Hours block were dead controls. The reader is now
    // supabase/functions/_shared/pushPreferences.ts via send-push.
    key: "notification_preferences",
    control: "Notifications → per-category push + quiet hours",
    readBy: ["services/reefApi.js", "components/reef/SonarPreferences.jsx"],
    // The authoritative reader is the Edge Function, which lives outside
    // frontend/src and so outside this test's reach. `settingsPushEnforcement`
    // covers that side; this entry pins the client half.
    readerPattern: "notification_preferences",
  },
];

export default SETTINGS_REGISTRY;
