import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEPTH_TIERS } from "../services/depthScoreApi";

function source(relativePath) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function stripComments(value) {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const API = stripComments(source("../../api/storefront-detail.js"));
const MODERATION_UI = stripComments(source("../components/reef/ModerationPanel.jsx"));
const MENTORSHIP_SERVICE = stripComments(source("../services/auditsApi.js"));
const PROFILE_UI = stripComments(source("../components/reef/PublicProfile.jsx"));
const AUTH = stripComments(source("../contexts/AuthContext.jsx"));
const MIGRATION = stripComments(source("../../../supabase/migrations/20260818120000_reef_trust_authority.sql"));

describe("Depth reputation stays separate from XP", () => {
  it("uses the verified-contribution ladder implemented by the database trigger", () => {
    expect(DEPTH_TIERS.map(({ key, min }) => [key, min])).toEqual([
      ["Shallow", 0],
      ["Coastal", 100],
      ["Pelagic", 500],
      ["Abyssal", 1500],
      ["Hadal", 5000],
    ]);
    for (const threshold of ["new_score >= 5000", "new_score >= 1500", "new_score >= 500", "new_score >= 100"]) {
      expect(MIGRATION).toContain(threshold);
    }
  });

  it("labels both ledgers and never falls back from Depth to XP", () => {
    expect(PROFILE_UI).toContain("XP Tier");
    expect(PROFILE_UI).toContain("Depth Reputation");
    expect(PROFILE_UI).toContain("fallbackScore={profile.depth_score ?? 0}");
    expect(PROFILE_UI).not.toMatch(/fallbackScore=\{[^}]*xp_total/);
    expect(PROFILE_UI).not.toMatch(/fallbackTier=\{[^}]*companion_tier/);
  });

  it("compares the old Depth tier before updating and secures only authoritative trigger writes", () => {
    expect(MIGRATION.indexOf("INTO old_score, old_tier")).toBeLessThan(MIGRATION.indexOf("UPDATE profiles"));
    expect(MIGRATION).toContain("old_tier IS DISTINCT FROM new_tier");
    expect(MIGRATION).toContain("ALTER FUNCTION depth_on_audit() SECURITY DEFINER");
    expect(MIGRATION).toContain("DROP TRIGGER IF EXISTS trigger_depth_on_insight_vote");
    expect(MIGRATION).not.toContain("ALTER FUNCTION depth_on_insight_vote() SECURITY DEFINER");
  });
});

describe("Reef trust operations use verified server identity", () => {
  it("registers all consolidated trust routes", () => {
    for (const [action, handler] of [
      ["mentors", "handleAvailableMentors"],
      ["mentorships", "handleMentorships"],
      ["expert-audits", "handleExpertAudits"],
      ["reef-report", "handleReefReport"],
      ["reef-moderation", "handleReefModeration"],
      ["review-reports", "handleReviewReports"],
    ]) {
      expect(API).toContain(`case "${action}":`);
      expect(API).toContain(`return ${handler}(req, res);`);
    }
  });

  it("requires both a verified Privy account and a fresh body-bound wallet signature", () => {
    const actorIdx = API.indexOf("async function resolveReefActor(req)");
    const actorBlock = API.slice(actorIdx, actorIdx + 2200);
    expect(actorBlock).toContain("verifyPrivyToken(req)");
    expect(actorBlock).toContain("ethers.utils.verifyMessage(buildReefTrustMessage({");
    expect(actorBlock).toContain("body: req.body");
    expect(actorBlock).toContain("REEF_TRUST_MAX_AGE_MS");

    const authorityIdx = API.indexOf("async function authorizeKeeperAuthority(req");
    const authorityBlock = API.slice(authorityIdx, authorityIdx + 1500);
    expect(authorityBlock).toContain("await resolveReefActor(req)");
    expect(authorityBlock).toContain('from("user_roles")');
    expect(authorityBlock).toContain('eq("active", true)');
    expect(authorityBlock).toContain("KEEPER_AUTHORITY_ROLES");
    expect(authorityBlock).not.toMatch(/req\.body\??\.\s*(wallet|reviewer)/i);
  });

  it("does not let browser components read or resolve the global moderation queue directly", () => {
    expect(MODERATION_UI).toContain("fetchModerationQueue(filter)");
    expect(MODERATION_UI).toContain("moderateFlag(flagId, action)");
    expect(MODERATION_UI).not.toMatch(/\.from\(["']moderation_flags["']\)/);
    expect(MIGRATION).toContain("GRANT EXECUTE ON FUNCTION moderate_reef_flag(UUID, TEXT, TEXT) TO service_role");
    expect(MIGRATION).toContain("REVOKE ALL ON FUNCTION moderate_reef_flag(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated");
  });

  it("routes mentorship mutations through the server and constrains transitions", () => {
    expect(MENTORSHIP_SERVICE).not.toMatch(/\.from\(["']mentorships["']\)/);
    const idx = API.indexOf("async function handleMentorships(req, res) {");
    const block = API.slice(idx, idx + 7500);
    expect(block).toContain('action === "request"');
    expect(block).toContain('supabase.rpc("transition_mentorship"');
    expect(MIGRATION).toContain("p_action = 'accept' AND NOT EXISTS");
    expect(MIGRATION).toContain("role IN ('founder', 'steward')");
    expect(MIGRATION).toContain('DROP POLICY IF EXISTS "Either party can update mentorship"');
  });

  it("registers and clears both Privy account and wallet-signature bridges", () => {
    expect(AUTH.indexOf("const getSigner = useCallback")).toBeLessThan(
      AUTH.indexOf("setReefTrustWalletSignerGetter(getSigner)")
    );
    expect(AUTH).toContain("setReefTrustSessionTokenGetter(getAccessToken)");
    expect(AUTH).toContain("setReefTrustWalletSignerGetter(getSigner)");
    expect((AUTH.match(/setReefTrustSessionTokenGetter\(null\)/g) || []).length).toBeGreaterThanOrEqual(2);
    expect((AUTH.match(/setReefTrustWalletSignerGetter\(null\)/g) || []).length).toBeGreaterThanOrEqual(2);
  });
});

describe("moderation decisions are atomic", () => {
  it("community and review handlers each call one service-role RPC", () => {
    const reefIdx = API.indexOf("async function handleReefModeration");
    const reefBlock = API.slice(reefIdx, reefIdx + 5000);
    expect(reefBlock).toContain('supabase.rpc("moderate_reef_flag"');
    expect(API).toContain('supabase.rpc("moderate_review_report"');
    expect(MIGRATION).toContain("UPDATE marketplace_reviews SET status = 'hidden'");
    expect(MIGRATION).toContain("UPDATE review_reports");
    expect(MIGRATION).toContain("IF NOT FOUND THEN RAISE EXCEPTION 'Flagged current no longer exists'");
    expect(MIGRATION).toContain("IF NOT FOUND THEN RAISE EXCEPTION 'Flagged profile no longer exists'");
  });
});
