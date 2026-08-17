/**
 * species_suggestions_invariant.test.mjs
 *
 * Proves the approval invariant in docs/SPECIES_SUGGESTION_APPROVAL_SPEC.md §3
 * against a REAL Postgres (PGlite is Postgres compiled to WASM, so plpgsql,
 * triggers, and RLS all behave as they do in Supabase).
 *
 *   approved  ⟺  approve_votes >= species_required_approvals()
 *                 AND at least one approve vote is from an active 'founder'
 *
 * The cases worth keeping honest are the ones a reviewer cannot eyeball:
 * a curator alone never approves at ANY threshold, two curators reach the count
 * but not the founder clause, revoking a founder role un-approves retroactively,
 * and the mixed-case wallet hazard does not silently drop a founder's authority.
 *
 * HOW TO RUN. PGlite is deliberately NOT a project dependency — a 30MB WASM
 * Postgres has no business in the frontend install for one migration test — so
 * install it out-of-tree and point PGLITE_PATH at it:
 *
 *   mkdir %TEMP%\pglite-verify && cd %TEMP%\pglite-verify
 *   npm init -y && npm install @electric-sql/pglite
 *   set PGLITE_PATH=%TEMP%\pglite-verify\node_modules\@electric-sql\pglite\dist\index.js
 *   node <repo>\supabase\tests\species_suggestions_invariant.test.mjs
 *
 * (NODE_PATH does not help here: ESM resolution ignores it.)
 * Exits 0 when every check passes, 1 otherwise.
 */

import { readFileSync } from "fs";
import { fileURLToPath, pathToFileURL } from "url";
import { dirname, join } from "path";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATION =
  process.env.MIGRATION_PATH ||
  join(here, "..", "migrations", "20260816120000_species_suggestions.sql");

const { PGlite } = await import(
  process.env.PGLITE_PATH
    ? pathToFileURL(process.env.PGLITE_PATH).href
    : "@electric-sql/pglite"
);

const db = await PGlite.create();
let failures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}  got ${JSON.stringify(actual)}`);
}

// ── Stub the pieces of the real database this migration depends on ──────────
await db.exec(`
  CREATE ROLE anon;
  CREATE ROLE authenticated;
  CREATE ROLE service_role;

  CREATE TABLE profiles (
    wallet_address TEXT PRIMARY KEY,
    email TEXT
  );

  -- mirrors supabase/migrations/20260808_keeper_roles.sql
  CREATE TABLE user_roles (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_address TEXT NOT NULL REFERENCES profiles(wallet_address) ON DELETE CASCADE,
    role           TEXT NOT NULL,
    granted_by     TEXT,
    granted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    active         BOOLEAN NOT NULL DEFAULT true,
    note           TEXT,
    UNIQUE (wallet_address, role)
  );

`);

// NOTE: no auth.jwt() stub is created. The migration must not depend on the
// Supabase JWT at all — if a later revision reintroduces an
// auth.jwt()->>'wallet_address' predicate, applying it here fails loudly instead
// of quietly reopening the spoofable-identity path (spec §8).

// ── Apply the migration under test ──────────────────────────────────────────
try {
  await db.exec(readFileSync(MIGRATION, "utf8"));
  console.log("PASS  migration applies cleanly\n");
} catch (e) {
  console.log("FAIL  migration failed to apply:\n" + e.message);
  process.exit(1);
}

const KEVIN   = "0xkevin000000000000000000000000000000000001";
const STEVE   = "0xsteve000000000000000000000000000000000002";
const CURATOR = "0xcurator00000000000000000000000000000000003";
const HOBBY   = "0xhobby000000000000000000000000000000000004";

// Kevin's profile is stored MIXED CASE, and user_roles has an FK to profiles so
// his role row carries the same mixed casing. Meanwhile the auth bridge
// (api/mint-session.js) always lowercases the wallet_address claim. That is the
// exact real-world hazard from 20260630120000_normalize_wallet_casing.sql, and it
// is why every predicate in the migration compares with lower() — the existing
// services/rolesApi.js getUserRoles does a bare .eq() on a lowercased wallet and
// would find nothing for this row.
const KEVIN_STORED = "0xKEVIN000000000000000000000000000000000001";

await db.exec(`
  INSERT INTO profiles (wallet_address, email) VALUES
    ('${KEVIN_STORED}', 'mcdermkev81@gmail.com'),
    ('${STEVE}',        'ggsteve92@gmail.com'),
    ('${CURATOR}',      'curator@example.com'),
    ('${HOBBY}',        'hobbyist@example.com');

  INSERT INTO user_roles (wallet_address, role) VALUES
    ('${KEVIN_STORED}', 'founder'),
    ('${STEVE}',        'founder'),
    ('${CURATOR}',      'curator');
`);

async function newSuggestion(name) {
  const r = await db.query(
    `INSERT INTO species_suggestions
       (submitted_by, scientific_name, common_name, care_level,
        min_temp_c, max_temp_c, min_ph, max_ph, fishbase_match, spec_code)
     VALUES ($1,$2,$3,1, 22,28, 6.5,7.5, 'json_only', 70002)
     RETURNING id`,
    [HOBBY, name, name.split(" ")[1]]
  );
  return r.rows[0].id;
}

async function statusOf(id) {
  const r = await db.query(`SELECT status FROM species_suggestions WHERE id = $1`, [id]);
  return r.rows[0].status;
}

// Mirrors what POST /api/species?action=vote does after it has verified the
// Privy token: pass the verified wallet explicitly. Nothing here reads the
// Supabase JWT, because that claim is spoofable until mint-session is hardened.
async function vote(wallet, id, v) {
  try {
    await db.query(`SELECT cast_species_vote_as($1, $2, $3)`, [wallet, id, v]);
    return null;
  } catch (e) {
    return e.message;
  }
}

console.log("── §3 approval invariant, required_approvals = 1 ──");

let id = await newSuggestion("Hemigrammus rhodostomus");
check("new suggestion starts pending", await statusOf(id), "pending");

// The headline rule: a curator alone must NEVER approve.
let err = await vote(CURATOR, id, "approve");
check("curator vote accepted (no error)", err, null);
check("curator alone does NOT approve", await statusOf(id), "pending");

// One founder lands it today.
id = await newSuggestion("Iriatherina werneri");
await vote(KEVIN, id, "approve");
check("one founder approves (required=1)", await statusOf(id), "approved");

// Founder identity must survive mixed-case storage.
let q = await db.query(
  `SELECT founder_approved, approve_votes FROM species_suggestion_queue WHERE id = $1`, [id]);
check("founder detected despite MIXED-CASE user_roles row",
  [q.rows[0].founder_approved, Number(q.rows[0].approve_votes)], [true, 1]);

// Non-role holder cannot vote at all.
id = await newSuggestion("Biotodoma cupido");
err = await vote(HOBBY, id, "approve");
check("hobbyist vote rejected", err !== null && /no species curation role/.test(err), true);
check("hobbyist vote left status pending", await statusOf(id), "pending");

// Only a founder's reject rejects.
id = await newSuggestion("Osteoglossum bicirrhosum");
await vote(CURATOR, id, "reject");
check("curator reject does NOT veto", await statusOf(id), "pending");
await vote(KEVIN, id, "reject");
check("founder reject rejects", await statusOf(id), "rejected");
err = await vote(STEVE, id, "approve");
check("cannot vote on a rejected suggestion", err !== null && /already rejected/.test(err), true);

// Revoking the role must un-approve anything that depended on it.
id = await newSuggestion("Chilatherina axelrodi");
await vote(STEVE, id, "approve");
check("founder approval lands", await statusOf(id), "approved");
await db.exec(`UPDATE user_roles SET active = false WHERE lower(wallet_address) = '${STEVE}' AND role='founder';`);
await db.query(`SELECT species_recompute_suggestion_status($1)`, [id]);
check("revoking the founder role un-approves", await statusOf(id), "pending");
await db.exec(`UPDATE user_roles SET active = true WHERE lower(wallet_address) = '${STEVE}' AND role='founder';`);

// Changing your own vote does not double-count.
id = await newSuggestion("Rasbora trilineata");
await vote(CURATOR, id, "approve");
await vote(CURATOR, id, "approve");
q = await db.query(`SELECT approve_votes FROM species_suggestion_queue WHERE id = $1`, [id]);
check("re-voting does not double-count", Number(q.rows[0].approve_votes), 1);

console.log("\n── §3 with required_approvals = 2 (the later model) ──");
await db.exec(`CREATE OR REPLACE FUNCTION species_required_approvals()
               RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$ SELECT 2 $$;`);

id = await newSuggestion("Leporinus vanzoi");
await vote(KEVIN, id, "approve");
check("1 founder is NOT enough at required=2", await statusOf(id), "pending");
await vote(CURATOR, id, "approve");
check("curator + founder approves", await statusOf(id), "approved");

id = await newSuggestion("Brochis agassizii");
await vote(CURATOR, id, "approve");
check("curator alone still pending at required=2", await statusOf(id), "pending");
// Give the curator a second non-founder ally to prove count alone never suffices.
await db.exec(`INSERT INTO profiles (wallet_address) VALUES ('0xcur2');
               INSERT INTO user_roles (wallet_address, role) VALUES ('0xcur2','curator');`);
// eslint-disable-next-line no-unused-vars
await vote("0xcur2", id, "approve");
q = await db.query(`SELECT approve_votes, founder_approved FROM species_suggestion_queue WHERE id=$1`, [id]);
check("two curators reach the COUNT but not the founder clause",
  [Number(q.rows[0].approve_votes), q.rows[0].founder_approved], [2, false]);
check("two curators still do NOT approve", await statusOf(id), "pending");

await db.exec(`CREATE OR REPLACE FUNCTION species_required_approvals()
               RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$ SELECT 1 $$;`);

console.log("\n── §8 RLS shape ──");
const pol = await db.query(
  `SELECT tablename, cmd, count(*)::int n FROM pg_policies
    WHERE tablename IN ('species_suggestions','species_suggestion_votes','species_profiles','species_id_map')
    GROUP BY 1,2 ORDER BY 1,2`);
const shape = pol.rows.map(r => `${r.tablename}:${r.cmd}`).sort();
// Every table is read-only to clients: all writes go through api/species.js with
// the service key, because each needs either the fishbase cross-check or a
// Privy-verified identity.
check("all four tables are client-READ-ONLY (no INSERT/UPDATE/DELETE policy)",
  shape,
  [
    "species_id_map:SELECT",
    "species_profiles:SELECT",
    "species_suggestion_votes:SELECT",
    "species_suggestions:SELECT",
  ]);

const grant = await db.query(
  `SELECT has_function_privilege('authenticated',
            'cast_species_vote_as(text,uuid,text,text)', 'EXECUTE') AS can`);
check("a logged-in client CANNOT execute the vote function", grant.rows[0].can, false);

const svc = await db.query(
  `SELECT has_function_privilege('service_role',
            'cast_species_vote_as(text,uuid,text,text)', 'EXECUTE') AS can`);
check("service_role CAN execute the vote function", svc.rows[0].can, true);

const rls = await db.query(
  `SELECT relname, relrowsecurity FROM pg_class
    WHERE relname IN ('species_suggestions','species_suggestion_votes','species_profiles','species_id_map')
    ORDER BY relname`);
check("RLS enabled on all four tables", rls.rows.every(r => r.relrowsecurity), true);

console.log("\n── misc guards ──");
const dupe = await db.query(
  `SELECT count(*)::int n FROM pg_indexes WHERE indexname='species_suggestions_live_name_uniq'`);
check("live-name dedupe index exists", dupe.rows[0].n, 1);

// A crafted insert must not arrive pre-approved.
const crafted = await db.query(
  `INSERT INTO species_suggestions
     (submitted_by, scientific_name, common_name, min_temp_c, max_temp_c, min_ph, max_ph,
      status, onchain_species_id, promoted_at)
   VALUES ('${HOBBY}','Crafted attempt','Crafted',22,28,6.5,7.5,'promoted',999,now())
   RETURNING status, onchain_species_id, promoted_at`);
check("insert trigger forces pending and nulls promotion fields",
  [crafted.rows[0].status, crafted.rows[0].onchain_species_id, crafted.rows[0].promoted_at],
  ["pending", null, null]);

// Range checks.
let rangeErr = null;
try {
  await db.query(`INSERT INTO species_suggestions
    (submitted_by, scientific_name, common_name, min_temp_c, max_temp_c, min_ph, max_ph)
    VALUES ('${HOBBY}','Bad range','Bad',30,22,6.5,7.5)`);
} catch (e) { rangeErr = e.message; }
check("min_temp >= max_temp rejected", rangeErr !== null, true);

const seq = await db.query(`SELECT nextval('species_local_spec_code_seq')::int v`);
check("local spec_code sequence starts above the legacy 7xxxx-9xxxx band",
  seq.rows[0].v >= 100000, true);

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
