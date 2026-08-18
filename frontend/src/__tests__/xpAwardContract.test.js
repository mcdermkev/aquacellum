/**
 * xpAwardContract.test.js — awards must NAME the action they are for.
 *
 * THE DEFECT THIS LOCKS DOWN. XP used to be awarded as a bare number plus a prose
 * label, and `useXPSync.mapReasonToActionKey` recovered the action by lowercasing
 * that label and substring-matching it against ~20 `includes()` checks, falling back
 * to `LOG_FEEDING`. The server then compared the claimed points against the action it
 * had inferred and rejected any mismatch with a 403, at which point the client
 * silently rolled the award back — after the toast had already told the user they
 * earned it. The only trace was a `console.info`.
 *
 * Confirmed instances that were live:
 *   "Specimen Rehomed"            → no rule matched → LOG_FEEDING (5) vs 10 claimed
 *   "First Tank Set Up"           → no rule matched → LOG_FEEDING (5) vs 15 claimed
 *   cash-handshake double-XP label → matched "handshake" → 25 vs 40×N claimed
 *   MORPH_REGISTERED / ACCLIMATION_COMPLETED → absent from the server table entirely,
 *                                   so rejected as an invalid action every time
 *
 * These are source-level assertions because the failure is architectural: it is about
 * WHICH API a call site uses, not about a value it computes. Node-environment
 * friendly, same technique as settingsPrivacyOwnership.test.js.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach } from "vitest";
import { XP_ACTIONS, awardXp } from "../utils/xp.js";

const SRC = new URL("../", import.meta.url);
const read = (p) => readFileSync(fileURLToPath(new URL(p, SRC)), "utf8");
/** Source with comments stripped — the docblocks quote the old forms to explain them. */
const readCode = (p) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Every module that awards XP for a user action. */
const AWARD_SITES = [
  "components/AcclimationChecklist.jsx",
  "components/ArrivalModal.jsx",
  "components/BatchGrowOutPanel.jsx",
  "components/BatchListingWizard.jsx",
  "components/CheckoutSummary.jsx",
  "components/FacilityTreeView.jsx",
  "components/HandshakeVerification.jsx",
  "components/ListSpecimenModal.jsx",
  "components/MintSpecimen.jsx",
  "components/MorphRegistration.jsx",
  "components/SpawnGrowoutTracker.jsx",
  "components/SpawningWizard.jsx",
  "components/TankList.jsx",
  // components/onboarding/TankTourStep.jsx and .../firstTankReward.js used to be
  // listed here. They were deleted with the retired onboarding tree, so the only
  // XP award sites left are the ones a user can actually reach.
  "services/cohortPromotion.js",
];

describe("every award site names its action", () => {
  it.each(AWARD_SITES)("%s does not call the legacy addXp()", (path) => {
    const code = readCode(path);
    expect(code, `${path} still uses addXp — the award can be inferred wrongly and lost`)
      .not.toMatch(/\baddXp\s*\(/);
  });

  it.each(AWARD_SITES)("%s awards through awardXp with a string key", (path) => {
    const code = readCode(path);
    expect(code).toMatch(/awardXp\(\s*"[A-Z_]+"/);
  });

  it("uses only keys that exist in XP_ACTIONS", () => {
    // A typo would otherwise be a silent no-op at runtime.
    const used = new Set();
    for (const path of AWARD_SITES) {
      for (const m of readCode(path).matchAll(/awardXp\(\s*"([A-Z_]+)"/g)) {
        used.add(m[1]);
      }
    }
    expect(used.size).toBeGreaterThan(5);
    for (const key of used) {
      expect(XP_ACTIONS[key], `awardXp("${key}") has no XP_ACTIONS entry`).toBeDefined();
    }
  });

  it("no award site hardcodes a point value any more", () => {
    // `addXp(10, "Specimen Rehomed")`, `addXp(5 * selected.size, ...)`,
    // `points * 2 * quantity` — every one of these disagreed with the canonical
    // table and so could not survive validation.
    for (const path of AWARD_SITES) {
      const code = readCode(path);
      expect(code, `${path} passes a literal amount`).not.toMatch(/awardXp\(\s*\d/);
      expect(code, `${path} multiplies canonical points inline`).not.toMatch(
        /XP_ACTIONS\.\w+\??\.points\s*\*/
      );
    }
  });
});

describe("the client no longer applies its own event multiplier", () => {
  it("does not double CLAIM_EXCHANGE for a self-declared event", () => {
    // The ×2 was unconditional (no event was ever checked) AND futile: useXPSync
    // always sends multiplier 1.0, so the inflated claim just failed the points
    // check. Only the server can confirm an event is live.
    for (const path of ["components/CheckoutSummary.jsx", "components/HandshakeVerification.jsx"]) {
      const code = readCode(path);
      expect(code, `${path} still doubles its own award`).not.toMatch(/points\s*\*\s*2/);
      expect(code).not.toMatch(/DOUBLE LOYALTY REWARDS/);
    }
  });

  it("passes the eventId through so the server can apply the real multiplier", () => {
    expect(readCode("components/CheckoutSummary.jsx")).toMatch(/eventId/);
    expect(read("hooks/useXPSync.js")).toMatch(/detail\.eventId/);
  });
});

describe("useXPSync prefers the declared key over inference", () => {
  const sync = read("hooks/useXPSync.js");

  it("reads detail.actionKey first and only then infers", () => {
    expect(sync).toMatch(/detail\.actionKey\s*\|\|\s*mapReasonToActionKey\(reason\)/);
  });

  it("warns when an award arrives without a key", () => {
    // Silence is what let this rot: a missing key means the award is one bad
    // substring match from being rejected and removed.
    expect(sync).toMatch(/carried no actionKey/);
  });

  it("forwards quantity so batched awards are not rejected as mismatches", () => {
    expect(sync).toMatch(/quantity: detail\.quantity \|\| 1/);
    expect(sync).toMatch(/quantity: Number\(metadata\?\.quantity\) \|\| 1/);
  });
});

describe("awardXp behaviour", () => {
  // `awardXp` persists to localStorage and announces on window; this suite runs in
  // the node environment, so both are stubbed. Errors are swallowed by design in
  // xp.js (a storage failure must not break the user's actual action), which is why
  // the stubs matter: without them these assertions would pass vacuously on 0.
  beforeEach(() => {
    const store = new Map();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      clear: () => store.clear(),
    };
    globalThis.CustomEvent = class {
      constructor(type, init) {
        this.type = type;
        this.detail = init?.detail;
      }
    };
    globalThis.window = { dispatchEvent: () => true };
  });

  it("fails loudly and awards nothing for an unknown key", () => {
    // Must NOT silently become LOG_FEEDING, which is what inference did.
    const before = awardXp("NOT_A_REAL_ACTION");
    expect(before.awarded).toBe(0);
  });

  it("scales a batched award by quantity", () => {
    // Uses the real table so the expectation cannot drift from the source of truth.
    const expected = XP_ACTIONS.MINT_SPECIMEN.points * 3;
    const result = awardXp("MINT_SPECIMEN", { quantity: 3 });
    expect(result.awarded).toBe(expected);
  });

  it("treats a missing or nonsensical quantity as one", () => {
    expect(awardXp("ADD_SPECIES").awarded).toBe(XP_ACTIONS.ADD_SPECIES.points);
    expect(awardXp("ADD_SPECIES", { quantity: 0 }).awarded).toBe(XP_ACTIONS.ADD_SPECIES.points);
    expect(awardXp("ADD_SPECIES", { quantity: -5 }).awarded).toBe(XP_ACTIONS.ADD_SPECIES.points);
  });
});

describe("client and server agree on the action table", () => {
  const server = read("../api/validate-xp.js");

  it("every client action exists server-side", () => {
    // MORPH_REGISTERED and ACCLIMATION_COMPLETED were missing, which made both
    // actions permanently un-earnable whenever Supabase was configured.
    for (const key of Object.keys(XP_ACTIONS)) {
      expect(server, `${key} is missing from VALID_ACTIONS`).toMatch(
        new RegExp(`\\b${key}\\s*:\\s*\\{`)
      );
    }
  });

  it("agrees on the point value for every action", () => {
    for (const [key, def] of Object.entries(XP_ACTIONS)) {
      const match = server.match(new RegExp(`\\b${key}\\s*:\\s*\\{[^}]*points:\\s*(\\d+)`));
      expect(match, `no server points found for ${key}`).toBeTruthy();
      expect(Number(match[1]), `${key} points disagree`).toBe(def.points);
    }
  });

  it("only allows batching on genuinely per-item actions", () => {
    // A quantity multiplier on the wrong action is an exploit: LOG_FEEDING × 500
    // would clear the per-tank cooldown, which only checks whether an event exists.
    expect(server).toMatch(/BATCHABLE_ACTIONS/);
    const block = server.slice(
      server.indexOf("const BATCHABLE_ACTIONS"),
      server.indexOf("});", server.indexOf("const BATCHABLE_ACTIONS"))
    );
    expect(block).not.toMatch(/LOG_FEEDING/);
    expect(block).not.toMatch(/LOG_WATER/);
    expect(block).not.toMatch(/SPAWN_BREED/);
  });
});

describe("rollback corrects the number the app actually displays", () => {
  const sync = read("hooks/useXPSync.js");

  it("rewrites aquadex_xp_profile, not just the scalar mirrors", () => {
    // `getXp()` reads `aquadex_xp_profile.points`. Rollback previously corrected only
    // `aquadex_xp` and `aquadex_xp_points`, so every rejected claim left the
    // displayed score permanently inflated — and compounded with the next one.
    expect(sync).toMatch(/setXpProfilePoints\(/);
  });
});
