/**
 * verify-curation-contract.mjs
 *
 * Verifies the field contract along the whole chain: the
 * `species_suggestion_queue` VIEW -> `GET /api/species?action=queue` -> the exact
 * property names BreedersCouncil.jsx reads.
 *
 * Worth asserting explicitly because a rename anywhere in that chain surfaces as
 * an `undefined` in the UI rather than an error — the tally would silently render
 * blank and the "needs a founder's approval" line would quietly lie. Postgres
 * gives snake_case, the component reads snake_case, and nothing in between
 * transforms it; this is what keeps that true.
 *
 * Also exercises a real founder vote through `cast_species_vote_as` (the same
 * function the endpoint calls) and confirms the status flip is visible through
 * the API, not just in the database.
 *
 * Runs against PRODUCTION with the service key and is self-cleaning: it deletes
 * the transient suggestion it creates, and asserts the deletion. It never
 * promotes, so it makes no on-chain write.
 *
 * Usage, from the frontend/ directory:
 *   node ops/verify-curation-contract.mjs
 *
 * Exits 0 when every check passes, 1 otherwise.
 */
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync("./.env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});
const { default: handler } = await import("../api/species.js");

let fails = 0;
const check = (name, cond, detail) => {
  if (!cond) fails++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  -> " + JSON.stringify(detail)}`);
};

async function queueViaApi() {
  const res = {
    statusCode: null, body: null, headers: {},
    setHeader() { return this; }, status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }, end() { return this; },
  };
  await handler(
    { method: "GET", query: { action: "queue" }, headers: {}, socket: { remoteAddress: "127.0.0.1" } },
    res
  );
  return res.body;
}

const KEVIN = "0x4a85f15309b3fa80f770be53414f9858945ca6d3";
let id = null;

try {
  const { data: inserted, error } = await supabase
    .from("species_suggestions")
    .insert({
      submitted_by: "0x0000000000000000000000000000000000000cafe",
      scientific_name: "ZZcontract transient",
      common_name: "Contract Probe",
      care_level: 2,
      min_temp_c: 23.5, max_temp_c: 27.5, min_ph: 6.2, max_ph: 7.4,
      fishbase_match: "none",
      notes: "transient contract-test row",
    })
    .select()
    .single();
  if (error) throw new Error("insert failed: " + error.message);
  id = inserted.id;

  const before = await queueViaApi();
  const row = (before?.suggestions || []).find((s) => s.id === id);
  check("the new suggestion surfaces through ?action=queue", !!row, before);

  if (row) {
    // Exactly the properties BreedersCouncil.jsx and requirementLabel() read.
    for (const f of [
      "id", "status", "scientific_name", "common_name", "care_level",
      "min_temp_c", "max_temp_c", "min_ph", "max_ph",
      "fishbase_match", "notes", "proof_url",
      "approve_votes", "reject_votes", "founder_approved",
      "required_approvals", "approvals_remaining",
      // Added by 20260816130000. The UI gates the Publish button on
      // needs_care_profile; gating on fishbase_match left a species permanently
      // un-publishable once approved, because that column is a submit-time
      // snapshot that never clears.
      "has_published_profile", "needs_care_profile",
    ]) {
      check(`  field present: ${f}`, row[f] !== undefined, Object.keys(row));
    }
    check("  status starts pending", row.status === "pending", row.status);
    check("  approvals_remaining is 1 with no votes", Number(row.approvals_remaining) === 1, row.approvals_remaining);
    check("  founder_approved is false with no votes", row.founder_approved === false, row.founder_approved);
    check("  fishbase_match survives as 'none'", row.fishbase_match === "none", row.fishbase_match);
  }

  // A real founder approve, through the same function the endpoint calls.
  const { error: voteErr } = await supabase.rpc("cast_species_vote_as", {
    p_wallet: KEVIN, p_suggestion_id: id, p_vote: "approve", p_note: "",
  });
  check("founder vote via cast_species_vote_as succeeds", !voteErr, voteErr?.message);

  const after = await queueViaApi();
  const row2 = (after?.suggestions || []).find((s) => s.id === id);
  check("status flips to approved through the API", row2?.status === "approved", row2?.status);
  check("approve_votes is 1", Number(row2?.approve_votes) === 1, row2?.approve_votes);
  check("founder_approved is true", row2?.founder_approved === true, row2?.founder_approved);
  check("approvals_remaining is 0", Number(row2?.approvals_remaining) === 0, row2?.approvals_remaining);

  // The UI must NOT offer Publish for a 'none' match with no authored profile —
  // the case a genuinely new species (not one of the 33 already in the reference
  // file) falls into.
  check(
    "a 'none' match is approved but flagged as needing a care profile",
    row2?.status === "approved" && row2?.needs_care_profile === true,
    { status: row2?.status, needsProfile: row2?.needs_care_profile }
  );
  check(
    "and reports no published profile yet",
    row2?.has_published_profile === false,
    row2?.has_published_profile
  );
} finally {
  if (id) {
    await supabase.from("species_suggestions").delete().eq("id", id);
    const { count } = await supabase
      .from("species_suggestions")
      .select("id", { count: "exact" })
      .eq("id", id);
    check("transient row cleaned up", (count || 0) === 0, count);
  }
}

console.log(`\n${fails === 0 ? "ALL CONTRACT CHECKS PASSED" : fails + " CHECK(S) FAILED"}`);
process.exit(fails === 0 ? 0 : 1);
