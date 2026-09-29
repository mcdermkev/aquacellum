/**
 * profiles column lockdown (20261003_profiles_private_columns.sql).
 *
 * The migration grants browser roles SELECT on an explicit column list. Any
 * browser read of another column (or select("*")) then fails with 42501, which
 * supabase-js surfaces as an empty result in most call sites. These source-level
 * checks keep the client inside the allowlist:
 *   - the JS allowlist equals the migration's GRANT list
 *   - every `from("profiles").select("...")` and every embedded
 *     `profiles...(cols)` in src/ and the public HTML pages only names allowed
 *     columns, with one exception: the pre-migration fallback in profileColumns.js
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { PUBLIC_PROFILE_COLUMN_LIST } from "../services/profileColumns.js";

const FRONTEND = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel) => readFileSync(path.join(FRONTEND, rel), "utf8");

function sourceFiles() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === "__tests__" || name === "node_modules") continue;
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(jsx?)$/.test(name)) out.push(full);
    }
  };
  walk(path.join(FRONTEND, "src"));
  walk(path.join(FRONTEND, "public", "js"));
  for (const name of readdirSync(FRONTEND)) if (name.endsWith(".html")) out.push(path.join(FRONTEND, name));
  return out;
}

describe("profiles column allowlist", () => {
  const migration = read("supabase/migrations/20261003_profiles_private_columns.sql");

  it("matches the migration's GRANT list exactly", () => {
    const grant = migration.match(/grant select \(([\s\S]*?)\) on table public\.profiles to anon, authenticated;/);
    expect(grant, "GRANT SELECT (...) not found in the migration").not.toBeNull();
    const granted = grant[1].split(",").map((c) => c.trim()).filter(Boolean).sort();
    expect(granted).toEqual([...PUBLIC_PROFILE_COLUMN_LIST].sort());
  });

  it("keeps email and other private fields out of the public list", () => {
    for (const col of ["email", "notification_preferences", "privacy_settings", "reward_credits", "is_banned",
      "banned_at", "muted_until", "zone_transfer_cooldown", "deletion_requested_at", "account_deleted_at"]) {
      expect(PUBLIC_PROFILE_COLUMN_LIST).not.toContain(col);
    }
  });

  it("every browser read of profiles names only allowed columns", () => {
    const allowed = new Set(PUBLIC_PROFILE_COLUMN_LIST);
    const violations = [];
    for (const file of sourceFiles()) {
      const rel = path.relative(FRONTEND, file).replace(/\\/g, "/");
      // Drop comments (prose like "two FKs to profiles (participant_a, ...)" is not a query).
      const text = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");

      const direct = /from\(\s*["']profiles["']\s*\)\s*\.select\(\s*(["'`])([^"'`]*)\1/g;
      let m;
      while ((m = direct.exec(text))) {
        const cols = m[2].split(",").map((c) => c.trim()).filter(Boolean);
        for (const c of cols) {
          if (c === "*" && rel === "src/services/profileColumns.js") continue; // pre-migration fallback
          if (!allowed.has(c)) violations.push(`${rel}: select ${c}`);
        }
      }

      // Embedded resources: profiles(...), profiles:author_wallet(...), alias:profiles!fk(...)
      const embed = /profiles(?:![a-z_]+|:[a-z_]+)?\s*\(([^()]*)\)/g;
      while ((m = embed.exec(text))) {
        if (/[{};=`]/.test(m[1])) continue; // a JS call such as searchProfiles(query), not a select
        for (const c of m[1].split(",").map((x) => x.trim()).filter(Boolean)) {
          if (!allowed.has(c)) violations.push(`${rel}: embed ${c}`);
        }
      }

      // A direct REST read of /rest/v1/profiles must name its columns.
      if (/rest\/v1\/profiles\?/.test(text) && !/rest\/v1\/profiles\?[^`'"]*select=/.test(text)) {
        violations.push(`${rel}: /rest/v1/profiles without select=`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("reefApi profile reads use the allowlist, not select('*')", () => {
    const reef = read("src/services/reefApi.js");
    const profileBlock = reef.slice(0, reef.indexOf("export async function checkDisplayNameAvailable"));
    expect(profileBlock).not.toMatch(/\.select\(\s*["']\*["']\s*\)/);
    expect(profileBlock).not.toMatch(/\.select\(\s*\)/);
    expect(profileBlock).toMatch(/withOwnPrivateFields/);
  });
});
