/**
 * challenges.js — school challenge phase and scoring vocabulary.
 *
 * THE PHASE IS DERIVED, NOT STORED.
 *
 * `school_challenges.status` was written once at insert and never updated by
 * anything: `updateChallenge()` existed but no caller ever invoked it, so every
 * challenge stayed 'upcoming' forever and the Completed filter in ChallengesTab
 * was empty by construction.
 *
 * The fix is not a cron job that flips the column on a schedule. Tides already
 * shows where that leads — nothing reconciles `tides.status` against `end_time`,
 * so a tide can sit LIVE indefinitely after it has finished. A stored status that
 * nothing advances is a lie waiting to happen.
 *
 * Instead the phase is a pure function of the timestamps, computed on read, so it
 * cannot drift. The only transitions actually persisted are the two a human
 * causes: cancelling, and finalizing results.
 *
 * This mirrors school_challenge_phase(school_challenges) in
 * supabase/migrations/20260817160000_school_challenge_lifecycle.sql. The SQL copy
 * guards writes; this one drives the UI. Keep them in step.
 */

/** @typedef {'upcoming'|'active'|'scoring'|'completed'|'cancelled'} ChallengePhase */

export const CHALLENGE_PHASE = Object.freeze({
  UPCOMING: "upcoming",
  ACTIVE: "active",
  /** Window closed, waiting on a founder/elder to lock in results. */
  SCORING: "scoring",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
});

/**
 * Resolve a challenge's current phase.
 *
 * @param {object} challenge
 * @param {Date|number} [now] - injectable for tests
 * @returns {ChallengePhase}
 */
export function resolveChallengePhase(challenge, now = Date.now()) {
  if (!challenge) return CHALLENGE_PHASE.UPCOMING;

  // Explicit human decisions win over any clock comparison.
  if (challenge.cancelled_at) return CHALLENGE_PHASE.CANCELLED;
  if (challenge.finalized_at) return CHALLENGE_PHASE.COMPLETED;

  // Legacy rows: `status` was the old stored field. Honour a cancellation
  // recorded that way, since those rows predate cancelled_at.
  if (challenge.status === "cancelled") return CHALLENGE_PHASE.CANCELLED;

  const t = now instanceof Date ? now.getTime() : now;
  const start = new Date(challenge.start_time).getTime();
  const end = new Date(challenge.end_time).getTime();

  // An unparseable window shouldn't crash a list. Treat it as upcoming.
  if (!Number.isFinite(start) || !Number.isFinite(end)) return CHALLENGE_PHASE.UPCOMING;

  if (t < start) return CHALLENGE_PHASE.UPCOMING;
  if (t <= end) return CHALLENGE_PHASE.ACTIVE;
  return CHALLENGE_PHASE.SCORING;
}

/**
 * How each challenge type is scored, and therefore what the UI must ask for.
 *
 * These are not interchangeable, and the app doesn't pretend they are. Two can be
 * scored from data the database already holds; two cannot, and require a human.
 * Claiming to auto-score "best tank photo" would just mean picking an arbitrary
 * winner.
 */
export const CHALLENGE_SCORING = Object.freeze({
  breeding_sprint: {
    mode: "auto",
    label: "Breeding Sprint",
    emoji: "🧬",
    /** Counted from aquadex_spawns (owner, species and timestamp are all stored). */
    scoreLabel: "spawns logged",
    howScored: "Counted automatically from the spawns you log during the window.",
    needsSubmission: false,
    needsVote: false,
  },
  care_streak: {
    mode: "auto",
    label: "Care Streak",
    emoji: "🔥",
    /** Longest consecutive-day run in aquadex_action_logs. */
    scoreLabel: "day streak",
    howScored: "Your longest run of consecutive days with a logged care action.",
    needsSubmission: false,
    needsVote: false,
  },
  photo_contest: {
    mode: "vote",
    label: "Photo Contest",
    emoji: "📷",
    scoreLabel: "votes",
    howScored: "Members vote on entries. One vote each, and you can't vote for your own.",
    needsSubmission: true,
    needsVote: true,
  },
  growout_race: {
    mode: "declared",
    label: "Grow-Out Race",
    emoji: "📈",
    scoreLabel: "measurement",
    howScored: "Enter your measurement with a photo. The host confirms results at the end.",
    needsSubmission: true,
    needsVote: false,
  },
});

/** Scoring descriptor for a challenge, with a safe fallback for unknown types. */
export function challengeScoring(challengeType) {
  return (
    CHALLENGE_SCORING[challengeType] || {
      mode: "declared",
      label: "Challenge",
      emoji: "🏆",
      scoreLabel: "score",
      howScored: "The host scores this challenge at the end.",
      needsSubmission: true,
      needsVote: false,
    }
  );
}

/** Human label for a phase, for badges. */
export function challengePhaseLabel(phase) {
  switch (phase) {
    case CHALLENGE_PHASE.UPCOMING: return "Upcoming";
    case CHALLENGE_PHASE.ACTIVE: return "Running";
    case CHALLENGE_PHASE.SCORING: return "Awaiting results";
    case CHALLENGE_PHASE.COMPLETED: return "Completed";
    case CHALLENGE_PHASE.CANCELLED: return "Cancelled";
    default: return "Challenge";
  }
}

/**
 * Can this member still enter?
 *
 * Joining and submitting both close when the window does — you cannot enter a
 * contest that has already finished and expect to be scored in it. Enforced by
 * the enforce_challenge_participation trigger; this mirrors it so the UI can
 * disable the button instead of surfacing a constraint error.
 */
export function canJoinChallenge(challenge, now = Date.now()) {
  const phase = resolveChallengePhase(challenge, now);
  return phase === CHALLENGE_PHASE.UPCOMING || phase === CHALLENGE_PHASE.ACTIVE;
}

/** Submissions are accepted only while the challenge is actually running. */
export function canSubmitToChallenge(challenge, now = Date.now()) {
  return resolveChallengePhase(challenge, now) === CHALLENGE_PHASE.ACTIVE;
}

/** Voting runs from the start until results are locked in. */
export function canVoteInChallenge(challenge, now = Date.now()) {
  const phase = resolveChallengePhase(challenge, now);
  return phase === CHALLENGE_PHASE.ACTIVE || phase === CHALLENGE_PHASE.SCORING;
}

/** Results can only be locked in once the window has closed. */
export function canFinalizeChallenge(challenge, now = Date.now()) {
  return resolveChallengePhase(challenge, now) === CHALLENGE_PHASE.SCORING;
}
