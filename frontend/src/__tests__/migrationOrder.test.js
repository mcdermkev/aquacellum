/**
 * The two migration directories, reconciled (docs/BREEDER_STATE_MODEL.md §9.33).
 *
 * THE PROBLEM THIS CLOSES. There are two migration directories, neither is a Supabase
 * CLI root (no `config.toml` in either, so these are hand-applied SQL files), and date
 * prefixes OVERLAP across them — `20260729` appears in both. So "apply in filename
 * order" is ambiguous and no tool resolves it. Worse, nothing made a reader aware the
 * second directory existed: §9.5 reported six migrations missing when all six sat in
 * the root directory, which had never been inspected. That cost real time.
 *
 * `supabase/migration-order.json` is the reconciliation. This test is what keeps it
 * true, and that is the whole point — a manifest nobody verifies is a comment. A
 * migration added to either directory and left out of the manifest **fails the build**
 * rather than being silently absent from a fresh-environment bootstrap.
 *
 * The directories were deliberately NOT merged. The filename is the identity of an
 * applied migration and every one of these is already applied in production, so moving
 * them would make the repo disagree with the record of what was applied — §6.6's
 * reasoning, which is why widening a CHECK needed a new file instead of an edit.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const REPO_ROOT = new URL("../../../", import.meta.url);

function repoPath(relative) {
  return fileURLToPath(new URL(relative, REPO_ROOT));
}

const manifest = JSON.parse(readFileSync(repoPath("supabase/migration-order.json"), "utf8"));

/** Every `.sql` on disk, as `<dir>/<file>`, across both directories. */
function migrationsOnDisk() {
  const found = [];
  for (const dir of Object.keys(manifest.directories)) {
    for (const name of readdirSync(repoPath(dir))) {
      if (name.endsWith(".sql")) found.push(`${dir}/${name}`);
    }
  }
  return found;
}

describe("the manifest covers both directories", () => {
  it("names every directory that actually holds migrations", () => {
    // Two, and the count is asserted so a third appearing is a decision someone has
    // to make rather than a directory that quietly goes unread.
    expect(Object.keys(manifest.directories).sort()).toEqual([
      "frontend/supabase/migrations",
      "supabase/migrations",
    ]);
    for (const description of Object.values(manifest.directories)) {
      expect(description.length).toBeGreaterThan(20);
    }
  });

  it("lists EVERY migration on disk — this is the guard that replaces remembering", () => {
    // STRICT IN ONE DIRECTION, AND DELIBERATELY SO.
    //
    // A migration that EXISTS but is not listed is exactly the §9.5 failure: a file
    // nobody knows to apply or inspect. That must fail.
    //
    // A migration LISTED but not yet on disk is a forward declaration, and it is
    // harmless — the manifest is documentation of intended order, and an entry for a
    // file arriving in another branch costs nothing. It is also currently real: the
    // in-flight listings RLS work holds `20260729_aquadex_listings_rls_lockdown.sql`
    // uncommitted, and entangling that unrelated change into this one to satisfy a
    // symmetric assertion would be the worse trade.
    const onDisk = migrationsOnDisk();
    const listed = new Set(manifest.order);

    const missingFromManifest = onDisk.filter((f) => !listed.has(f));
    expect(missingFromManifest, "on disk but not in migration-order.json").toEqual([]);
  });

  it("keeps forward declarations to files this repo genuinely expects", () => {
    // The tolerance above must not become a place stale entries accumulate. Anything
    // listed but absent has to look like a migration and live in a known directory,
    // so a typo is still caught.
    const onDisk = new Set(migrationsOnDisk());
    const forwardDeclared = manifest.order.filter((f) => !onDisk.has(f));
    for (const entry of forwardDeclared) {
      const dir = entry.slice(0, entry.lastIndexOf("/"));
      expect(Object.keys(manifest.directories), entry).toContain(dir);
      expect(entry, entry).toMatch(/\.sql$/);
    }
    // A sanity ceiling: if this ever grows, the manifest has drifted from the repo
    // rather than run slightly ahead of one branch.
    expect(forwardDeclared.length).toBeLessThanOrEqual(2);
  });

  it("lists each migration exactly once", () => {
    expect(new Set(manifest.order).size).toBe(manifest.order.length);
  });

  it("has no duplicate BASENAME across the two directories", () => {
    // The one thing that would make a future merge lossy, and the reason a filename
    // alone is not a safe way to refer to a migration today.
    const basenames = manifest.order.map((p) => p.split("/").pop());
    const duplicates = basenames.filter((b, i) => basenames.indexOf(b) !== i);
    expect(duplicates).toEqual([]);
  });
});

describe("the manifest is an ORDER, not just a set", () => {
  it("keeps the numbered bootstrap schema first and in sequence", () => {
    // 001–012 build the base schema; anything applied before them fails on a missing
    // table rather than on a policy, which is a confusing way to discover the order.
    const numbered = manifest.order.filter((p) => /\/\d{3}_/.test(p));
    expect(numbered.length).toBeGreaterThan(0);
    expect(manifest.order.slice(0, numbered.length)).toEqual(numbered);
    const indices = numbered.map((p) => Number(p.match(/\/(\d{3})_/)[1]));
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });

  it("orders the date-prefixed migrations by date, so the sequence is checkable", () => {
    // Within a single date the order is a judgement call and is left to the manifest.
    // ACROSS dates it must be monotonic, otherwise the file is not an order at all.
    const dates = manifest.order
      .map((p) => p.split("/").pop().match(/^(\d{8})/))
      .filter(Boolean)
      .map((m) => Number(m[1]));
    expect(dates.length).toBeGreaterThan(20);
    expect(dates).toEqual([...dates].sort((a, b) => a - b));
  });

  it("puts the listings public view before the lockdown that depends on it", () => {
    // A concrete dependency, pinned because getting it backwards locks the table
    // before the view anon reads through exists — §11.3.
    const view = manifest.order.indexOf("supabase/migrations/20260728_aquadex_listings_public_view.sql");
    const lockdown = manifest.order.indexOf("supabase/migrations/20260729_aquadex_listings_rls_lockdown.sql");
    expect(view).toBeGreaterThanOrEqual(0);
    expect(lockdown).toBeGreaterThan(view);
  });

  it("puts the grow-out mirror before the amendment that widens its CHECK", () => {
    // §6.6: the `promoted` type needed a NEW file because the parent was already
    // applied. Applying the amendment first would fail on a missing table.
    const base = manifest.order.indexOf("frontend/supabase/migrations/20260729_spawn_growout_sync.sql");
    const amendment = manifest.order.indexOf("frontend/supabase/migrations/20260730_spawn_growout_promoted_type.sql");
    expect(base).toBeGreaterThanOrEqual(0);
    expect(amendment).toBeGreaterThan(base);
  });
});

describe("version prefixes stay representable in the Supabase CLI ledger", () => {
  // WHY THIS EXISTS. The Supabase CLI derives a migration's ledger `version` from the
  // leading digits of the filename, and `supabase_migrations.schema_migrations.version`
  // is unique. So two files sharing a prefix CANNOT both be recorded — the ledger
  // physically cannot represent them.
  //
  // That is the real reason `supabase migration list` shows applied migrations as
  // pending here, and the reason the standing instruction is to apply files
  // individually (scripts/sb-query.ps1) rather than with `supabase db push`.
  //
  // It is also why the drift was NOT "fixed" by inserting a synthetic ledger row:
  // recording version `20260731` once, to stand for three files, would make any
  // FUTURE `20260731_*.sql` silently count as already applied. Trading a noisy,
  // honest ledger for a quiet, wrong one is the worse deal — an unapplied migration
  // that everything reports as applied is exactly the failure this suite exists to
  // prevent.
  //
  // So the collisions are grandfathered and frozen, and new ones fail here.
  //
  // Only the repo-root `supabase/migrations` matters: that is the CLI project.
  // `frontend/supabase/migrations` is a folder of hand-applied SQL and is never
  // pushed, so its prefixes never reach a ledger.
  const GRANDFATHERED_COLLISIONS = {
    // Both applied 2026-07-29. Only `aquadex_listings_rls_lockdown` is in the ledger.
    20260729: 2,
    // All three applied 2026-07-31. None are in the ledger.
    20260731: 3,
  };

  function prefixCounts() {
    const counts = {};
    for (const name of readdirSync(repoPath("supabase/migrations"))) {
      if (!name.endsWith(".sql")) continue;
      const match = name.match(/^(\d+)_/);
      if (!match) continue;
      counts[match[1]] = (counts[match[1]] || 0) + 1;
    }
    return counts;
  }

  it("adds no NEW colliding version prefix", () => {
    // A new migration must carry a prefix no existing file uses — in practice a full
    // 14-digit `YYYYMMDDHHMMSS` stamp, which is what the CLI generates and what the
    // pre-20260728 files in this directory already use. Date-only prefixes are how
    // the collisions above happened.
    const collisions = Object.fromEntries(
      Object.entries(prefixCounts()).filter(([, count]) => count > 1)
    );
    expect(
      collisions,
      "a new migration shares a version prefix with an existing one — give it a full " +
        "YYYYMMDDHHMMSS stamp so the CLI ledger can record it"
    ).toEqual(GRANDFATHERED_COLLISIONS);
  });

  it("does not let the grandfathered list grow", () => {
    // The exception list is a record of past mistakes, not an allowance. Adding to it
    // should require editing this assertion and justifying why.
    expect(Object.keys(GRANDFATHERED_COLLISIONS).length).toBe(2);
  });
});

describe("the reasoning survives in the file", () => {
  it("records why there are two directories and why they were not merged", () => {
    // This is a rejected request, not an unbuilt one, so the reason has to outlive
    // whoever reads the register next. docs/ is gitignored; this file is not.
    const raw = readFileSync(repoPath("supabase/migration-order.json"), "utf8");
    expect(raw).toMatch(/overlap/i);
    expect(raw).toMatch(/§9\.5/);
    expect(raw).toMatch(/§6\.6/);
    expect(raw).toMatch(/config\.toml/);
  });

  it("tells the next person where a new migration goes", () => {
    const raw = readFileSync(repoPath("supabase/migration-order.json"), "utf8");
    expect(raw).toMatch(/ADDING A MIGRATION/);
  });
});
