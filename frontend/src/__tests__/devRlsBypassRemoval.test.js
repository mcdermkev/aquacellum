/**
 * The development RLS bypass policies (§9.34).
 *
 * `002_dev_rls_bypass.sql` created fourteen unconditional policies for MVP testing and
 * said, in its own header, *"⚠️ REMOVE THESE BEFORE PRODUCTION"* — with the exact
 * `DROP POLICY` statements listed. **Those DROPs were never run.** A policy dump taken
 * 2026-07-31 found them live, and every policy on the database PERMISSIVE, which is
 * what makes them not merely permissive but *authoritative*: PostgreSQL ORs permissive
 * policies for the same command, so one `USING (true)` makes every restrictive sibling
 * on that command irrelevant. `dev_comments_delete` does not "also allow" deletes — it
 * means "Users delete own comments" is not enforced at all.
 *
 * The instruction sat in a comment for months and nothing checked it. That is the
 * failure this test exists to prevent repeating: **every policy `002` created must
 * either be dropped by a later migration, or be named in the remediation as a
 * deliberate deferral with a reason.** Silence is no longer an option.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const REPO_ROOT = new URL("../../../", import.meta.url);
const repoPath = (rel) => fileURLToPath(new URL(rel, REPO_ROOT));
const read = (rel) => readFileSync(repoPath(rel), "utf8");

const BYPASS_MIGRATION = "supabase/migrations/002_dev_rls_bypass.sql";
const REMEDIATION = "supabase/migrations/20260731_drop_dev_rls_bypass.sql";

/** Every policy name `002` creates. */
function policiesCreatedByBypass() {
  const sql = read(BYPASS_MIGRATION);
  // Only the CREATE statements — `002`'s header also lists them inside comments.
  const withoutComments = sql.replace(/^\s*--.*$/gm, "");
  return [...withoutComments.matchAll(/CREATE POLICY\s+"([^"]+)"/g)].map((m) => m[1]);
}

/** Every policy name dropped anywhere in `supabase/migrations`. */
function policiesDroppedAnywhere() {
  const dropped = new Set();
  for (const name of readdirSync(repoPath("supabase/migrations"))) {
    if (!name.endsWith(".sql")) continue;
    const sql = read(`supabase/migrations/${name}`).replace(/^\s*--.*$/gm, "");
    for (const m of sql.matchAll(/DROP POLICY(?:\s+IF\s+EXISTS)?\s+"([^"]+)"/gi)) {
      dropped.add(m[1]);
    }
  }
  return dropped;
}

describe("§9.34 — every dev bypass is accounted for", () => {
  const created = policiesCreatedByBypass();

  it("finds the bypass policies to begin with, or this whole file is vacuous", () => {
    // If `002` is ever renamed or its CREATEs restructured, fail loudly rather than
    // silently asserting nothing.
    expect(created.length).toBeGreaterThanOrEqual(14);
    expect(created).toContain("dev_comments_delete");
    expect(created).toContain("dev_profiles_update");
  });

  it("drops each one, or names it as a deliberate deferral WITH a reason", () => {
    const dropped = policiesDroppedAnywhere();
    const remediation = read(REMEDIATION);

    const unaccounted = created.filter(
      (name) => !dropped.has(name) && !remediation.includes(name)
    );

    // The failure message is the point: it lists exactly which bypass is still
    // silently live, which is the information that went missing for months.
    expect(unaccounted, "dev bypass policies neither dropped nor documented").toEqual([]);
  });

  it("gives every deferral an explicit reason, not just a mention", () => {
    const dropped = policiesDroppedAnywhere();
    const remediation = read(REMEDIATION);
    const deferred = created.filter((name) => !dropped.has(name));

    // There ARE deferrals right now and that is fine — the dump was truncated, and
    // the notifications one may be load-bearing for triggers. What is not fine is a
    // deferral without a stated reason.
    expect(deferred.length).toBeGreaterThan(0);
    const sectionC = remediation.slice(remediation.indexOf("SECTION C"));
    expect(sectionC.length).toBeGreaterThan(500);
    for (const name of deferred) {
      expect(sectionC, `${name} deferred without a reason`).toContain(name);
    }
    // And the two reasons that must survive, because both are non-obvious.
    expect(sectionC).toMatch(/SECURITY DEFINER/);
    expect(sectionC).toMatch(/truncated/i);
  });
});

describe("the remediation itself", () => {
  const sql = read(REMEDIATION);

  it("is idempotent, so a partial application can be re-run", () => {
    // Comments stripped first — trap 6.3. This file's own header quotes `002`'s
    // "REMOVE THESE BEFORE PRODUCTION by running: DROP POLICY ..." instruction, so an
    // unstripped scan asserts against the prose rather than the statements.
    const statements = sql.replace(/^\s*--.*$/gm, "");
    const drops = [...statements.matchAll(/DROP POLICY([^;]*);/g)].map((m) => m[1]);
    expect(drops.length).toBeGreaterThan(10);
    for (const drop of drops) {
      expect(drop, `not idempotent: DROP POLICY${drop}`).toMatch(/IF\s+EXISTS/i);
    }
  });

  it("replaces rather than merely removes, where removal would leave a hole", () => {
    // Four tables had a policy whose NAME claimed a restriction its predicate did not
    // implement, so dropping the `dev_` twin alone would have left the real hole.
    for (const policy of [
      "conversations_select_participant",
      "credits_select_own",
      "breeder_profiles_service_role",
      "depth_events_select_own",
    ]) {
      expect(sql, policy).toContain(policy);
    }
  });

  it("closes the hole under the Master Breeder flag (§9.28 at the database layer)", () => {
    // `breeder_profiles."Service role full access profiles"` was {public} with
    // USING (true) / WITH CHECK (true) despite the name, and `is_master_breeder` is
    // the ONLY definition of Master Breeder left after §9.28.
    expect(sql).toContain('DROP POLICY IF EXISTS "Service role full access profiles" ON breeder_profiles');
    expect(sql).toMatch(/breeder_profiles_service_role[\s\S]{0,200}auth\.role\(\) = 'service_role'/);
    // Public READ is intentional and must survive — storefronts depend on it.
    expect(sql).not.toContain('DROP POLICY IF EXISTS "Public read access"');
  });

  it("grants clients no insert path to the credit ledger", () => {
    expect(sql).toContain('DROP POLICY IF EXISTS "Service write credits" ON credit_transactions');
    // service_role bypasses RLS, so the server needs no policy — and giving one to
    // {public} is how a client could mint itself credit.
    expect(sql).not.toMatch(/CREATE POLICY[^;]*ON credit_transactions FOR INSERT/i);
  });

  it("strips the `OR true` that made the credits wallet check decorative", () => {
    expect(sql).toContain('DROP POLICY IF EXISTS "Users read own credits" ON credit_transactions');
    const idx = sql.indexOf("credits_select_own");
    const body = sql.slice(idx, idx + 320);
    expect(body).toContain("wallet_address =");
    expect(body).not.toMatch(/OR\s+true/i);
  });

  it("creates no new unconditional policy — the thing it is fixing", () => {
    for (const block of [...sql.matchAll(/CREATE POLICY[^;]*;/g)].map((m) => m[0])) {
      const withoutComments = block.replace(/^\s*--.*$/gm, "");
      expect(withoutComments, block.slice(0, 80)).not.toMatch(/USING\s*\(\s*true\s*\)/i);
      expect(withoutComments, block.slice(0, 80)).not.toMatch(/WITH\s+CHECK\s*\(\s*true\s*\)/i);
    }
  });

  it("does not drop a policy the CLIENT depends on writing", () => {
    // The whole reason this remediation is split in two. `service_role` bypasses RLS,
    // so a "Service write X" policy is droppable ONLY when the client never writes X.
    // These three are written from the browser today, so dropping them breaks the app
    // and the fix is architectural. Verified against the call sites.
    const serviceWrites = read("supabase/migrations/20260731_close_service_write_bypasses.sql");
    const statements = serviceWrites.replace(/^\s*--.*$/gm, "");
    expect(statements).not.toMatch(/DROP POLICY[^;]*ON user_xp_profiles/);
    expect(statements).not.toMatch(/DROP POLICY[^;]*ON zones/);
    expect(statements).not.toContain('"Service write xp_events"');
    // And each is named with its reason instead.
    const sectionC = serviceWrites.slice(serviceWrites.indexOf("SECTION C"));
    for (const name of ["user_xp_profiles", "zones", "Service write xp_events"]) {
      expect(sectionC, name).toContain(name);
    }
  });

  it("records that xp_server_authority's own comment is contradicted by what shipped", () => {
    // `20260624120000_xp_server_authority.sql` says "No INSERT policy for anon or
    // authenticated — only service_role can insert." A `WITH CHECK (true)` INSERT
    // policy is live AND the client inserts directly. That gap is the finding; losing
    // it would make the deferral look like laziness rather than a real conflict.
    const authority = read("supabase/migrations/20260624120000_xp_server_authority.sql");
    expect(authority).toMatch(/only service_role can insert/i);
    const serviceWrites = read("supabase/migrations/20260731_close_service_write_bypasses.sql");
    expect(serviceWrites).toContain("zoneLeaderboardApi.js:257");
    expect(serviceWrites).toMatch(/disagree/i);
  });

  it("keeps deliberately public reads public — no crying wolf", () => {
    // A `USING (true)` SELECT on genuinely shared data is correct, not a hole. Marking
    // those as findings is how the real ones get ignored.
    const serviceWrites = read("supabase/migrations/20260731_close_service_write_bypasses.sql");
    const statements = serviceWrites.replace(/^\s*--.*$/gm, "");
    expect(statements).not.toContain('"Public read pool_ledger"');
    expect(statements).not.toContain('"Anyone can read profiles"');
    expect(statements).not.toContain('"Public read zones"');
    // The one public read that IS dropped is dropped because scoped siblings exist.
    expect(statements).toContain('DROP POLICY IF EXISTS "Public read xp_events"');
    expect(serviceWrites).toContain("xp_events_select_own_jwt");
  });

  it("leaves the §9.20 header/JWT cutover alone — a different, smaller problem", () => {
    // A spoofable identity is not an absent check. Mixing the two would make this
    // migration un-reviewable and could break every session where the bridge fails.
    expect(sql).not.toMatch(/DROP POLICY[^;]*ON aquadex_/);
    expect(sql).toMatch(/§9\.20/);
  });
});
