/**
 * unwrapEnvelope.js — turn a `{ data, error }` service envelope into a value or a
 * thrown error, for use as a React Query `queryFn`.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * The pattern this replaces is `select: (res) => res.data`. It reads the data out
 * of the envelope and drops `res.error` on the floor. React Query never sees a
 * rejection, so `isError` stays false, nothing retries, nothing logs, and the
 * component renders its ordinary empty state.
 *
 * That is not a theoretical concern — it is how a whole feature broke silently.
 * `getTideAttendees` ordered by a `created_at` column that did not exist, so every
 * request failed with Postgres 42703. With the error discarded, each tide reported
 * "Attendees (0) — No RSVPs yet" while real RSVP rows sat in the table, and the
 * same page simultaneously told the same user "✓ Checked In" from a query that
 * happened not to order by the missing column. A silent catch turned a loud schema
 * error into a plausible-looking empty event, and it stayed that way until someone
 * compared the UI against the database by hand.
 *
 * Throwing means a broken query looks broken.
 *
 * @example
 *   useQuery({
 *     queryKey: ["reef", "tide", id],
 *     queryFn: () => unwrap(getTide(id), "getTide"),
 *   })
 */

/**
 * @param {Promise<{data?: any, error?: any}>} promise - a service call
 * @param {string} label - included in the thrown message so the failing call is
 *   identifiable from a stack-less error string in production logs
 * @returns {Promise<any>} the envelope's `data`
 * @throws {Error} when the envelope carries an error
 */
export async function unwrap(promise, label = "request") {
  const res = await promise;

  // Services aren't perfectly uniform: a few return a bare value rather than an
  // envelope. Anything without an `error` key passes through untouched.
  if (!res || typeof res !== "object" || !("error" in res)) return res ?? null;

  if (res.error) {
    const detail =
      typeof res.error === "string"
        ? res.error
        : res.error.message || res.error.code || JSON.stringify(res.error);

    const err = new Error(`${label}: ${detail}`);
    err.code = res.error?.code;
    err.cause = res.error;
    throw err;
  }

  return res.data ?? null;
}

export default unwrap;
