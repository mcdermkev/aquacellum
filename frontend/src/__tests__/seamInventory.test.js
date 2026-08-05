/**
 * seamInventory.test.js — the CI ratchet over one-sided module seams.
 *
 * WHY THIS EXISTS. The five Settings defects fixed in this rework all had the same
 * shape: a writer and a reader disagreeing about a name, producing `undefined`
 * instead of an error. 2789 unit tests, 0 lint errors and a green build caught none
 * of them, because each side was tested in isolation against a fixture that encoded
 * the same wrong assumption. Seams are invisible to vertical tests by construction.
 *
 * WHAT THIS FILE DOES. `scripts/seams/analyzeSeams.mjs` enumerates every persisted
 * key and custom event and reports the ones with only one side. The baseline below
 * records every seam that exists today together with a VERDICT, so that:
 *
 *   - a NEW one-sided seam fails the build immediately;
 *   - a FIXED seam also fails, forcing its baseline entry to be deleted, so the list
 *     can only ever shrink;
 *   - the known-bug count is a number in source control rather than a vibe.
 *
 * The verdicts are not guesses. Each was checked by reading the producer.
 *
 * ⚠️ HOW TO USE THIS: do not add a `verdict: "expected"` entry to silence a finding.
 * "expected" means a non-app writer owns the key (a library, or an older release of
 * this app). Everything else is "bug" and belongs on the fix list.
 * Run `node scripts/seams/report.mjs` for the full report with line numbers.
 */

import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { analyzeSeams, findings, findingIds } from "../../scripts/seams/analyzeSeams.mjs";
import { collectSourceFiles } from "../../scripts/seams/report.mjs";

/**
 * Every one-sided seam in the app as of this commit.
 *
 * verdict "bug"      — genuinely broken; nothing on the other side, user-visible.
 * verdict "expected" — the other side is outside this codebase (a library, or a
 *                      previous release whose data we still migrate).
 */
const SEAM_BASELINE = [
  // ── Confirmed defects ───────────────────────────────────────────────────
  //
  // HISTORICAL NOTE, because it is the most useful thing in this file. Two entries
  // that once sat here were WRONG, and both were resolver gaps rather than defects:
  //
  //   aquadex_specimen_metadata_ — read at specimenMetadata.js:408 via
  //     localMetadataKey(id), a key-BUILDER FUNCTION. It is the deliberate local tier
  //     of the hosted → local → none precedence chain. Acting on the finding would
  //     have deleted a live write on the certificate path.
  //   aquadex_tank_photo_ — written at tankMedia.js:66 through a builder call stored
  //     in a const, and read through a wrapper that forwards a parameter to getItem.
  //
  // Both are now resolved automatically. The lesson is in the analyzer's own tests:
  // a finding is a hypothesis about the producer, and it is worth nothing until
  // someone has read the producer.
  {
    id: "writtenNeverRead:aquadex_xp_points",
    verdict: "bug",
    note:
      "Six writers (useXPSync, cloudSync x3, xp.js x2), zero readers. cloudSync's " +
      "own comment says it is maintained 'for legacy components that read from " +
      "there'; those components no longer exist.",
  },
  {
    id: "readNeverWritten:aquadex_digital_orders_count",
    verdict: "bug",
    note:
      "MarketplaceBoard:615 reads it as `Number(getItem(...) || 12)`. Nothing ever " +
      "writes it, so the marketplace always displays a hardcoded 12 as though it " +
      "were a real count.",
  },
  {
    id: "readNeverWritten:aquadex_display_name",
    verdict: "bug",
    note:
      "SpecimenDetailModal:448 uses this as the last fallback before " +
      "'Breeder #XXXX'. Nothing writes it, and the real name lives in Supabase " +
      "profiles.display_name — so your own display name never appears on your own " +
      "specimens.",
  },
  {
    id: "readNeverWritten:aquadex_demo_tank",
    verdict: "bug",
    note:
      "reef/hooks/useTankData.js:169 falls back to it when no per-id tank is " +
      "stored. Nothing writes it, so the fallback is unreachable.",
  },
  {
    id: "readNeverWritten:echo_last_evolution_ts",
    verdict: "bug",
    note:
      "useEchoRareMoments:65 reads it to gate evolution timing. Never written, so " +
      "whatever cooldown it guards never engages.",
  },
  {
    id: "readNeverWritten:echo_personality_",
    verdict: "bug",
    note:
      "useEchoState:218 reads `echo_personality_<address>`. Never written, so a " +
      "stored Echo personality can never be restored.",
  },
  {
    id: "handledNeverDispatched:aquadex_navigate",
    verdict: "bug",
    note:
      "EchoAmbient:145 listens for 'aquadex_navigate'. The app dispatches " +
      "'aquadex:navigate-tab' — different name, so Echo never reacts to in-app tab " +
      "navigation. Its sibling listener 'aquadex_xp_added' IS dispatched, which is " +
      "what makes this one a typo rather than a design choice.",
  },
  {
    id: "dispatchedNeverHandled:poseidon:species-search",
    verdict: "bug",
    note: "App.jsx:662 dispatches it on a Poseidon species search; nothing listens.",
  },
  {
    id: "dispatchedNeverHandled:aquadex_xp_rollback",
    verdict: "bug",
    note:
      "useXPSync:225 announces that an XP award was rolled back. Nothing listens, " +
      "so the UI keeps showing XP the server rejected.",
  },
  {
    id: "dispatchedNeverHandled:aquadex_campaign_reward",
    verdict: "bug",
    note: "SponsorCampaignBanner:28 dispatches a claimed reward; nothing listens.",
  },
  {
    id: "dispatchedNeverHandled:echo_rare_moment",
    verdict: "bug",
    note: "useEchoRareMoments:92 dispatches a rare moment; nothing listens.",
  },

  // ── Explained: the other side is outside this codebase ──────────────────
  {
    id: "readNeverWritten:aquacellum-reef-auth",
    verdict: "expected",
    note:
      "supabase-js owns this key — it is passed to the client as its `storageKey`, " +
      "and the library writes it. supabaseClient.js:121 only reads it.",
  },
];

const BASELINE_IDS = SEAM_BASELINE.map((s) => s.id).sort();
const KNOWN_BUGS = SEAM_BASELINE.filter((s) => s.verdict === "bug").length;

const FRONTEND = fileURLToPath(new URL("../../", import.meta.url));
const rel = (f) => f.replace(FRONTEND, "").split("\\").join("/");

function currentFindings() {
  const files = collectSourceFiles();
  return findings(analyzeSeams(files, { relativize: rel }));
}

describe("seam inventory", () => {
  const found = currentFindings();
  const ids = findingIds(found);

  it("finds no seam that is not already recorded", () => {
    const added = ids.filter((id) => !BASELINE_IDS.includes(id));
    expect(
      added,
      "New one-sided seam(s). Something writes a key nothing reads, or dispatches an " +
        "event nothing handles. Run `node scripts/seams/report.mjs` for line numbers."
    ).toEqual([]);
  });

  it("has no stale baseline entries — the list can only shrink", () => {
    const fixed = BASELINE_IDS.filter((id) => !ids.includes(id));
    expect(
      fixed,
      "These seams no longer exist. Delete their entries from SEAM_BASELINE so the " +
        "known-bug count reflects reality."
    ).toEqual([]);
  });

  it("does not let the known-bug count grow", () => {
    // A ceiling, not a target. It should trend to 0.
    expect(KNOWN_BUGS).toBeLessThanOrEqual(11);
  });

  it("every baseline entry carries a verdict and a reason", () => {
    for (const seam of SEAM_BASELINE) {
      expect(["bug", "expected"], `${seam.id} has an invalid verdict`).toContain(seam.verdict);
      expect(seam.note.length, `${seam.id} needs a real explanation`).toBeGreaterThan(40);
    }
  });
});

/**
 * The analyzer's own tests.
 *
 * Without these the ratchet is worthless: a resolver that silently stopped
 * recognising `setItem` would report zero seams and pass forever, which is exactly
 * the "green build, broken app" failure this whole file exists to prevent. Fixtures
 * are virtual, passed through the `readFile` hook.
 */
describe("the analyzer itself", () => {
  const analyze = (fixtures) =>
    findings(
      analyzeSeams(Object.keys(fixtures), {
        readFile: (f) => fixtures[f],
        relativize: (f) => f,
      })
    );

  it("catches a written-but-never-read key", () => {
    const out = analyze({ "a.js": `localStorage.setItem("k_dead", "1");` });
    expect(out.writtenNeverRead.map((f) => f.key)).toEqual(["k_dead"]);
  });

  it("catches a read-but-never-written key", () => {
    const out = analyze({ "a.js": `const v = localStorage.getItem("k_ghost");` });
    expect(out.readNeverWritten.map((f) => f.key)).toEqual(["k_ghost"]);
  });

  it("reports nothing when both sides exist across different files", () => {
    const out = analyze({
      "w.js": `localStorage.setItem("k_ok", "1");`,
      "r.js": `const v = localStorage.getItem("k_ok");`,
    });
    expect(out.writtenNeverRead).toEqual([]);
    expect(out.readNeverWritten).toEqual([]);
  });

  it("resolves a key held in a file-local const", () => {
    // The pattern that makes naive grep-based checks useless.
    const out = analyze({
      "w.js": `const K = "k_const"; localStorage.setItem(K, "1");`,
      "r.js": `const K = "k_const"; localStorage.getItem(K);`,
    });
    expect(out.writtenNeverRead).toEqual([]);
    expect(out.readNeverWritten).toEqual([]);
  });

  it("resolves a key imported from another module", () => {
    const out = analyze({
      "keys.js": `export const CACHE_KEY = "k_exported";`,
      "w.js": `import { CACHE_KEY } from "./keys.js"; localStorage.setItem(CACHE_KEY, "1");`,
      "r.js": `import { CACHE_KEY } from "./keys.js"; localStorage.getItem(CACHE_KEY);`,
    });
    expect(out.writtenNeverRead).toEqual([]);
    expect(out.readNeverWritten).toEqual([]);
  });

  it("attributes a dynamic key-map write to every value in the map", () => {
    // The AI_PREF_KEYS case. Without this, both keys looked never-written and the
    // Poseidon/Echo toggles were reported as dead controls when they work fine.
    const out = analyze({
      "w.js": `
        const KEYS = Object.freeze({ a: "k_map_a", b: "k_map_b" });
        function set(which) { const key = KEYS[which]; localStorage.setItem(key, "1"); }
      `,
      "r.js": `localStorage.getItem("k_map_a"); localStorage.getItem("k_map_b");`,
    });
    expect(out.readNeverWritten).toEqual([]);
  });

  it("pairs a templated writer with a templated reader by prefix", () => {
    const out = analyze({
      "w.js": "localStorage.setItem(`k_photo_${id}`, x);",
      "r.js": "localStorage.getItem(`k_photo_${id}`);",
    });
    expect(out.writtenNeverRead).toEqual([]);
    expect(out.readNeverWritten).toEqual([]);
  });

  it("resolves a key built into a const via a template literal", () => {
    const out = analyze({
      "w.js": "const ck = `k_claim_${id}`; localStorage.setItem(ck, '1');",
      "r.js": "localStorage.getItem(`k_claim_${id}`);",
    });
    expect(out.writtenNeverRead).toEqual([]);
    expect(out.readNeverWritten).toEqual([]);
  });

  it("resolves a key produced by a key-builder function", () => {
    // The gap that produced a WRONG verdict about certificate metadata: the reader
    // was `localStorage.getItem(localMetadataKey(id))`, which looked like nothing.
    const out = analyze({
      "keys.js": "export function metaKey(id) { return `k_meta_${id}`; }",
      "w.js": "import { metaKey } from './keys.js'; localStorage.setItem(metaKey(1), 'x');",
      "r.js": "import { metaKey } from './keys.js'; localStorage.getItem(metaKey(1));",
    });
    expect(out.writtenNeverRead).toEqual([]);
    expect(out.readNeverWritten).toEqual([]);
  });

  it("resolves an arrow-function key builder", () => {
    const out = analyze({
      "w.js": "const k = (id) => `k_arrow_${id}`; localStorage.setItem(k(1), 'x');",
      "r.js": "localStorage.getItem(`k_arrow_${1}`);",
    });
    expect(out.writtenNeverRead).toEqual([]);
  });

  it("resolves BOTH branches of a ternary key builder", () => {
    // `legacyPhotoKey` returns a tank key or delegates to the specimen key builder.
    // Taking only the first branch would leave the other looking unwritten.
    const out = analyze({
      "keys.js": `
        export function specKey(id) { return \`k_spec_\${id}\`; }
        export function anyKey(t, id) { return t === "tank" ? \`k_tank_\${id}\` : specKey(id); }
      `,
      "w.js": `
        import { anyKey } from './keys.js';
        const key = anyKey("tank", 1);
        localStorage.setItem(key, "x");
      `,
      "r.js": "localStorage.getItem(`k_tank_${1}`); localStorage.getItem(`k_spec_${1}`);",
    });
    expect(out.readNeverWritten.map((f) => f.key)).toEqual([]);
  });

  it("resolves a key read through a storage wrapper function", () => {
    // `readLocalStorageKey(key)` forwards a bare parameter to getItem, so the key
    // itself never appears at the getItem call site.
    const out = analyze({
      "s.js": `
        function readKey(key) { return localStorage.getItem(key) || null; }
        export function get(id) { return readKey(\`k_wrapped_\${id}\`); }
      `,
      "w.js": "localStorage.setItem(`k_wrapped_${1}`, 'x');",
    });
    expect(out.writtenNeverRead).toEqual([]);
    expect(out.readNeverWritten).toEqual([]);
  });

  it("does not treat a wrapper that transforms its key as a forward", () => {
    // Only a DIRECT parameter forward is sound. If the helper rewrites the key we
    // cannot know what it became, so the call must not be credited as a read.
    const out = analyze({
      "s.js": `
        function readPrefixed(key) { return localStorage.getItem("pre_" + key); }
        export function get() { return readPrefixed("k_transformed"); }
      `,
    });
    expect(out.readNeverWritten.map((f) => f.key)).toEqual(["pre_"]);
  });

  it("does not let an unrelated prefix explain away a dead key", () => {
    // `k_xp` must not be treated as the reader for `k_xp_points`; that suppression
    // bug hid a key with six writers and no readers.
    const out = analyze({
      "w.js": `localStorage.setItem("k_xp_points", "1");`,
      "r.js": `localStorage.getItem("k_xp");`,
    });
    expect(out.writtenNeverRead.map((f) => f.key)).toEqual(["k_xp_points"]);
  });

  it("treats removeItem as neither a read nor a write", () => {
    // Logout cleanup legitimately deletes keys owned by retired code.
    const out = analyze({ "a.js": `localStorage.removeItem("k_cleanup");` });
    expect(out.writtenNeverRead).toEqual([]);
    expect(out.readNeverWritten).toEqual([]);
  });

  it("catches an event dispatched with no listener", () => {
    const out = analyze({
      "a.js": `window.dispatchEvent(new CustomEvent("app:orphan", { detail: 1 }));`,
    });
    expect(out.dispatchedNeverHandled.map((f) => f.key)).toEqual(["app:orphan"]);
  });

  it("catches a listener for an event nobody dispatches", () => {
    const out = analyze({ "a.js": `window.addEventListener("app:never", fn);` });
    expect(out.handledNeverDispatched.map((f) => f.key)).toEqual(["app:never"]);
  });

  it("ignores native browser events", () => {
    // Otherwise keydown/click/focus/beforeinstallprompt bury every real finding.
    const out = analyze({
      "a.js": `
        window.addEventListener("keydown", fn);
        window.addEventListener("beforeinstallprompt", fn);
        window.addEventListener("notificationclick", fn);
      `,
    });
    expect(out.handledNeverDispatched).toEqual([]);
  });

  it("downgrades an event whose name appears elsewhere to 'possibly indirect'", () => {
    // The onboarding `completeOn:` pattern: a generic runner calls
    // addEventListener(step.completeOn), which no resolver can attribute. Claiming
    // "nothing handles this" would be unsound, so it moves to a review bucket.
    const out = analyze({
      "d.js": `window.dispatchEvent(new CustomEvent("app:tour_done"));`,
      "s.js": `export const step = { completeOn: "app:tour_done" };`,
    });
    expect(out.dispatchedNeverHandled).toEqual([]);
    expect(out.possiblyHandledIndirectly.map((f) => f.key)).toEqual(["app:tour_done"]);
  });

  it("sees storage reached through an aliased object", () => {
    // `const storage = window.localStorage` then storage.setItem(...) — matching on
    // the object name alone would miss every write in useAiPrefs.
    const out = analyze({
      "a.js": `const storage = window.localStorage; storage.setItem("k_alias", "1");`,
    });
    expect(out.writtenNeverRead.map((f) => f.key)).toEqual(["k_alias"]);
  });

  it("parses JSX without choking", () => {
    const out = analyze({
      "a.jsx": `export const C = () => <div onClick={() => localStorage.setItem("k_jsx", "1")} />;`,
    });
    expect(out.writtenNeverRead.map((f) => f.key)).toEqual(["k_jsx"]);
  });
});
