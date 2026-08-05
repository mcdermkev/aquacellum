/**
 * One bug class, four instances: a Settings control reading a value that is not
 * what its name suggests, or treating absence as something the producer never
 * signals. None of these threw. Each simply behaved wrongly and said nothing.
 *
 * They are grouped in one file because the fix for each is a discipline, not a
 * line of code, and the discipline is the thing worth protecting:
 *
 *   VERIFY THE PRODUCER, NOT THE FIELD NAME.
 *
 * Node-environment friendly (this repo's vitest has no DOM): source-level
 * assertions, same technique as settingsPrivacyOwnership.test.js.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const SRC = new URL("../", import.meta.url);

function read(relativePath) {
  return readFileSync(fileURLToPath(new URL(relativePath, SRC)), "utf8");
}

/** Source with comments stripped — the docblocks quote the wrong forms to explain them. */
function readCode(relativePath) {
  return read(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("zone assignment is read from the field that actually records it", () => {
  const zoneCode = readCode("components/settings/sections/ZoneSection.jsx");

  it("does not treat Dexie userProfile.zoneHash as a zone assignment", () => {
    // `useXPSync` sets userProfile.zoneHash to a deterministic hash of the WALLET
    // ADDRESS on every XP award — no geographic input whatsoever. Reading it made
    // `zoneAssigned` true for anyone with a single XP point, which routed users who
    // had never joined a zone into the TRANSFER flow, complete with a "you can only
    // transfer once every 90 days" warning that did not apply to them.
    expect(zoneCode).not.toMatch(/zoneHash/);
    expect(zoneCode).not.toMatch(/db\.userProfile/);
  });

  it("reads profiles.zone_hash, where assignUserToZone actually writes", () => {
    expect(zoneCode).toMatch(/fetchMyZoneAssignment/);

    const api = read("services/zoneLeaderboardApi.js");
    expect(api).toMatch(/export async function fetchMyZoneAssignment/);
    // Must consult the column the assignment writer updates, not a local mirror.
    expect(api).toMatch(/select\(["']zone_hash, zone_assigned_at, zone_transfer_cooldown["']\)/);
    expect(api).toMatch(/assigned:\s*!!data\?\.zone_hash/);
  });

  it("confirms the Dexie field really is address-derived, not geographic", () => {
    // Pins the premise of this whole group. If XP sync ever starts writing a real
    // zone hash, this fails and the reasoning above needs revisiting.
    const xpSync = read("hooks/useXPSync.js");
    expect(xpSync).toMatch(/user\.charCodeAt\(i\)/);
    expect(xpSync).toMatch(/profile\.zoneHash = zoneHash/);
  });
});

describe("smart wallet retry is driven by the signal the producer emits", () => {
  it("getSmartWalletAddress resolves null rather than throwing", () => {
    // The premise: absence is a RESOLVED null, so a `.catch()`-based retry can
    // never fire for the signer-registration race it was written for.
    const client = read("services/smartAccountClient.js");
    expect(client).toMatch(/if \(!_userEip1193Provider \|\| !_userAddress\) \{\s*\n\s*return null;/);
  });

  it("retries on a falsy address inside then(), not inside catch()", () => {
    const section = readCode("components/settings/sections/SmartWalletSection.jsx");
    // The retry guard must test the address itself.
    expect(section).toMatch(/if \(!addr && retries < 3 && !hasUserSigner\(\)\)/);
    // And it must not sit in the rejection handler, where it is unreachable.
    const catchBlock = section.slice(section.indexOf(".catch("));
    expect(catchBlock).not.toMatch(/attempt\(retries \+ 1\)/);
  });

  it("still terminates and still reports genuine failure", () => {
    const section = readCode("components/settings/sections/SmartWalletSection.jsx");
    // Bounded (retries < 3) and the loading flag is cleared on both outcomes, so a
    // permanently-null address settles into the honest "not saving" state instead
    // of spinning forever.
    expect(section).toMatch(/retries < 3/);
    expect(section).toMatch(/setSmartWalletLoading\(false\)/);
    expect(section).toMatch(/console\.warn\("Smart wallet init failed:", err\)/);
  });
});

describe("the facility report covers this owner's live tanks only", () => {
  const backup = readCode("components/settings/sections/BackupSection.jsx");

  it("scopes by ownerAddress instead of dumping the whole local table", () => {
    // `db.tanks.toArray()` returned every account ever cached in this browser, then
    // labelled the document with tanks[0].ownerAddress — so on a shared device the
    // report attributed a stranger's units to you.
    expect(backup).not.toMatch(/db\.tanks\.toArray\(\)/);
    expect(backup).toMatch(/db\.tanks\.where\(["']ownerAddress["']\)\.equals\(owner\)/);
  });

  it("lowercases the key, per the canonical address rule", () => {
    // Dexie writes ownerAddress lowercased and `.equals()` is case-sensitive, so a
    // checksummed address from Privy matches zero rows.
    expect(backup).toMatch(/account \|\| ""\)\.toLowerCase\(\)/);
  });

  it("excludes soft-deleted tanks from the totals", () => {
    // Retiring a tank sets active:false rather than deleting the row, so an
    // unfiltered report counted removed tanks in Total Units and Total Volume.
    expect(backup).toMatch(/filter\(\(t\) => t\.active !== false\)/);
  });
});

describe("replaying onboarding survives Dexie key casing", () => {
  const support = readCode("components/settings/sections/AppSupportSection.jsx");

  it("falls back to the lowercase key when the exact key matches nothing", () => {
    // Dexie.update() resolves with 0 rather than throwing on a key miss, so the
    // surrounding try/catch could never notice; the Dexie half of the reset was
    // silently skipped for checksum-cased addresses.
    expect(support).toMatch(/let updated = await db\.userProfile\.update\(account, patch\)/);
    expect(support).toMatch(/if \(!updated && lower !== account\)/);
    expect(support).toMatch(/db\.userProfile\.update\(lower, patch\)/);
  });

  it("matches the fallback another consumer already needed", () => {
    // Pins the precedent this mirrors, so the two cannot drift apart.
    const reefProfile = read("hooks/useReefProfile.js");
    expect(reefProfile).toMatch(/Dexie keys are case-sensitive/);
  });
});
