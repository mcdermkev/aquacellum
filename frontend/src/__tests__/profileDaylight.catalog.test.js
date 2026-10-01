// @vitest-environment node
/**
 * profileDaylight.catalog.test.js
 *
 * Source guards for the View Profile page and the account menu on Daylight.
 *
 * 1. Opening a profile never asks the wallet to sign (commit 052ef54). Every
 *    Reef trust request signs (reefTrustApi.request), so the profile must not
 *    call one on mount: no trust API import, no mentorship hooks, and the
 *    moderation panels mount only after their toggle is pressed.
 * 2. Echo in the profile header is the Echo stream's markup, untouched.
 * 3. The Daylight rules: own stylesheet, 44px menu items, keyboard support in
 *    the account menu, no emoji or em dashes in the copy, plain words.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { containsProhibitedTerm } from "../services/orderCopy.js";

function source(relativePath) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function stripComments(value) {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const PROFILE = stripComments(source("../components/reef/PublicProfile.jsx"));
const PANEL = stripComments(source("../components/reef/MentorshipPanel.jsx"));
const DEPTH = stripComments(source("../components/reef/DepthScoreMeter.jsx"));
const BADGES = stripComments(source("../components/reef/BadgeShelf.jsx"));
const AUDIT = stripComments(source("../components/reef/ExpertAuditCard.jsx"));
const EDIT = stripComments(source("../components/reef/ProfileEdit.jsx"));
const FOLLOW = stripComments(source("../components/reef/FollowButton.jsx"));
const MESSAGE = stripComments(source("../components/reef/MessageButton.jsx"));
const INVITE = stripComments(source("../components/reef/SchoolInviteButton.jsx"));
const CONNECT = stripComments(source("../components/ConnectWallet.jsx"));
const PROFILE_CSS = source("../components/reef/ProfileDaylight.css");
const MENU_CSS = source("../components/AccountMenu.css");

// Pictographic emoji plus the arrow, check, cross, pencil, power and star
// glyphs the old copy used as icons.
const EMOJI = /[\p{Extended_Pictographic}\u2190-\u21FF\u2713\u2715\u270E\u23FB\u2605]/u;

describe("opening a profile never asks the wallet to sign", () => {
  it("PublicProfile makes no Reef trust request of its own", () => {
    expect(PROFILE).not.toMatch(/reefTrustApi/);
    expect(PROFILE).not.toMatch(/useMentorships\(/);
    expect(PROFILE).not.toMatch(/useAvailableMentors\(/);
    expect(PROFILE).not.toMatch(/fetchModerationQueue/);
    expect(PROFILE).not.toMatch(/fetchReviewReports/);
  });

  it("mounts the moderation panels only after their toggle is pressed", () => {
    expect(PROFILE).toContain("const [showModeration, setShowModeration] = useState(false)");
    expect(PROFILE).toContain("const [showReviewModeration, setShowReviewModeration] = useState(false)");
    const mod = PROFILE.indexOf("<ModerationPanel");
    const review = PROFILE.indexOf("<ReviewModerationPanel");
    expect(mod).toBeGreaterThan(0);
    expect(review).toBeGreaterThan(0);
    expect(PROFILE.slice(mod - 250, mod)).toContain("showModeration &&");
    expect(PROFILE.slice(review - 250, review)).toContain("showReviewModeration &&");
  });

  it("MentorshipPanel loads nothing on mount", () => {
    expect(PANEL).not.toMatch(/useEffect\(/);
    expect((PANEL.match(/setMentorshipsRequested\(true\)/g) || []).length).toBe(2);
  });
});

describe("Echo in the profile header is unchanged", () => {
  it("renders the Echo stream's Ask Echo button as it ships on master", () => {
    expect(PROFILE).toContain('import { EchoRenderer } from "../EchoRenderer"');
    expect(PROFILE).toContain('import { useEchoFace } from "../../hooks/useEchoFace"');
    expect(PROFILE).toContain('import { openEchoChat } from "../../services/echoChatBus"');
    expect(PROFILE).toContain("const echoFace = useEchoFace(true);");
    expect(PROFILE).toContain("<EchoRenderer size={92} expression={echoFace} animated />");
    const echo = PROFILE.indexOf("<EchoRenderer");
    const box = PROFILE.slice(echo - 250, echo);
    for (const attr of ['type="button"', 'className="reef-profile-echo"', "onClick={() => openEchoChat()}", 'aria-label="Ask Echo"', 'title="Ask Echo"']) {
      expect(box).toContain(attr);
    }
    // She sits inside the Daylight hero, which is the positioning context.
    const hero = PROFILE.indexOf('className="pf-hero"');
    expect(hero).toBeGreaterThan(0);
    expect(hero).toBeLessThan(echo);
    expect(PROFILE_CSS).toMatch(/\.pf-hero\s*\{[^}]*position:\s*relative/);
  });
});

describe("Daylight styling", () => {
  it("the profile uses its own scoped stylesheet", () => {
    expect(PROFILE).toContain('import "./ProfileDaylight.css"');
    expect(PROFILE).toContain('className="pf"');
    expect(PROFILE_CSS).toMatch(/\.pf-stat\s*\{/);
    expect(PROFILE_CSS).toMatch(/\.pf-card\s*\{/);
    expect(PROFILE_CSS).toMatch(/\.pf-section-title\s*\{/);
  });

  it("account menu items are at least 44px tall", () => {
    expect(CONNECT).toContain('import "./AccountMenu.css"');
    expect(MENU_CSS).toMatch(/\.acct-item\s*\{[^}]*min-height:\s*44px/);
    expect(MENU_CSS).toMatch(/\.acct-chip\s*\{[^}]*min-height:\s*44px/);
  });
});

describe("account menu keeps its roles and works from the keyboard", () => {
  it("keeps the portal, roles and actions", () => {
    expect(CONNECT).toContain('role="menu"');
    expect(CONNECT).toContain('aria-label="User menu"');
    expect((CONNECT.match(/role="menuitem"/g) || []).length).toBe(2);
    expect(CONNECT).toContain('aria-haspopup="menu"');
    expect(CONNECT).toContain("createPortal(");
    expect(CONNECT).toContain('"reef_view_profile"');
    expect(CONNECT).toContain('"poseidon:navigate"');
    expect(CONNECT).toContain("disconnect()");
  });

  it("handles arrows, Home, End and Escape", () => {
    for (const key of ['"ArrowDown"', '"ArrowUp"', '"Home"', '"End"', '"Escape"']) {
      expect(CONNECT).toContain(key);
    }
  });

  it("has no emoji in the menu", () => {
    const start = CONNECT.indexOf('role="menu"');
    const end = CONNECT.indexOf("document.body", start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(CONNECT.slice(start, end)).not.toMatch(EMOJI);
  });
});

describe("profile copy", () => {
  const FILES = { PROFILE, DEPTH, PANEL, EDIT, MESSAGE, INVITE, AUDIT, FOLLOW };

  it("uses Phosphor icons, not emoji", () => {
    for (const [name, text] of Object.entries(FILES)) {
      expect(text, name).not.toMatch(EMOJI);
    }
    // Badge art keeps its emoji (gamification layer); nothing after the list.
    const idx = BADGES.indexOf("function getUnlockedBadges");
    expect(idx).toBeGreaterThan(0);
    expect(BADGES.slice(idx)).not.toMatch(EMOJI);
  });

  it("has no em dashes", () => {
    for (const [name, text] of Object.entries({ ...FILES, BADGES })) {
      expect(text, name).not.toContain("\u2014");
    }
  });

  it("drops claims the product does not back", () => {
    // There is no mentor XP multiplier (api/validate-xp.js).
    expect(PANEL).not.toMatch(/XP multiplier/i);
    // An auditor's tier is not invented when it is missing.
    expect(AUDIT).not.toContain('|| "Master"');
  });

  it("keeps the new visible strings plain", () => {
    const strings = [
      "Back to The Reef",
      "We couldn't load your profile",
      "Reload the page or sign in again.",
      "Setting up your profile…",
      "Profile not found",
      "We couldn't find this keeper's profile.",
      "Edit profile",
      "Tankmates",
      "Connected",
      "Request sent",
      "Add tankmate",
      "Add a note (optional)",
      "Top tier reached",
      "Community Reputation",
      "Depth Reputation",
      "Tank reviews",
      "Expert audits",
      "Mentorship",
      "Moderation tools",
      "Review reports",
      "Tank updates",
      "Posts",
      "No posts yet.",
      "Depth is separate from XP. Verified expert audits raise it.",
      "Depth is community trust, separate from your points. Verified helpful contributions raise it.",
      "Recent Depth changes",
      "No Depth changes yet.",
      "What is Depth?",
      "Accept mentees",
      "Let other keepers ask you to be their mentor.",
      "Become a mentor",
      "Mentor status",
      "Mentoring is granted to founders and stewards. XP and Depth do not unlock it.",
      "How mentors are chosen",
      "Mentee requests",
      "Your mentees",
      "Waiting for a reply",
      "Find a mentor",
      "Request mentorship",
      "Send request",
      "Expert auditor",
      "Expert audit",
      "Achievements",
      "Badges",
      "Change profile photo",
      "Display name",
      "Save changes",
      "Data and privacy",
      "Export your data or delete your account in Settings.",
      "Open Settings",
      "Message",
      "Invite to a club",
      "Choose a club",
      "Following",
      "Follow",
      "View profile",
      "Close logbook",
      "Disconnect",
    ];
    const all = [PROFILE, DEPTH, PANEL, EDIT, MESSAGE, INVITE, AUDIT, FOLLOW, BADGES, CONNECT].join("\n")
      .replace(/&apos;/g, "'");
    for (const text of strings) {
      expect(all, text).toContain(text);
      expect(containsProhibitedTerm(text), text).toBe(false);
      expect(text).not.toContain("!");
      expect(text).not.toContain("\u2014");
    }
  });
});
