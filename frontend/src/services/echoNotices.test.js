/**
 * echoNotices.test.js
 *
 * The rules Echo's whispers have to obey, asserted rather than trusted to review.
 *
 * The headline one is the advice ban. The version this replaced told keepers their
 * "fish would appreciate" a water change — husbandry advice from a hardcoded string
 * table, in a codebase that otherwise forbids exactly that (Poseidon's prompt bans
 * veterinary diagnosis; AI listing copy has a grounding contract). The tempting
 * edit here will always be to add one helpful line, so the ban is a test.
 */
import { describe, it, expect } from "vitest";
import {
  buildNotices,
  pickNotice,
  noticeText,
  noticeMentionsAdvice,
  NOTICE_THRESHOLDS,
} from "./echoNotices";

const NOW = Date.UTC(2026, 7, 16, 12, 0, 0);
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();
const hoursAgo = (n) => new Date(NOW - n * 3600000).toISOString();

/** Every distinct notice this module can emit, for the invariant sweeps below. */
function everyNotice() {
  const cases = [
    // Care, at and well past each threshold.
    { tankData: { lastWaterChange: daysAgo(3) } },
    { tankData: { lastWaterChange: daysAgo(11) } },
    { tankData: { lastFeeding: hoursAgo(40) } },
    { tankData: { lastParams: daysAgo(9) } },
    // Progress and streaks.
    { userState: { totalXp: 450, streakDays: 0 } },
    { userState: { streakDays: 6 } },
    { userState: { streakDays: 14 } },
    { userState: { streakDays: 4 } },
    // A keeper with a tank and nothing logged.
    { userState: { totalXp: 10 }, tankData: { tankCount: 1 } },
  ];

  const seen = new Map();
  for (const c of cases) {
    for (const n of buildNotices({ ...c, now: NOW })) {
      if (!seen.has(n.id)) seen.set(n.id, n);
    }
  }
  return [...seen.values()];
}

describe("Echo states facts, she does not give husbandry advice", () => {
  it("emits no advice-shaped wording in any notice, in either mode", () => {
    const all = everyNotice();
    expect(all.length).toBeGreaterThan(5); // the sweep actually covered something

    for (const n of all) {
      for (const pro of [false, true]) {
        const text = noticeText(n, { pro });
        expect(
          noticeMentionsAdvice(text),
          `advice-shaped notice "${n.id}" (${pro ? "pro" : "casual"}): ${text}`,
        ).toBe(false);
      }
    }
  });

  it("catches the exact phrasings the old version shipped", () => {
    // Guards the guard: if these stopped matching, the sweep above would pass
    // vacuously and the advice could come straight back.
    for (const line of [
      "It's been 7 days since the last water change. Your fish would appreciate one.",
      "3 days since your last water change. Good time for a refresh?",
      "A quick test keeps everyone safe.",
      "Try logging a feeding or water change.",
    ]) {
      expect(noticeMentionsAdvice(line), line).toBe(true);
    }
  });

  it("hands care notices to Poseidon instead of answering them itself", () => {
    // The care notices are the ones that used to advise. Each must carry a question
    // for Poseidon — he has the species context and the anti-diagnosis prompt.
    const care = buildNotices({
      tankData: { lastWaterChange: daysAgo(6), lastFeeding: hoursAgo(40), lastParams: daysAgo(9) },
      now: NOW,
    });
    expect(care.map((n) => n.id).sort()).toEqual(["feeding", "params", "water-change"]);
    for (const n of care) {
      expect(n.seedPrompt, `${n.id} has no way to follow up`).toBeTruthy();
    }
  });
});

describe("notices are read from the keeper's own logs", () => {
  it("says nothing when there is nothing logged", () => {
    // Silence is the right output. No tank data must not become "NaN days ago".
    expect(buildNotices({ now: NOW })).toEqual([]);
    expect(buildNotices({ userState: {}, tankData: {}, now: NOW })).toEqual([]);
  });

  it("counts elapsed days from the log, not from a guess", () => {
    const [notice] = buildNotices({ tankData: { lastWaterChange: daysAgo(6) }, now: NOW });
    expect(notice.casual).toContain("6 days");
    expect(notice.pro).toContain("6d");
  });

  it("stays quiet until the threshold is actually crossed", () => {
    const under = buildNotices({
      tankData: { lastWaterChange: daysAgo(NOTICE_THRESHOLDS.waterChangeDays - 1) },
      now: NOW,
    });
    expect(under.map((n) => n.id)).not.toContain("water-change");

    const at = buildNotices({
      tankData: { lastWaterChange: daysAgo(NOTICE_THRESHOLDS.waterChangeDays) },
      now: NOW,
    });
    expect(at.map((n) => n.id)).toContain("water-change");
  });

  it("ignores an unparseable timestamp rather than reporting nonsense", () => {
    const out = buildNotices({ tankData: { lastWaterChange: "not a date" }, now: NOW });
    expect(out).toEqual([]);
  });

  it("treats a very overdue log as more urgent than a slightly overdue one", () => {
    const mild = buildNotices({ tankData: { lastWaterChange: daysAgo(4) }, now: NOW })[0];
    const bad = buildNotices({ tankData: { lastWaterChange: daysAgo(12) }, now: NOW })[0];
    expect(bad.priority).toBeGreaterThan(mild.priority);
  });

  it("does not nag a keeper who has logged nothing but has no tanks either", () => {
    const out = buildNotices({ userState: { totalXp: 0 }, tankData: { tankCount: 0 }, now: NOW });
    expect(out.map((n) => n.id)).not.toContain("no-logs-yet");
  });
});

describe("choosing which one to show", () => {
  it("prefers the most urgent", () => {
    const notices = buildNotices({
      userState: { streakDays: 4 }, // priority 0
      tankData: { lastWaterChange: daysAgo(12) }, // priority 4
      now: NOW,
    });
    expect(pickNotice(notices, { random: () => 0 }).id).toBe("water-change");
  });

  it("avoids repeating the notice just shown", () => {
    const notices = buildNotices({
      tankData: { lastWaterChange: daysAgo(12), lastFeeding: hoursAgo(40) },
      now: NOW,
    });
    const again = pickNotice(notices, { excludeId: "water-change", random: () => 0 });
    expect(again.id).not.toBe("water-change");
  });

  it("still shows the only notice there is, rather than nothing", () => {
    // A repeat beats silence when it is the single true thing to report.
    const notices = buildNotices({ tankData: { lastWaterChange: daysAgo(12) }, now: NOW });
    expect(pickNotice(notices, { excludeId: "water-change", random: () => 0 })?.id).toBe(
      "water-change",
    );
  });

  it("returns null when there is nothing to say", () => {
    expect(pickNotice([], { random: () => 0 })).toBeNull();
    expect(pickNotice(null)).toBeNull();
  });

  it("varies between equally urgent notices", () => {
    const notices = buildNotices({
      tankData: { lastFeeding: hoursAgo(40), lastParams: daysAgo(9) },
      now: NOW,
    });
    const first = pickNotice(notices, { random: () => 0 }).id;
    const last = pickNotice(notices, { random: () => 0.99 }).id;
    expect(first).not.toBe(last);
  });
});

describe("both modes get a voice", () => {
  it("gives Pro its own terse wording rather than nothing", () => {
    // Whispers used to be casual-only, which is the same mistake as the XP gate
    // that hid Echo from new keepers: it withheld the guide from a whole mode.
    for (const n of everyNotice()) {
      expect(noticeText(n, { pro: true }), `${n.id} has no pro wording`).toBeTruthy();
      expect(noticeText(n, { pro: false }), `${n.id} has no casual wording`).toBeTruthy();
      expect(noticeText(n, { pro: true })).not.toBe(noticeText(n, { pro: false }));
    }
  });

  it("returns null for a missing notice instead of throwing", () => {
    expect(noticeText(null)).toBeNull();
  });
});
