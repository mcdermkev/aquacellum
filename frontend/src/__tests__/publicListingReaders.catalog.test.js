/**
 * Fish Finder Rework T14 — guards on the anonymous listing read path.
 *
 * The static marketing pages are plain <script> HTML, so (following this
 * project's source-guard convention) these assert the contract over the file
 * text: no public page may read the RAW aquadex_listings table, and the shared
 * helper must prefer the display-safe view.
 *
 * This is the regression that matters most: the raw-table read is trivially
 * easy to reintroduce (it's one word shorter), and nothing else would catch it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const PUBLIC_PAGES = ["marketplace.html", "species.html", "store.html", "database.html"];

function readFrontendFile(relative) {
  return readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), "utf8");
}

const HELPER = readFrontendFile("public/js/public-listings.js");

describe("public pages never read the raw aquadex_listings table", () => {
  for (const page of PUBLIC_PAGES) {
    it(`${page} does not query aquadex_listings directly`, () => {
      const src = readFrontendFile(page);
      // Match a REST path to the base table but not to the *_public view.
      const rawRead = /rest\/v1\/aquadex_listings(?!_public)/.test(src);
      expect(rawRead).toBe(false);
    });
  }

  for (const page of ["marketplace.html", "species.html", "store.html"]) {
    it(`${page} loads the shared helper before using it`, () => {
      // HTML comments are stripped first: they mention the global by name, and
      // a comment is not a call site.
      const src = readFrontendFile(page).replace(/<!--[\s\S]*?-->/g, "");
      const tagAt = src.indexOf('<script src="/js/public-listings.js">');
      expect(tagAt).toBeGreaterThan(-1);
      // Every call must appear after the script tag, or the global is undefined
      // at call time (these pages put their other /js includes at the bottom).
      const firstCall = src.search(/AquadexPublicListings\s*\./);
      expect(firstCall).toBeGreaterThan(tagAt);
    });
  }
});

describe("public-listings.js helper", () => {
  it("targets the display-safe view first", () => {
    expect(HELPER).toContain('var PUBLIC_VIEW = "aquadex_listings_public"');
    // The view must be the first relation attempted.
    expect(HELPER.indexOf("get(PUBLIC_VIEW)")).toBeGreaterThan(-1);
    expect(HELPER.indexOf("get(PUBLIC_VIEW)")).toBeLessThan(HELPER.indexOf("get(BASE_TABLE)"));
  });

  it("warns when it falls back, so an un-migrated environment is not silent", () => {
    expect(HELPER).toContain("falling back to");
    expect(HELPER).toContain("20260728_aquadex_listings_public_view.sql");
  });

  it("never throws — a listing fetch failure must not blank the page", () => {
    expect(HELPER).toContain(".catch(");
    expect(HELPER).toContain("return [];");
  });

  it("parses both blob shapes, matching the writer's JSON.stringify", () => {
    expect(HELPER).toContain('typeof row.data === "string" ? JSON.parse(row.data) : row.data');
  });
});

describe("staged purge of legacy fabricated location data (D3 follow-up)", () => {
  const PURGE = readFrontendFile("supabase/checks/aquadex_listings_purge_legacy_location.sql");
  const PURGE_CODE = PURGE.replace(/^\s*--.*$/gm, "");

  it("stays out of migrations/ because it mutates data irreversibly", () => {
    expect(PURGE).toContain("MUTATES DATA");
    expect(PURGE).toContain("supabase/checks/");
  });

  it("strips only the two fabricated keys", () => {
    expect(PURGE_CODE).toContain("data - 'fuzzedLocation' - 'zoneHash'");
    // Must not rewrite the blob wholesale — every other field is preserved.
    expect(PURGE_CODE).not.toMatch(/set\s+data\s*=\s*'\{/);
  });

  it("is idempotent: only touches rows that actually carry a stripped key", () => {
    expect(PURGE_CODE).toContain("data ? 'fuzzedLocation' or data ? 'zoneHash'");
  });

  it("handles the string-scalar blob case that `-` would otherwise error on", () => {
    expect(PURGE_CODE).toContain("jsonb_typeof(data) = 'string'");
    expect(PURGE_CODE).toContain("(data #>> '{}')::jsonb");
  });

  it("does not bump updated_at, which would reorder the public marketplace", () => {
    expect(PURGE_CODE).not.toMatch(/updated_at\s*=/);
  });

  it("is transactional", () => {
    expect(PURGE_CODE).toContain("begin;");
    expect(PURGE_CODE).toContain("commit;");
  });
});

describe("staged RLS lockdown", () => {
  const LOCKDOWN = readFrontendFile("supabase/checks/aquadex_listings_rls_lockdown.sql");
  /** Executable statements only — the prose documents the rollback and the
   *  superseded approach, both of which contain SQL-shaped text. */
  const LOCKDOWN_CODE = LOCKDOWN.replace(/^\s*--.*$/gm, "");

  it("stays out of migrations/ so db push cannot auto-apply it", () => {
    expect(LOCKDOWN).toContain("DO NOT APPLY YET");
    expect(LOCKDOWN).toContain("supabase/checks/");
  });

  it("drops the anon read policy and does NOT re-scope reads to `authenticated`", () => {
    expect(LOCKDOWN_CODE).toContain('drop policy if exists "listings_select_public" on public.aquadex_listings');
    // The superseded fix created an `authenticated`-only SELECT policy, which
    // would have blanked both the public site and any in-app session whose JWT
    // bridge fell back to anon. This file creates no SELECT policy at all.
    expect(LOCKDOWN_CODE).not.toMatch(/create\s+policy/i);
  });

  it("leaves seller write policies alone (read-access change only)", () => {
    for (const p of ["listings_insert_own", "listings_update_own", "listings_delete_own"]) {
      expect(LOCKDOWN_CODE).not.toMatch(new RegExp(`drop policy if exists "${p}"`));
    }
  });

  it("documents a single-statement rollback", () => {
    expect(LOCKDOWN).toContain("ROLLBACK");
    expect(LOCKDOWN).toContain('create policy "listings_select_public"');
  });
});
