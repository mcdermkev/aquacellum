import { describe, it, expect } from "vitest";
import {
  resolveChallengePhase,
  CHALLENGE_PHASE,
  challengeScoring,
  canJoinChallenge,
  canSubmitToChallenge,
  canVoteInChallenge,
  canFinalizeChallenge,
} from "./challenges";

const HOUR = 3600 * 1000;
const NOW = new Date("2026-08-17T12:00:00Z").getTime();

/** A challenge window relative to NOW, in hours. */
function challenge({ startH, endH, ...rest }) {
  return {
    start_time: new Date(NOW + startH * HOUR).toISOString(),
    end_time: new Date(NOW + endH * HOUR).toISOString(),
    ...rest,
  };
}

describe("resolveChallengePhase — derived, never stored", () => {
  it("is upcoming before the window opens", () => {
    expect(resolveChallengePhase(challenge({ startH: 1, endH: 2 }), NOW)).toBe(CHALLENGE_PHASE.UPCOMING);
  });

  it("is active inside the window", () => {
    expect(resolveChallengePhase(challenge({ startH: -1, endH: 1 }), NOW)).toBe(CHALLENGE_PHASE.ACTIVE);
  });

  it("moves to scoring on its own once the window closes", () => {
    // THE REGRESSION THIS GUARDS. `status` was written once at insert and never
    // updated, so a finished challenge stayed 'upcoming' forever and the
    // Completed tab was empty by construction. No cron runs here — the phase is
    // computed, so a closed window reports itself closed.
    const finished = challenge({ startH: -48, endH: -1, status: "upcoming" });
    expect(resolveChallengePhase(finished, NOW)).toBe(CHALLENGE_PHASE.SCORING);
  });

  it("is completed once finalized, whatever the clock says", () => {
    const c = challenge({ startH: -48, endH: -1, finalized_at: new Date(NOW).toISOString() });
    expect(resolveChallengePhase(c, NOW)).toBe(CHALLENGE_PHASE.COMPLETED);
  });

  it("treats a cancellation as final, even mid-window", () => {
    const c = challenge({ startH: -1, endH: 1, cancelled_at: new Date(NOW).toISOString() });
    expect(resolveChallengePhase(c, NOW)).toBe(CHALLENGE_PHASE.CANCELLED);
  });

  it("honours a legacy status='cancelled' row with no cancelled_at", () => {
    const c = challenge({ startH: -1, endH: 1, status: "cancelled" });
    expect(resolveChallengePhase(c, NOW)).toBe(CHALLENGE_PHASE.CANCELLED);
  });

  it("ignores a stale stored status otherwise", () => {
    // A row still claiming 'upcoming' while its window is open is active.
    const c = challenge({ startH: -1, endH: 1, status: "upcoming" });
    expect(resolveChallengePhase(c, NOW)).toBe(CHALLENGE_PHASE.ACTIVE);
  });

  it("prefers cancellation over finalization when both exist", () => {
    const c = challenge({
      startH: -48, endH: -1,
      cancelled_at: new Date(NOW).toISOString(),
      finalized_at: new Date(NOW).toISOString(),
    });
    expect(resolveChallengePhase(c, NOW)).toBe(CHALLENGE_PHASE.CANCELLED);
  });

  it("is inclusive at the boundaries rather than briefly phase-less", () => {
    const c = challenge({ startH: 0, endH: 1 });
    expect(resolveChallengePhase(c, NOW)).toBe(CHALLENGE_PHASE.ACTIVE);
    const ending = challenge({ startH: -1, endH: 0 });
    expect(resolveChallengePhase(ending, NOW)).toBe(CHALLENGE_PHASE.ACTIVE);
  });

  it("degrades to upcoming rather than throwing on a malformed window", () => {
    expect(resolveChallengePhase({ start_time: "nope", end_time: "also nope" }, NOW))
      .toBe(CHALLENGE_PHASE.UPCOMING);
    expect(resolveChallengePhase(null, NOW)).toBe(CHALLENGE_PHASE.UPCOMING);
  });
});

describe("action gates mirror the DB triggers", () => {
  const upcoming = challenge({ startH: 1, endH: 2 });
  const active = challenge({ startH: -1, endH: 1 });
  const scoring = challenge({ startH: -48, endH: -1 });
  const done = challenge({ startH: -48, endH: -1, finalized_at: new Date(NOW).toISOString() });

  it("allows joining before and during, never after", () => {
    expect(canJoinChallenge(upcoming, NOW)).toBe(true);
    expect(canJoinChallenge(active, NOW)).toBe(true);
    expect(canJoinChallenge(scoring, NOW)).toBe(false);
    expect(canJoinChallenge(done, NOW)).toBe(false);
  });

  it("accepts submissions only while running", () => {
    expect(canSubmitToChallenge(upcoming, NOW)).toBe(false);
    expect(canSubmitToChallenge(active, NOW)).toBe(true);
    expect(canSubmitToChallenge(scoring, NOW)).toBe(false);
  });

  it("keeps voting open through the scoring window, closed once finalized", () => {
    expect(canVoteInChallenge(upcoming, NOW)).toBe(false);
    expect(canVoteInChallenge(active, NOW)).toBe(true);
    expect(canVoteInChallenge(scoring, NOW)).toBe(true);
    expect(canVoteInChallenge(done, NOW)).toBe(false);
  });

  it("only allows finalizing after the window and only once", () => {
    expect(canFinalizeChallenge(active, NOW)).toBe(false);
    expect(canFinalizeChallenge(scoring, NOW)).toBe(true);
    expect(canFinalizeChallenge(done, NOW)).toBe(false);
  });
});

describe("challengeScoring is honest about what can be automated", () => {
  it("auto-scores only the two types backed by stored data", () => {
    expect(challengeScoring("breeding_sprint").mode).toBe("auto");
    expect(challengeScoring("care_streak").mode).toBe("auto");
    expect(challengeScoring("breeding_sprint").needsSubmission).toBe(false);
    expect(challengeScoring("care_streak").needsSubmission).toBe(false);
  });

  it("requires an entry for the two that need a human", () => {
    expect(challengeScoring("photo_contest").needsSubmission).toBe(true);
    expect(challengeScoring("photo_contest").needsVote).toBe(true);
    expect(challengeScoring("growout_race").needsSubmission).toBe(true);
    // A grow-out race is measured, not voted on.
    expect(challengeScoring("growout_race").needsVote).toBe(false);
  });

  it("falls back to host-judged for an unknown type instead of returning undefined", () => {
    const s = challengeScoring("some_future_type");
    expect(s.label).toBe("Challenge");
    expect(s.needsSubmission).toBe(true);
    expect(s.howScored).toBeTruthy();
  });

  it("gives every type a score label so the leaderboard is never unitless", () => {
    for (const type of ["breeding_sprint", "care_streak", "photo_contest", "growout_race"]) {
      expect(challengeScoring(type).scoreLabel, type).toBeTruthy();
    }
  });
});
