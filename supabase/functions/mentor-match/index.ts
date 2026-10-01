/**
 * mentor-match Edge Function
 *
 * Mentor matching (Task 53): ranks the available mentors for one keeper and
 * says why, in a sentence each.
 *
 * WHO IS A MENTOR IS NOT DECIDED HERE. The app's server already owns that list
 * (api/storefront-detail.js handleAvailableMentors: an active founder or
 * steward role, and accepting mentees). It calls this with those wallets and
 * the keeper's species, and shows the ranking. This used to pick its own
 * mentors by companion tier (Master / God-Tier), which is exactly what the app
 * says does NOT make someone a mentor ("XP and Depth do not unlock it").
 *
 * Service-role callers only (_shared/callerRole.ts).
 *
 * Expects body:
 * {
 *   wallet_address: string,                         // the keeper asking
 *   mentor_wallets: string[],                       // authoritative list from the caller
 *   species: Array<{ specCode: number, name: string }>, // what the keeper keeps
 *   struggles?: string
 * }
 * Returns { matches: [{ wallet_address, reason, match_score, shared_species }] }, best first.
 *
 * Gemini on Vertex (_shared/vertex.ts), with a heuristic fallback.
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { aiConfigured, generateText, parseJson, tidyGenerated } from "../_shared/vertex.ts";
import { requireServiceRole } from "../_shared/callerRole.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type KeeperSpecies = { specCode: number; name: string };
type Mentor = {
  wallet_address: string;
  display_name: string | null;
  audits_given: number;
  active_mentees: number;
  insight_codes: number[];
  shared: KeeperSpecies[];
};

serve(async (req) => {
  const denied = requireServiceRole(req);
  if (denied) return denied;

  try {
    const body = await req.json();
    const keeper = String(body?.wallet_address || "").toLowerCase();
    const wallets = (Array.isArray(body?.mentor_wallets) ? body.mentor_wallets : [])
      .map((w: unknown) => String(w || "").toLowerCase())
      .filter((w: string) => /^0x[0-9a-f]{40}$/.test(w) && w !== keeper)
      .slice(0, 20);
    const species: KeeperSpecies[] = (Array.isArray(body?.species) ? body.species : [])
      .map((s: any) => ({ specCode: Number(s?.specCode), name: String(s?.name || "").slice(0, 80) }))
      .filter((s: KeeperSpecies) => Number.isFinite(s.specCode) && s.name)
      .slice(0, 20);
    const struggles = typeof body?.struggles === "string" ? body.struggles.slice(0, 300) : "";

    if (!keeper || wallets.length === 0) return json({ matches: [] });

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("wallet_address, display_name")
      .in("wallet_address", wallets)
      .eq("accepting_mentees", true);
    if (!profiles || profiles.length === 0) return json({ matches: [] });

    const keeperCodes = new Set(species.map((s) => s.specCode));
    const mentors: Mentor[] = await Promise.all(
      profiles.map(async (p: any) => {
        const [{ data: insights }, { count: audits }, { count: mentees }] = await Promise.all([
          supabase.from("species_insights").select("spec_code").eq("author_wallet", p.wallet_address).limit(50),
          supabase.from("expert_audits").select("*", { count: "exact", head: true }).eq("auditor_wallet", p.wallet_address),
          supabase.from("mentorships").select("*", { count: "exact", head: true }).eq("mentor_wallet", p.wallet_address).eq("status", "active"),
        ]);
        const codes = [...new Set((insights || []).map((i: any) => Number(i.spec_code)).filter(Number.isFinite))];
        return {
          wallet_address: p.wallet_address,
          display_name: p.display_name,
          audits_given: audits || 0,
          active_mentees: mentees || 0,
          insight_codes: codes,
          shared: species.filter((s) => codes.includes(s.specCode)),
        };
      }),
    );

    const ranked = aiConfigured() && species.length > 0 && mentors.length > 1
      ? await aiRank(mentors, species, struggles)
      : null;
    const matches = (ranked || heuristicRank(mentors)).slice(0, 3);
    return json({ matches, source: ranked ? "ai" : "heuristic", keeperSpecies: keeperCodes.size });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function factReason(m: Mentor): string {
  if (m.shared.length > 0) {
    return `Has written about ${m.shared.slice(0, 2).map((s) => s.name).join(" and ")}, which you keep.`;
  }
  if (m.audits_given > 0) return `Has given ${plural(m.audits_given, "expert audit", "expert audits")}.`;
  return m.active_mentees === 0 ? "Has room for a new mentee." : "Available as a mentor.";
}

/** Species overlap first, then experience, then availability. */
function heuristicRank(mentors: Mentor[]) {
  return mentors
    .map((m) => ({
      m,
      score: m.shared.length * 30 + Math.min(m.audits_given * 5, 25) - m.active_mentees * 10,
    }))
    .sort((a, b) => b.score - a.score)
    .map(({ m }, rank) => ({
      wallet_address: m.wallet_address,
      reason: factReason(m),
      match_score: Math.max(10, 100 - rank * 10),
      shared_species: m.shared.map((s) => s.name),
    }));
}

/**
 * The model picks from a numbered list; the pick is a string enum, not a free
 * number, so it cannot name a mentor who is not on the list.
 */
async function aiRank(mentors: Mentor[], species: KeeperSpecies[], struggles: string) {
  const shortlist = mentors.slice(0, 10);
  const list = shortlist.map((m, i) => {
    const shared = m.shared.length ? `writes about ${m.shared.map((s) => s.name).join(", ")}` : "no shared species";
    return `${i + 1}. ${shared}; expert audits given: ${m.audits_given}; current mentees: ${m.active_mentees}`;
  }).join("\n");

  const prompt = `You are Echo, the fish guide in an aquarium community, suggesting mentors for a keeper.
The keeper keeps: ${species.map((s) => s.name).join(", ")}.${struggles ? ` They want help with: "${struggles}"` : ""}

Mentors (by number):
${list}

Pick up to 3, best first. For each give its number and one short plain sentence on why, using only the facts listed. Speak to the keeper ("you"). Do not use names. No exclamation points, no em dashes.`;

  const schema = {
    type: "array",
    items: {
      type: "object",
      properties: {
        pick: { type: "string", enum: shortlist.map((_, i) => String(i + 1)) },
        reason: { type: "string" },
      },
      required: ["pick", "reason"],
    },
  };

  const res = await generateText(prompt, { schema, maxOutputTokens: 300, temperature: 0.2 });
  const picks = parseJson<Array<{ pick: string; reason: string }>>(res.text);
  if (!Array.isArray(picks) || picks.length === 0) return null;

  const seen = new Set<number>();
  const out = [];
  for (const r of picks) {
    const i = Number(r?.pick) - 1;
    const m = shortlist[i];
    if (!m || seen.has(i)) continue;
    seen.add(i);
    out.push({
      wallet_address: m.wallet_address,
      reason: tidyGenerated(r.reason) || factReason(m),
      // Rank order from the model, not a score it computed.
      match_score: 100 - out.length * 10,
      shared_species: m.shared.map((s) => s.name),
    });
  }
  return out.length ? out : null;
}
