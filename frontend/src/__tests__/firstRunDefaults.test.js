/**
 * First-run defaults, pinned as source guards.
 *
 * A new user reported being lost and overwhelmed. The cause was not a missing
 * tutorial — two of those were built and sunset for feeling forced. It was three
 * regressions that a tutorial would only have papered over:
 *
 *   1. A brand-new account landed in PRO mode. The retired onboarding wizard's
 *      persona step was the only code that ever wrote `aquadex_casual_mode`, so
 *      deleting the wizard silently made Pro the first-run default — and the
 *      welcome copy a hobbyist read was "Register your first containment unit …
 *      define your system topology".
 *   2. The activation checklist rendered only inside ProfileHub, on the `profile`
 *      tab, which has no entry in App.jsx's nav array. On desktop it was
 *      reachable only by typing /app/profile.
 *   3. The dashboard rendered furnished-but-empty shells: a $0.00 loyalty card
 *      with a tier discount and a distribution date, plus Scan and Quick Log
 *      buttons whose tank picker resolved to undefined with zero tanks.
 *
 * This project's vitest runs in a `node` environment with no jsdom, and App.jsx
 * transitively imports the whole app, so these are asserted over source the same
 * way the other catalog tests in this directory are.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function source(rel) {
  return stripComments(readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8"));
}

describe("a new account starts in Casual, not Pro", () => {
  const app = source("App.jsx");

  it("defaults casualModeActive to true when no preference is stored", () => {
    // THE REGRESSION. This block returned `false`, so every new keeper got the
    // breeder vocabulary and a Breeder Tools tab as a peer of Aquariums.
    expect(app).toMatch(
      /localStorage\.getItem\("aquadex_casual_mode"\);\s*if \(saved !== null\) return saved === "true";\s*return true;/
    );
  });

  it("still honours an explicit stored preference", () => {
    // Anyone who has ever toggled keeps their choice — the change only affects
    // accounts that never expressed one.
    expect(app).toContain('if (saved !== null) return saved === "true";');
  });
});

describe("the activation checklist is reachable without typing a URL", () => {
  const app = source("App.jsx");

  it("renders on the tanks dashboard, which is where a new keeper lands", () => {
    expect(app).toContain("StarterQuestCard");
    // The tanks branch is the default case of renderContent(), so a card
    // rendered there is on the landing page for every signed-in user.
    expect(app).toMatch(/case "tanks":[\s\S]{0,400}StarterQuestCard/);
  });

  it("is imported as a shared component rather than redeclared", () => {
    // It used to be declared inside ProfileHub, which is what tied it to an
    // unlinked route.
    expect(app).toContain('from "./components/StarterQuestCard"');
    expect(source("components/ProfileHub.jsx")).toContain('from "./StarterQuestCard"');
  });

  it("can be dismissed at any time, not only once complete", () => {
    // A checklist you cannot close is a demand, and a demand is what "forced"
    // feels like. The previous version only offered dismissal after all five
    // steps, so a keeper uninterested in one of them saw it forever.
    const card = source("components/StarterQuestCard.jsx");
    expect(card).toContain("if (quest.dismissed) return null;");
    expect(card).not.toMatch(/quest\.allDone && quest\.dismissed/);
  });
});

describe("the dashboard does not render empty furniture", () => {
  it("the loyalty card hides itself when there is nothing in it", () => {
    const card = source("components/RewardCreditsCard.jsx");
    expect(card).toContain("hasNothingYet");
    expect(card).toMatch(/if \(hasNothingYet\) return null;/);
  });

  it("Scan and Quick Log require a tank to act on", () => {
    // Both were live controls that could not succeed with zero tanks: the Quick
    // Log picker resolves `tanks.find(...) || activeTank || tanks[0]`.
    const list = source("components/TankList.jsx");
    // Two toolbar pills (scan, quick log) …
    const gatedPills = list.match(/\{tanks\.length > 0 && \(/g) || [];
    expect(gatedPills.length).toBeGreaterThanOrEqual(2);
    // … and the mobile FAB, which carries its own open/closed condition too.
    expect(list).toMatch(/\{!quickLogOpen && tanks\.length > 0 && \(/);
  });

  it("follows the hide-when-empty precedent FryNursery already set", () => {
    expect(source("components/FryNursery.jsx")).toMatch(/length === 0\) return null/);
  });
});

describe("the empty state speaks to the audience it is shown to", () => {
  const list = source("components/TankList.jsx");

  it("does not hand facility topology to a casual keeper", () => {
    // The casual branch must not mention containment units, topology or racks as
    // the primary instruction.
    const casualCopy = list.match(/"Add your first tank[^"]*"/);
    expect(casualCopy, "casual empty-state copy").toBeTruthy();
    expect(casualCopy[0]).not.toMatch(/containment|topology/i);
  });

  it("tells an actual breeder where Pro mode is", () => {
    // Casual is now the default, so the escape hatch has to exist for the
    // audience the default is wrong for — offered once, where it is relevant.
    expect(list).toMatch(/Switch to Pro in the header/);
  });
});
