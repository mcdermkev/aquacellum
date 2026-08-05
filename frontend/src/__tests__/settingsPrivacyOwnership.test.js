/**
 * D-S-1 (docs/SETTINGS_SPEC.md): account deletion has exactly ONE home, and the
 * control that merely clears the browser cannot be mistaken for it.
 *
 * WHY THIS IS A TEST AND NOT JUST A CODE REVIEW. The original defect was not a bug
 * in either component — both worked correctly. It was a PLACEMENT problem: account
 * deletion was reachable only from Reef → ProfileEdit, while Settings offered
 * "Reset Local Data" / "Reset Everything", which wipes Dexie plus `aquadex_*` keys
 * and leaves the account fully intact. A user who came to Settings to delete their
 * account found the button that looked right and got something else entirely.
 *
 * Placement regressions are invisible to unit tests of either component, and they
 * are easy to reintroduce — re-adding `<DataPrivacySettings />` to a profile screen
 * looks like a helpful convenience. So these are source-level assertions about
 * where the deletion flow is allowed to live.
 *
 * Node-environment friendly (this repo's vitest has no DOM): these read source text
 * rather than rendering, the same technique as useAiPrefs.test.js's Echo gating.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const SRC = new URL("../", import.meta.url);

function read(relativePath) {
  return readFileSync(fileURLToPath(new URL(relativePath, SRC)), "utf8");
}

/**
 * Source with block comments removed.
 *
 * Needed because the docblocks in these files deliberately QUOTE the old, unsafe
 * labels ("Reset Local Data", "Reset Everything") to record why they changed. That
 * history is worth keeping, so the assertions below check the code rather than
 * forcing the prose to avoid its own subject matter.
 */
function readCode(relativePath) {
  return read(relativePath).replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("account deletion lives in Settings, and only there", () => {
  it("is rendered by the Settings privacy section", () => {
    const privacy = read("components/settings/sections/PrivacySection.jsx");
    expect(privacy).toMatch(/<DataPrivacySettings/);
    expect(privacy).toMatch(/from ["']\.\.\/\.\.\/reef\/DataPrivacySettings["']/);
  });

  it("is NOT rendered by Reef ProfileEdit any more", () => {
    // The regression that matters. ProfileEdit may *link* to Settings, but it must
    // not mount a second copy of the deletion flow: two live renders means two
    // places to keep a type-to-confirm gate correct.
    const profileEdit = read("components/reef/ProfileEdit.jsx");
    expect(profileEdit).not.toMatch(/<DataPrivacySettings/);
  });

  it("is mounted in exactly one place across the whole app", () => {
    // Guards against a third surface appearing later.
    const renderSites = [
      "components/settings/sections/PrivacySection.jsx",
      "components/reef/ProfileEdit.jsx",
      "components/settings/SettingsPanel.jsx",
    ].filter((path) => /<DataPrivacySettings/.test(read(path)));

    expect(renderSites).toEqual(["components/settings/sections/PrivacySection.jsx"]);
  });

  it("keeps ProfileEdit pointing at Settings so the flow stays reachable", () => {
    // Removing the inline panel without leaving a route would just hide deletion,
    // which is a different failure rather than a fix.
    const profileEdit = read("components/reef/ProfileEdit.jsx");
    expect(profileEdit).toMatch(/aquadex:navigate-tab/);
    expect(profileEdit).toMatch(/section:\s*["']privacy["']/);
  });

  it("does not rewrite the deletion flow, only re-parents it", () => {
    // The type-to-confirm string and the grace period are the safety mechanism.
    const gdpr = read("components/reef/DataPrivacySettings.jsx");
    expect(gdpr).toContain("DELETE MY ACCOUNT");
    expect(gdpr).toMatch(/30-day grace period/);
    // And the cancel path stays available while a deletion is pending.
    expect(gdpr).toMatch(/cancelAccountDeletion/);
  });
});

describe("the device-clear control cannot be mistaken for account deletion", () => {
  const reset = readCode("components/settings/sections/ResetSection.jsx");

  it("is labelled by scope rather than as a general reset", () => {
    expect(reset).toMatch(/Clear this device/);
    expect(reset).toMatch(/Purge local database/);
    // The old labels actively invited the confusion.
    expect(reset).not.toMatch(/Reset Everything/);
    expect(reset).not.toMatch(/Reset Local Data/);
  });

  it("states that the account is NOT deleted", () => {
    expect(reset).toMatch(/does NOT delete your account|Account, profile and cloud records are unaffected/);
  });

  it("points anyone who wanted deletion at the section that does it", () => {
    expect(reset).toMatch(/settings-privacy|#settings\/privacy/);
    expect(reset).toMatch(/delete your account instead/i);
  });
});

describe("Privacy & Data renders last, after the device-clear control", () => {
  const panel = read("components/settings/SettingsPanel.jsx");

  it("orders the irreversible action last (§6)", () => {
    const resetAt = panel.indexOf("<ResetSection");
    const privacyAt = panel.indexOf("<PrivacySection");
    expect(resetAt).toBeGreaterThan(-1);
    expect(privacyAt).toBeGreaterThan(resetAt);
  });

  it("surfaces a pending deletion without requiring the section to be expanded", () => {
    // A scheduled deletion and its Cancel button live inside the section body, so
    // the header badge is the only always-visible signal. Losing it would hide a
    // countdown on an irreversible action.
    const privacy = read("components/settings/sections/PrivacySection.jsx");
    expect(privacy).toMatch(/getDeletionStatus/);
    expect(privacy).toMatch(/badge=\{pendingBadge\}/);
    // And it must not be collapsed by default, which would bury the cancel control.
    expect(privacy).not.toMatch(/defaultCollapsed/);
  });
});

describe("the seller section deep-links rather than duplicating owned state", () => {
  const seller = read("components/settings/sections/SellerSection.jsx");

  it("navigates to the Breeder Terminal instead of hosting seller setup", () => {
    expect(seller).toMatch(/aquadex:navigate-tab/);
    expect(seller).toMatch(/breeder-terminal/);
    // Two places writing payout destination is how a payout address disagrees
    // with itself.
    expect(seller).not.toMatch(/<StorefrontSetup/);
    expect(seller).not.toMatch(/<ShipFromSetup/);
  });

  it("ships vacation mode ONLY alongside its enforcement", () => {
    // This assertion previously required the ABSENCE of a vacation control, because
    // nothing honoured it — a seller believing their store was closed while orders
    // for live animals kept arriving is the most dangerous dead control in the app.
    // Enforcement now exists, so the requirement inverts: the control may ship, but
    // only while the checkout gate still reads the paused-seller set.
    //
    // Both halves are asserted together on purpose. If someone removes the cart
    // wiring, this fails and points at the control that must come out with it.
    expect(seller).toMatch(/<VacationModeControl/);

    const revalidation = read("services/cartRevalidation.js");
    expect(
      revalidation,
      "cartRevalidation must consume pausedSellers — without it the Settings control is a lie"
    ).toMatch(/pausedSellers/);
    expect(revalidation).toMatch(/SELLER_PAUSED/);

    const cartContext = read("contexts/CartContext.jsx");
    expect(
      cartContext,
      "CartContext must supply the paused-seller set to revalidateCart"
    ).toMatch(/pausedSellers:/);
  });
});
