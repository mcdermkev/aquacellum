/**
 * mentorRanking.js — the pure half of mentor suggestions.
 *
 * api/storefront-detail.js handleAvailableMentors decides who is a mentor
 * (an active founder or steward role, accepting mentees). When the keeper says
 * what they keep, it asks the mentor-match edge function to rank that list and
 * explain each pick, then merges the answer back with these helpers. Pure so
 * it can be tested without a Supabase client.
 */

/**
 * `?species=[{"c":2,"n":"Neon Tetra"}]` from the mentorship panel: catalog
 * codes and names of what the keeper keeps. It only labels a prompt and
 * orders a list, so a bad value just means no suggestions.
 *
 * @returns {Array<{ specCode: number, name: string }>}
 */
export function parseMentorSpecies(raw) {
  if (typeof raw !== "string" || !raw || raw.length > 4000) return [];
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const out = [];
    for (const s of list) {
      const specCode = Number(s?.c);
      const name = typeof s?.n === "string" ? s.n.replace(/[\r\n]+/g, " ").trim().slice(0, 80) : "";
      if (!Number.isInteger(specCode) || specCode <= 0 || !name || seen.has(specCode)) continue;
      seen.add(specCode);
      out.push({ specCode, name });
      if (out.length >= 20) break;
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Ranked mentors first, with Echo's reason; everyone else after, in the order
 * they came. A ranking can only reorder and annotate: a wallet that is not in
 * `mentors` is ignored.
 */
export function mergeMentorRanking(mentors, ranked) {
  const list = Array.isArray(mentors) ? mentors : [];
  const byWallet = new Map(
    (Array.isArray(ranked) ? ranked : []).map((r, i) => [String(r?.wallet_address || "").toLowerCase(), { ...r, rank: i }]),
  );
  const annotated = list.map((m) => {
    const r = byWallet.get(String(m?.wallet_address || "").toLowerCase());
    if (!r) return m;
    return {
      ...m,
      match_reason: typeof r.reason === "string" ? r.reason.slice(0, 240) : null,
      shared_species: Array.isArray(r.shared_species) ? r.shared_species.filter((s) => typeof s === "string").slice(0, 5) : [],
      match_rank: r.rank,
    };
  });
  return [
    ...annotated.filter((m) => m.match_rank != null).sort((a, b) => a.match_rank - b.match_rank),
    ...annotated.filter((m) => m.match_rank == null),
  ];
}
