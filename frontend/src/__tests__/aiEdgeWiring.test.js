/**
 * aiEdgeWiring.test.js — the three AI edge functions that nothing called, now
 * connected (supabase/migrations/20261006120000_ai_edge_wiring.sql).
 *
 *   content-moderation  ← a trigger on every new post and comment
 *   tide-narration      ← pg_cron every 15 minutes, live tides with activity only
 *   mentor-match        ← the mentor list in the profile's mentorship panel
 *
 * Plus the two fixes that came with it: dismissing an auto flag un-hides what
 * the auto check hid, and tide-lifecycle builds the recap for a tide that ends
 * on its own and no longer claims XP it never paid.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseMentorSpecies, mergeMentorRanking } from "../../api/_lib/mentorRanking.js";
import { keeperSpeciesFrom } from "../hooks/useKeeperSpecies.js";

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const SQL = read("../../../supabase/migrations/20261006120000_ai_edge_wiring.sql");
const SQL_CODE = SQL.replace(/--.*$/gm, "");
const ORDER = JSON.parse(read("../../../supabase/migration-order.json"));
const MODERATION = strip(read("../../../supabase/functions/content-moderation/index.ts"));
const LIFECYCLE = strip(read("../../../supabase/functions/tide-lifecycle/index.ts"));
const MENTOR_MATCH = strip(read("../../../supabase/functions/mentor-match/index.ts"));
const API = strip(read("../../api/storefront-detail.js"));
const PANEL = strip(read("../components/reef/MentorshipPanel.jsx"));

describe("content-moderation runs on new content", () => {
  it("is triggered after insert on currents and comments, through pg_net", () => {
    expect(SQL_CODE).toMatch(/CREATE TRIGGER trg_moderate_new_current\s+AFTER INSERT ON public\.currents/);
    expect(SQL_CODE).toMatch(/CREATE TRIGGER trg_moderate_new_comment\s+AFTER INSERT ON public\.comments/);
    expect(SQL_CODE).toContain("'/functions/v1/content-moderation'");
    expect(SQL_CODE).toContain("net.http_post(");
  });

  it("can never block a post: queueing failures are warnings", () => {
    const fn = SQL_CODE.slice(SQL_CODE.indexOf("FUNCTION public.queue_content_moderation"), SQL_CODE.indexOf("REVOKE ALL ON FUNCTION public.queue_content_moderation"));
    expect(fn).toMatch(/EXCEPTION WHEN OTHERS THEN\s+RAISE WARNING/);
    expect(fn).toMatch(/RETURN NEW;\s*END;\s*\$\$;?\s*$/);
    expect(fn).toContain("SECURITY DEFINER");
  });

  it("hides on its own only when the model is highly confident, and records that it did", () => {
    expect(MODERATION).toMatch(/const hide = verdict\.flagged && verdict\.confidence >= CONFIDENCE\.high/);
    expect(MODERATION).toContain("auto_hidden: hide");
    // A spam pattern alone only flags.
    expect(MODERATION).toMatch(/patternHit\) \{\s*verdict = \{ flagged: true, reason: "spam", confidence: CONFIDENCE\.medium/);
    // One auto flag per item.
    expect(MODERATION).toContain('.eq("auto_flagged", true)');
  });

  it("dismissing an auto flag un-hides what the auto check hid, unless a curator hid it", () => {
    expect(SQL_CODE).toContain("ADD COLUMN IF NOT EXISTS auto_hidden BOOLEAN NOT NULL DEFAULT false");
    const dismiss = SQL_CODE.slice(SQL_CODE.indexOf("IF p_action = 'dismiss' THEN"), SQL_CODE.indexOf("ELSIF p_action = 'hide' THEN"));
    expect(dismiss).toContain("flag_row.auto_hidden");
    expect(dismiss).toContain("other.action_taken = 'hide'");
    expect(dismiss).toContain("UPDATE currents SET is_hidden = false");
    expect(dismiss).toContain("UPDATE comments SET is_hidden = false");
    // Still server-only.
    expect(SQL_CODE).toContain("REVOKE ALL ON FUNCTION moderate_reef_flag(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated");
    expect(SQL_CODE).toContain("GRANT EXECUTE ON FUNCTION moderate_reef_flag(UUID, TEXT, TEXT) TO service_role");
  });
});

describe("tide narration and recaps", () => {
  it("narrates live tides every 15 minutes, only when something happened", () => {
    expect(SQL_CODE).toMatch(/cron\.schedule\(\s*'tide-narration',\s*'\*\/15 \* \* \* \*'/);
    expect(SQL_CODE).toContain("t.status = 'live'");
    expect(SQL_CODE).toContain("interval '15 minutes'");
    expect(SQL_CODE).toContain("'mode', 'narrate'");
  });

  it("tide-lifecycle builds the recap when a tide ends on its own", () => {
    expect(LIFECYCLE).toContain('supabase.rpc("build_tide_recap", { target_tide: tide.id })');
    expect(LIFECYCLE).toContain("requireServiceRole(req)");
  });

  it("tide-lifecycle no longer claims XP it never paid, or pre-marks check-in XP", () => {
    expect(LIFECYCLE).not.toMatch(/xp_awarded:\s*true/);
    expect(LIFECYCLE).not.toMatch(/\+\$\{xp\} XP/);
    expect(LIFECYCLE).not.toContain("distributeAttendanceXP");
  });

  it("the migration is in the apply order", () => {
    expect(ORDER.order).toContain("supabase/migrations/20261006120000_ai_edge_wiring.sql");
  });
});

describe("mentor suggestions", () => {
  it("mentor-match ranks the caller's list; it no longer picks mentors by tier", () => {
    expect(MENTOR_MATCH).toContain("requireServiceRole(req)");
    expect(MENTOR_MATCH).toContain("mentor_wallets");
    expect(MENTOR_MATCH).not.toMatch(/companion_tier", \["Master", "God-Tier"\]/);
  });

  it("the server still decides who is a mentor, then asks for a ranking", () => {
    const fn = API.slice(API.indexOf("async function handleAvailableMentors"), API.indexOf("async function rankMentors"));
    expect(fn.indexOf('.in("role", KEEPER_AUTHORITY_ROLES)')).toBeGreaterThan(-1);
    expect(fn.indexOf("rankMentors(")).toBeGreaterThan(fn.indexOf('.in("role", KEEPER_AUTHORITY_ROLES)'));
    expect(API).toContain("/functions/v1/mentor-match");
  });

  it("parses the keeper's species defensively", () => {
    expect(parseMentorSpecies('[{"c":2,"n":"Neon Tetra"},{"c":2,"n":"dupe"},{"c":-1,"n":"x"},{"c":5,"n":""},{"c":7,"n":"Betta\\nfish"}]'))
      .toEqual([{ specCode: 2, name: "Neon Tetra" }, { specCode: 7, name: "Betta fish" }]);
    expect(parseMentorSpecies("not json")).toEqual([]);
    expect(parseMentorSpecies(undefined)).toEqual([]);
    expect(parseMentorSpecies("x".repeat(5000))).toEqual([]);
  });

  it("a ranking only reorders and annotates the real list", () => {
    const mentors = [{ wallet_address: "0xa" }, { wallet_address: "0xB" }, { wallet_address: "0xc" }];
    const merged = mergeMentorRanking(mentors, [
      { wallet_address: "0xb", reason: "Writes about bettas.", shared_species: ["Betta"] },
      { wallet_address: "0xnot-a-mentor", reason: "nope" },
    ]);
    expect(merged.map((m) => m.wallet_address)).toEqual(["0xB", "0xa", "0xc"]);
    expect(merged[0]).toMatchObject({ match_reason: "Writes about bettas.", shared_species: ["Betta"] });
    expect(merged).toHaveLength(3);
  });

  it("reads the keeper's species through the catalog, once each, without plants", () => {
    const catalog = [
      { specCode: 10, scientificName: "Betta splendens", commonName: "Betta / Siamese Fighting Fish" },
      { specCode: 11, scientificName: "Vesicularia dubyana", commonName: "Java Moss", type: "plant" },
    ];
    const tanks = [
      { specimens: [{ scientificName: "Betta splendens", status: 0 }, { scientificName: "Vesicularia dubyana", status: 0 }] },
      { specimens: [{ scientificName: "Betta splendens", status: 0 }] },
      { active: false, specimens: [{ scientificName: "Betta splendens", status: 0 }] },
    ];
    expect(keeperSpeciesFrom(tanks, catalog)).toEqual([{ specCode: 10, name: "Betta" }]);
  });

  it("the panel shows Echo's reason when there is one", () => {
    expect(PANEL).toContain("mentor.match_reason &&");
    expect(PANEL).toContain('className="pf-mentor-why"');
  });
});
