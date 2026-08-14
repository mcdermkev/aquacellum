import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  APP_GUIDE,
  GUIDE_STATUS,
  GUIDE_MODE,
  findAppGuide,
  scoreAppGuide,
  answerAppQuestion,
  navTargetFor,
  guideEntryById,
  allGuideCopy,
} from "../services/appGuide";
import { PROHIBITED_TERMS } from "../services/orderCopy";

/**
 * Drift guards for the app capability manifest.
 *
 * The manifest exists so Poseidon can answer "where do I do X?" from data rather
 * than invention. That only holds if the data keeps matching the app, so these
 * tests assert every destination against the REAL source of truth.
 *
 * Why source-text assertions rather than imports: `config/appConfig.js` reads
 * `import.meta.env` at module load, which is undefined under the node test
 * environment, and the two section lists (`BreederTools`'s `sections`,
 * `BreederTerminal`'s `SECTIONS`) are component-local and not exported. Scraping
 * the source is the established precedent here — see
 * `localBreederMapPickups.catalog.test.js` (asserts against appConfig.js text)
 * and `cohortPromotion.test.js` (scrapes SpawnGrowoutTracker).
 */

const SRC = fileURLToPath(new URL("../", import.meta.url));
const read = (rel) => readFileSync(SRC + rel, "utf8");

/** Pull a JS string-array literal out of source text by its declaration. */
function extractStringArray(source, declaration) {
  const start = source.indexOf(declaration);
  if (start === -1) throw new Error(`Could not find ${declaration}`);
  const open = source.indexOf("[", start);
  const close = source.indexOf("]", open);
  return [...source.slice(open, close).matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
}

const VALID_TABS = extractStringArray(read("config/appConfig.js"), "export const VALID_TABS");

// BreederTools' sections are objects: { id: "register", icon: …, label: … }
const BREEDER_SECTIONS = (() => {
  const source = read("components/BreederTools.jsx");
  const start = source.indexOf("const sections = [");
  const close = source.indexOf("];", start);
  return [...source.slice(start, close).matchAll(/id:\s*"([a-z-]+)"/g)].map((m) => m[1]);
})();

// BreederTerminal's SECTIONS is a frozen map: { HOME: "home", … }
const TERMINAL_SECTIONS = (() => {
  const source = read("components/breeder/BreederTerminal.jsx");
  const start = source.indexOf("const SECTIONS = Object.freeze({");
  const close = source.indexOf("});", start);
  return [...source.slice(start, close).matchAll(/:\s*"([a-z-]+)"/g)].map((m) => m[1]);
})();

// Settings anchors are the `id` prop on each SettingsSection.
const SETTINGS_SECTIONS = (() => {
  const files = [
    "ExperienceModeSection", "AccountSection", "NotificationsSection", "AccessibilitySection",
    "CompanionsSection", "UnitsSection", "AquariumsSection", "DiscoverySection", "SellerSection",
    "ZoneSection", "BackupSection", "AppSupportSection", "SmartWalletSection", "ResetSection",
    "PrivacySection",
  ];
  const ids = new Set();
  for (const f of files) {
    const source = read(`components/settings/sections/${f}.jsx`);
    for (const m of source.matchAll(/id="([a-z][a-z-]*)"/g)) ids.add(m[1]);
  }
  return [...ids];
})();

describe("the manifest agrees with the app's real routes", () => {
  it("extracted the source constants (guards the scrapers themselves)", () => {
    // If a scraper silently returns [] every assertion below passes vacuously.
    expect(VALID_TABS.length).toBeGreaterThanOrEqual(10);
    expect(VALID_TABS).toContain("tanks");
    expect(BREEDER_SECTIONS.length).toBeGreaterThanOrEqual(7);
    expect(BREEDER_SECTIONS).toContain("register");
    expect(TERMINAL_SECTIONS.length).toBeGreaterThanOrEqual(8);
    expect(TERMINAL_SECTIONS).toContain("payouts");
    expect(SETTINGS_SECTIONS.length).toBeGreaterThanOrEqual(10);
    expect(SETTINGS_SECTIONS).toContain("privacy");
  });

  it("every entry points at a tab in VALID_TABS", () => {
    for (const entry of APP_GUIDE) {
      expect(VALID_TABS, `entry "${entry.id}" targets unknown tab "${entry.tab}"`).toContain(entry.tab);
    }
  });

  it("never points at a retired tab", () => {
    // `map` and `storefront` were retired and only exist as redirects.
    for (const entry of APP_GUIDE) {
      expect(["map", "storefront"]).not.toContain(entry.tab);
    }
  });

  it("every Breeder Tools section exists in BreederTools", () => {
    for (const entry of APP_GUIDE.filter((e) => e.tab === "breeder" && e.section)) {
      expect(BREEDER_SECTIONS, `"${entry.id}" → unknown breeder section "${entry.section}"`).toContain(entry.section);
    }
  });

  it("every Breeder Terminal section exists in BreederTerminal", () => {
    for (const entry of APP_GUIDE.filter((e) => e.tab === "breeder-terminal" && e.section)) {
      expect(TERMINAL_SECTIONS, `"${entry.id}" → unknown terminal section "${entry.section}"`).toContain(entry.section);
    }
  });

  it("every Settings section is a real #settings/<id> anchor", () => {
    for (const entry of APP_GUIDE.filter((e) => e.tab === "settings" && e.section)) {
      expect(SETTINGS_SECTIONS, `"${entry.id}" → unknown settings anchor "${entry.section}"`).toContain(entry.section);
    }
  });

  it("only tabs that support sections carry one", () => {
    const sectionable = ["breeder", "breeder-terminal", "settings"];
    for (const entry of APP_GUIDE.filter((e) => e.section)) {
      expect(sectionable, `"${entry.id}" sets a section on tab "${entry.tab}", which has none`).toContain(entry.tab);
    }
  });
});

describe("manifest shape", () => {
  it("has unique ids", () => {
    const ids = APP_GUIDE.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every entry has copy, keywords, a known status and a known mode", () => {
    const statuses = Object.values(GUIDE_STATUS);
    const modes = Object.values(GUIDE_MODE);
    for (const entry of APP_GUIDE) {
      expect(entry.what, `"${entry.id}" has no description`).toBeTruthy();
      expect(entry.label.casual).toBeTruthy();
      expect(entry.label.pro).toBeTruthy();
      expect(entry.keywords.length, `"${entry.id}" has no keywords`).toBeGreaterThan(0);
      expect(statuses, `"${entry.id}" has unknown status`).toContain(entry.status);
      expect(modes, `"${entry.id}" has unknown mode`).toContain(entry.mode);
    }
  });

  it("anything not live explains itself", () => {
    // A gate that doesn't say what it needs, or a retirement that doesn't say it
    // was retired, is worse than no answer (see entitlements.js on misreporting).
    for (const entry of APP_GUIDE.filter((e) => e.status === GUIDE_STATUS.GATED || e.status === GUIDE_STATUS.NOT_ENFORCED)) {
      expect(entry.note, `"${entry.id}" is ${entry.status} but explains nothing`).toBeTruthy();
    }
  });

  it("carries the retired surfaces on purpose, so they can be corrected", () => {
    const removed = APP_GUIDE.filter((e) => e.status === GUIDE_STATUS.REMOVED).map((e) => e.id);
    expect(removed).toContain("tank-cam");
    expect(removed).toContain("local-map");
  });
});

describe("copy stays free of Web3 vocabulary", () => {
  it("no user-facing string contains a prohibited term", () => {
    for (const line of allGuideCopy()) {
      const hit = PROHIBITED_TERMS.find((t) => line.toLowerCase().includes(t));
      expect(hit, `"${line}" contains prohibited term "${hit}"`).toBeUndefined();
    }
  });
});

describe("navTargetFor", () => {
  it("returns the tab, and the section when there is one", () => {
    expect(navTargetFor(guideEntryById("log-water-test"))).toEqual({ tab: "tanks" });
    expect(navTargetFor(guideEntryById("spawning"))).toEqual({ tab: "breeder", section: "spawning" });
    expect(navTargetFor(guideEntryById("payouts"))).toEqual({ tab: "breeder-terminal", section: "payouts" });
  });

  it("refuses to route to a retired surface", () => {
    expect(navTargetFor(guideEntryById("tank-cam"))).toBeNull();
    expect(navTargetFor(guideEntryById("local-map"))).toBeNull();
  });

  it("is null-safe", () => {
    expect(navTargetFor(null)).toBeNull();
  });
});

describe("findAppGuide", () => {
  const topId = (q) => (findAppGuide(q, { limit: 1 })[0] || {}).id;

  it("finds the water-test destination from natural phrasings", () => {
    expect(topId("where do I log a water test")).toBe("log-water-test");
    expect(topId("how do I test my water")).toBe("log-water-test");
  });

  it("finds spawning, lineage and grow-out", () => {
    expect(topId("how do I log a spawn")).toBe("spawning");
    expect(topId("where is the pedigree")).toBe("lineage");
    expect(topId("how many fry survived")).toBe("growout");
  });

  it("finds the selling and payout surfaces", () => {
    expect(topId("how do I get paid")).toBe("payouts");
    expect(topId("where do I buy a shipping label")).toBe("seller-orders");
  });

  it("finds mode switching and units", () => {
    expect(topId("how do I switch to pro mode")).toBe("switch-mode");
    expect(topId("change to fahrenheit")).toBe("units");
  });

  it("routes a retired feature to its retirement entry, not to something plausible", () => {
    expect(topId("can I put a camera on my tank")).toBe("tank-cam");
    expect(topId("show me sellers near me")).toBe("local-map");
  });

  it("returns nothing for an empty or nonsense query rather than a bad guess", () => {
    expect(findAppGuide("")).toEqual([]);
    expect(findAppGuide("a")).toEqual([]);
    expect(findAppGuide("zzzxqwv")).toEqual([]);
  });

  it("respects the limit", () => {
    expect(findAppGuide("tank", { limit: 3 }).length).toBeLessThanOrEqual(3);
  });

  it("ranks a specific phrase above an incidental single-word hit", () => {
    // The tuning case: "fry" appears in the Fry Nursery's keywords and literally
    // in this question, but grow-out is what's being asked about.
    const ranked = scoreAppGuide("how many fry survived");
    const growout = ranked.find((r) => r.id === "growout");
    const nursery = ranked.find((r) => r.id === "fry-nursery");
    expect(growout.score).toBeGreaterThan(nursery.score);
  });

  it("scores nonsense at zero for everything", () => {
    expect(scoreAppGuide("zzzxqwv").every((r) => r.score === 0)).toBe(true);
  });
});

describe("answerAppQuestion", () => {
  it("names the destination using the reader's own vocabulary", () => {
    const casual = answerAppQuestion("where do I buy fish", { casual: true });
    expect(casual.answer).toContain("Breeder Store");
    const pro = answerAppQuestion("where do I buy fish", { casual: false });
    expect(pro.answer).toContain("Marketplace");
  });

  it("includes the section when there is one", () => {
    const res = answerAppQuestion("how do I log a spawn", { casual: false });
    expect(res.answer).toContain("spawning");
    expect(res.navTarget).toEqual({ tab: "breeder", section: "spawning" });
  });

  it("offers the Pro toggle instead of implying a Casual user is locked out", () => {
    const res = answerAppQuestion("how do I log a spawn", { casual: true });
    expect(res.needsModeSwitch).toBe(true);
    expect(res.answer).toMatch(/Pro mode/i);
    // Crucially it does NOT claim the capability is unavailable.
    expect(res.answer).not.toMatch(/can't|cannot|not allowed|locked/i);
  });

  it("says a retired feature is retired and offers nowhere to go", () => {
    const res = answerAppQuestion("can I stream my tank on camera", { casual: true });
    expect(res.entry.status).toBe(GUIDE_STATUS.REMOVED);
    expect(res.answer).toMatch(/retired/i);
    expect(res.navTarget).toBeNull();
  });

  it("passes a gate's real condition through", () => {
    const res = answerAppQuestion("can you alert me when a species is available", { casual: true });
    expect(res.entry.status).toBe(GUIDE_STATUS.GATED);
    expect(res.answer).toContain(res.entry.note);
  });

  it("notices when the user is already where they need to be", () => {
    const res = answerAppQuestion("how do I test my water", { casual: true, currentTab: "tanks" });
    expect(res.answer).toMatch(/already on that tab/i);
  });

  it("returns null when it doesn't know, so the caller can fall back to the model", () => {
    expect(answerAppQuestion("zzzxqwv")).toBeNull();
    expect(answerAppQuestion("")).toBeNull();
  });
});
